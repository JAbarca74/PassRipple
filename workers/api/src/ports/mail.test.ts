import { describe, expect, test, vi } from "vitest";
import { AwsClient } from "aws4fetch";
import { consoleMailSender, createMailSender, sesMailSender } from "./mail.ts";
import type { Env } from "../env.ts";

vi.mock("aws4fetch", () => {
  return {
    AwsClient: vi.fn().mockImplementation(() => {
      return {
        fetch: vi.fn(),
      };
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
    const mockClientInstance = vi.mocked(AwsClient).mock.results[0].value;
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
      }
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
    const mockClientInstance = vi.mocked(AwsClient).mock.results[1].value;
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
    const mockClientInstance = vi.mocked(AwsClient).mock.results[2].value;
    mockClientInstance.fetch.mockResolvedValue({ ok: false, status: 400, text: async () => "Bad request" });
    
    await expect(sender.send({ to: "a", subject: "b", text: "c" })).rejects.toThrow("SES answered 400: Bad request");
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

  test("throws on invalid provider", () => {
    const env = { MAIL_PROVIDER: "smtp" } as unknown as Env;
    expect(() => createMailSender(env, "http://localhost")).toThrow(/ses or log/);
  });
});
