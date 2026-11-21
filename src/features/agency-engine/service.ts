import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AIProvider } from "@/lib/ai/types";
import {
  ENGINE_VERSION,
  TEMPLATE_VERSION,
  agencyDraftSchema,
  artifactSchema,
  pitchDraftSchema,
  pitchInputSchema,
  idSchema,
  type AgencyDraft,
  type ArtifactContent,
  type PitchDraft,
} from "@/lib/ai/contracts";
import { containsSolicitation } from "@/lib/ai/pitch";
import {
  EngineError,
  errorCodes,
  generateCommandSchema,
  queueCommandSchema,
  runCommandSchema,
  revisionCommandSchema,
  type EngineRepository,
  type EngineState,
  type CrewRun,
  type EngineTransaction,
  type Result,
  type Scope,
} from "./contracts";

/** Canonical fingerprint; timestamps, random IDs and transport keys never enter provider output. */
export function fingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, val]) => [key, canonical(val)]),
          )
        : item;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export async function engineResult<T>(
  work: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (error instanceof EngineError)
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.current === undefined ? {} : { current: error.current }),
        },
      };
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: {
          code: "invalid_input",
          message: "Check the fields and try again.",
        },
      };
    if (
      error instanceof Error &&
      "code" in error &&
      errorCodes.includes(error.code as (typeof errorCodes)[number])
    ) {
      const code = error.code as (typeof errorCodes)[number];
      const messages = {
        unauthenticated: "Sign in to continue.",
        forbidden_or_missing: "This record is unavailable.",
        invalid_input: "Check the fields and try again.",
        conflict: "This record changed. Reload before trying again.",
        rate_limited: "Too many requests. Try again later.",
        provider_failed:
          "The operation could not finish. Retry from saved work.",
      };
      return { ok: false, error: { code, message: messages[code] } };
    }
    return {
      ok: false,
      error: {
        code: "provider_failed",
        message:
          "The operation could not finish. Your saved work is preserved; retry.",
      },
    };
  }
}
function required<T>(value: T | undefined): T {
  if (!value)
    throw new EngineError(
      "forbidden_or_missing",
      "This record is unavailable.",
    );
  return value;
}
const EDIT_NOTICE =
  "[Evidence needed] Owner-edited narrative; saved references do not independently verify added claims.\n\n";
