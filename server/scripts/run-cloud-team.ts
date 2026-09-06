/**
 * Claim and execute at most one Cloud Team run.
 *
 * Intended for a CronJob or an externally managed loop. It only needs DATABASE_URL,
 * CLOUD_TEAM_CONFIG, and the provider keys named by that configuration.
 */
import { randomUUID } from "node:crypto";
import { loadCloudTeamConfig } from "../src/cloud-team/config";
import { createModelProvider } from "../src/cloud-team/provider";
import { createCloudTeamRunner } from "../src/cloud-team/runner";
import { createCloudTeamStore } from "../src/cloud-team/store";
import { runCloudTeamWorker } from "../src/cloud-team/worker";
import { createDatabase } from "../src/db/client";

const arguments_ = process.argv.slice(2);
const unexpected = arguments_.filter((argument) => argument !== "--loop");
const loop = arguments_.includes("--loop");
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.info(
      JSON.stringify({
        type: "cloud-team-worker-stopping",
        signal,
        note: "The current provider call, if any, will finish before shutdown.",
      }),
    );
    stop.abort();
  });
}

try {
  if (unexpected.length > 0) {
    throw new Error(`Unknown Cloud Team worker argument: ${unexpected[0]}`);
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const configuration = loadCloudTeamConfig(process.env);
  if (!configuration.configured) {
    throw new Error(
      configuration.error ??
        "CLOUD_TEAM_CONFIG is required to execute Cloud Team runs.",
    );
  }

  const database = createDatabase(databaseUrl);
  const runner = createCloudTeamRunner({
    store: createCloudTeamStore(database),
    provider: createModelProvider(process.env),
    config: configuration.config,
    owner: `cloud-team/${process.env.HOSTNAME ?? randomUUID().slice(0, 8)}`,
    signal: stop.signal,
  });
  try {
    await runCloudTeamWorker({
      sweep: () => runner.sweep(),
      loop,
      signal: stop.signal,
      report: (event) => {
        const write =
          event.type === "cloud-team-sweep-failed"
            ? console.error
            : console.info;
        write(JSON.stringify(event));
      },
    });
  } finally {
    await database.$client.end({ timeout: 5 });
  }
} catch (error) {
  console.error(
    JSON.stringify({
      type: "cloud-team-worker-failed",
      error:
        error instanceof Error
          ? error.message
          : "The Cloud Team worker failed.",
    }),
  );
  process.exitCode = 1;
}
