// Entry point of the jobs Worker: the Cron Trigger publishes the outboxes, and the queue
// consumer hands each domain event to the module that handles it (ADR 0029).

import { consume } from "./consumer.ts";
import { connect } from "./db.ts";
import type { Env } from "./env.ts";
import { relay } from "./relay.ts";

export default {
  async scheduled(_controller, env, ctx): Promise<void> {
    const db = connect(env.HYPERDRIVE.connectionString);
    try {
      const published = await relay(db, env.EVENTS);
      console.log(JSON.stringify({ job: "relay", published }));
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
