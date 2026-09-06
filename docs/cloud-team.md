# Cloud Team

Cloud Team is a bounded, source-backed planning and drafting workflow at
`/cloud-team`. It adds portable task records, approved shared memory, and a
per-model token ledger to OpenBot. It is not an installed cloud service until
you provision a host, database, sign-in, model access, and a running worker.

## What it does

1. You add selected text materials and set an objective with acceptance criteria.
2. A premium planner breaks the objective into bounded work.
3. An economical worker handles the work; an economical reviewer evaluates it.
4. You inspect the result, intermediate output, tokens, and estimated spend.
5. You write a verified lesson into shared memory for future tasks.

Materials and memory are account-scoped, not globally visible to every person.
Memory is durable context, not changes to the model's weights. A model's proposed
lesson is not automatically a fact: approval remains a human decision. Existing
runtime Bots receive a read-only `cloud_team__trusted_memory` tool for the same
signed-in person's notes. An arbitrary external agent must support the runtime's
tool-calling contract to use it; no private memories are broadcast to other users.
Both the team and memory tool cap context at the latest 20 memories, using at most
2,000 characters of each. Older notes remain stored but are not all injected.

This workflow prepares text. It does not autonomously execute shell commands,
send messages, purchase services, or modify your original files. Existing
OpenBot coworker tools and handoffs retain their separate authorization rules.
Cloud Team budgets do not govern ordinary chats or third-party agents.

## Start with your Grokbot materials

No Grokbot folder is bundled with this repository. Do not assume another device
can reach a folder on your laptop.

From **Cloud Team > Add material**, select a `.txt`, `.md`, `.csv`, or `.json`
file, or paste a short source. The file is read locally for inspection first.
Only **Save material** uploads it to your OpenBot deployment. Keep the original
filename or document reference in the source field. The initial limit is 30,000
characters per material, 100 materials per person, and 20 sources totaling at
most 120,000 characters per task. Split large exports into independently useful
sources.
Export PDF, Word, or proprietary formats to reviewed text before importing.

Do not import `.env` files, API credentials, session cookies, or whole folders
without inspecting them. Removing a material prevents future selection; it does
not erase copies already present in task history, provider retention, backups,
or in-flight requests. Set a separate retention and deletion policy before
using sensitive production material.

Good first tasks:

- Identify contradictions between the original Grokbot rules and recent notes,
  citing the source IDs rather than inventing a resolution.
- Produce an indexed project brief with open decisions and missing evidence.
- Propose changes to the original workflow as a reviewable draft, not overwrite it.

## Model selection and cost discipline

The desired premium planners are **Claude Fable 5.1** and **GPT-6 Astra**.
Those are target choices, not a guarantee that a similarly named public API
model exists or that your account has access. Coding-assistant subscriptions
and their model menus do not provide application API credentials.

Configure one verified premium planner at a time. Benchmark the alternate on
the same material set before switching; do not pay both to discuss every task.
Use inexpensive models for worker and reviewer roles. Provider, exact model ID,
token rates, output limits, and budgets belong to the server operator, not
the model's prompt. No unverified pricing should be treated as a real quote.

`CLOUD_TEAM_CONFIG` is the operator's JSON configuration. Provider credentials
are separate secrets: `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`. Never put keys
in the JSON, a prompt, Git, or a mobile bundle. OpenAI uses the Responses API;
Anthropic uses the Messages API. An optional provider-compatible base URL is
an operator trust decision, not a user-supplied task field. Base URLs must use
HTTPS, contain no embedded credentials, query, or fragment, and point to the
provider root or `/v1`. Redirects are refused instead of forwarding credentials.

The exact JSON contract is below. **This template deliberately will not enable
spending:** replace each `null` with the provider's verified numeric USD price
per million tokens and each placeholder with an API model ID available to your
account. The example budgets are a proposed pilot ceiling, not provider prices.
Set the resulting compact JSON as `CLOUD_TEAM_CONFIG` in your private `.env` or
deployment secret/configuration store; API and worker must receive the same value.

```json
{
  "planner": {
    "provider": "anthropic",
    "model": "REPLACE_WITH_VERIFIED_FABLE_API_ID",
    "inputUsdPerMillion": null,
    "outputUsdPerMillion": null,
    "maxOutputTokens": 2000
  },
  "worker": {
    "provider": "openai",
    "model": "REPLACE_WITH_VERIFIED_ECONOMY_API_ID",
    "inputUsdPerMillion": null,
    "outputUsdPerMillion": null,
    "maxOutputTokens": 3000
  },
  "reviewer": {
    "provider": "openai",
    "model": "REPLACE_WITH_VERIFIED_REVIEWER_API_ID",
    "inputUsdPerMillion": null,
    "outputUsdPerMillion": null,
    "maxOutputTokens": 4000
  },
  "dailyBudgetUsd": 5,
  "runBudgetUsd": 1,
  "maxSteps": 5
}
```

For Astra, set the planner provider to `openai` and its exact verified API ID.
Each output cap must be 1-16,000 tokens. Step limits are 3-6, with the current
workflow using one planning call, one to three worker calls, and one review call.
Each price and budget must be finite and positive; the run budget cannot exceed
the daily budget. Price changes apply to subsequent reservations. Completed
steps retain their originally calculated cost.

Before launch, configure small daily and per-task budgets that you explicitly
approve. Start with one worker and a small source set. Add capacity only after
measuring useful completions, not merely fast responses.

