// Business settings the checkout reads from the Worker's configuration, never from code:
// the fee schedule, the SINPE number and the unique amount offset (ADR 0031, 0033). A
// missing or malformed setting fails the checkout with 503, never with a guessed value.

import { checkFeeSchedule, type FeeSchedule } from "@passripple/pricing";
import type { Env } from "./env.ts";
import { ApiError } from "./errors.ts";

const NOT_CONFIGURED = () =>
  new ApiError(503, "not_configured", "Sales are not available right now. Try again later.");

const schedules = new Map<string, FeeSchedule>();

/** The fee schedule in FEE_SCHEDULE. */
export function feeSchedule(env: Env): FeeSchedule {
  const raw = env.FEE_SCHEDULE;
  if (!raw) throw NOT_CONFIGURED();
  let schedule = schedules.get(raw);
  if (!schedule) {
    try {
      schedule = checkFeeSchedule(JSON.parse(raw) as FeeSchedule);
    } catch (error) {
      console.error("FEE_SCHEDULE is malformed", error);
      throw NOT_CONFIGURED();
    }
    schedules.set(raw, schedule);
  }
  return schedule;
}

/** The platform's SINPE Móvil number, as shown to buyers. */
export function sinpeNumber(env: Env): string {
  const value = env.SINPE_NUMBER?.trim();
  if (!value) throw NOT_CONFIGURED();
  return value;
}

/** The largest offset over the base amount an order may get (ADR 0031). */
export function maxAmountOffset(env: Env): number {
  const value = Number(env.UNIQUE_AMOUNT_MAX_OFFSET_CRC ?? "0");
  return Number.isSafeInteger(value) && value >= 0 && value <= 1000 ? value : 0;
}

/** The comma-separated origins of a setting. */
export function origins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
