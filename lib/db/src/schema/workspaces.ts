import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const workspaces = pgTable("ntp_workspaces", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertWorkspaceSchema = createInsertSchema(workspaces);
export type Workspace = typeof workspaces.$inferSelect;
