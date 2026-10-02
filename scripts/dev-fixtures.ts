// Development fixtures for the gate: an organizer, an event, ticket types, tickets bound to
// test device keys and signed by a development server key, and a staff code, so the API
// and the gate app can be tried locally end to end. Local database only. Everything here
// is fictitious: every key is derived from a public label, signs only fixture tickets and
// is never used outside a local machine.
//
//   node scripts/dev-fixtures.ts seed [count]  create it all (idempotent); prints the staff
//                                              code and the SERVER_PUBLIC_KEYS for .dev.vars
//   node scripts/dev-fixtures.ts list          each fixture ticket: index, code, type, state
//   node scripts/dev-fixtures.ts qr <n>        the QR text of ticket n, valid now
//   node scripts/dev-fixtures.ts images        QR images (SVG) and codes in .dev-fixtures/
//   node scripts/dev-fixtures.ts serve [port]  a local page with live QR codes to scan from
//                                              the screen (http://localhost:8790)
//
// A credential is valid for its 30-second window and two on each side (ADR 0014): a QR
// image works for about two minutes. `serve` draws fresh ones every 20 seconds.
//
// Connects with DATABASE_URL (default: the local database) and requires psql on PATH, like
// scripts/db.ts, or DB_CONTAINER naming the local database's Docker container. The staff
// code needs SIGN_IN_PEPPER, read from workers/api/.dev.vars.
import { spawnSync } from "node:child_process";
import { createHash, createHmac, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import QRCode from "qrcode";
import { encodeBase64url } from "../packages/contracts/src/index.ts";
import {
  formatHumanCode,
  humanCode,
  presentCredential,
  type ServerSigner,
  type Signer,
  signCertificate,
} from "../packages/crypto/src/index.ts";

const ROOT = process.cwd();
const LOCAL_URL = "postgres://passripple@localhost:54329/passripple";
const DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_URL;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);
const OUT_DIR = join(ROOT, ".dev-fixtures");

const DEV_ORG_ID = "d0000000-0000-4000-8000-000000000001";
const DEV_EVENT_ID = "d0000000-0000-4000-8000-000000000003";
const DEV_ORGANIZER_EMAIL = "organizer@example.test";
const DEV_SERVER_KEY_ID = 1;

// Without psql on PATH, set DB_CONTAINER to run it inside the local database's container
// (`DB_CONTAINER=passripple-db`).
function psql(input: string): string {
  const args = ["-X", "-q", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1"];
  const container = process.env.DB_CONTAINER;
  const result = container
    ? spawnSync(
        "docker",
        ["exec", "-i", container, "psql", "-U", "passripple", "-d", "passripple", ...args],
        {
          input,
          encoding: "utf8",
        },
      )
    : spawnSync("psql", [DATABASE_URL, ...args], { input, encoding: "utf8" });
  if (result.error) throw new Error(`could not run psql: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`.trim());
  return result.stdout;
}

function sha256(label: string): Buffer {
  return createHash("sha256").update(label).digest();
}

// PKCS #8 prefix of a raw 32-byte Ed25519 seed.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** An Ed25519 signer whose seed is the SHA-256 of a public label. */
function labelSigner(label: string): Signer {
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, sha256(label)]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  const publicKey = new Uint8Array(Buffer.from(String(jwk.x), "base64url"));
  return {
    publicKey,
    async sign(message) {
      return new Uint8Array(sign(null, message, privateKey));
    },
  };
}

const serverSigner: ServerSigner = {
  ...labelSigner("PassRipple development server key"),
  keyId: DEV_SERVER_KEY_ID,
};

function holderSigner(index: number): Signer {
  // Every fourth buyer holds two tickets on one phone, to try burst mode (6.5).
  return labelSigner(`PassRipple development holder ${index - (index % 4 === 1 ? 1 : 0)}`);
}

