// Entry point of the jobs Worker: the Cron Trigger publishes the outboxes, and the queue
// consumer hands each domain event to the module that handles it (ADR 0029). The cron also
// expires orders and holds, before relaying, so their events go out in the same run, and
// once an hour erases attendees' documents past their retention period.

import { consume } from "./consumer.ts";
import { connect } from "./db.ts";
import type { Env } from "./env.ts";
import { expire } from "./expiry.ts";
import { relay } from "./relay.ts";
import { isHourly, purgeDocuments, retentionDays } from "./retention.ts";

export default {
  async scheduled(controller, env, ctx): Promise<void> {
    const db = connect(env.HYPERDRIVE.connectionString);
    try {
      // Expiry first, so a failing relay never keeps holds from being released.
      const expired = await expire(db);
      console.log(JSON.stringify({ job: "expiry", expired }));
      const published = await relay(db, env.EVENTS);
      console.log(JSON.stringify({ job: "relay", published }));
      if (isHourly(controller.scheduledTime)) {
        const days = retentionDays(env.ATTENDEE_DOC_RETENTION_DAYS);
        if (days === null) {
          console.error(JSON.stringify({ job: "retention", error: "malformed period" }));
        } else {
          const erased = await purgeDocuments(db, days);
          console.log(JSON.stringify({ job: "retention", days, erased }));
        }
      }
    } finally {
      ctx.waitUntil(db.close());
    }
  },

  async queue(batch, env, ctx): Promise<void> {
    const db = connect(env.HYPERDRIVE.connectionString);
    try {
      await consume(db, batch);
    } finally {
      ctx.waitUntil(db.close());
    }
  },
} satisfies ExportedHandler<Env, unknown>;
