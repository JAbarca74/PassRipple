import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Env } from "../env.ts";
import {
  buildMimeMessage,
  createMailSender,
  gmailMailSender,
  resetGmailTokenCache,
} from "./mail.ts";

let privateKeyPem: string;
let publicKey: CryptoKey;

function pem(der: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(der)) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

function fromBase64url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
}

function decodeUtf8Base64url(text: string): string {
  return new TextDecoder().decode(fromBase64url(text));
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  privateKeyPem = pem((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  publicKey = pair.publicKey;
});

beforeEach(() => resetGmailTokenCache());

function env(overrides: Record<string, string | undefined> = {}): Env {
  return {
    MAIL_PROVIDER: "gmail",
    MAIL_FROM_ADDRESS: "no-reply@passripple.com",
    MAIL_FROM_NAME: "PassRipple",
    GMAIL_CLIENT_EMAIL: "mailer@passripple.iam.gserviceaccount.com",
    GMAIL_PRIVATE_KEY: privateKeyPem,
    ...overrides,
  } as Env;
}

function fakeGoogle(expiresIn = 3600) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({ access_token: `token-${calls.length}`, expires_in: expiresIn });
    }
    return Response.json({ id: "sent" });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const message = {
  to: "staff@example.com",
  subject: "Su código de PassRipple",
  text: "Su código es 123456.",
};

describe("gmailMailSender", () => {
  test("trades a signed JWT for a token and sends the message as the mailbox", async () => {
    const google = fakeGoogle();
    await gmailMailSender(env(), google.fetchImpl, () => 1_700_000_000_000).send(message);

    expect(google.calls).toHaveLength(2);
    const [tokenCall, sendCall] = google.calls;
    if (!tokenCall || !sendCall) throw new Error("expected a token call and a send call");
    expect(tokenCall.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(tokenCall.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const [header, claims, signature] = String(form.get("assertion")).split(".");
    expect(JSON.parse(decodeUtf8Base64url(String(header)))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(decodeUtf8Base64url(String(claims)))).toEqual({
      iss: "mailer@passripple.iam.gserviceaccount.com",
      sub: "no-reply@passripple.com",
      scope: "https://www.googleapis.com/auth/gmail.send",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      fromBase64url(String(signature)),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);

    expect(sendCall.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect((sendCall.init.headers as Record<string, string>).authorization).toBe("Bearer token-1");
    const raw = JSON.parse(String(sendCall.init.body)).raw as string;
    expect(raw).not.toMatch(/[+/=]/);
    expect(decodeUtf8Base64url(raw)).toBe(
      buildMimeMessage({ address: "no-reply@passripple.com", name: "PassRipple" }, message),
    );
  });

  test("acts as GMAIL_SENDER_USER when set", async () => {
    const google = fakeGoogle();
    await gmailMailSender(
      env({ GMAIL_SENDER_USER: "mailbox@passripple.com" }),
      google.fetchImpl,
    ).send(message);
    const form = new URLSearchParams(String(google.calls[0]?.init.body));
    const claims = JSON.parse(
      decodeUtf8Base64url(String(form.get("assertion")).split(".")[1] ?? ""),
    );
    expect(claims.sub).toBe("mailbox@passripple.com");
  });

  test("accepts a private key with \\n escapes, as pasted from the JSON key file", async () => {
    const google = fakeGoogle();
    const escaped = privateKeyPem.replace(/\n/g, "\\n");
    await expect(
      gmailMailSender(env({ GMAIL_PRIVATE_KEY: escaped }), google.fetchImpl).send(message),
    ).resolves.toBeUndefined();
  });

  test("reuses the token until shortly before it expires", async () => {
    const google = fakeGoogle(3600);
    let clock = 1_700_000_000_000;
    const sender = gmailMailSender(env(), google.fetchImpl, () => clock);
    await sender.send(message);
    clock += 30 * 60_000;
    await sender.send(message);
    expect(google.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);

    clock += 30 * 60_000; // past expiry minus the one-minute margin
    await sender.send(message);
    expect(google.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(2);
  });

  test("fails when Google refuses the token", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized_client", { status: 401 }));
    await expect(
      gmailMailSender(env(), fetchImpl as unknown as typeof fetch).send(message),
    ).rejects.toThrow(/token endpoint answered 401: unauthorized_client/);
  });

  test("fails when the token answer has no access token", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "x" }));
    await expect(
      gmailMailSender(env(), fetchImpl as unknown as typeof fetch).send(message),
    ).rejects.toThrow(/without an access token/);
  });

  test("fails when Gmail refuses the message", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("oauth2")
        ? Response.json({ access_token: "t", expires_in: 3600 })
        : new Response("forbidden", { status: 403 }),
    );
    await expect(
      gmailMailSender(env(), fetchImpl as unknown as typeof fetch).send(message),
    ).rejects.toThrow(/Gmail answered 403: forbidden/);
  });

  test("needs the service account settings", () => {
    expect(() => gmailMailSender(env({ GMAIL_PRIVATE_KEY: undefined }))).toThrow(
      /GMAIL_PRIVATE_KEY/,
    );
    expect(() => gmailMailSender(env({ GMAIL_CLIENT_EMAIL: undefined }))).toThrow(
      /GMAIL_CLIENT_EMAIL/,
    );
  });
});

describe("buildMimeMessage", () => {
  test("encodes accented headers and the body in UTF-8", () => {
    const mime = buildMimeMessage(
      { address: "no-reply@passripple.com", name: "PassRipple Puerta" },
      message,
    );
    const [head, body] = mime.split("\r\n\r\n");
    expect(head).toContain("To: staff@example.com");
    expect(head).toContain("Content-Type: text/plain; charset=UTF-8");
    const subject = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(String(head))?.[1];
    expect(
      new TextDecoder().decode(Uint8Array.from(atob(String(subject)), (c) => c.charCodeAt(0))),
    ).toBe("Su código de PassRipple");
    const text = new TextDecoder().decode(
      Uint8Array.from(atob(String(body).replace(/\r\n/g, "")), (c) => c.charCodeAt(0)),
    );
    expect(text).toBe("Su código es 123456.");
  });

  test("uses the bare address when there is no display name", () => {
    expect(buildMimeMessage({ address: "a@passripple.com" }, message)).toContain(
      "From: a@passripple.com\r\n",
    );
  });

  test("wraps long bodies at 76 characters", () => {
    const mime = buildMimeMessage(
      { address: "a@passripple.com" },
      { ...message, text: "x".repeat(300) },
    );
    const body = mime.split("\r\n\r\n")[1] ?? "";
    for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
  });

  test("refuses headers that would inject more headers", () => {
    expect(() =>
      buildMimeMessage(
        { address: "a@passripple.com" },
        { ...message, to: "x@example.com\r\nBcc: y@example.com" },
      ),
    ).toThrow(/single line/);
    expect(() =>
      buildMimeMessage({ address: "a@passripple.com" }, { ...message, subject: "a\nb" }),
    ).toThrow(/single line/);
    expect(() => buildMimeMessage({ address: "a@passripple.com", name: "a\rb" }, message)).toThrow(
      /single line/,
    );
  });
});

describe("createMailSender", () => {
  test("picks Gmail for MAIL_PROVIDER=gmail", () => {
    expect(createMailSender(env(), "https://api.passripple.com/x")).toHaveProperty("send");
  });

  test("names every provider when MAIL_PROVIDER is unknown", () => {
    expect(() => createMailSender(env({ MAIL_PROVIDER: "carrier-pigeon" }), "https://x/")).toThrow(
      "MAIL_PROVIDER must be gmail, ses or log",
    );
  });
});
