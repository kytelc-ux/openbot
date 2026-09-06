import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  cloudTeamMaterials,
  cloudTeamMemories,
  cloudTeamRunMaterials,
  cloudTeamRuns,
  cloudTeamSteps,
} from "../db/schema";
import type { CloudTeamConfig, CloudTeamModelConfig } from "./config";
import type {
  CloudTeamRole,
  CloudTeamRunStatus,
  CloudTeamSnapshot,
  Material,
  Memory,
  Run,
  Step,
} from "./types";

const MATERIAL_LIMIT = 100;
const MEMORY_LIMIT = 100;
const dollars = (micros: number) => micros / 1_000_000;
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result)
    ? result
    : ((result as { rows?: T[] } | null)?.rows ?? [])) as T[];

export class CloudTeamNotFoundError extends Error {
  constructor(message = "That Cloud Team item does not exist.") {
    super(message);
    this.name = "CloudTeamNotFoundError";
  }
}
export class CloudTeamRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudTeamRefusedError";
  }
}

type MaterialRow = typeof cloudTeamMaterials.$inferSelect;
type MemoryRow = typeof cloudTeamMemories.$inferSelect;
type StepRow = typeof cloudTeamSteps.$inferSelect;
type RunRow = typeof cloudTeamRuns.$inferSelect;
const materialDto = (row: MaterialRow): Material => ({
  id: row.id,
  title: row.title,
  content: row.content,
  source: row.source,
  createdAt: row.createdAt.toISOString(),
});
const memoryDto = (row: MemoryRow): Memory => ({
  id: row.id,
  content: row.content,
  sourceRunId: row.sourceRunId,
  createdAt: row.createdAt.toISOString(),
});
const stepDto = (row: StepRow): Step => ({
  id: row.id,
  role: row.role,
  model: row.model,
  status: row.status,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  costUsd: dollars(row.costMicros),
  output: row.output,
});
const runDto = (row: RunRow, steps: StepRow[] = []): Run => ({
  id: row.id,
  objective: row.objective,
  status: row.status,
  result: row.result,
  error: row.error,
  spentUsd: dollars(row.spentMicros),
  reservedUsd: dollars(row.reservedMicros),
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  createdAt: row.createdAt.toISOString(),
  steps: steps.map(stepDto),
});

export type ClaimedRun = {
  run: RunRow;
  materials: MaterialRow[];
  memories: MemoryRow[];
};

export type CloudTeamStore = {
  snapshot(
    ownerUserId: string,
  ): Promise<
    Omit<
      CloudTeamSnapshot,
      "configured" | "configurationError" | "policy" | "models"
    >
  >;
  createMaterial(
    ownerUserId: string,
    input: { title: string; content: string; source: string },
  ): Promise<Material>;
  deleteMaterial(ownerUserId: string, id: string): Promise<void>;
  createMemory(
    ownerUserId: string,
    input: { content: string; sourceRunId?: string },
  ): Promise<Memory>;
  listMemories(ownerUserId: string): Promise<Memory[]>;
  deleteMemory(ownerUserId: string, id: string): Promise<void>;
  createRun(
    ownerUserId: string,
    input: { objective: string; materialIds: string[] },
  ): Promise<Run>;
  getRun(ownerUserId: string, id: string): Promise<Run>;
  cancelRun(ownerUserId: string, id: string): Promise<Run>;
  claim(owner: string, leaseMs: number): Promise<ClaimedRun | null>;
  reserveStep(input: {
    runId: string;
    owner: string;
    role: CloudTeamRole;
    descriptor: CloudTeamModelConfig;
    reserveMicros: number;
    policy: CloudTeamConfig;
  }): Promise<{ id: string; ordinal: number }>;
  finishStep(input: {
    runId: string;
    stepId: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    output: string;
  }): Promise<void>;
  retainStepReservation(
    runId: string,
    stepId: string,
    reason: string,
  ): Promise<void>;
  stopRun(
    runId: string,
    status: Exclude<CloudTeamRunStatus, "queued" | "running">,
    error?: string,
    result?: string,
  ): Promise<void>;
  status(runId: string): Promise<CloudTeamRunStatus | null>;
};

