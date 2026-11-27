import { pgTable, text, integer, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { workspaces } from "./workspaces";
export const runs = pgTable("ntp_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  notes: text("notes").notNull(),
  timezone: text("timezone").notNull(),
  // Nullable only for records created before submission context was persisted.
  referenceDate: text("reference_date"),
  status: text("status").notNull().default("queued"),
  method: text("method").notNull().default("pending"),
  model: text("model"),
  processorVersion: text("processor_version").notNull().default("1"),
  parentRunId: text("parent_run_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  taskCount: integer("task_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  error: text("error"),
  output: jsonb("output").notNull().default([]),
  workerToken: text("worker_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  recoveries: integer("recoveries").notNull().default(0),
  aiAttempts: integer("ai_attempts").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
}, (t) => [uniqueIndex("ntp_run_request_unique").on(t.workspaceId, t.idempotencyKey), index("ntp_queue").on(t.status, t.leaseUntil)]);
export const insertRunSchema = createInsertSchema(runs);
export type StoredRun = typeof runs.$inferSelect;
