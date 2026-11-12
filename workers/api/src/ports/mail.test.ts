import { AwsClient } from "aws4fetch";
import { describe, expect, test, vi } from "vitest";
import type { Env } from "../env.ts";
import { consoleMailSender, createMailSender, sesMailSender } from "./mail.ts";

vi.mock("aws4fetch", () => {
  return {
    // biome-ignore lint/complexity/useArrowFunction: vitest requires function for constructors
    AwsClient: vi.fn(function () {
      return { fetch: vi.fn() };
    }),
  };
});

describe("consoleMailSender", () => {
  test("logs message on localhost", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const sender = consoleMailSender("http://localhost:8080/test");

    await sender.send({ to: "a@b.com", subject: "S", text: "T" });

    expect(consoleSpy).toHaveBeenCalledWith("[mail] to a@b.com: S\nT");
    consoleSpy.mockRestore();
  });

  test("throws if not localhost", async () => {
    const sender = consoleMailSender("https://example.com/test");
    await expect(sender.send({ to: "a", subject: "b", text: "c" })).rejects.toThrow(/localhost/);
  });

  test("accepts private ipv4 addresses", async () => {
    const urls = [
      "http://192.168.8.108:8787/x",
      "http://10.0.0.5/x",
      "http://172.20.10.2/x",
      "http://172.31.255.1/x",
    ];
    for (const url of urls) {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const sender = consoleMailSender(url);
      await sender.send({ to: "a@b.com", subject: "S", text: "T" });
      expect(consoleSpy).toHaveBeenCalledWith("[mail] to a@b.com: S\nT");
      consoleSpy.mockRestore();
    }
  });

  test("rejects public or invalid ips", async () => {
    const urls = [
      "http://172.15.0.1/x",
      "http://172.32.0.1/x",
      "http://8.8.8.8/x",
      "https://api.passripple.com/x",
      "http://192x168y1z1/x",
    ];
    for (const url of urls) {
      const sender = consoleMailSender(url);
      await expect(sender.send({ to: "a", subject: "b", text: "c" })).rejects.toThrow(/localhost/);
    }
  });
});

describe("sesMailSender", () => {
  test("sends formatted request via AwsClient", async () => {
    const env = {
      SES_REGION: "us-east-1",
      SES_ACCESS_KEY_ID: "key",
      SES_SECRET_ACCESS_KEY: "secret",
      MAIL_FROM_ADDRESS: "test@example.com",
    } as unknown as Env;

    const sender = sesMailSender(env);

    // We mocked AwsClient so we can grab the instance that was created
    const res0 = vi.mocked(AwsClient).mock.results[0];
    if (!res0) throw new Error("mock result missing");
    const mockClientInstance = res0.value;
    mockClientInstance.fetch.mockResolvedValue({ ok: true });

    await sender.send({ to: "to@example.com", subject: "S", text: "T" });

    expect(mockClientInstance.fetch).toHaveBeenCalledWith(
      "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          FromEmailAddress: "test@example.com",
          Destination: { ToAddresses: ["to@example.com"] },
          Content: {
            Simple: {
              Subject: { Data: "S", Charset: "UTF-8" },
              Body: { Text: { Data: "T", Charset: "UTF-8" } },
            },
          },
        }),
      },
    );
  });

  test("includes MAIL_FROM_NAME if provided", async () => {
    const env = {
      SES_REGION: "us-east-1",
      SES_ACCESS_KEY_ID: "key",
      SES_SECRET_ACCESS_KEY: "secret",
      MAIL_FROM_ADDRESS: "test@example.com",
      MAIL_FROM_NAME: "Test Name",
    } as unknown as Env;

    const sender = sesMailSender(env);
    const res0 = vi.mocked(AwsClient).mock.results[0];
    if (!res0) throw new Error("mock result missing");
    const mockClientInstance = res0.value;
    mockClientInstance.fetch.mockResolvedValue({ ok: true });

    await sender.send({ to: "a", subject: "b", text: "c" });

    const call = mockClientInstance.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.FromEmailAddress).toBe("Test Name <test@example.com>");
  });

  test("throws if SES returns non-ok", async () => {
    const env = {
      SES_REGION: "us-east-1",
      SES_ACCESS_KEY_ID: "key",
      SES_SECRET_ACCESS_KEY: "secret",
      MAIL_FROM_ADDRESS: "test@example.com",
    } as unknown as Env;

    const sender = sesMailSender(env);
    const res0 = vi.mocked(AwsClient).mock.results[0];
    if (!res0) throw new Error("mock result missing");
    const mockClientInstance = res0.value;
    mockClientInstance.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad request",
    });

    await expect(sender.send({ to: "a", subject: "b", text: "c" })).rejects.toThrow(
      "SES answered 400: Bad request",
    );
  });
});

describe("createMailSender", () => {
  test("returns ses sender", () => {
    const env = {
      MAIL_PROVIDER: "ses",
      SES_REGION: "a",
      SES_ACCESS_KEY_ID: "a",
      SES_SECRET_ACCESS_KEY: "a",
      MAIL_FROM_ADDRESS: "a",
    } as unknown as Env;

    expect(createMailSender(env, "http://localhost")).toBeDefined();
  });

  test("returns log sender", () => {
    const env = { MAIL_PROVIDER: "log" } as unknown as Env;
    expect(createMailSender(env, "http://localhost")).toBeDefined();
  });

  test("returns log sender that does not throw on private url", async () => {
    const env = { MAIL_PROVIDER: "log" } as unknown as Env;
    const sender = createMailSender(env, "http://192.168.1.100/x");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sender.send({ to: "a", subject: "b", text: "c" })).resolves.not.toThrow();
    consoleSpy.mockRestore();
  });

  test("throws on invalid provider", () => {
    const env = { MAIL_PROVIDER: "smtp" } as unknown as Env;
    expect(() => createMailSender(env, "http://localhost")).toThrow(/ses or log/);
  });
});
