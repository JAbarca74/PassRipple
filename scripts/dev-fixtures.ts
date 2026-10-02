// Development fixtures for the gate: an event with tickets bound to deterministic device
// keys and signed by a development server key, so the API and the gate app can be tried
// locally end to end. Local database only; nothing here is a secret, because every key is
// derived from a public label and only ever signs fixture tickets.
//
//   node scripts/dev-fixtures.ts seed [count]  create the event and its tickets (idempotent)
//                                              and print the SERVER_PUBLIC_KEYS for .dev.vars
//   node scripts/dev-fixtures.ts qr <n>        print a QR for fixture ticket n, valid now
//   node scripts/dev-fixtures.ts list          print each fixture ticket's index, code and state
//
// Connects with DATABASE_URL (default: the local database) and requires psql on PATH, like
// scripts/db.ts, or DB_CONTAINER naming the local database's Docker container.
import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { encodeBase64url } from "../packages/contracts/src/index.ts";
import {
  formatHumanCode,
  humanCode,
  presentCredential,
  type ServerSigner,
  type Signer,
  signCertificate,
} from "../packages/crypto/src/index.ts";

const LOCAL_URL = "postgres://passripple@localhost:54329/passripple";
const DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_URL;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);

const DEV_ORG_ID = "d0000000-0000-4000-8000-000000000001";
const DEV_ORGANIZER_ID = "d0000000-0000-4000-8000-000000000002";
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
  return labelSigner(`PassRipple development holder ${index}`);
}

function fixtureCode(index: number): string {
  return humanCode(sha256(`PassRipple development ticket ${index}`).subarray(0, 6));
}

interface Plan {
  readonly index: number;
  readonly type: "General" | "VIP" | "Staff";
  /** bound: has a credential; issued: manual code only; void: voided after binding. */
  readonly state: "bound" | "issued" | "void";
}

function plan(count: number): Plan[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    type: index % 10 === 9 ? "VIP" : index >= count - 2 ? "Staff" : "General",
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

function seed(count: number): void {
  const lines = [
    "BEGIN;",
    `INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
       VALUES ('dev', 'Development canton', 500, '{}', 'next_business_day') ON CONFLICT DO NOTHING;`,
    `INSERT INTO identity.organizations (id, name) VALUES ('${DEV_ORG_ID}', 'Development organization')
       ON CONFLICT DO NOTHING;`,
    `INSERT INTO identity.users (id, email) VALUES ('${DEV_ORGANIZER_ID}', '${DEV_ORGANIZER_EMAIL}')
       ON CONFLICT DO NOTHING;`,
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
  lines.push("COMMIT;");
  psql(lines.join("\n"));
  console.log(`Seeded ${count} fixture tickets for event ${DEV_EVENT_ID}.`);
  console.log(`Organizer: ${DEV_ORGANIZER_EMAIL} (organization ${DEV_ORG_ID})`);
  console.log("\nPut this line in workers/api/.dev.vars:\n");
  console.log(`SERVER_PUBLIC_KEYS=${serverKeysJson()}`);
}

interface TicketRow {
  id: string;
  typeRef: number;
  entryMode: "single_use" | "multi_scan";
  status: string;
  keyVersion: number;
}

function ticketByIndex(index: number): TicketRow {
  const code = fixtureCode(index);
  const out = psql(
    `SELECT t.id, tt.ref, t.entry_mode, t.status, t.key_version
       FROM ticketing.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
      WHERE t.code_human = '${code}';\n`,
  ).trim();
  const [id, ref, entryMode, status, keyVersion] = out.split("|");
  if (!id) throw new Error(`fixture ticket ${index} does not exist: run seed first`);
  return {
    id,
    typeRef: Number(ref),
    entryMode: entryMode === "multi_scan" ? "multi_scan" : "single_use",
    status: status ?? "",
    keyVersion: Number(keyVersion),
  };
}

async function qr(index: number): Promise<void> {
  const ticket = ticketByIndex(index);
  if (ticket.keyVersion === 0)
    throw new Error(`fixture ticket ${index} is not bound: it has no credential`);
  const holder = holderSigner(index);
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
  console.log(await presentCredential(certificate, holder, Date.now()));
}

function list(): void {
  const out = psql(
    `SELECT t.code_human, tt.name, t.status, t.key_version
       FROM ticketing.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
      WHERE t.event_id = '${DEV_EVENT_ID}';\n`,
  );
  const byCode = new Map(
    out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.split("|")[0], line]),
  );
  for (let index = 0; index < 1000; index++) {
    const line = byCode.get(fixtureCode(index));
    if (!line) break;
    const [code = "", type, status, keyVersion] = line.split("|");
    console.log(`${index}\t${formatHumanCode(code)}\t${type}\t${status}\tkey v${keyVersion}`);
  }
}

if (!LOCAL_HOSTS.has(new URL(DATABASE_URL).hostname)) {
  console.error("dev-fixtures only runs against the local database.");
  process.exit(1);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "seed") seed(arg === undefined ? 20 : Number.parseInt(arg, 10));
  else if (command === "qr" && arg !== undefined) await qr(Number.parseInt(arg, 10));
  else if (command === "list") list();
  else {
    console.error("usage: node scripts/dev-fixtures.ts <seed [count]|qr <n>|list>");
    process.exit(2);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