function withoutEditNotice(body: string) {
  return body.startsWith(EDIT_NOTICE) ? body.slice(EDIT_NOTICE.length) : body;
}
function expectVersion(value: { version: number }, expected: number) {
  if (value.version !== expected)
    throw new EngineError(
      "conflict",
      "This record changed. Reload before trying again.",
      value,
    );
}
function runFor(state: EngineState, agencyId: string, id: string) {
  return required(
    state.runs.find((run) => run.id === id && run.agencyId === agencyId),
  );
}
function receipt(state: EngineState, key: string, hash: string) {
  const previous = state.receipts.find((row) => row.key === key);
  if (previous && previous.hash !== hash)
    throw new EngineError(
      "conflict",
      "That request key was already used for different input.",
    );
  return previous;
}
function eligible(
  gate: { status: string; dependenciesDone: boolean },
  statuses = ["queued"],
) {
  if (!statuses.includes(gate.status) || !gate.dependenciesDone)
    throw new EngineError(
      "conflict",
      "This task is not queued or has unfinished dependencies.",
    );
}
function steps(runId: string, attempt: number): CrewRun["steps"] {
  return (["validate_input", "generate_draft", "human_review"] as const).map(
    (kind) => ({
      key: `${runId}:${attempt}:${kind}`,
      kind,
      status: "pending",
      attempt,
      completedAt: null,
      errorCode: null,
    }),
  );
}
async function bounded<T>(
  work: () => Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("provider timeout")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class AgencyEngine {
  constructor(
    private repo: EngineRepository,
    private provider: AIProvider,
    private now: () => Date = () => new Date(),
    private timeoutMs = 5000,
  ) {
    if (provider.name !== "demo")
      throw new EngineError(
        "provider_failed",
        "Only the demo provider is enabled.",
      );
  }
  private stamp() {
    return this.now().toISOString();
  }
  private scope(userId: string, agencyId?: string): Scope {
    return {
      userId: idSchema.parse(userId),
      ...(agencyId ? { agencyId: idSchema.parse(agencyId) } : {}),
    };
  }
  readWorkspace(userId: string, agencyId?: string) {
    return this.repo.read(this.scope(userId, agencyId));
  }

  async generateAgency(userId: string, raw: unknown) {
    const command = generateCommandSchema.parse(raw),
      scope = this.scope(userId),
      hash = fingerprint({
        ...command,
        idempotencyKey: undefined,
        providerVersion: ENGINE_VERSION,
        templateVersion: TEMPLATE_VERSION,
      });
    const draft = await this.repo.transact(scope, (tx) => {
      const duplicate = tx.state.drafts.find(
        (row) => row.idempotencyKey === command.idempotencyKey,
      );
      if (duplicate) {
        if (duplicate.inputHash !== hash)
          throw new EngineError("conflict", "Request key already used.");
        return duplicate;
      }
      if (command.previousDraftId)
        required(
          tx.state.drafts.find(
            (row) =>
              row.id === command.previousDraftId && row.status === "generated",
          ),
        );
      const stamp = this.stamp();
      const row = {
        id: randomUUID(),
        idempotencyKey: command.idempotencyKey,
        inputHash: hash,
        input: command.input,
        version: 1,
        previousDraftId: command.previousDraftId ?? null,
        status: "generating" as const,
        content: null,
        errorCode: null,
        createdAt: stamp,
        updatedAt: stamp,
      };
      tx.state.drafts.push(row);
      return row;
    });
    if (draft.status !== "generating") return draft;
    let content: AgencyDraft;
    try {
      content = agencyDraftSchema.parse(
        await bounded(
          () => this.provider.generateAgency(draft.input),
          this.timeoutMs,
        ),
      );
    } catch {
      return this.repo.transact(scope, (tx) => {
        const row = required(
          tx.state.drafts.find((row) => row.id === draft.id),
        );
        if (row.status === "generating")
          Object.assign(row, {
            status: "failed",
            errorCode: "provider_failed",
            updatedAt: this.stamp(),
          });
        return row;
      });
    }
    if (command.previousDraftId) {
      const previous = required(
        (await this.repo.read(scope)).drafts.find(
          (row) => row.id === command.previousDraftId,
        ),
      );
      const old = required(previous.content ?? undefined);
      const selected = command.regenerateFields!;
      const fresh = content;
      content = agencyDraftSchema.parse({
        ...old,
        ...Object.fromEntries(selected.map((key) => [key, fresh[key]])),
        meta: fresh.meta,
      });
    }
    return this.repo.transact(scope, (tx) => {
      const row = required(tx.state.drafts.find((row) => row.id === draft.id));
      if (row.status === "generating")
        Object.assign(row, {
          content,
          status: "generated",
          updatedAt: this.stamp(),
        });
      return row;
    });
  }

  async editDraft(userId: string, raw: unknown) {
    const command = z
      .strictObject({
        draftId: idSchema,
        expectedVersion: z.number().int().positive(),
        content: agencyDraftSchema,
      })
      .parse(raw);
    return this.repo.transact(this.scope(userId), (tx) => {
      const row = required(
        tx.state.drafts.find((row) => row.id === command.draftId),
      );
      expectVersion(row, command.expectedVersion);
      if (row.status !== "generated")
        throw new EngineError(
          "conflict",
          "Only a generated draft can be edited.",
        );
      row.content = {
        ...command.content,
        meta: required(row.content ?? undefined).meta,
      };
      row.version++;
      row.updatedAt = this.stamp();
      return row;
    });
  }

  async queueRun(userId: string, raw: unknown) {
    const command = queueCommandSchema.parse(raw),
      hash = fingerprint({
        ...command,
        idempotencyKey: undefined,
        providerVersion: ENGINE_VERSION,
        templateVersion: TEMPLATE_VERSION,
      });
    return this.repo.transact(
      this.scope(userId, command.agencyId),
      async (tx) => {
        const duplicate = tx.state.runs.find(
          (row) => row.idempotencyKey === command.idempotencyKey,
        );
        if (duplicate) {
          if (duplicate.inputHash !== hash)
            throw new EngineError("conflict", "Request key already used.");
          return duplicate;
        }
        const gate = await tx.task(command.taskId, command.projectId);
        expectVersion(gate, command.expectedTaskVersion);
        eligible(gate);
        if (
          tx.state.runs.some(
            (row) =>
              row.taskId === command.taskId &&
              !["failed", "cancelled"].includes(row.status),
          )
        )
          throw new EngineError(
            "conflict",
            "A run already exists for this task. Revise, retry or cancel that run.",
          );
        const id = randomUUID(),
          stamp = this.stamp();
        const run: CrewRun = {
          id,
          agencyId: command.agencyId,
          taskId: command.taskId,
          projectId: command.projectId,
          idempotencyKey: command.idempotencyKey,
          inputHash: hash,
          input: command.input,
          taskVersion: gate.version,
          status: "queued",
          version: 1,
          attempt: 1,
          steps: steps(id, 1),
          previousRunId: null,
          previousArtifactId: null,
          artifactId: null,
          errorCode: null,
          createdAt: stamp,
          updatedAt: stamp,
        };
        tx.state.runs.push(run);
        return run;
      },
    );
  }

  /** A running row is its own durable recovery marker; replaying computation has no side effects. */
  async advanceRun(userId: string, raw: unknown) {
    const command = z
        .strictObject({ agencyId: idSchema, runId: idSchema })
        .parse(raw),
      scope = this.scope(userId, command.agencyId);
    const run = await this.repo.transact(scope, async (tx) => {
      const row = runFor(tx.state, command.agencyId, command.runId);
      if (!["queued", "running"].includes(row.status)) return row;
      const gate = await tx.task(row.taskId, row.projectId);
      expectVersion(gate, row.taskVersion);
      eligible(gate, ["queued", "in_progress"]);
      if (row.status === "queued") {
        row.status = "running";
        row.version++;
        row.updatedAt = this.stamp();
        const step = row.steps.find(
          (step) =>
            step.attempt === row.attempt && step.kind === "validate_input",
        )!;
        Object.assign(step, { status: "completed", completedAt: this.stamp() });
      }
      return row;
    });
    if (run.status !== "running") return run;
    let content: ArtifactContent;
    try {
      content = artifactSchema.parse(
        await bounded(
          () => this.provider.simulateTask(run.input),
          this.timeoutMs,
        ),
      );
    } catch {
      return this.repo.transact(scope, (tx) => {
        const row = runFor(tx.state, command.agencyId, command.runId);
        if (row.status === "running" && row.attempt === run.attempt) {
          Object.assign(row, {
            status: "failed",
            errorCode: "provider_failed",
            version: row.version + 1,
            updatedAt: this.stamp(),
          });
          const step = row.steps.find(
            (step) =>
              step.attempt === row.attempt && step.kind === "generate_draft",
          )!;
          Object.assign(step, {
            status: "failed",
            errorCode: "provider_failed",
          });
        }
        return row;
      });
    }
    return this.repo.transact(scope, async (tx) => {
      const row = runFor(tx.state, command.agencyId, command.runId);
      if (row.status !== "running" || row.attempt !== run.attempt) return row;
      const gate = await tx.task(row.taskId, row.projectId);
      expectVersion(gate, row.taskVersion);
      eligible(gate, ["queued", "in_progress"]);
      const stamp = this.stamp(),
        previous = tx.state.artifacts.find(
          (artifact) => artifact.id === row.previousArtifactId,
        ),
        id = `${row.id}:artifact`;
      if (!tx.state.artifacts.some((artifact) => artifact.id === id))
        tx.state.artifacts.push({
          id,
          agencyId: row.agencyId,
          taskId: row.taskId,
          runId: row.id,
          revision: previous ? previous.revision + 1 : 1,
          previousRevisionId: previous?.id ?? null,
          status: "draft",
          content,
          reviewedByUserId: null,
          reviewedAt: null,
          createdAt: stamp,
        });
      Object.assign(row, {
        artifactId: id,
        status: "awaiting_review",
        version: row.version + 1,
        updatedAt: stamp,
      });
      const step = row.steps.find(
        (step) =>
          step.attempt === row.attempt && step.kind === "generate_draft",
      )!;
      Object.assign(step, { status: "completed", completedAt: stamp });
      return row;
    });
  }

  private async runMutation(
    userId: string,
    command: z.infer<typeof runCommandSchema>,
    kind: string,
    apply: (tx: EngineTransaction, run: CrewRun) => Promise<CrewRun> | CrewRun,
  ) {
    const hash = fingerprint({ kind, ...command });
    return this.repo.transact(
      this.scope(userId, command.agencyId),
      async (tx) => {
        const old = receipt(tx.state, command.idempotencyKey, hash);
        if (old) return runFor(tx.state, command.agencyId, old.subjectId);
        const row = runFor(tx.state, command.agencyId, command.runId);
        expectVersion(row, command.expectedVersion);
        const result = await apply(tx, row);
        tx.state.receipts.push({
          key: command.idempotencyKey,
          hash,
          subjectId: result.id,
        });
        return result;
      },
    );
  }
  retryRun(userId: string, raw: unknown) {
    const command = runCommandSchema.parse(raw);
    return this.runMutation(userId, command, "retry", async (tx, row) => {
      if (row.status !== "failed")
        throw new EngineError("conflict", "Only a failed run can be retried.");
      const gate = await tx.task(row.taskId, row.projectId);
      eligible(gate, ["queued", "failed"]);
      row.taskVersion = gate.version;
      row.attempt++;
      row.status = "queued";
      row.errorCode = null;
      row.steps.push(...steps(row.id, row.attempt));
      row.version++;
      row.updatedAt = this.stamp();
      return row;
    });
  }
  cancelRun(userId: string, raw: unknown) {
    const command = runCommandSchema.parse(raw);
    return this.runMutation(userId, command, "cancel", (tx, row) => {
      if (!["queued", "running", "awaiting_review"].includes(row.status))
        throw new EngineError("conflict", "This run cannot be cancelled.");
      row.status = "cancelled";
      row.version++;
      row.updatedAt = this.stamp();
      row.steps
        .filter((step) => step.status === "pending")
        .forEach((step) => {
          step.status = "cancelled";
        });
      const artifact = tx.state.artifacts.find(
        (artifact) => artifact.id === row.artifactId,
      );
      if (artifact) artifact.status = "cancelled";
      return row;
    });
  }
  approveRun(userId: string, raw: unknown) {
    const command = runCommandSchema.parse(raw);
    return this.runMutation(userId, command, "approve", async (tx, row) => {
      if (row.status !== "awaiting_review")
        throw new EngineError("conflict", "This run is not awaiting review.");
      const gate = await tx.task(row.taskId, row.projectId);
      expectVersion(gate, row.taskVersion);
      eligible(gate, ["queued", "awaiting_review"]);
      const artifact = required(
        tx.state.artifacts.find(
          (artifact) =>
            artifact.id === row.artifactId && artifact.status === "draft",
        ),
      );
      Object.assign(artifact, {
        status: "approved",
        reviewedByUserId: userId,
        reviewedAt: this.stamp(),
      });
      await tx.approved(artifact);
      row.status = "completed";
      row.version++;
      row.updatedAt = this.stamp();
      const step = row.steps.find(
        (step) => step.attempt === row.attempt && step.kind === "human_review",
      )!;
      Object.assign(step, { status: "completed", completedAt: this.stamp() });
      return row;
    });
  }
  requestRevision(userId: string, raw: unknown) {
    const command = revisionCommandSchema.parse(raw);
    return this.runMutation(userId, command, "revision", async (tx, row) => {
      if (row.status !== "awaiting_review")
        throw new EngineError(
          "conflict",
          "Only a draft awaiting review can be revised.",
        );
      const gate = await tx.task(row.taskId, row.projectId);
      expectVersion(gate, row.taskVersion);
      eligible(gate, ["queued", "awaiting_review"]);
      const artifact = required(
        tx.state.artifacts.find(
          (artifact) =>
            artifact.id === row.artifactId && artifact.status === "draft",
        ),
      );
      artifact.status = "revision_requested";
      row.status = "cancelled";
      row.version++;
      row.updatedAt = this.stamp();
      row.steps
        .filter((step) => step.status === "pending")
        .forEach((step) => {
          step.status = "cancelled";
        });
      const id = randomUUID(),
        next: CrewRun = {
          ...row,
          id,
          status: "queued",
          version: 1,
          attempt: 1,
          idempotencyKey: command.idempotencyKey,
          input: { ...row.input, revisionNote: command.note },
          inputHash: fingerprint({ ...row.input, revisionNote: command.note }),
          previousRunId: row.id,
          previousArtifactId: artifact.id,
          artifactId: null,
          steps: steps(id, 1),
          createdAt: this.stamp(),
          updatedAt: this.stamp(),
        };
      tx.state.runs.push(next);
      return next;
    });
  }

  async draftPitch(userId: string, raw: unknown) {
    const command = z
        .strictObject({
          agencyId: idSchema,
          idempotencyKey: idSchema,
          input: pitchInputSchema,
          previousPitchId: idSchema.optional(),
        })
        .parse(raw),
      scope = this.scope(userId, command.agencyId),
      hash = fingerprint({
        ...command,
        idempotencyKey: undefined,
        providerVersion: ENGINE_VERSION,
        templateVersion: TEMPLATE_VERSION,
      });
    if (containsSolicitation(JSON.stringify(command.input)))
      throw new EngineError(
        "invalid_input",
        "Remove call-to-invest language from this private preparation draft.",
      );
    if (
      command.input.facts.some(
        (fact) =>
          new Date(`${fact.asOf}T00:00:00Z`).getTime() > this.now().getTime(),
      )
    )
      throw new EngineError(
        "invalid_input",
        "Evidence cannot have a future as-of date.",
      );
    const pitch = await this.repo.transact(scope, async (tx) => {
      const previous = tx.state.pitches.find(
        (row) => row.idempotencyKey === command.idempotencyKey,
      );
      if (previous) {
        if (previous.inputHash !== hash)
          throw new EngineError("conflict", "Request key already used.");
        return previous;
      }
      if (command.previousPitchId)
        required(
          tx.state.pitches.find(
            (row) =>
              row.id === command.previousPitchId &&
              row.agencyId === command.agencyId,
          ),
        );
      await tx.facts(command.input.facts);
      const stamp = this.stamp(),
        row = {
          id: randomUUID(),
          agencyId: command.agencyId,
          idempotencyKey: command.idempotencyKey,
          inputHash: hash,
          version: 1,
          previousPitchId: command.previousPitchId ?? null,
          input: command.input,
          content: null,
          status: "generating" as const,
          errorCode: null,
          createdAt: stamp,
          updatedAt: stamp,
        };
      tx.state.pitches.push(row);
      return row;
    });
    if (pitch.status !== "generating") return pitch;
    let content: PitchDraft;
    try {
      content = pitchDraftSchema.parse(
        await bounded(
          () => this.provider.draftPitch(pitch.input),
          this.timeoutMs,
        ),
      );
      if (containsSolicitation(JSON.stringify(content)))
        throw new Error("Unsafe pitch output");
      const ids = new Set(pitch.input.facts.map((fact) => fact.id));
      if (
        content.sections.some((section) =>
          section.sourceIds.some((id) => !ids.has(id)),
        )
      )
        throw new Error("Unknown evidence reference");
    } catch {
      return this.repo.transact(scope, (tx) => {
        const row = required(
          tx.state.pitches.find((row) => row.id === pitch.id),
        );
        if (row.status === "generating")
          Object.assign(row, {
            status: "failed",
            errorCode: "provider_failed",
            updatedAt: this.stamp(),
          });
        return row;
      });
    }
    return this.repo.transact(scope, (tx) => {
      const row = required(tx.state.pitches.find((row) => row.id === pitch.id));
      if (row.status === "generating")
        Object.assign(row, {
          content,
          status: "generated",
          updatedAt: this.stamp(),
        });
      return row;
    });
  }
  editPitch(userId: string, raw: unknown) {
    const command = z
      .strictObject({
        agencyId: idSchema,
        pitchId: idSchema,
        expectedVersion: z.number().int().positive(),
        content: pitchDraftSchema,
      })
      .parse(raw);
    if (containsSolicitation(JSON.stringify(command.content)))
      throw new EngineError(
        "invalid_input",
        "Remove call-to-invest language from this private preparation draft.",
      );
    return this.repo.transact(
      this.scope(userId, command.agencyId),
      async (tx) => {
        const row = required(
          tx.state.pitches.find(
            (row) =>
              row.id === command.pitchId && row.agencyId === command.agencyId,
          ),
        );
        expectVersion(row, command.expectedVersion);
        if (row.status !== "generated")
          throw new EngineError(
            "conflict",
            "Only a generated pitch can be edited.",
          );
        if (tx.state.pitches.some((item) => item.previousPitchId === row.id))
          throw new EngineError(
            "conflict",
            "A newer pitch version exists. Reload before editing.",
          );
        await tx.facts(row.input.facts);
        const sourceIds = new Set(row.input.facts.map((fact) => fact.id));
        if (
          command.content.sections.some((section) =>
            section.sourceIds.some((id) => !sourceIds.has(id)),
          )
        )
          throw new EngineError("invalid_input", "Unknown evidence reference.");
        const prior = required(row.content ?? undefined);
        const changed = command.content.sections.filter((section) => {
          const old = prior.sections.find((old) => old.key === section.key);
          return (
            !old ||
            withoutEditNotice(old.body) !== withoutEditNotice(section.body)
          );
        });
        const editedContent = {
          ...command.content,
          sections: command.content.sections.map((section) => ({
            ...section,
            body: changed.some((item) => item.key === section.key)
              ? `${EDIT_NOTICE}${withoutEditNotice(section.body)}`
              : required(prior.sections.find((old) => old.key === section.key))
                  .body,
          })),
          unresolvedClaims: [
            ...new Set([
              ...command.content.unresolvedClaims,
              ...changed.map(
                (section) =>
                  `${section.heading}: owner-edited claims need evidence review`,
              ),
            ]),
          ],
        };
        const next = {
          ...row,
          id: randomUUID(),
          previousPitchId: row.id,
          version: row.version + 1,
          content: {
            ...editedContent,
            meta: required(row.content ?? undefined).meta,
            disclosure: required(row.content ?? undefined).disclosure,
          },
          createdAt: this.stamp(),
          updatedAt: this.stamp(),
          idempotencyKey: randomUUID(),
        };
        tx.state.pitches.push(next);
        return next;
      },
    );
  }
}
