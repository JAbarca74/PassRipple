// 100 gate devices uploading batches at the same time (design 9.8): no operation may be
// lost. Each device scans tickets of carga-puerta (a share of them twice, as at a real door)
// and uploads them in batches of up to 100, then uploads its last batch again, as a device
// does when the answer is lost. Every operation must come back applied or duplicate, never
// rejected or missing (I6).
//
//   k6 run -e API=https://<test api>/v1 scripts/load/gate.js
//
// Devices and tickets come from scripts/load/seed.sql: device n has the token
// prd_load-device-<n>, and ticket n the id 10adc000-0000-4000-8000-<n in hex>.

import { check } from "k6";
import http from "k6/http";
import { Counter } from "k6/metrics";

const API = (__ENV.API || "http://localhost:8787/v1").replace(/\/+$/, "");
const DEVICES = Number(__ENV.DEVICES ?? 100);
const BATCHES = Number(__ENV.BATCHES ?? 5);
const BATCH_SIZE = Number(__ENV.BATCH_SIZE ?? 100);
const TICKETS = 5000;

const sent = new Counter("gate_ops_sent");
const lost = new Counter("gate_ops_lost");

export const options = {
  scenarios: {
    gates: { executor: "per-vu-iterations", vus: DEVICES, iterations: 1, maxDuration: "5m" },
  },
  thresholds: {
    gate_ops_lost: ["count==0"],
    "http_req_duration{name:batch}": ["p(95)<1000"],
  },
};

function hex(n, width) {
  return n.toString(16).padStart(width, "0");
}

/** A UUIDv7: the device's clock in the first 48 bits, then random bits. */
function uuidv7() {
  const time = hex(Date.now(), 12);
  let random = "";
  for (let i = 0; i < 20; i++) random += hex(Math.floor(Math.random() * 16), 1);
  const variant = hex(8 + Math.floor(Math.random() * 4), 1);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(0, 3)}-${variant}${random.slice(3, 6)}-${random.slice(6, 18)}`;
}

function ticketId(n) {
  return `10adc000-0000-4000-8000-${hex(n, 12)}`;
}

function upload(token, items) {
  const res = http.post(`${API}/gate/batches`, JSON.stringify({ items }), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    tags: { name: "batch" },
  });
  const results = res.status === 200 ? res.json("results") : [];
  const byId = new Map(results.map((result) => [result.id, result.status]));
  let missing = 0;
  for (const item of items) {
    const status = byId.get(item.id);
    if (status !== "applied" && status !== "duplicate") missing++;
  }
  lost.add(missing);
  check(res, { "batch answered 200 with every operation stored": () => missing === 0 });
  return res;
}

export default function () {
  const device = __VU;
  const token = `prd_load-device-${device}`;
  let seq = 0;
  let last = null;
  for (let b = 0; b < BATCHES; b++) {
    const items = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      // Tickets spread over the event; about one in ten was already scanned somewhere.
      const n = 1 + ((device * 997 + seq * 31) % TICKETS);
      items.push({
        id: uuidv7(),
        deviceSeq: seq++,
        opType: "redemption",
        createdAt: Date.now(),
        clockOffsetMs: 0,
        payload: { ticketId: ticketId(n), method: "qr", idChecked: false, inManifest: true },
      });
    }
    sent.add(items.length);
    upload(token, items);
    last = items;
  }
  // The answer to the last batch was "lost": the device sends it again.
  if (last) upload(token, last);
}
