// Retention of attendees' documents (design 7.5, Ley 8968): once an hour, the encrypted
// document numbers of events that ended more than ATTENDEE_DOC_RETENTION_DAYS days ago are
// erased. Names and last digits stay as the event's record. The period is the owner's
// decision; 30 days until then.

import type { Database } from "./db.ts";

export const DEFAULT_RETENTION_DAYS = 30;

/** The configured period in days, or the default when unset. Null when it is malformed. */
export function retentionDays(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return DEFAULT_RETENTION_DAYS;
  const days = Number(raw);
  return Number.isInteger(days) && days >= 0 && days <= 3650 ? days : null;
}

/** Whether this run of the every-minute cron is the hourly one. */
export function isHourly(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() === 0;
}

export async function purgeDocuments(db: Database, days: number): Promise<number> {
  return db.system(async (tx) => {
    const [row] = await tx<{ count: number }[]>`
      SELECT ticketing.purge_attendee_documents(${days}) AS count`;
    return row?.count ?? 0;
  });
}
