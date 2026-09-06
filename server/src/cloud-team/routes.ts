import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables } from "../auth/guards";
import type { CloudTeamConfiguration } from "./config";
import {
  CloudTeamNotFoundError,
  CloudTeamRefusedError,
  type CloudTeamStore,
} from "./store";

const materialInput = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(30_000),
  source: z.string().trim().min(1).max(500),
});
const memoryInput = z.object({
  content: z.string().trim().min(1).max(4_000),
  sourceRunId: z.string().uuid().optional(),
});
const runInput = z.object({
  objective: z.string().trim().min(1).max(8_000),
  materialIds: z.array(z.string().uuid()).max(20),
});

export function createCloudTeamRoutes(
  store: CloudTeamStore,
  configuration: CloudTeamConfiguration,
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
) {
  const routes = new Hono<{ Variables: AppVariables }>();
  const body = async <T>(
    context: Parameters<typeof materialInput.safeParse>[0],
    schema: z.ZodType<T>,
  ) => {
    const parsed = schema.safeParse(context);
    return parsed.success ? parsed.data : null;
  };

  routes.get("/", requireUser, async (context) => {
    const snapshot = await store.snapshot(context.var.actor.id);
    return context.json({
      configured: configuration.configured,
      ...(!configuration.configured && configuration.error
        ? { configurationError: configuration.error }
        : {}),
      policy: configuration.configured
        ? {
            dailyBudgetUsd: configuration.config.dailyBudgetUsd,
            runBudgetUsd: configuration.config.runBudgetUsd,
            maxSteps: configuration.config.maxSteps,
          }
        : null,
      models: configuration.configured
        ? {
            planner: configuration.config.planner.model,
            worker: configuration.config.worker.model,
            reviewer: configuration.config.reviewer.model,
          }
        : null,
      ...snapshot,
    });
  });

  routes.post("/materials", requireUser, async (context) => {
    const parsed = await body(
      await context.req.json().catch(() => null),
      materialInput,
    );
    if (!parsed)
      return context.json(
        {
          error:
            "title, content, and source are required and exceed no published size limit.",
        },
        400,
      );
    try {
      return context.json(
        { material: await store.createMaterial(context.var.actor.id, parsed) },
        201,
      );
    } catch (error) {
      return storeError(context, error);
    }
  });
  routes.delete("/materials/:id", requireUser, async (context) => {
    try {
      await store.deleteMaterial(context.var.actor.id, context.req.param("id"));
      return context.body(null, 204);
    } catch (error) {
      return storeError(context, error);
    }
  });
  routes.post("/memories", requireUser, async (context) => {
    const parsed = await body(
      await context.req.json().catch(() => null),
      memoryInput,
    );
    if (!parsed)
      return context.json(
        {
          error:
            "content is required; sourceRunId, when present, must be a run UUID.",
        },
        400,
      );
    try {
      return context.json(
        { memory: await store.createMemory(context.var.actor.id, parsed) },
        201,
      );
    } catch (error) {
      return storeError(context, error);
    }
  });
  routes.delete("/memories/:id", requireUser, async (context) => {
    try {
      await store.deleteMemory(context.var.actor.id, context.req.param("id"));
      return context.body(null, 204);
    } catch (error) {
      return storeError(context, error);
    }
  });
  routes.post("/runs", requireUser, async (context) => {
    if (!configuration.configured) {
      return context.json(
        {
          error:
            configuration.error ??
            "Cloud Team model providers are not configured.",
        },
        503,
      );
    }
    const parsed = await body(
      await context.req.json().catch(() => null),
      runInput,
    );
    if (!parsed)
      return context.json(
        {
          error:
            "objective and an explicit list of at most 20 materialIds are required.",
        },
        400,
      );
    try {
      return context.json(
        { run: await store.createRun(context.var.actor.id, parsed) },
        202,
      );
    } catch (error) {
      return storeError(context, error);
    }
  });
  routes.get("/runs/:id", requireUser, async (context) => {
    try {
      return context.json({
        run: await store.getRun(context.var.actor.id, context.req.param("id")),
      });
    } catch (error) {
      return storeError(context, error);
    }
  });
  routes.post("/runs/:id/cancel", requireUser, async (context) => {
    try {
      return context.json({
        run: await store.cancelRun(
          context.var.actor.id,
          context.req.param("id"),
        ),
      });
    } catch (error) {
      return storeError(context, error);
    }
  });
  return routes;
}

function storeError(
  context: { json: (body: { error: string }, status: 400 | 404) => Response },
  error: unknown,
) {
  if (error instanceof CloudTeamNotFoundError)
    return context.json({ error: error.message }, 404);
  if (error instanceof CloudTeamRefusedError)
    return context.json({ error: error.message }, 400);
  throw error;
}