function fixtureCode(index: number): string {
  return humanCode(sha256(`PassRipple development ticket ${index}`).subarray(0, 6));
}

const DEV_STAFF_CODE = humanCode(sha256("PassRipple development staff code").subarray(0, 6));

interface Plan {
  readonly index: number;
  readonly type: "General" | "VIP" | "Staff";
  /** bound: has a credential; issued: manual code only; void: voided after binding. */
  readonly state: "bound" | "issued" | "void";
}

function plan(count: number): Plan[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    type: index >= count - 2 ? "Staff" : index % 10 === 9 ? "VIP" : "General",
    state: index === 3 ? "issued" : index === 4 ? "void" : "bound",
  }));
}

function hex(bytes: Uint8Array): string {
  return `'\\x${Buffer.from(bytes).toString("hex")}'::bytea`;
}

function serverKeysJson(): string {
  return JSON.stringify([
    { id: DEV_SERVER_KEY_ID, publicKey: encodeBase64url(serverSigner.publicKey) },
  ]);
}

/** SIGN_IN_PEPPER from workers/api/.dev.vars, if it is there. */
function devPepper(): string | null {
  const file = join(ROOT, "workers", "api", ".dev.vars");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("SIGN_IN_PEPPER="));
  const value = line?.slice("SIGN_IN_PEPPER=".length).trim();
  return value ? value : null;
}

/** The same keyed hash as the API's staffCodeHash (workers/api/src/secrets.ts). */
function staffCodeHash(pepper: string, code: string): Buffer {
  return createHmac("sha256", Buffer.from(pepper, "base64"))
    .update(["PassRipple/staff-code/v1", code].join("\u0000"))
    .digest();
}

function seed(count: number): void {
  const lines = [
    "BEGIN;",
    `INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
       VALUES ('dev', 'Development canton', 500, '{}', 'next_business_day') ON CONFLICT DO NOTHING;`,
    `INSERT INTO identity.organizations (id, name) VALUES ('${DEV_ORG_ID}', 'Development organization')
       ON CONFLICT DO NOTHING;`,
    `INSERT INTO identity.users (email) VALUES ('${DEV_ORGANIZER_EMAIL}') ON CONFLICT DO NOTHING;`,
    `INSERT INTO identity.memberships (org_id, user_id)
       SELECT '${DEV_ORG_ID}', id FROM identity.users WHERE email = '${DEV_ORGANIZER_EMAIL}'
       ON CONFLICT DO NOTHING;`,
    `INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating,
                                permitted_capacity)
       VALUES ('${DEV_EVENT_ID}', '${DEV_ORG_ID}', 'dev', 'Development event', 'Development venue',
               date_trunc('hour', now()) - interval '1 hour', date_trunc('hour', now()) + interval '2 days',
               'all', 1000)
       ON CONFLICT DO NOTHING;`,
    `INSERT INTO catalog.ticket_types (event_id, name, price_crc, audience, entry_mode) VALUES
       ('${DEV_EVENT_ID}', 'General', 5000, 'public', 'single_use'),
       ('${DEV_EVENT_ID}', 'VIP', 15000, 'public', 'single_use'),
       ('${DEV_EVENT_ID}', 'Staff', 0, 'staff', 'multi_scan')
       ON CONFLICT DO NOTHING;`,
    "SELECT identity.set_actor(NULL, 'system', NULL);",
  ];
  for (const ticket of plan(count)) {
    const code = fixtureCode(ticket.index);
    const holder = holderSigner(ticket.index);
    lines.push(
      `DO $fixture$ DECLARE v_id uuid; BEGIN
         IF NOT EXISTS (SELECT 1 FROM ticketing.tickets WHERE code_human = '${code}') THEN
           SELECT ticketing.issue('${DEV_EVENT_ID}',
                                  (SELECT id FROM catalog.ticket_types WHERE event_id = '${DEV_EVENT_ID}'
                                      AND name = '${ticket.type}'),
                                  gen_random_uuid(), 'sale', '${code}') INTO v_id;
           ${ticket.state === "issued" ? "" : `PERFORM ticketing.bind(v_id, ${hex(holder.publicKey)}, 'bind');`}
           ${ticket.state === "void" ? "UPDATE ticketing.tickets SET status = 'void' WHERE id = v_id;" : ""}
         END IF;
       END $fixture$;`,
    );
  }
  const pepper = devPepper();
  if (pepper !== null) {
    lines.push(
      `INSERT INTO staff.staff_codes (event_id, code_hash, role, valid_from, valid_until, max_uses, created_by)
         SELECT '${DEV_EVENT_ID}', ${hex(staffCodeHash(pepper, DEV_STAFF_CODE))}, 'gate',
                e.starts_at - interval '1 day', e.ends_at, 50, u.id
           FROM events.events e, identity.users u
          WHERE e.id = '${DEV_EVENT_ID}' AND u.email = '${DEV_ORGANIZER_EMAIL}'
         ON CONFLICT (code_hash) DO NOTHING;`,
    );
  }
  lines.push("COMMIT;");
  psql(lines.join("\n"));

  console.log(`Seeded ${count} fixture tickets for event ${DEV_EVENT_ID} ("Development event").`);
  console.log(`Organizer: ${DEV_ORGANIZER_EMAIL} (organization ${DEV_ORG_ID})`);
  if (pepper === null) {
    console.log("\nNo staff code: set SIGN_IN_PEPPER in workers/api/.dev.vars and run seed again.");
  } else {
    console.log(`Staff code (gate, 50 uses): ${formatHumanCode(DEV_STAFF_CODE)}`);
  }
  console.log("\nPut this line in workers/api/.dev.vars:\n");
  console.log(`SERVER_PUBLIC_KEYS=${serverKeysJson()}`);
}