The ledger records each model call. Reservations are conservative estimates
made before spending; unresolved calls must not be silently refunded or retried.
Cancellation prevents subsequent calls, but cannot promise to cancel a charge
already accepted by the provider. Limits cover the configured token rates, not
hosting, document parsing services, unrelated bots, taxes, or billing corrections.
Set independent provider-side spend limits and alerts as a second boundary.

Daily totals follow the UTC day when a model step is settled, not when its task
was queued. Unresolved reservations carry across midnight. There is no automatic
refund or reconciliation UI in this version: an operator must reconcile unknown
outcomes against provider records before making an audited accounting correction.
Do not clear held amounts merely to retry work. Until reconciliation is available
in-product, use a small pilot rather than unattended high-volume production.

## Portable deployment

Use **one durable source of truth**, not a synchronized folder of bot state:
PostgreSQL for task records, sources, memory, and accounting; a separately
backed-up CopilotKit Intelligence project for existing conversations.
Use a secrets manager for credentials. Keep database backups and the credential
encryption key recoverable independently of this laptop.

`docker-compose.cloud.yml` runs the existing API/SPA image and a dedicated
Cloud Team worker. It uses an external PostgreSQL database and intentionally
does not run bot shells beside API credentials. No Docker socket is mounted.
Browser-computer automation can be added later through OpenBot's isolated
computer deployment, not by weakening this boundary.

Deployment prerequisites:

1. A Linux container host and persistent PostgreSQL with pgvector, encrypted
   connections, backups, and a tested restore procedure.
2. A domain and an HTTPS reverse proxy that supports the app's streaming and
   WebSocket traffic. Only the reverse proxy should be public.
3. Google, Microsoft, or Okta sign-in configured using the existing
   [sign-in instructions](../README.md#sign-in). Restrict admission to intended
   users. The cloud Compose file forces single-user bypass off.
4. CopilotKit Intelligence credentials and license required by OpenBot,
   a unique vault encryption key, provider keys, and verified model configuration.
5. Migrations applied as a release step before API or workers start.

Create a private `.env` from `.env.example`, then replace laptop addresses,
example keys, and single-user settings with production values. Set
`BETTER_AUTH_URL` and `TRUSTED_ORIGINS` to your HTTPS origin. Do not use the
example database password on a public server.

```sh
docker compose -f docker-compose.cloud.yml build api
docker compose -f docker-compose.cloud.yml run --rm --no-deps api \
  bun x drizzle-kit migrate --config=drizzle.config.ts
docker compose -f docker-compose.cloud.yml up -d
```

The API listens on host loopback port 3001 by default. Point your HTTPS proxy
there; do not open raw database, model-worker, or bot-computer ports.
The Cloud Team worker is distinct from the existing routines worker:
this file does not start the routines scheduler.

For a managed container platform, deploy the same image twice: the normal API
command as a web service and `bun scripts/run-cloud-team.ts --loop` as an
always-on background service, both with the same database and model policy.
Do not use request-only serverless functions for long-lived jobs. A scheduled
one-shot invocation of `bun scripts/run-cloud-team.ts` is another option.

Restarting a worker must not automatically replay a possibly billed call.
Inspect interrupted tasks and their reservations before explicitly creating
a replacement task. Keep one operator-owned model policy consistent across
API and worker replicas.

## Web and mobile plan

**First: responsive web.** Use the same authenticated HTTPS address on desktop,
iPhone, and Android. Tasks continue on the worker after the browser closes.
Git is for code, not live memory; pulling the repository on another device does
not transfer the database or decrypt its secrets.

**Next: installable web app.** Add an app manifest, icons, and an install flow
after the hosted workflow is reliable. Cache only the application shell, never
private materials or authenticated API responses by default. Add notification
permissions and device registration only when completion notifications are
actually implemented. Native push and offline access are not present now.

**Later: native wrapper only when justified.** Wrap the same API for camera
capture, share-sheet ingestion, or native notifications. Keep credentials and
model execution on the server. Use revocable device sessions and explicit
offline-storage protection; do not duplicate orchestration inside the mobile app.

## Improving beyond the old system

Do not claim to outperform Grokbot before comparing actual work. Build a
versioned benchmark from representative, permission-cleared tasks: factual
questions, synthesis, corrections, and planning under an explicit budget.
Keep expected answers and source references reviewed by a person.

For each task compare source accuracy, unsupported claims, accepted output,
manual correction time, elapsed time, tokens, and cost per accepted result.
Require improvement in accepted outcomes without increasing unsupported claims.
Record which model and policy produced every result.

Tune by failure category: improve retrieval for missing context, use a stronger
worker for reasoning failures, shorten or split oversized sources, and stop
retrying tasks that need missing facts. Promote only verified lessons. Automatic
model promotion, learned routing, semantic retrieval, provider invoice
reconciliation, and recurring evaluation are roadmap items, not working features
of this initial workflow.

## Git and Cursor Origin

GitHub remains the existing `origin` remote. A separate `cursor` remote can
hold the same code at Cursor Origin without replacing GitHub. Push only code,
reviewed configuration templates, and documentation. Never push live memory,
private material exports, database dumps, or `.env`.

Use branches and reviewable commits on either host. Promote a tested release
image to your cloud deployment rather than making the server depend on a local
checkout. A clone plus deployment configuration and a database restore should
be sufficient to recover on a different machine.
