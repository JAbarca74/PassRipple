// Checks the mock API against the shared wire schemas, the way the gate app reads it, and
// verifies that the QR it serves is admitted against its own manifest. Run it with the
// mock listening:
//
//   node apps/scanner/e2e/mock-api.ts & node apps/scanner/e2e/check-mock-api.ts

import {
  decodeGateManifest,
  decodeGateManifestDelta,
  enrollResponse,
  gateBatchResponse,
  gateSessionResponse,
  signInResponse,
  userSession,
} from "@passripple/contracts";
import type { z } from "zod";
import { verifyCredential } from "../../../packages/crypto/src/credential.ts";

const BASE = process.env.MOCK_API_URL ?? "http://localhost:8787";
let failures = 0;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

function check(name: string, ok: boolean): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures += 1;
}

async function json(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await call(method, path, body);
  check(
    `${method} ${path} answers 2xx with X-Server-Time`,
    response.ok && Number(response.headers.get("x-server-time")) > 0,
  );
  return response.json();
}

function matches(name: string, schema: z.ZodType, value: unknown): void {
  check(name, schema.safeParse(value).success);
}

matches(
  "sign-in",
  signInResponse,
  await json("POST", "/v1/auth/sign-in", { email: "staff@example.com" }),
);
matches(
  "verify",
  userSession,
  await json("POST", "/v1/auth/verify", { email: "staff@example.com", code: "123456" }),
);
matches(
  "enroll",
  enrollResponse,
  await json("POST", "/v1/staff/enroll", {
    staffCode: "ABCD12345",
    platform: "ios",
    appVersion: "1.0.0",
    integrityToken: null,
  }),
);
matches("gate session", gateSessionResponse, await json("GET", "/v1/gate/session"));

const manifest = decodeGateManifest(await json("GET", "/v1/gate/manifest"));
check("full manifest decodes", manifest !== null);
const delta = decodeGateManifestDelta(
  await json("GET", `/v1/gate/manifest?since=${encodeURIComponent(manifest?.cursor ?? "1")}`),
);
check("manifest delta decodes", delta !== null);

matches(
  "batch",
  gateBatchResponse,
  await json("POST", "/v1/gate/batches", {
    items: [{ id: "00000000-0000-7000-8000-000000000001", opType: "redemption" }],
  }),
);

const qr = await (await call("GET", "/e2e/qr")).text();
if (manifest !== null) {
  const serverKeys = new Map(manifest.serverKeys.map((key) => [key.id, key.publicKey]));
  const verdict = verifyCredential(qr, { serverKeys, eventId: manifest.eventId }, Date.now());
  check("the QR verifies against the manifest's keys and event", verdict.ok);
  if (verdict.ok) {
    check(
      "the QR's ticket is in the manifest",
      manifest.tickets.some((ticket) => ticket.ticketId === verdict.credential.ticketId),
    );
  }
}

for (const path of ["/v1/gate/sign-out", "/v1/auth/sign-out"]) {
  check(`POST ${path} answers 204`, (await call("POST", path)).status === 204);
}

console.log(
  failures === 0 ? "\nThe mock API matches the app's contracts." : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
