import * as http from "node:http";
import { parse } from "node:url";
import { encodeGateManifest } from "@passripple/contracts";
import { buildGateManifest } from "../../../modules/manifest/src/gate-manifest.ts";
import { signCertificate } from "../../../packages/crypto/src/certificate.ts";
import { presentCredential } from "../../../packages/crypto/src/credential.ts";
import { createServerSigner, createSigner } from "../../../packages/crypto/src/testing.ts";

const port = 8787;

async function run() {
  const serverSigner = createServerSigner("mock_server_key", 1);
  const holder = createSigner("mock_holder_key");
  const serverKeys = [{ id: 1, publicKey: serverSigner.publicKey }];

  // mock ticket
  const ticketId = "11111111-1111-1111-1111-111111111111";
  const eventId = "22222222-2222-2222-2222-222222222222";

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

  const qr = await presentCredential(certificate, holder, Date.now());

  const manifest = buildGateManifest({
    event: {
      event_id: eventId,
      name: "Mock Event",
      venue_name: "Mock Venue",
      starts_at: new Date(Date.now() - 3600000),
      ends_at: new Date(Date.now() + 3600000),
      age_rating: "all",
      device_zone: null,
    },
    serverKeys,
    ticketTypes: [
      {
        ref: 1,
        name: "Mock Ticket",
        zone: null,
        entry_mode: "single_use",
        audience: "public",
      },
    ],
    tickets: [
      {
        ticket_id: ticketId,
        type_ref: 1,
        entry_mode: "single_use",
        status: "issued",
        redeemed: false,
        holder_pubkey: holder.publicKey,
        key_version: 1,
        code_human: "MOCKCODE01",
      },
    ],
    cursor: "1",
    serverTime: Date.now(),
  });

  const manifestBytes = encodeGateManifest(manifest);

  const httpServer = http.createServer((req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-org-id");
    res.setHeader("X-Server-Time", Date.now().toString());

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = parse(req.url || "", true);
    const path = parsedUrl.pathname;

    if (req.method === "GET" && path === "/v1/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.method === "POST" && path === "/v1/auth/staff/session") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token: "prd_mocktoken123" }));
    } else if (req.method === "GET" && path === "/v1/gate/manifest") {
      res.writeHead(200, { "Content-Type": "application/json" });
      // The encodeGateManifest returns a base64url string.
      res.end(JSON.stringify(manifestBytes));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  httpServer.listen(port, () => {
    console.log(`Mock API running on port ${port}`);
    console.log(`QR for flow: ${qr}`);
  });
}

run().catch(console.error);
