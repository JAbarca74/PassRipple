// The app's only way to the API (VITE_API_URL). Every response carries the server's clock,
// which the payment countdown and the QR windows use instead of trusting the phone's clock.

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

/** Milliseconds to add to Date.now() to get the server's time. */
let clockOffsetMs = 0;

/** The server's time now, as best the app knows it. */
export function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

/** An error the API answered with: a stable code and, sometimes, more data. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

interface RequestOptions {
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
  readonly token?: string;
  readonly headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiFailure(
      0,
      "network",
      "No hay conexión. Revise su señal e intente de nuevo.",
      null,
    );
  }
  const serverTime = Number(response.headers.get("x-server-time"));
  if (Number.isFinite(serverTime) && serverTime > 0) clockOffsetMs = serverTime - Date.now();
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiFailure(
      response.status,
      error?.code ?? "unknown",
      error?.message ?? "Algo salió mal.",
      body,
    );
  }
  return body as T;
}

/** 128 random bits in base64url: an idempotency key or any other unguessable id. */
export function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
