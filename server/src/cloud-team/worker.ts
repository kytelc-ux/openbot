export type CloudTeamWorkerEvent =
  | { type: "cloud-team-sweep"; ran: boolean }
  | { type: "cloud-team-sweep-failed"; error: string };

export async function runCloudTeamWorker(options: {
  sweep: () => Promise<boolean>;
  loop: boolean;
  signal: AbortSignal;
  pollMs?: number;
  report: (event: CloudTeamWorkerEvent) => void;
}): Promise<void> {
  const pollMs = options.pollMs ?? 5_000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 60_000) {
    throw new Error(
      "Cloud Team poll interval must be 100–60,000 milliseconds.",
    );
  }

  do {
    if (options.signal.aborted) return;
    try {
      options.report({
        type: "cloud-team-sweep",
        ran: await options.sweep(),
      });
    } catch (error) {
      options.report({
        type: "cloud-team-sweep-failed",
        error:
          error instanceof Error
            ? error.message
            : "The Cloud Team sweep failed.",
      });
      if (!options.loop) throw error;
    }
    if (!options.loop || options.signal.aborted) return;
    await waitForDelayOrStop(pollMs, options.signal);
  } while (!options.signal.aborted);
}

async function waitForDelayOrStop(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
