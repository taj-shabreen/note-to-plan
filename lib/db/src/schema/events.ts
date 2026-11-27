import { pgTable, text, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { runs } from "./runs";
export const events = pgTable("ntp_events", {
  runId: text("run_id").notNull().references(() => runs.id),
  seq: integer("seq").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull().default(1),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer("duration_ms").notNull(),
  summary: text("summary").notNull(),
  details: text("details").notNull().default(""),
}, (t) => [primaryKey({ columns: [t.runId, t.seq] })]);
export const insertEventSchema = createInsertSchema(events);
export type StoredEvent = typeof events.$inferSelect;
