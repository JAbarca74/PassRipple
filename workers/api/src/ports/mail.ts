// Outgoing email behind a port (rule R5): the routes know a MailSender, not a provider.
// Gmail through Google Workspace in production (ADR 0028), Amazon SES as the alternative it
// replaced, and a console sender for local development that refuses to run anywhere but
// localhost, so a misconfigured deployment cannot leak sign-in codes to logs.

import { AwsClient } from "aws4fetch";
import { type Env, required } from "../env.ts";

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A private-network IPv4 address (RFC 1918): a phone on the developer's Wi-Fi reaches the local API through one. */
const PRIVATE_IPV4 =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || PRIVATE_IPV4.test(hostname);
}

/** Prints messages instead of sending them. Local development only. */
export function consoleMailSender(requestUrl: string): MailSender {
  return {
    async send(message) {
      if (!isLocalHost(new URL(requestUrl).hostname)) {
        throw new Error(
          "the console mail sender only runs on localhost or a private network address",
        );
      }
      console.log(`[mail] to ${message.to}: ${message.subject}\n${message.text}`);
    },
  };
}

/** Amazon SES, API v2, signed with SigV4. */
export function sesMailSender(env: Env): MailSender {
  const region = required(env, "SES_REGION");
  const client = new AwsClient({
    accessKeyId: required(env, "SES_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "SES_SECRET_ACCESS_KEY"),
    region,
    service: "ses",
  });
  const fromAddress = required(env, "MAIL_FROM_ADDRESS");
  const from = env.MAIL_FROM_NAME ? `${env.MAIL_FROM_NAME} <${fromAddress}>` : fromAddress;
  return {
    async send(message) {
      const response = await client.fetch(
        `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            FromEmailAddress: from,
            Destination: { ToAddresses: [message.to] },
            Content: {
              Simple: {
                Subject: { Data: message.subject, Charset: "UTF-8" },
                Body: { Text: { Data: message.text, Charset: "UTF-8" } },
              },
            },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`SES answered ${response.status}: ${await response.text()}`);
      }
    },
  };
}

// ── Gmail (Google Workspace) ─────────────────────────────────────────────────
// The Gmail API, sending as a Workspace mailbox through a service account with domain-wide
// delegation limited to the gmail.send scope (ADR 0028). The service account signs a JWT
// (RS256, WebCrypto) and trades it for an access token, cached until shortly before it
// expires. Workspace caps a mailbox at about 2,000 messages a day.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** Renew this long before Google's expiry, so a token never dies mid-request. */
const TOKEN_MARGIN_MS = 60_000;

interface CachedToken {
  readonly key: string;
  readonly token: string;
  readonly expiresAt: number;
}
let cachedToken: CachedToken | null = null;

/** Forgets the cached access token. For tests. */
export function resetGmailTokenCache(): void {
  cachedToken = null;
}

function bytesBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function utf8Base64(text: string): string {
  return bytesBase64(new TextEncoder().encode(text));
}

function base64url(input: Uint8Array | string): string {
  const base64 = typeof input === "string" ? utf8Base64(input) : bytesBase64(input);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A header value in RFC 2047 encoded-word form, so accents survive. */
function encodedWord(text: string): string {
  return `=?UTF-8?B?${utf8Base64(text)}?=`;
}

function assertHeaderSafe(name: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`mail header ${name} must be a single line`);
}

/** The RFC 5322 message Gmail sends, as UTF-8 text. */
export function buildMimeMessage(
  from: { readonly address: string; readonly name?: string | undefined },
  message: MailMessage,
): string {
  assertHeaderSafe("to", message.to);
  assertHeaderSafe("subject", message.subject);
  assertHeaderSafe("from", from.address);
  if (from.name !== undefined) assertHeaderSafe("from name", from.name);
  const fromHeader = from.name ? `${encodedWord(from.name)} <${from.address}>` : from.address;
  const body = utf8Base64(message.text).replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${fromHeader}`,
    `To: ${message.to}`,
    `Subject: ${encodedWord(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** The service account's PKCS #8 key, from PEM. Accepts `\n` escapes as pasted from the JSON key file. */
async function importServiceAccountKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function serviceAccountAssertion(
  clientEmail: string,
  privateKeyPem: string,
  subject: string,
  nowMs: number,
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: clientEmail,
      sub: subject,
      scope: GMAIL_SEND_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const key = await importServiceAccountKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

export function gmailMailSender(
  env: Env,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): MailSender {
  const clientEmail = required(env, "GMAIL_CLIENT_EMAIL");
  const privateKey = required(env, "GMAIL_PRIVATE_KEY");
  const fromAddress = required(env, "MAIL_FROM_ADDRESS");
  // The mailbox the service account acts as; MAIL_FROM_ADDRESS must be it or one of its
  // send-as aliases.
  const mailbox = env.GMAIL_SENDER_USER || fromAddress;
  const cacheKey = `${clientEmail}|${mailbox}`;

  async function accessToken(): Promise<string> {
    const current = now();
    if (cachedToken !== null && cachedToken.key === cacheKey && cachedToken.expiresAt > current) {
      return cachedToken.token;
    }
    const assertion = await serviceAccountAssertion(clientEmail, privateKey, mailbox, current);
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!response.ok) {
      throw new Error(
        `Google token endpoint answered ${response.status}: ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new Error("Google token endpoint answered without an access token");
    }
    cachedToken = {
      key: cacheKey,
      token: body.access_token,
      expiresAt: current + body.expires_in * 1000 - TOKEN_MARGIN_MS,
    };
    return body.access_token;
  }

  return {
    async send(message) {
      const raw = base64url(
        buildMimeMessage({ address: fromAddress, name: env.MAIL_FROM_NAME }, message),
      );
      const response = await fetchImpl(GMAIL_SEND_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ raw }),
      });
      if (!response.ok) {
        throw new Error(`Gmail answered ${response.status}: ${await response.text()}`);
      }
    },
  };
}

export function createMailSender(env: Env, requestUrl: string): MailSender {
  switch (env.MAIL_PROVIDER) {
    case "gmail":
      return gmailMailSender(env);
    case "ses":
      return sesMailSender(env);
    case "log":
      return consoleMailSender(requestUrl);
    default:
      throw new Error("MAIL_PROVIDER must be gmail, ses or log");
  }
}
