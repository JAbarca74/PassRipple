// The PassRipple API as the gate app sees it. Every response feeds the device clock, every
// request gives up after a timeout, and every body is checked against the shared schemas
// before the app trusts it.

import {
  apiError,
  type CreatedStaffCode,
  decodeGateManifest,
  decodeGateManifestDelta,
  type EnrollRequest,
  type EnrollResponse,
  enrollResponse,
  type GateBatchItemResult,
  type GateManifest,
  type GateManifestDelta,
  type GateOperation,
  type GateSessionResponse,
  gateBatchResponse,
  gateSessionResponse,
  type SignInResponse,
  signInResponse,
  type UserSession,
  userSession,
} from "@passripple/contracts";
import type { z } from "zod";
import { DeviceClock } from "./clock.ts";

/** A failed call: `status` 0 means it never reached the server. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface CallOptions {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly body?: unknown;
  readonly token?: string | null;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class Api {
  readonly baseUrl: string;
  private readonly clock: DeviceClock;

  constructor(baseUrl: string, clock: DeviceClock) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.clock = clock;
  }

  private async call(path: string, options: CallOptions = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const sentPerf = DeviceClock.monotonic();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? null : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new ApiFailure(0, timedOut ? "timeout" : "network", String(error));
    } finally {
      clearTimeout(timer);
    }
    const serverTime = Number(response.headers.get("x-server-time"));
    if (serverTime > 0) this.clock.sample(serverTime, sentPerf, DeviceClock.monotonic());

    const text = await response.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiFailure(
          response.status,
          "bad_response",
          "The server answered something that is not JSON.",
        );
      }
    }
    if (!response.ok) {
      const parsed = apiError.safeParse(json);
      const code = parsed.success ? parsed.data.error.code : "http_error";
      throw new ApiFailure(response.status, code, `HTTP ${response.status}: ${code}`);
    }
    return json;
  }

  private async typed<S extends z.ZodType>(
    schema: S,
    path: string,
    options?: CallOptions,
  ): Promise<z.output<S>> {
    const json = await this.call(path, options);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiFailure(200, "bad_response", "Unexpected response.");
    return parsed.data;
  }

  signIn(email: string): Promise<SignInResponse> {
    return this.typed(signInResponse, "/v1/auth/sign-in", { method: "POST", body: { email } });
  }

  verifySignIn(email: string, code: string): Promise<UserSession> {
    return this.typed(userSession, "/v1/auth/verify", { method: "POST", body: { email, code } });
  }

  enroll(
    userToken: string,
    request: Omit<EnrollRequest, "integrityToken"> & { integrityToken: string | null },
  ): Promise<EnrollResponse> {
    return this.typed(enrollResponse, "/v1/staff/enroll", {
      method: "POST",
      body: request,
      token: userToken,
    });
  }

  async signOutUser(userToken: string): Promise<void> {
    await this.call("/v1/auth/sign-out", { method: "POST", token: userToken });
  }

  gateSession(deviceToken: string, timeoutMs?: number): Promise<GateSessionResponse> {
    return this.typed(gateSessionResponse, "/v1/gate/session", {
      token: deviceToken,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  }

  async manifest(deviceToken: string): Promise<GateManifest> {
    // A whole manifest can be large: give it time on a slow connection.
    const json = await this.call("/v1/gate/manifest", { token: deviceToken, timeoutMs: 120_000 });
    const manifest = decodeGateManifest(json);
    if (manifest === null) throw new ApiFailure(200, "bad_response", "Unexpected manifest.");
    return manifest;
  }

  async manifestDelta(
    deviceToken: string,
    since: string,
    timeoutMs: number,
  ): Promise<GateManifestDelta> {
    const json = await this.call(`/v1/gate/manifest?since=${encodeURIComponent(since)}`, {
      token: deviceToken,
      timeoutMs,
    });
    const delta = decodeGateManifestDelta(json);
    if (delta === null) throw new ApiFailure(200, "bad_response", "Unexpected manifest update.");
    return delta;
  }

  async uploadBatch(
    deviceToken: string,
    items: readonly GateOperation[],
    timeoutMs: number,
  ): Promise<readonly GateBatchItemResult[]> {
    const body = await this.typed(gateBatchResponse, "/v1/gate/batches", {
      method: "POST",
      body: { items },
      token: deviceToken,
      timeoutMs,
    });
    return body.results;
  }

  /** Erases the signed-in person's account (design 14.7). */
  async deleteAccount(userToken: string): Promise<void> {
    await this.call("/v1/account", { method: "DELETE", token: userToken });
  }

  async signOutDevice(deviceToken: string): Promise<void> {
    await this.call("/v1/gate/sign-out", { method: "POST", token: deviceToken });
  }
}

export type { CreatedStaffCode };
