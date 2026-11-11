// The big on-sale (design 9.8): BUYERS buyers at once trying to buy the 10,000 seats of
// carga-a, while carga-b keeps selling at a steady pace. Each buyer places one order of 1 to
// 4 tickets and repeats the same request with the same Idempotency-Key (a double tap), which
// must return the same order. Run scripts/load/verify.sql afterwards: zero overselling and
// zero duplicate orders.
//
//   k6 run -e API=https://<test api>/v1 -e BUYERS=5000 scripts/load/purchase.js
//
// Thresholds: the hold (POST /orders) under 1 s at p95 on both events; the steady event's
// p95 is the isolation measure (compare with a run of -e BUYERS=0).

import { check } from "k6";
import http from "k6/http";
import { Counter } from "k6/metrics";

const API = (__ENV.API || "http://localhost:8787/v1").replace(/\/+$/, "");
const BUYERS = Number(__ENV.BUYERS ?? 5000);
const STEADY_RATE = Number(__ENV.STEADY_RATE ?? 5);
const DURATION = __ENV.DURATION || "3m";
// Distinguishes runs, so buyers' contacts and keys never repeat between runs.
const RUN = __ENV.RUN || String(Date.now());

const ticketsHeld = new Counter("tickets_held");
const soldOut = new Counter("sold_out");
const unexpected = new Counter("unexpected_answers");
const duplicateOrders = new Counter("duplicate_orders");

const scenarios = {
  steady: {
    executor: "constant-arrival-rate",
    rate: STEADY_RATE,
    timeUnit: "1s",
    duration: DURATION,
    preAllocatedVUs: 20,
    maxVUs: 100,
    exec: "steady",
  },
};
if (BUYERS > 0) {
  scenarios.rush = {
    executor: "per-vu-iterations",
    vus: BUYERS,
    iterations: 1,
    maxDuration: DURATION,
    exec: "rush",
  };
}

export const options = {
  scenarios,
  thresholds: {
    "http_req_duration{name:hold carga-a}": ["p(95)<1000"],
    "http_req_duration{name:hold carga-b}": ["p(95)<1000"],
    unexpected_answers: ["count==0"],
    duplicate_orders: ["count==0"],
  },
};

function eventPage(slug) {
  const res = http.get(`${API}/events/${slug}`, { tags: { name: `event ${slug}` } });
  if (res.status !== 200) throw new Error(`GET /events/${slug}: ${res.status} ${res.body}`);
  const body = res.json();
  return {
    eventId: body.event.id,
    ticketTypeId: body.ticketTypes[0].id,
    termsVersion: body.legal.termsVersion,
    privacyVersion: body.legal.privacyVersion,
  };
}

export function setup() {
  return { a: eventPage("carga-a"), b: eventPage("carga-b") };
}

/** 32 random characters of base64url: the browser's idempotency key. */
function randomKey() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let key = "";
  for (let i = 0; i < 32; i++) key += alphabet[Math.floor(Math.random() * 64)];
  return key;
}

function buy(event, slug, contact) {
  const quantity = 1 + Math.floor(Math.random() * 4);
  const key = randomKey();
  const body = JSON.stringify({
    eventId: event.eventId,
    ticketTypeId: event.ticketTypeId,
    quantity,
    contact,
    termsVersion: event.termsVersion,
    privacyVersion: event.privacyVersion,
    marketing: false,
  });
  const params = {
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    tags: { name: `hold ${slug}` },
  };
  const first = http.post(`${API}/orders`, body, params);
  if (first.status === 201) {
    ticketsHeld.add(quantity, { event: slug });
    // The double tap: same key, same order.
    const again = http.post(`${API}/orders`, body, { ...params, tags: { name: `retry ${slug}` } });
    if (again.status !== 200 && again.status !== 201) {
      unexpected.add(1, { event: slug, status: String(again.status) });
      check(again, { "retry answered": () => false });
      return;
    }
    const same = again.json("orderCode") === first.json("orderCode");
    if (!same) duplicateOrders.add(1, { event: slug });
    check(again, { "a retry returns the same order": () => same });
    return;
  }
  const code = first.status === 409 ? first.json("error.code") : null;
  if (code === "sold_out") {
    soldOut.add(1, { event: slug });
    return;
  }
  unexpected.add(1, { event: slug, status: String(first.status) });
  check(first, { "hold answered 201 or sold_out": () => false });
}

export function rush(data) {
  buy(data.a, "carga-a", `rush-${RUN}-${__VU}-${__ITER}@load.test`);
}

export function steady(data) {
  buy(data.b, "carga-b", `steady-${RUN}-${__VU}-${__ITER}@load.test`);
}
