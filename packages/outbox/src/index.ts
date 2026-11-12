// Public API of @passripple/outbox.
// Only what is exported here may be used by other packages.
export { createOutbox, DEFAULT_CONFIG, type Outbox, type OutboxDeps } from "./outbox.ts";
export type {
  CircuitState,
  Clock,
  DrainReport,
  ItemResult,
  ItemStatus,
  NewOperation,
  OutboxConfig,
  OutboxCounts,
  OutboxEntry,
  OutboxState,
  OutboxStatus,
  OutboxStore,
  Random,
  Transport,
} from "./types.ts";
