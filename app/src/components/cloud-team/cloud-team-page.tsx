import {
  IconBrain,
  IconChevronRight,
  IconCoin,
  IconFileText,
  IconPlus,
  IconRobot,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import {
  PageEmpty,
  PageRows,
  PageSection,
  PageShell,
} from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  cloudMaterialSchema,
  cloudMemorySchema,
  cloudRunSchema,
  readCloudMaterial,
} from "@/lib/cloud-team/form";
import {
  cancelCloudRunMutationOptions,
  createCloudMaterialMutationOptions,
  createCloudMemoryMutationOptions,
  createCloudRunMutationOptions,
  deleteCloudMaterialMutationOptions,
  deleteCloudMemoryMutationOptions,
} from "@/lib/cloud-team/mutations";
import {
  type CloudMaterial,
  type CloudRun,
  cloudRunQueryOptions,
  cloudTeamQueryOptions,
  formatCloudCost,
  isActiveRun,
} from "@/lib/cloud-team/queries";
import { queryClient } from "@/query-client";

function Failure({ error }: { error: Error | null }) {
  return error ? (
    <p className="text-sm text-destructive" role="alert">
      {error.message}
    </p>
  ) : null;
}

export function CloudTeamPage() {
  const overview = useQuery(cloudTeamQueryOptions());
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const [memorySource, setMemorySource] = useState<{ runId?: string } | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] =
    useState<CloudMaterial | null>(null);
  const [removing, setRemoving] = useState<{
    kind: "material" | "memory";
    id: string;
  } | null>(null);
  const deleteMaterial = useMutation(
    deleteCloudMaterialMutationOptions(queryClient),
  );
  const deleteMemory = useMutation(
    deleteCloudMemoryMutationOptions(queryClient),
  );
  const removal = removing?.kind === "material" ? deleteMaterial : deleteMemory;

  return (
    <PageShell
      title="Cloud Team"
      description="Premium planning, economical execution, and reviewed lessons that survive the next conversation. Your materials and memory stay scoped to your account."
      action={
        <Button
          size="lg"
          disabled={!overview.data?.configured}
          onClick={() => setCreatingRun(true)}
        >
          <IconPlus /> New task
        </Button>
      }
    >
      {overview.isPending ? null : overview.error ? (
        <PageSection>
          <Failure error={overview.error} />
        </PageSection>
      ) : overview.data ? (
        <>
          <PageSection
            title="Control room"
            description="Cost estimates use operator-configured token rates. Other chats, tools, hosting, and provider billing adjustments are not covered by these limits."
          >
            {!overview.data.configured ? (
              <p className="mt-4 text-sm" role="status">
                {overview.data.configurationError ||
                  "Model access is not configured. An administrator must configure Cloud Team and its worker before tasks can run. You can prepare materials and memory now."}
              </p>
            ) : null}
            <PageRows>
              <Item size="sm">
                <ItemMedia variant="icon">
                  <IconCoin />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Today's token spend (UTC)</ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {formatCloudCost(overview.data.usage.reservedUsd)} reserved,
                    including unresolved calls.{" "}
                    {overview.data.usage.inputTokens.toLocaleString()} input /{" "}
                    {overview.data.usage.outputTokens.toLocaleString()} output
                    tokens.
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {formatCloudCost(overview.data.usage.spentUsd)}
                </ItemActions>
              </Item>
              {overview.data.policy ? (
                <>
                  <Separator />
                  <Item size="sm">
                    <ItemContent>
                      <ItemTitle>Budget guardrails</ItemTitle>
                      <ItemDescription className="line-clamp-none">
                        {formatCloudCost(overview.data.policy.dailyBudgetUsd)}{" "}
                        per day /{" "}
                        {formatCloudCost(overview.data.policy.runBudgetUsd)} per
                        task. At most {overview.data.policy.maxSteps} model
                        calls per task. No automatic paid retries.
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                </>
              ) : null}
              {overview.data.models ? (
                <>
                  <Separator />
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <IconRobot />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>Assigned models</ItemTitle>
                      <ItemDescription className="line-clamp-none break-words">
                        Plan: {overview.data.models.planner}. Work:{" "}
                        {overview.data.models.worker}. Review:{" "}
                        {overview.data.models.reviewer}.
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                </>
              ) : null}
            </PageRows>
          </PageSection>
          <PageSection
            title="Source materials"
            description="Import selected Grokbot notes or other text. Review the contents before saving; never include credentials. Only sources selected for a task are sent to its model providers."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddingMaterial(true)}
              >
                Add material
              </Button>
            }
          >
            {overview.data.materials.length === 0 ? (
              <PageEmpty>
                No materials yet. Add a text file or paste a source.
              </PageEmpty>
            ) : (
              <PageRows>
                {overview.data.materials.map((material, index) => (
                  <Fragment key={material.id}>
                    {index > 0 ? <Separator /> : null}
                    <Item size="sm">
                      <ItemMedia variant="icon">
                        <IconFileText />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{material.title}</ItemTitle>
                        <ItemDescription>{material.source}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedMaterial(material)}
                          aria-label={`Read ${material.title}`}
                        >
                          Read
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${material.title}`}
                          onClick={() =>
                            setRemoving({ kind: "material", id: material.id })
                          }
                        >
                          <IconTrash />
                        </Button>
                      </ItemActions>
                    </Item>
                  </Fragment>
                ))}
              </PageRows>
            )}
          </PageSection>
          <PageSection
            title="Shared memory"
            description="Lessons you approve, not self-certified model claims. Cloud Team stages reuse a bounded selection; existing Bots can read the same memory through a read-only tool."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMemorySource({})}
              >
                Add lesson
              </Button>
            }
          >
            {overview.data.memories.length === 0 ? (
              <PageEmpty>
                No approved lessons yet. Record a preference or approve a lesson
                after reviewing a result.
              </PageEmpty>
            ) : (
              <PageRows>
                {overview.data.memories.map((memory, index) => (
                  <Fragment key={memory.id}>
                    {index > 0 ? <Separator /> : null}
                    <Item size="sm">
                      <ItemMedia variant="icon">
                        <IconBrain />
                      </ItemMedia>
                      <ItemContent>
                        <ItemDescription className="line-clamp-none whitespace-pre-wrap break-words">
                          {memory.content}
                        </ItemDescription>
                        {memory.sourceRunId ? (
                          <p className="text-xs text-muted-foreground break-all">
                            Source task: {memory.sourceRunId}
                          </p>
                        ) : null}
                      </ItemContent>
                      <ItemActions>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Remove lesson"
                          onClick={() =>
                            setRemoving({ kind: "memory", id: memory.id })
                          }
                        >
                          <IconTrash />
                        </Button>
                      </ItemActions>
                    </Item>
                  </Fragment>
                ))}
              </PageRows>
            )}
          </PageSection>
          <PageSection
            title="Recent tasks"
            description="Tasks run on the server worker, not in this browser. A queued task needs an active worker. Open a task to inspect its output and per-model token costs."
          >
            {overview.data.runs.length === 0 ? (
              <PageEmpty>
                No tasks yet. Set an objective, choose sources, and let the team
                prepare a draft for review.
              </PageEmpty>
            ) : (
              <PageRows>
                {overview.data.runs.map((run, index) => (
                  <Fragment key={run.id}>
                    {index > 0 ? <Separator /> : null}
                    <Item
                      size="sm"
                      render={
                        <button
                          type="button"
                          onClick={() => setSelectedRunId(run.id)}
                        />
                      }
                    >
                      <ItemMedia variant="icon">
                        <IconRobot />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="line-clamp-2">
                          {run.objective}
                        </ItemTitle>
                        <ItemDescription>
                          {run.status.replaceAll("_", " ")} /{" "}
                          {formatCloudCost(run.spentUsd)} / {run.steps.length}{" "}
                          steps
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <IconChevronRight className="size-4" />
                      </ItemActions>
                    </Item>
                  </Fragment>
                ))}
              </PageRows>
            )}
          </PageSection>
        </>
      ) : null}
      {addingMaterial ? (
        <MaterialDialog onClose={() => setAddingMaterial(false)} />
      ) : null}
      {creatingRun ? (
        <NewRunDialog
          materials={overview.data?.materials ?? []}
          onClose={() => setCreatingRun(false)}
        />
      ) : null}
      {memorySource ? (
        <MemoryDialog
          sourceRunId={memorySource.runId}
          onClose={() => setMemorySource(null)}
        />
      ) : null}
      {selectedRunId ? (
        <SelectedRunDialog
          key={selectedRunId}
          id={selectedRunId}
          onClose={() => setSelectedRunId(null)}
          onLearn={() => {
            setMemorySource({ runId: selectedRunId });
            setSelectedRunId(null);
          }}
        />
      ) : null}
      <Dialog
        open={selectedMaterial !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedMaterial(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedMaterial?.title}</DialogTitle>
            <DialogDescription>{selectedMaterial?.source}</DialogDescription>
          </DialogHeader>
          <DialogBody className="mt-4 overflow-y-auto">
            <p className="text-xs text-muted-foreground break-all">
              Citation: [material:{selectedMaterial?.id}]
            </p>
            <p className="whitespace-pre-wrap break-words">
              {selectedMaterial?.content}
            </p>
          </DialogBody>
        </DialogContent>
      </Dialog>
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            deleteMaterial.reset();
            deleteMemory.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Remove {removing?.kind === "material" ? "material" : "lesson"}?
            </DialogTitle>
            <DialogDescription>
              This removes it from future selection. Existing task records or
              in-flight context may still contain it.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Failure error={removal.error} />
          </DialogBody>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRemoving(null)}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={removal.isPending}
              onClick={() => {
                if (removing)
                  removal.mutate(removing.id, {
                    onSuccess: () => setRemoving(null),
                  });
              }}
            >
              {removal.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function MaterialDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState({ title: "", source: "", content: "" });
  const [fileError, setFileError] = useState<Error | null>(null);
  const [reading, setReading] = useState(false);
  const save = useMutation(createCloudMaterialMutationOptions(queryClient));
  const parsed = cloudMaterialSchema.safeParse(value);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add source material</DialogTitle>
          <DialogDescription>
            Choose a text export or paste content. Selecting a file only
            previews it locally; Save uploads it to this deployment.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 overflow-y-auto">
          <Field>
            <FieldLabel htmlFor="cloud-file">Text file (optional)</FieldLabel>
            <Input
              id="cloud-file"
              type="file"
              accept=".txt,.md,.csv,.json"
              disabled={reading || save.isPending}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setReading(true);
                setFileError(null);
                try {
                  setValue(await readCloudMaterial(file));
                } catch (error) {
                  setFileError(
                    error instanceof Error
                      ? error
                      : new Error("Could not read this file."),
                  );
                } finally {
                  setReading(false);
                }
              }}
            />
          </Field>
          <Failure error={fileError} />
          <Field>
            <FieldLabel htmlFor="cloud-title">Title</FieldLabel>
            <Input
              id="cloud-title"
              value={value.title}
              maxLength={120}
              onChange={(event) =>
                setValue({ ...value, title: event.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cloud-source">
              Source or original filename
            </FieldLabel>
            <Input
              id="cloud-source"
              value={value.source}
              maxLength={500}
              onChange={(event) =>
                setValue({ ...value, source: event.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cloud-content">
              Content (up to 30,000 characters)
            </FieldLabel>
            <Textarea
              id="cloud-content"
              rows={10}
              value={value.content}
              maxLength={30_000}
              onChange={(event) =>
                setValue({ ...value, content: event.target.value })
              }
            />
          </Field>
          <Failure error={save.error} />
        </DialogBody>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!parsed.success || reading || save.isPending}
            onClick={() => {
              if (parsed.success)
                save.mutate(parsed.data, { onSuccess: onClose });
            }}
          >
            {save.isPending ? "Saving..." : "Save material"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewRunDialog({
  materials,
  onClose,
}: {
  materials: CloudMaterial[];
  onClose: () => void;
}) {
  const [objective, setObjective] = useState("");
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const create = useMutation(createCloudRunMutationOptions(queryClient));
  const parsed = cloudRunSchema.safeParse({ objective, materialIds });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Give the team a task</DialogTitle>
          <DialogDescription>
            Planning, bounded work, then review. Selected sources and a bounded
            selection of approved memory are sent to the configured model
            providers. This workflow drafts answers; it does not browse or
            modify external systems.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 overflow-y-auto">
          <Field>
            <FieldLabel htmlFor="cloud-objective">
              Objective and acceptance criteria
            </FieldLabel>
            <Textarea
              id="cloud-objective"
              rows={6}
              maxLength={8_000}
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Compare these notes, identify contradictions with citations, and propose a prioritized plan. Mark anything unsupported."
            />
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-medium">
              Sources to include (up to 20)
            </legend>
            {materials.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No materials available. This task will use your objective and
                approved memory only.
              </p>
            ) : (
              materials.map((material) => (
                <label
                  key={material.id}
                  htmlFor={`source-${material.id}`}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    id={`source-${material.id}`}
                    checked={materialIds.includes(material.id)}
                    disabled={
                      materialIds.length >= 20 &&
                      !materialIds.includes(material.id)
                    }
                    onCheckedChange={(checked) =>
                      setMaterialIds((ids) =>
                        checked
                          ? [...ids, material.id]
                          : ids.filter((id) => id !== material.id),
                      )
                    }
                  />
                  <span className="break-words">{material.title}</span>
                </label>
              ))
            )}
          </fieldset>
          <Failure error={create.error} />
        </DialogBody>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!parsed.success || create.isPending}
            onClick={() => {
              if (parsed.success)
                create.mutate(parsed.data, { onSuccess: onClose });
            }}
          >
            {create.isPending ? "Queuing..." : "Queue task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemoryDialog({
  sourceRunId,
  onClose,
}: {
  sourceRunId?: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const save = useMutation(createCloudMemoryMutationOptions(queryClient));
  const parsed = cloudMemorySchema.safeParse({ content, sourceRunId });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve a shared lesson</DialogTitle>
          <DialogDescription>
            Write a concise, verified preference or correction. It will inform
            later Cloud Team tasks. This is durable context, not model training.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 overflow-y-auto">
          {sourceRunId ? (
            <p className="text-xs text-muted-foreground break-all">
              Source task: {sourceRunId}
            </p>
          ) : null}
          <Field>
            <FieldLabel htmlFor="cloud-lesson">
              Approved lesson (up to 4,000 characters)
            </FieldLabel>
            <Textarea
              id="cloud-lesson"
              rows={8}
              value={content}
              maxLength={4_000}
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <Failure error={save.error} />
        </DialogBody>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!parsed.success || save.isPending}
            onClick={() => {
              if (parsed.success)
                save.mutate(parsed.data, { onSuccess: onClose });
            }}
          >
            {save.isPending ? "Saving..." : "Approve lesson"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SelectedRunDialog({
  id,
  onClose,
  onLearn,
}: {
  id: string;
  onClose: () => void;
  onLearn: () => void;
}) {
  const run = useQuery(cloudRunQueryOptions(id));
  if (run.isPending || run.error) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cloud Team task</DialogTitle>
            <DialogDescription>
              Task output and token accounting.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {run.isPending ? null : <Failure error={run.error} />}
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }
  return <RunDialog run={run.data} onClose={onClose} onLearn={onLearn} />;
}

function RunDialog({
  run,
  onClose,
  onLearn,
}: {
  run: CloudRun;
  onClose: () => void;
  onLearn: () => void;
}) {
  const cancel = useMutation(cancelCloudRunMutationOptions(queryClient));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Task / {run.status.replaceAll("_", " ")}</DialogTitle>
          <DialogDescription>
            {formatCloudCost(run.spentUsd)} spent,{" "}
            {formatCloudCost(run.reservedUsd)} reserved.{" "}
            {run.inputTokens.toLocaleString()} input /{" "}
            {run.outputTokens.toLocaleString()} output tokens.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 overflow-y-auto">
          <p className="whitespace-pre-wrap break-words">{run.objective}</p>
          {run.error ? (
            <p className="text-destructive" role="alert">
              {run.error}
            </p>
          ) : null}
          {run.result ? (
            <div>
              <h3 className="mb-2 font-medium">Result (review before use)</h3>
              <p className="whitespace-pre-wrap break-words">{run.result}</p>
            </div>
          ) : null}
          {run.steps.map((step) => (
            <details key={step.id}>
              <summary className="cursor-pointer break-words">
                {step.role} / {step.model} / {step.status} /{" "}
                {formatCloudCost(step.costUsd)}
              </summary>
              <p className="mt-2 text-muted-foreground">
                {step.inputTokens.toLocaleString()} input /{" "}
                {step.outputTokens.toLocaleString()} output tokens
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words">
                {step.output || "No output recorded."}
              </p>
            </details>
          ))}
          {isActiveRun(run) ? (
            <p className="text-sm text-muted-foreground">
              Stopping prevents subsequent calls. An already-started provider
              call may still finish and incur cost.
            </p>
          ) : null}
          <Failure error={cancel.error} />
        </DialogBody>
        <DialogFooter>
          {isActiveRun(run) ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(run.id)}
            >
              {cancel.isPending ? "Stopping..." : "Stop task"}
            </Button>
          ) : null}
          {run.result && !isActiveRun(run) ? (
            <Button size="sm" onClick={onLearn}>
              Record a verified lesson
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
