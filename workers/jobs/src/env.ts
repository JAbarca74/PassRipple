// What the jobs Worker receives from Cloudflare: the bindings declared in wrangler.jsonc.
// It holds no secrets.

import type { DomainEventEnvelope } from "@passripple/contracts";

export interface Env {
  /** Pooled connection to PostgreSQL as passripple_api, through Cloudflare Hyperdrive. */
  readonly HYPERDRIVE: Hyperdrive;
  /** The queue that carries domain events between modules (ADR 0029). */
  readonly EVENTS: Queue<DomainEventEnvelope>;
  /**
   * Days after an event ends before attendees' document numbers are erased (design 7.5).
   * The owner decides it; unset means 30.
   */
  readonly ATTENDEE_DOC_RETENTION_DAYS?: string;
}