interface FixtureTicket {
  readonly index: number;
  readonly id: string;
  readonly code: string;
  readonly type: string;
  readonly typeRef: number;
  readonly entryMode: "single_use" | "multi_scan";
  readonly status: string;
  readonly keyVersion: number;
}

function fixtureTickets(): FixtureTicket[] {
  const out = psql(
    `SELECT t.code_human, t.id, tt.name, tt.ref, t.entry_mode, t.status, t.key_version
       FROM ticketing.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
      WHERE t.event_id = '${DEV_EVENT_ID}';\n`,
  );
  const byCode = new Map(
    out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [code = "", ...rest] = line.split("|");
        return [code, rest] as const;
      }),
  );
  const tickets: FixtureTicket[] = [];
  for (let index = 0; index < 1000; index++) {
    const code = fixtureCode(index);
    const row = byCode.get(code);
    if (row === undefined) break;
    const [id = "", type = "", ref, entryMode, status = "", keyVersion] = row;
    tickets.push({
      index,
      id,
      code,
      type,
      typeRef: Number(ref),
      entryMode: entryMode === "multi_scan" ? "multi_scan" : "single_use",
      status,
      keyVersion: Number(keyVersion),
    });
  }
  if (tickets.length === 0) throw new Error("no fixture tickets: run seed first");
  return tickets;
}

/** The QR text of a bound fixture ticket, valid now; null if it has no credential. */
async function qrText(ticket: FixtureTicket): Promise<string | null> {
  if (ticket.keyVersion === 0) return null;
  const holder = holderSigner(ticket.index);
  const certificate = await signCertificate(
    {
      ticketId: ticket.id,
      eventId: DEV_EVENT_ID,
      typeRef: ticket.typeRef,
      entryMode: ticket.entryMode,
      ageRating: "all",
      named: false,
      holderPubkey: holder.publicKey,
      keyVersion: ticket.keyVersion,
    },
    serverSigner,
  );
  return presentCredential(certificate, holder, Date.now());
}

function svg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}

