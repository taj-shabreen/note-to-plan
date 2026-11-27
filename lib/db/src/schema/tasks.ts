import { pgTable, text, boolean, timestamp, date, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { runs } from "./runs";
import { workspaces } from "./workspaces";
export const tasks = pgTable("ntp_tasks", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  ordinal: integer("ordinal"),
  title: text("title").notNull(),
  priority: text("priority").notNull(),
  category: text("category").notNull(),
  dueDate: date("due_date", { mode: "string" }),
  explanation: text("explanation").notNull().default(""),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("ntp_task_run_ordinal").on(t.runId, t.ordinal)]);
export const insertTaskSchema = createInsertSchema(tasks);
export type StoredTask = typeof tasks.$inferSelect;
