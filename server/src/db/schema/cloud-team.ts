import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const cloudTeamRunStatus = pgEnum("cloud_team_run_status", [
  "queued",
  "running",
  "completed",
  "needs_review",
  "failed",
  "budget_exceeded",
  "cancelled",
]);
export const cloudTeamStepRole = pgEnum("cloud_team_step_role", [
  "planner",
  "worker",
  "reviewer",
]);

export const cloudTeamMaterials = pgTable(
  "cloud_team_materials",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("cloud_team_materials_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt,
    ),
    check(
      "cloud_team_material_title_length",
      sql`char_length(${table.title}) between 1 and 120`,
    ),
    check(
      "cloud_team_material_content_length",
      sql`char_length(${table.content}) between 1 and 30000`,
    ),
    check(
      "cloud_team_material_source_length",
      sql`char_length(${table.source}) between 1 and 500`,
    ),
  ],
);

export const cloudTeamRuns = pgTable(
  "cloud_team_runs",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    objective: text("objective").notNull(),
    status: cloudTeamRunStatus("status").notNull().default("queued"),
    result: text("result"),
    error: text("error"),
    spentMicros: bigint("spent_micros", { mode: "number" })
      .notNull()
      .default(0),
    reservedMicros: bigint("reserved_micros", { mode: "number" })
      .notNull()
      .default(0),
    inputTokens: bigint("input_tokens", { mode: "number" })
      .notNull()
      .default(0),
    outputTokens: bigint("output_tokens", { mode: "number" })
      .notNull()
      .default(0),
    claimedBy: text("claimed_by"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("cloud_team_runs_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt,
    ),
    index("cloud_team_runs_claimable_idx").on(table.status, table.createdAt),
    check(
      "cloud_team_run_objective_length",
      sql`char_length(${table.objective}) between 1 and 8000`,
    ),
    check(
      "cloud_team_run_usage_nonnegative",
      sql`${table.spentMicros} >= 0 and ${table.reservedMicros} >= 0 and ${table.inputTokens} >= 0 and ${table.outputTokens} >= 0`,
    ),
  ],
);

export const cloudTeamRunMaterials = pgTable(
  "cloud_team_run_materials",
  {
    runId: text("run_id")
      .notNull()
      .references(() => cloudTeamRuns.id, { onDelete: "cascade" }),
    materialId: text("material_id")
      .notNull()
      .references(() => cloudTeamMaterials.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.materialId] }),
    index("cloud_team_run_materials_run_idx").on(table.runId),
    index("cloud_team_run_materials_material_idx").on(table.materialId),
  ],
);

export const cloudTeamMemories = pgTable(
  "cloud_team_memories",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    sourceRunId: text("source_run_id").references(() => cloudTeamRuns.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index("cloud_team_memories_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt,
    ),
    index("cloud_team_memories_source_run_idx").on(table.sourceRunId),
    check(
      "cloud_team_memory_content_length",
      sql`char_length(${table.content}) between 1 and 4000`,
    ),
  ],
);

export const cloudTeamSteps = pgTable(
  "cloud_team_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => cloudTeamRuns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    role: cloudTeamStepRole("role").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" })
      .notNull()
      .default(0),
    outputTokens: bigint("output_tokens", { mode: "number" })
      .notNull()
      .default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    reservedMicros: bigint("reserved_micros", { mode: "number" })
      .notNull()
      .default(0),
    output: text("output"),
    createdAt: createdAt(),
    /** Database settlement time: the UTC-day usage boundary, never the run's queue time. */
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("cloud_team_steps_run_ordinal_idx").on(
      table.runId,
      table.ordinal,
    ),
    check(
      "cloud_team_step_usage_nonnegative",
      sql`${table.ordinal} >= 0 and ${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.costMicros} >= 0 and ${table.reservedMicros} >= 0`,
    ),
  ],
);
