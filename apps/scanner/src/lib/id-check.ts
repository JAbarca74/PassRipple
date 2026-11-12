// Pure helpers of the document check (design 7.4), kept apart from React Native so they can
// be tested on their own.

import type { IdCheck } from "./gate-session.ts";

/** The banner title for an event's rating. */
export function idCheckTitle(check: IdCheck): string {
  if (check.ageRating === "18plus") return "VERIFICAR MAYORÍA DE EDAD";
  if (check.ageRating === "12plus") return "VERIFICAR EDAD 12+";
  return "VERIFICAR DOCUMENTO";
}

/** Whether a typed attendee is complete: a name and 2 to 4 last characters. */
export function captureComplete(name: string, last4: string): boolean {
  return name.trim().length >= 2 && /^[0-9A-Za-z]{2,4}$/.test(last4.trim());
}