function list(): void {
  for (const ticket of fixtureTickets()) {
    console.log(
      `${ticket.index}\t${formatHumanCode(ticket.code)}\t${ticket.type}\t${ticket.status}\tkey v${ticket.keyVersion}`,
    );
  }
}

async function qr(index: number): Promise<void> {
  const ticket = fixtureTickets().find((candidate) => candidate.index === index);
  if (ticket === undefined) throw new Error(`fixture ticket ${index} does not exist`);
  const text = await qrText(ticket);
  if (text === null)
    throw new Error(`fixture ticket ${index} is not bound: it has no QR, only its code`);
  console.log(text);
}

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

async function page(): Promise<string> {
  const cards: string[] = [];
  for (const ticket of fixtureTickets()) {
    const text = await qrText(ticket);
    const image = text === null ? "<p>Sin QR: solo código manual</p>" : await svg(text);
    cards.push(`<figure><div class="qr">${image}</div><figcaption><b>#${ticket.index} ${escapeHtml(ticket.type)}</b><br>
      ${formatHumanCode(ticket.code)}<br><small>${escapeHtml(ticket.status)}</small></figcaption></figure>`);
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>PassRipple · entradas de prueba</title><meta http-equiv="refresh" content="20">
<style>body{font-family:system-ui;margin:16px;background:#fff;color:#0b0b14}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
figure{margin:0;border:1px solid #dadce0;border-radius:12px;padding:12px;text-align:center}.qr svg{width:100%;height:auto}</style></head>
<body><h1>Entradas de prueba (ficticias, solo local)</h1>
<p>Evento de desarrollo · código de staff: <b>${formatHumanCode(DEV_STAFF_CODE)}</b> · Cada QR vale unos 2 minutos; esta página se renueva cada 20 s.</p>
<main>${cards.join("\n")}</main></body></html>`;
}

async function images(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const codes: string[] = [`Staff code: ${formatHumanCode(DEV_STAFF_CODE)}`, ""];
  for (const ticket of fixtureTickets()) {
    codes.push(
      `${ticket.index}\t${formatHumanCode(ticket.code)}\t${ticket.type}\t${ticket.status}`,
    );
    const text = await qrText(ticket);
    if (text !== null)
      writeFileSync(
        join(OUT_DIR, `ticket-${String(ticket.index).padStart(2, "0")}.svg`),
        await svg(text),
      );
  }
  writeFileSync(join(OUT_DIR, "codes.txt"), `${codes.join("\n")}\n`);
  writeFileSync(join(OUT_DIR, "index.html"), await page());
  console.log(
    `Wrote QR images and codes to ${OUT_DIR}. They are valid for about two minutes; use serve for live ones.`,
  );
}

function serve(port: number): void {
  const server = createServer((request, response) => {
    if (request.url !== "/" && request.url !== "/index.html") {
      response.writeHead(404).end();
      return;
    }
    page().then(
      (html) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html),
      (error: Error) =>
        response.writeHead(500, { "content-type": "text/plain" }).end(error.message),
    );
  });
  // Local only: the page is for this machine's screen.
  server.listen(port, "127.0.0.1", () =>
    console.log(`Live test tickets on http://localhost:${port} (Ctrl+C to stop)`),
  );
}

if (!LOCAL_HOSTS.has(new URL(DATABASE_URL).hostname)) {
  console.error("dev-fixtures only runs against the local database.");
  process.exit(1);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "seed") seed(arg === undefined ? 20 : Number.parseInt(arg, 10));
  else if (command === "list") list();
  else if (command === "qr" && arg !== undefined) await qr(Number.parseInt(arg, 10));
  else if (command === "images") await images();
  else if (command === "serve") serve(arg === undefined ? 8790 : Number.parseInt(arg, 10));
  else {
    console.error(
      "usage: node scripts/dev-fixtures.ts <seed [count]|list|qr <n>|images|serve [port]>",
    );
    process.exit(2);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
