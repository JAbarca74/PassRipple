// Public API of @passripple/pricing.
// Only what is exported here may be used by other packages.
//
// The service charge per ticket (10.5): a percentage of the price plus a fixed amount, with
// the value-added tax on it. Every figure comes from a fee schedule the caller passes in:
// this package holds no rates (ADR 0033). The minimum per event of 10.5 is settled with the
// payout statement (Phase 4), not per ticket.

/** Whether the tax is inside the service charge shown to the buyer or added on top of it. */
export const FEE_TAX_MODES = ["included", "added"] as const;
export type FeeTaxMode = (typeof FEE_TAX_MODES)[number];

/** A fee schedule, as configured outside the code. Rates are in basis points (1 % = 100). */
export interface FeeSchedule {
  /** Names the schedule in every order it priced (the order line's fee rule). */
  readonly id: string;
  readonly rateBps: number;
  readonly fixedCrc: number;
  readonly taxRateBps: number;
  readonly taxMode: FeeTaxMode;
}

/** The charge on one ticket, in whole colones. */
export interface ServiceCharge {
  /** The service charge before tax. */
  readonly feeCrc: number;
  /** The tax on the service charge. */
  readonly feeTaxCrc: number;
}

function nonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole, non-negative number, got ${value}`);
  }
}

/** numerator / denominator rounded to the nearest whole number, halves up. */
function roundedDivision(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Checks a schedule's figures. Throws on anything that is not a whole, non-negative number. */
export function checkFeeSchedule(schedule: FeeSchedule): FeeSchedule {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(schedule.id)) {
    throw new RangeError("the fee schedule needs an id of letters, digits, dots and dashes");
  }
  nonNegativeInteger("rateBps", schedule.rateBps);
  nonNegativeInteger("fixedCrc", schedule.fixedCrc);
  nonNegativeInteger("taxRateBps", schedule.taxRateBps);
  if (schedule.rateBps > 10_000 || schedule.taxRateBps > 10_000) {
    throw new RangeError("rates are basis points between 0 and 10000");
  }
  if (!FEE_TAX_MODES.includes(schedule.taxMode)) {
    throw new RangeError(`unknown tax mode ${String(schedule.taxMode)}`);
  }
  return schedule;
}

/**
 * The service charge on one ticket of a given price. With the tax `added`, the tax is the
 * rate applied to the charge; with it `included`, the charge shown already contains it and
 * is split into charge and tax. Each figure is rounded to whole colones, halves up.
 */
export function serviceCharge(priceCrc: number, schedule: FeeSchedule): ServiceCharge {
  nonNegativeInteger("priceCrc", priceCrc);
  checkFeeSchedule(schedule);
  const gross = roundedDivision(priceCrc * schedule.rateBps, 10_000) + schedule.fixedCrc;
  if (schedule.taxMode === "added") {
    return { feeCrc: gross, feeTaxCrc: roundedDivision(gross * schedule.taxRateBps, 10_000) };
  }
  const feeTaxCrc = roundedDivision(gross * schedule.taxRateBps, 10_000 + schedule.taxRateBps);
  return { feeCrc: gross - feeTaxCrc, feeTaxCrc };
}

/**
 * What an order line records as its fee rule: the schedule and its figures, so the fee can
 * be explained later even after the schedule changes (invariant I5).
 */
export function feeRule(schedule: FeeSchedule): string {
  const { id, rateBps, fixedCrc, taxRateBps, taxMode } = checkFeeSchedule(schedule);
  return `${id}:${rateBps}bps+${fixedCrc}crc:tax${taxRateBps}bps:${taxMode}`;
}
