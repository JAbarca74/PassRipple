import { describe, expect, test, vi } from "vitest";
import { createApp, SERVER_TIME_HEADER, type Services } from "./app.ts";
import type { Database } from "./db.ts";

function fakeServices(): Services {
  return {
    database: () => ({ close: vi.fn().mockResolvedValue(undefined) }) as unknown as Database,
    mailer: () => ({} as any),
    integrity: () => ({} as any),
  };
}

describe("App", () => {
  test("creates a hono app with routes under /v1", () => {
    const app = createApp(fakeServices());
    expect(app).toBeDefined();
  });

  test("middleware injects services and server time header", async () => {
    const dbClose = vi.fn().mockResolvedValue(undefined);
    const services: Services = {
      database: () => ({ close: dbClose }) as unknown as Database,
      mailer: () => ({} as any),
      integrity: () => ({} as any),
    };
    
    const app = createApp(services);
    
    // add a dummy route to test middleware
    app.get("/test", (c) => {
      expect(c.get("db")).toBeDefined();
      expect(c.get("mailer")).toBeDefined();
      expect(c.get("integrity")).toBeDefined();
      return c.text("ok");
    });
    
    const res = await app.request("http://localhost/v1/test", { method: "GET" }, { ALLOWED_ORIGINS: "" });
    expect(res.status).toBe(200);
    expect(res.headers.get(SERVER_TIME_HEADER)).not.toBeNull();
    // Because there's no executionCtx in standard request(), it uses the catch block in waitUntil which is fine
    expect(dbClose).toHaveBeenCalled();
  });

  test("cors allows origins in ALLOWED_ORIGINS", async () => {
    const app = createApp(fakeServices());
    
    // test origin matching
    const res1 = await app.request("http://localhost/v1/auth/sign-in", {
      method: "OPTIONS",
      headers: { Origin: "https://allowed.com", "Access-Control-Request-Method": "POST" }
    }, { ALLOWED_ORIGINS: "https://allowed.com, https://other.com" });
    
    expect(res1.headers.get("Access-Control-Allow-Origin")).toBe("https://allowed.com");
    
    const res2 = await app.request("http://localhost/v1/auth/sign-in", {
      method: "OPTIONS",
      headers: { Origin: "https://not-allowed.com", "Access-Control-Request-Method": "POST" }
    }, { ALLOWED_ORIGINS: "https://allowed.com" });
    
    expect(res2.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("returns 404 with json error on not found", async () => {
    const app = createApp(fakeServices());
    const res = await app.request("http://localhost/v1/nowhere", {}, { ALLOWED_ORIGINS: "" });
    
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: { code: "not_found", message: "Not found." } });
  });

  test("onError maps errors to json and includes server time header", async () => {
    const app = createApp(fakeServices());
    
    app.get("/boom", () => {
      throw new Error("Boom");
    });
    
    const res = await app.request("http://localhost/v1/boom", {}, { ALLOWED_ORIGINS: "" });
    expect(res.status).toBe(500);
    expect(res.headers.get(SERVER_TIME_HEADER)).not.toBeNull();
    const json = await res.json();
    expect(json).toEqual({ error: { code: "internal", message: "Something went wrong." } });
  });
});
