// Display formats for Costa Rica: whole colones and local event times.

/** Costa Rica is UTC−6 all year: it does not observe daylight saving time. */
const COSTA_RICA_OFFSET_MS = -6 * 60 * 60 * 1000;

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/** Formats whole colones with a dot as the thousands separator: 10700 → "₡10.700". */
export function formatColones(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Expected a whole number of colones, got ${amount}`);
  }
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0 ? "−" : ""}₡${digits}`;
}

/** Formats an instant in Costa Rica time: "sáb 15 nov · 1:00 p. m.". */
export function formatEventDate(instant: Date): string {
  const local = toCostaRica(instant);
  const weekday = WEEKDAYS[local.getUTCDay()] ?? "";
  const month = MONTHS[local.getUTCMonth()] ?? "";
  return `${weekday} ${local.getUTCDate()} ${month} · ${formatTime(local)}`;
}

/** Formats a time in Costa Rica: "1:00 p. m.". */
export function formatEventTime(instant: Date): string {
  return formatTime(toCostaRica(instant));
}

/** Formats remaining seconds as minutes and seconds: 1781 → "29:41". Never negative. */
export function formatCountdown(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(whole / 60);
  return `${pad(minutes)}:${pad(whole % 60)}`;
}

function toCostaRica(instant: Date): Date {
  const time = instant.getTime();
  if (Number.isNaN(time)) throw new RangeError("Invalid date");
  return new Date(time + COSTA_RICA_OFFSET_MS);
}

function formatTime(local: Date): string {
  const hours = local.getUTCHours();
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;
  const period = hours < 12 ? "a. m." : "p. m.";
  return `${hours12}:${pad(local.getUTCMinutes())} ${period}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