export function createCloudTeamStore(database: Database): CloudTeamStore {
  const runWithSteps = async (row: RunRow): Promise<Run> => {
    const steps = await database
      .select()
      .from(cloudTeamSteps)
      .where(eq(cloudTeamSteps.runId, row.id))
      .orderBy(asc(cloudTeamSteps.ordinal));
    return runDto(row, steps);
  };

  return {
    async snapshot(ownerUserId) {
      const [materials, memories, runs, usageRows] = await Promise.all([
        database
          .select()
          .from(cloudTeamMaterials)
          .where(eq(cloudTeamMaterials.ownerUserId, ownerUserId))
          .orderBy(desc(cloudTeamMaterials.createdAt)),
        database
          .select()
          .from(cloudTeamMemories)
          .where(eq(cloudTeamMemories.ownerUserId, ownerUserId))
          .orderBy(desc(cloudTeamMemories.createdAt))
          .limit(MEMORY_LIMIT),
        database
          .select()
          .from(cloudTeamRuns)
          .where(eq(cloudTeamRuns.ownerUserId, ownerUserId))
          .orderBy(desc(cloudTeamRuns.createdAt))
          .limit(20),
        database.execute(sql`
          select
            (select coalesce(sum(s.cost_micros), 0)::bigint
             from cloud_team_steps s join cloud_team_runs r on r.id = s.run_id
             where r.owner_user_id = ${ownerUserId}
               and s.settled_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as spent,
            (select coalesce(sum(r.reserved_micros), 0)::bigint
             from cloud_team_runs r where r.owner_user_id = ${ownerUserId}) as reserved,
            (select coalesce(sum(s.input_tokens), 0)::bigint
             from cloud_team_steps s join cloud_team_runs r on r.id = s.run_id
             where r.owner_user_id = ${ownerUserId}
               and s.settled_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as input,
            (select coalesce(sum(s.output_tokens), 0)::bigint
             from cloud_team_steps s join cloud_team_runs r on r.id = s.run_id
             where r.owner_user_id = ${ownerUserId}
               and s.settled_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as output
        `),
      ]);
      const usage = rowsOf<{
        spent: string;
        reserved: string;
        input: string;
        output: string;
      }>(usageRows)[0];
      return {
        usage: {
          spentUsd: dollars(Number(usage?.spent ?? 0)),
          reservedUsd: dollars(Number(usage?.reserved ?? 0)),
          inputTokens: Number(usage?.input ?? 0),
          outputTokens: Number(usage?.output ?? 0),
        },
        materials: materials.map(materialDto),
        memories: memories.map(memoryDto),
        runs: await Promise.all(runs.map(runWithSteps)),
      };
    },

    async createMaterial(ownerUserId, input) {
      return database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`cloud-team:materials:${ownerUserId}`}))`,
        );
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(cloudTeamMaterials)
          .where(eq(cloudTeamMaterials.ownerUserId, ownerUserId));
        if ((count ?? 0) >= MATERIAL_LIMIT)
          throw new CloudTeamRefusedError(
            `Cloud Team supports at most ${MATERIAL_LIMIT} materials per person.`,
          );
        const [row] = await tx
          .insert(cloudTeamMaterials)
          .values({ id: randomUUID(), ownerUserId, ...input })
          .returning();
        if (!row) throw new Error("The material insert returned no row.");
        return materialDto(row);
      });
    },

    async deleteMaterial(ownerUserId, id) {
      await database.transaction(async (tx) => {
        const material = await tx
          .select({ id: cloudTeamMaterials.id })
          .from(cloudTeamMaterials)
          .where(
            and(
              eq(cloudTeamMaterials.id, id),
              eq(cloudTeamMaterials.ownerUserId, ownerUserId),
            ),
          )
          .limit(1)
          .for("update");
        if (!material[0]) throw new CloudTeamNotFoundError();
        const referenced = await tx
          .select({ runId: cloudTeamRunMaterials.runId })
          .from(cloudTeamRunMaterials)
          .innerJoin(
            cloudTeamRuns,
            eq(cloudTeamRuns.id, cloudTeamRunMaterials.runId),
          )
          .where(
            and(
              eq(cloudTeamRunMaterials.materialId, id),
              inArray(cloudTeamRuns.status, ["queued", "running"]),
            ),
          )
          .limit(1);
        if (referenced[0]) {
          throw new CloudTeamRefusedError(
            "That material is selected by a queued or running Cloud Team run.",
          );
        }
        await tx
          .delete(cloudTeamMaterials)
          .where(eq(cloudTeamMaterials.id, id));
      });
    },

    async createMemory(ownerUserId, input) {
      return database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`cloud-team:memories:${ownerUserId}`}))`,
        );
        if (input.sourceRunId) {
          const source = await tx
            .select({ id: cloudTeamRuns.id })
            .from(cloudTeamRuns)
            .where(
              and(
                eq(cloudTeamRuns.id, input.sourceRunId),
                eq(cloudTeamRuns.ownerUserId, ownerUserId),
              ),
            )
            .limit(1);
          if (!source[0])
            throw new CloudTeamNotFoundError("That source run does not exist.");
        }
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(cloudTeamMemories)
          .where(eq(cloudTeamMemories.ownerUserId, ownerUserId));
        if ((count ?? 0) >= MEMORY_LIMIT)
          throw new CloudTeamRefusedError(
            `Cloud Team supports at most ${MEMORY_LIMIT} trusted memories per person.`,
          );
        const [row] = await tx
          .insert(cloudTeamMemories)
          .values({ id: randomUUID(), ownerUserId, ...input })
          .returning();
        if (!row) throw new Error("The memory insert returned no row.");
        return memoryDto(row);
      });
    },

    async listMemories(ownerUserId) {
      const rows = await database
        .select()
        .from(cloudTeamMemories)
        .where(eq(cloudTeamMemories.ownerUserId, ownerUserId))
        .orderBy(desc(cloudTeamMemories.createdAt))
        .limit(MEMORY_LIMIT);
      return rows.map(memoryDto);
    },

    async deleteMemory(ownerUserId, id) {
      const rows = await database
        .delete(cloudTeamMemories)
        .where(
          and(
            eq(cloudTeamMemories.id, id),
            eq(cloudTeamMemories.ownerUserId, ownerUserId),
          ),
        )
        .returning({ id: cloudTeamMemories.id });
      if (!rows[0]) throw new CloudTeamNotFoundError();
    },

    async createRun(ownerUserId, input) {
      return database.transaction(async (tx) => {
        const unique = [...new Set(input.materialIds)];
        if (unique.length > 20)
          throw new CloudTeamRefusedError(
            "Select at most 20 materials for one run.",
          );
        const selected =
          unique.length === 0
            ? []
            : await tx
                .select({
                  id: cloudTeamMaterials.id,
                  content: cloudTeamMaterials.content,
                })
                .from(cloudTeamMaterials)
                .where(
                  and(
                    eq(cloudTeamMaterials.ownerUserId, ownerUserId),
                    inArray(cloudTeamMaterials.id, unique),
                  ),
                )
                .for("share");
        if (selected.length !== unique.length)
          throw new CloudTeamRefusedError(
            "Every selected material must exist and belong to you.",
          );
        if (
          selected.reduce((total, item) => total + item.content.length, 0) >
          120_000
        ) {
          throw new CloudTeamRefusedError(
            "Selected material content must total at most 120,000 characters.",
          );
        }
        const id = randomUUID();
        const [row] = await tx
          .insert(cloudTeamRuns)
          .values({ id, ownerUserId, objective: input.objective })
          .returning();
        if (unique.length)
          await tx
            .insert(cloudTeamRunMaterials)
            .values(unique.map((materialId) => ({ runId: id, materialId })));
        if (!row) throw new Error("The run insert returned no row.");
        return runDto(row);
      });
    },

    async getRun(ownerUserId, id) {
      const [row] = await database
        .select()
        .from(cloudTeamRuns)
        .where(
          and(
            eq(cloudTeamRuns.id, id),
            eq(cloudTeamRuns.ownerUserId, ownerUserId),
          ),
        )
        .limit(1);
      if (!row)
        throw new CloudTeamNotFoundError("That Cloud Team run does not exist.");
      return runWithSteps(row);
    },

    async cancelRun(ownerUserId, id) {
      const [row] = await database
        .update(cloudTeamRuns)
        .set({
          status: "cancelled",
          error: null,
          claimedBy: null,
          leaseUntil: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(cloudTeamRuns.id, id),
            eq(cloudTeamRuns.ownerUserId, ownerUserId),
            inArray(cloudTeamRuns.status, ["queued", "running"]),
          ),
        )
        .returning();
      if (row) return runWithSteps(row);
      return this.getRun(ownerUserId, id);
    },

    async claim(owner, leaseMs) {
      return database.transaction(async (tx) => {
        // An expired in-flight request has an unknown outcome. Never replay it automatically.
        await tx.execute(sql`
          update cloud_team_runs set status = 'needs_review', error = 'Execution was interrupted; reserved cost remains held because provider outcome is unknown.', claimed_by = null, lease_until = null, updated_at = now()
          where status = 'running' and lease_until <= now()
        `);
        const result = await tx.execute(sql`
          update cloud_team_runs set status = 'running', claimed_by = ${owner},
            lease_until = now() + make_interval(secs => ${leaseMs / 1000}), updated_at = now()
          where id = (
            select id from cloud_team_runs where status = 'queued'
            order by created_at asc limit 1 for update skip locked
          )
          returning id
        `);
        const claimed = rowsOf<{ id: string }>(result)[0];
        if (!claimed) return null;
        const [row] = await tx
          .select()
          .from(cloudTeamRuns)
          .where(eq(cloudTeamRuns.id, claimed.id))
          .limit(1);
        if (!row) return null;
        const materials = await tx
          .select({ material: cloudTeamMaterials })
          .from(cloudTeamRunMaterials)
          .innerJoin(
            cloudTeamMaterials,
            eq(cloudTeamRunMaterials.materialId, cloudTeamMaterials.id),
          )
          .where(eq(cloudTeamRunMaterials.runId, row.id));
        const memories = await tx
          .select()
          .from(cloudTeamMemories)
          .where(eq(cloudTeamMemories.ownerUserId, row.ownerUserId))
          .orderBy(desc(cloudTeamMemories.createdAt))
          .limit(20);
        return {
          run: row,
          materials: materials.map((entry) => entry.material),
          memories,
        };
      });
    },

    async reserveStep(input) {
      const outcome = await database.transaction(async (tx) => {
        const [identity] = await tx
          .select({ owner: cloudTeamRuns.ownerUserId })
          .from(cloudTeamRuns)
          .where(eq(cloudTeamRuns.id, input.runId))
          .limit(1);
        if (!identity)
          throw new CloudTeamRefusedError("The run no longer exists.");
        // Per-owner, not per-run: two of one person's runs must not both pass the same daily cap.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`cloud-team:budget:${identity.owner}`}))`,
        );
        const result = await tx.execute(sql`
          select r.status, r.claimed_by as claimed, r.lease_until > now() as lease_live,
            r.spent_micros as spent, r.reserved_micros as reserved,
            (select count(*)::int from cloud_team_steps s where s.run_id = r.id) as steps,
            (select coalesce(sum(s.cost_micros), 0)
             from cloud_team_steps s join cloud_team_runs d on d.id = s.run_id
             where d.owner_user_id = r.owner_user_id
               and s.settled_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc')
            + (select coalesce(sum(d.reserved_micros), 0)
               from cloud_team_runs d where d.owner_user_id = r.owner_user_id) as daily
          from cloud_team_runs r where r.id = ${input.runId} for update
        `);
        const row = rowsOf<{
          status: string;
          claimed: string | null;
          lease_live: boolean;
          spent: string;
          reserved: string;
          steps: number;
          daily: string;
        }>(result)[0];
        if (row?.status !== "running")
          throw new CloudTeamRefusedError("The run is no longer running.");
        if (row.claimed !== input.owner || !row.lease_live) {
          throw new CloudTeamRefusedError(
            "The run lease expired before another paid step could start.",
          );
        }
        if (row.steps >= input.policy.maxSteps)
          throw new CloudTeamRefusedError(
            "The run reached its configured step limit.",
          );
        if (
          Number(row.spent) + Number(row.reserved) + input.reserveMicros >
            input.policy.runBudgetUsd * 1_000_000 ||
          Number(row.daily) + input.reserveMicros >
            input.policy.dailyBudgetUsd * 1_000_000
        ) {
          await tx
            .update(cloudTeamRuns)
            .set({
              status: "budget_exceeded",
              error:
                "The configured token-cost reservation budget would be exceeded.",
              claimedBy: null,
              leaseUntil: null,
              updatedAt: sql`now()`,
            })
            .where(eq(cloudTeamRuns.id, input.runId));
          return { refused: true as const };
        }
        const id = randomUUID();
        const ordinal = row.steps;
        await tx.insert(cloudTeamSteps).values({
          id,
          runId: input.runId,
          ordinal,
          role: input.role,
          model: input.descriptor.model,
          status: "reserved",
          reservedMicros: input.reserveMicros,
        });
        await tx
          .update(cloudTeamRuns)
          .set({
            reservedMicros: sql`${cloudTeamRuns.reservedMicros} + ${input.reserveMicros}`,
            updatedAt: sql`now()`,
          })
          .where(eq(cloudTeamRuns.id, input.runId));
        return { refused: false as const, id, ordinal };
      });
      if (outcome.refused) {
        throw new CloudTeamRefusedError(
          "The configured token-cost reservation budget would be exceeded.",
        );
      }
      return { id: outcome.id, ordinal: outcome.ordinal };
    },

    async finishStep(input) {
      const exceeded = await database.transaction(async (tx) => {
        const [identity] = await tx
          .select({ owner: cloudTeamRuns.ownerUserId })
          .from(cloudTeamRuns)
          .where(eq(cloudTeamRuns.id, input.runId))
          .limit(1);
        if (!identity)
          throw new CloudTeamRefusedError("The run no longer exists.");
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`cloud-team:budget:${identity.owner}`}))`,
        );
        const locked = await tx.execute(sql`
          select status, reserved_micros as reserved
          from cloud_team_steps
          where id = ${input.stepId} and run_id = ${input.runId}
          for update
        `);
        const step = rowsOf<{ status: string; reserved: string }>(locked)[0];
        // A repeated provider callback or local completion is already accounted for.
        if (step?.status !== "reserved") return false;
        const reserved = Number(step.reserved);
        if (input.costMicros > reserved) {
          await tx
            .update(cloudTeamSteps)
            .set({
              status: "usage_exceeded_reservation",
              inputTokens: input.inputTokens,
              outputTokens: input.outputTokens,
              costMicros: input.costMicros,
              reservedMicros: 0,
              output: input.output,
              settledAt: sql`now()`,
            })
            .where(eq(cloudTeamSteps.id, input.stepId));
          await tx
            .update(cloudTeamRuns)
            .set({
              status: sql`case when ${cloudTeamRuns.status} = 'running' then 'needs_review'::cloud_team_run_status else ${cloudTeamRuns.status} end`,
              error: sql`case when ${cloudTeamRuns.status} = 'running' then 'Provider usage exceeded the conservative reservation; execution stopped.' else ${cloudTeamRuns.error} end`,
              spentMicros: sql`${cloudTeamRuns.spentMicros} + ${input.costMicros}`,
              reservedMicros: sql`${cloudTeamRuns.reservedMicros} - ${reserved}`,
              inputTokens: sql`${cloudTeamRuns.inputTokens} + ${input.inputTokens}`,
              outputTokens: sql`${cloudTeamRuns.outputTokens} + ${input.outputTokens}`,
              claimedBy: null,
              leaseUntil: null,
              updatedAt: sql`now()`,
            })
            .where(eq(cloudTeamRuns.id, input.runId));
          return true;
        }
        await tx
          .update(cloudTeamSteps)
          .set({
            status: "completed",
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            costMicros: input.costMicros,
            reservedMicros: 0,
            output: input.output,
            settledAt: sql`now()`,
          })
          .where(eq(cloudTeamSteps.id, input.stepId));
        await tx
          .update(cloudTeamRuns)
          .set({
            spentMicros: sql`${cloudTeamRuns.spentMicros} + ${input.costMicros}`,
            reservedMicros: sql`${cloudTeamRuns.reservedMicros} - ${reserved}`,
            inputTokens: sql`${cloudTeamRuns.inputTokens} + ${input.inputTokens}`,
            outputTokens: sql`${cloudTeamRuns.outputTokens} + ${input.outputTokens}`,
            updatedAt: sql`now()`,
          })
          .where(eq(cloudTeamRuns.id, input.runId));
        return false;
      });
      if (exceeded)
        throw new CloudTeamRefusedError(
          "Provider usage exceeded its reservation.",
        );
    },

    async retainStepReservation(runId, stepId, reason) {
      await database.transaction(async (tx) => {
        const [identity] = await tx
          .select({ owner: cloudTeamRuns.ownerUserId })
          .from(cloudTeamRuns)
          .where(eq(cloudTeamRuns.id, runId))
          .limit(1);
        if (!identity) return;
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`cloud-team:budget:${identity.owner}`}))`,
        );
        await tx.execute(sql`
          select id from cloud_team_steps
          where id = ${stepId} and run_id = ${runId}
          for update
        `);
        const changed = await tx
          .update(cloudTeamSteps)
          .set({ status: "outcome_unknown" })
          .where(
            and(
              eq(cloudTeamSteps.id, stepId),
              eq(cloudTeamSteps.runId, runId),
              eq(cloudTeamSteps.status, "reserved"),
            ),
          )
          .returning({ id: cloudTeamSteps.id });
        if (!changed[0]) return;
        await tx
          .update(cloudTeamRuns)
          .set({
            status: "needs_review",
            error: reason,
            claimedBy: null,
            leaseUntil: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(cloudTeamRuns.id, runId),
              eq(cloudTeamRuns.status, "running"),
            ),
          );
      });
    },

    async stopRun(runId, status, error, result) {
      await database
        .update(cloudTeamRuns)
        .set({
          status,
          error: error ?? null,
          result: result ?? null,
          claimedBy: null,
          leaseUntil: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(cloudTeamRuns.id, runId), eq(cloudTeamRuns.status, "running")),
        );
    },

    async status(runId) {
      const [row] = await database
        .select({ status: cloudTeamRuns.status })
        .from(cloudTeamRuns)
        .where(eq(cloudTeamRuns.id, runId))
        .limit(1);
      return row?.status ?? null;
    },
  };
}
