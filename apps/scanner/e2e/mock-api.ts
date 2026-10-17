// A stand-in for the PassRipple API, for the gate app's UI flows (Maestro) in CI. It answers
// every route the app calls, in the shared wire format, for one fixture event with one bound
// ticket. Every key is derived from a public label: nothing here is a secret.
//
//   node apps/scanner/e2e/mock-api.ts
//
// GET /e2e/qr returns the ticket's QR text, valid now: a credential lives for its 30-second
// window and two on each side (ADR 0014), so a flow asks for it right before scanning.

import { randomUUID } from "node:crypto";
import * as http from "node:http";
import { encodeGateManifest, encodeGateManifestDelta } from "@passripple/contracts";
import {
  buildGateManifest,
  buildGateManifestDelta,
} from "../../../modules/manifest/src/gate-manifest.ts";
import { signCertificate } from "../../../packages/crypto/src/certificate.ts";
import { presentCredential } from "../../../packages/crypto/src/credential.ts";
import { createServerSigner, createSigner } from "../../../packages/crypto/src/testing.ts";

const PORT = 8787;
const HOUR_MS = 3_600_000;

const serverSigner = createServerSigner("e2e mock server key", 1);
const holder = createSigner("e2e mock holder key");
const serverKeys = [{ id: 1, publicKey: serverSigner.publicKey }];

const eventId = randomUUID();
const ticketId = randomUUID();
const userId = randomUUID();
const deviceId = randomUUID();
const startedAt = Date.now();
const startsAt = new Date(startedAt - HOUR_MS);
const endsAt = new Date(startedAt + 6 * HOUR_MS);

const certificate = await signCertificate(
  {
    ticketId,
    eventId,
    typeRef: 1,
    entryMode: "single_use",
    ageRating: "all",
    named: false,
    holderPubkey: holder.publicKey,
    keyVersion: 1,
  },
  serverSigner,
);

const manifestInput = {
  event: {
    event_id: eventId,
    name: "Evento de prueba",
    venue_name: "Sede de prueba",
    starts_at: startsAt,
    ends_at: endsAt,
    age_rating: "all" as const,
    device_zone: null,
  },
  serverKeys,
  ticketTypes: [
    { ref: 1, name: "General", zone: null, entry_mode: "single_use" as const, audience: "public" },
  ],
  tickets: [
    {
      ticket_id: ticketId,
      type_ref: 1,
      entry_mode: "single_use" as const,
      status: "bound" as const,
      redeemed: false,
      holder_pubkey: holder.publicKey,
      key_version: 1,
      code_human: "E2E0000001",
    },
  ],
  cursor: "1",
};

const device = {
  deviceId,
  eventId,
  role: "gate",
  zone: null,
  validFrom: startsAt.toISOString(),
  validUntil: endsAt.toISOString(),
  status: "active",
};

type Reply = { status: number; body?: unknown; text?: string };

async function route(method: string, path: string, url: URL, body: unknown): Promise<Reply> {
  const key = `${method} ${path}`;
  switch (key) {
    case "GET /v1/health":
      return { status: 200, body: { status: "ok" } };
    case "GET /e2e/qr":
      return { status: 200, text: await presentCredential(certificate, holder, Date.now()) };
    case "POST /v1/auth/sign-in":
      return { status: 200, body: { expiresInSeconds: 600 } };
    case "POST /v1/auth/verify":
      return {
        status: 200,
        body: {
          token: "e2e-user-token",
          userId,
          expiresAt: new Date(Date.now() + HOUR_MS).toISOString(),
        },
      };
    case "POST /v1/staff/enroll":
      return { status: 200, body: { deviceToken: "e2e-device-token", device } };
    case "GET /v1/gate/session":
      return { status: 200, body: { device, serverTime: Date.now() } };
    case "GET /v1/gate/manifest": {
      const since = url.searchParams.get("since");
      if (since === null) {
        return {
          status: 200,
          body: encodeGateManifest(buildGateManifest({ ...manifestInput, serverTime: Date.now() })),
        };
      }
      const delta = buildGateManifestDelta({
        ...manifestInput,
        tickets: [],
        since,
        serverTime: Date.now(),
      });
      return { status: 200, body: encodeGateManifestDelta(delta) };
    }
    case "POST /v1/gate/batches": {
      const items = (body as { items?: { id: string; opType: string }[] } | null)?.items ?? [];
      const results = items.map((item) =>
        item.opType === "incident"
          ? { id: item.id, status: "applied" }
          : { id: item.id, status: "applied", outcome: "admitted" },
      );
      return { status: 200, body: { results, serverTime: Date.now() } };
    }
    case "POST /v1/gate/sign-out":
    case "POST /v1/auth/sign-out":
    case "DELETE /v1/account":
      return { status: 204 };
    default:
      return { status: 404, body: { error: { code: "not_found", message: `No route ${key}` } } };
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(text.length > 0 ? JSON.parse(text) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const reply = await route(req.method ?? "GET", url.pathname, url, await readBody(req));
  console.log(`${req.method} ${url.pathname}${url.search} -> ${reply.status}`);
  res.setHeader("X-Server-Time", Date.now().toString());
  if (reply.text !== undefined) {
    res.writeHead(reply.status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(reply.text);
  } else if (reply.body !== undefined) {
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  } else {
    res.writeHead(reply.status);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Mock API on http://localhost:${PORT}, event ${eventId}, ticket ${ticketId}`);
});
