import { pgTable, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { runs } from "./runs";
// Preserve already-recorded history from the previous implementation.
// New writes use ntp_events; API reads expose both without rewriting telemetry.
export const executionEvents = pgTable("ntp_execution_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  sequence: integer("sequence").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull().default(1),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer("duration_ms"),
  summary: text("summary").notNull(),
}, (t) => [uniqueIndex("ntp_event_sequence_unique").on(t.runId, t.sequence)]);
export const insertExecutionEventSchema = createInsertSchema(executionEvents);
