import { pgTable, bigserial, text, boolean, timestamp } from "drizzle-orm/pg-core";

const tasks = pgTable("tasks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export {tasks};