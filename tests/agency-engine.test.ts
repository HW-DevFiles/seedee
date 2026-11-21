import { describe, expect, it, vi } from "vitest";
import { DemoProvider } from "@/lib/ai/demo-provider";
import { getAIProvider } from "@/lib/ai";
import {
  PRACTICES,
  agencyInputSchema,
  type AgencyDraft,
  type ArtifactContent,
} from "@/lib/ai/contracts";
import { containsSolicitation, PRIVATE_PITCH_DISCLOSURE } from "@/lib/ai/pitch";
import { AgencyEngine, engineResult } from "@/features/agency-engine/service";
import { FixtureEngineRepository } from "@/features/agency-engine/repository";
import { EngineError } from "@/features/agency-engine/contracts";
import { createEngineActions } from "@/features/agency-engine/actions";
import {
  agencyFixture,
  taskFixture,
  pitchFixture,
} from "@/features/agency-engine/fixtures";
import { explainReadiness } from "@/features/agency-engine/explanations";

const clock = () => new Date("2026-11-21T00:00:00Z");
function setup(provider = new DemoProvider(), timeout = 1000) {
  const gates = {
    task: {
      taskId: "task",
      projectId: "project",
      version: 0,
      status: "queued",
      dependenciesDone: true,
    },
  };
  const repo = new FixtureEngineRepository("owner", "agency", undefined, gates);
  return {
    repo,
    gates,
    engine: new AgencyEngine(repo, provider, clock, timeout),
  };
}
const queue = {
  agencyId: "agency",
  taskId: "task",
  projectId: "project",
  expectedTaskVersion: 0,
  idempotencyKey: "queue",
  input: taskFixture,
};
const runArgs = (run: { id: string; version: number }, key: string) => ({
  agencyId: "agency",
  runId: run.id,
  expectedVersion: run.version,
  idempotencyKey: key,
});

class ConflictOnSave extends FixtureEngineRepository {
  calls = 0;
  failAt = 0;
  async transact<T>(
    ...args: Parameters<FixtureEngineRepository["transact"]>
  ): Promise<T> {
    if (++this.calls === this.failAt)
      throw new EngineError("conflict", "Workspace changed. Reload and retry.");
    return super.transact<T>(...args);
  }
}
function conflictSetup() {
  const repo = new ConflictOnSave("owner", "agency", undefined, {
    task: {
      taskId: "task",
      projectId: "project",
      version: 0,
      status: "queued",
      dependenciesDone: true,
    },
  });
  return { repo, engine: new AgencyEngine(repo, new DemoProvider(), clock) };
}

describe("save-time conflicts", () => {
  it("propagates a draft save conflict without recording a provider failure", async () => {
    const { repo, engine } = conflictSetup(),
      command = { idempotencyKey: "draft", input: agencyFixture };
    repo.failAt = 2;
    await expect(engine.generateAgency("owner", command)).rejects.toMatchObject(
      { code: "conflict" },
    );
    expect((await engine.readWorkspace("owner")).drafts[0]).toMatchObject({
      status: "generating",
      errorCode: null,
    });
    expect(await engine.generateAgency("owner", command)).toMatchObject({
      status: "generated",
      errorCode: null,
    });
  });
  it("propagates a run save conflict and leaves the run resumable", async () => {
    const { repo, engine } = conflictSetup();
    const run = await engine.queueRun("owner", queue);
    repo.failAt = repo.calls + 2;
    const advance = { agencyId: "agency", runId: run.id };
    await expect(engine.advanceRun("owner", advance)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      (await engine.readWorkspace("owner", "agency")).runs[0],
    ).toMatchObject({ status: "running", errorCode: null, attempt: 1 });
    expect(await engine.advanceRun("owner", advance)).toMatchObject({
      status: "awaiting_review",
      attempt: 1,
    });
  });
  it("propagates a pitch save conflict without recording a provider failure", async () => {
    const { repo, engine } = conflictSetup(),
      command = {
        agencyId: "agency",
        idempotencyKey: "pitch",
        input: pitchFixture,
      };
    repo.failAt = 2;
    await expect(engine.draftPitch("owner", command)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      (await engine.readWorkspace("owner", "agency")).pitches[0],
    ).toMatchObject({ status: "generating", errorCode: null });
    expect(await engine.draftPitch("owner", command)).toMatchObject({
      status: "generated",
    });
  });
});

describe("practice generation evaluations", () => {
  it.each(PRACTICES)(
    "makes a meaningful repeatable %s proposal with no network",
    async (practice) => {
      const network = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Network forbidden"));
      try {
        const input = agencyInputSchema.parse({
          ...agencyFixture,
          practices: [practice],
        });
        const provider = new DemoProvider(),
          draft = await provider.generateAgency(input);
        expect(await provider.generateAgency(input)).toEqual(draft);
        expect(draft.packages).toHaveLength(3);
        expect(draft.roles).toHaveLength(7);
        expect(draft.workflows).toHaveLength(2);
        expect(draft.packages[0].deliverables).toHaveLength(3);
        expect(
          draft.roles.every(
            (role) =>
              role.simulated &&
              role.approvalRequired &&
              role.input.length > 0 &&
              role.approvalBoundary.includes("owner"),
          ),
        ).toBe(true);
        expect(draft.meta).toMatchObject({
          provider: "demo",
          requiresReview: true,
        });
        expect(draft).not.toHaveProperty("revenue");
        expect(draft).not.toHaveProperty("clients");
        expect(network).not.toHaveBeenCalled();
      } finally {
        network.mockRestore();
      }
    },
  );
  it("normalizes ordering, duplicates and boundary whitespace", async () => {
    const provider = new DemoProvider();
    const first = agencyInputSchema.parse({
      ...agencyFixture,
      practices: ["writer", "designer", "writer"],
      targetBuyer: "  Makers  ",
    });
    const second = agencyInputSchema.parse({
      ...agencyFixture,
      practices: ["designer", "writer"],
      targetBuyer: "Makers",
    });
    expect(await provider.generateAgency(first)).toEqual(
      await provider.generateAgency(second),
    );
  });
  it("rejects unknown providers, invalid capacity and unknown schema fields", async () => {
    expect(() => getAIProvider("paid")).toThrow("Only demo");
    await expect(
      new DemoProvider().generateAgency({
        ...agencyFixture,
        weeklyCapacityHours: Infinity,
      }),
    ).rejects.toThrow();
    await expect(
      new DemoProvider().generateAgency({
        ...agencyFixture,
        weeklyCapacityHours: 0,
      }),
    ).rejects.toThrow();
    await expect(
      new DemoProvider().generateAgency({
        ...agencyFixture,
        revenue: 1,
      } as typeof agencyFixture),
    ).rejects.toThrow();
  });
  it("saves malformed provider failure, preserves inputs and creates no active agency", async () => {
    class Broken extends DemoProvider {
      async generateAgency() {
        return { name: "Invented" } as AgencyDraft;
      }
    }
    const { engine } = setup(new Broken());
    const draft = await engine.generateAgency("owner", {
      idempotencyKey: "draft",
      input: agencyFixture,
    });
    expect(draft).toMatchObject({
      status: "failed",
      content: null,
      errorCode: "provider_failed",
      input: agencyFixture,
    });
    expect((await engine.readWorkspace("owner")).drafts).toHaveLength(1);
  });
  it("bounds provider runtime and saves a recoverable failure", async () => {
    class Stuck extends DemoProvider {
      async generateAgency(): Promise<AgencyDraft> {
        return new Promise(() => {});
      }
    }
    const { engine } = setup(new Stuck(), 5);
    expect(
      await engine.generateAgency("owner", {
        idempotencyKey: "timeout",
        input: agencyFixture,
      }),
    ).toMatchObject({ status: "failed", errorCode: "provider_failed" });
  });
  it("deduplicates concurrent requests and keeps selective regeneration and edits separate", async () => {
    const { engine } = setup(),
      command = { idempotencyKey: "first", input: agencyFixture };
    const [first, second] = await Promise.all([
      engine.generateAgency("owner", command),
      engine.generateAgency("owner", command),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.status).toBe("generated");
    const edited = await engine.editDraft("owner", {
      draftId: first.id,
      expectedVersion: first.version,
      content: { ...first.content, name: "Owner's edited studio" },
    });
    await expect(
      engine.editDraft("owner", {
        draftId: first.id,
        expectedVersion: 1,
        content: first.content,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const next = await engine.generateAgency("owner", {
      ...command,
      idempotencyKey: "next",
      previousDraftId: first.id,
      regenerateFields: ["positioning"],
      input: { ...agencyFixture, goal: "An intentionally different goal" },
    });
    expect(next.content?.name).toBe("Owner's edited studio");
    expect(next.content?.positioning).toContain("different goal");
    expect(next.previousDraftId).toBe(edited.id);
    expect((await engine.readWorkspace("owner")).drafts[0].content?.name).toBe(
      "Owner's edited studio",
    );
    await expect(
      engine.generateAgency("owner", {
        ...command,
        input: { ...agencyFixture, goal: "conflicting" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("persisted run protocol", () => {
  it("queues once, requires human approval, and replays approval idempotently", async () => {
    const { engine } = setup();
    const [first, second] = await Promise.all([
      engine.queueRun("owner", queue),
      engine.queueRun("owner", queue),
    ]);
    expect(first.id).toBe(second.id);
    await expect(
      engine.approveRun("owner", runArgs(first, "early")),
    ).rejects.toMatchObject({ code: "conflict" });
    const generated = await engine.advanceRun("owner", {
      agencyId: "agency",
      runId: first.id,
    });
    expect(generated.status).toBe("awaiting_review");
    const artifact = (await engine.readWorkspace("owner", "agency"))
      .artifacts[0];
    expect(artifact).toMatchObject({ status: "draft", reviewedAt: null });
    const command = runArgs(generated, "approve"),
      approved = await engine.approveRun("owner", command);
    expect(approved.status).toBe("completed");
    expect(await engine.approveRun("owner", command)).toEqual(approved);
    expect(
      (await engine.readWorkspace("owner", "agency")).artifacts[0],
    ).toMatchObject({
      status: "approved",
      reviewedByUserId: "owner",
      reviewedAt: clock().toISOString(),
    });
    expect(
      (
        await engine.advanceRun("owner", {
          agencyId: "agency",
          runId: first.id,
        })
      ).status,
    ).toBe("completed");
  });
  it("rejects blocked dependencies, stale task versions and cross-project IDs", async () => {
    const { engine, gates } = setup();
    gates.task.dependenciesDone = false;
    await expect(engine.queueRun("owner", queue)).rejects.toMatchObject({
      code: "conflict",
    });
    gates.task.dependenciesDone = true;
    gates.task.version = 1;
    await expect(engine.queueRun("owner", queue)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      engine.queueRun("owner", {
        ...queue,
        expectedTaskVersion: 1,
        projectId: "foreign",
      }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
  });
  it("links revised artifact versions and cannot approve a superseded run", async () => {
    const { engine } = setup();
    const run = await engine.queueRun("owner", queue);
    const ready = await engine.advanceRun("owner", {
      agencyId: "agency",
      runId: run.id,
    });
    const request = {
      ...runArgs(ready, "revision"),
      note: "Use a quieter visual direction",
    };
    const next = await engine.requestRevision("owner", request);
    expect((await engine.requestRevision("owner", request)).id).toBe(next.id);
    await expect(
      engine.approveRun(
        "owner",
        runArgs({ ...ready, version: ready.version + 1 }, "old"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const revised = await engine.advanceRun("owner", {
      agencyId: "agency",
      runId: next.id,
    });
    const state = await engine.readWorkspace("owner", "agency");
    expect(state.artifacts).toHaveLength(2);
    expect(state.artifacts[0].status).toBe("revision_requested");
    expect(state.artifacts[1]).toMatchObject({
      revision: 2,
      previousRevisionId: state.artifacts[0].id,
    });
    expect(
      state.artifacts[1].content.sections.find(
        (section) => section.heading === "Revision request",
      )?.body,
    ).toContain("quieter");
    expect(revised.status).toBe("awaiting_review");
  });
  it("failed steps retry once and retain attempted-step evidence", async () => {
    class Flaky extends DemoProvider {
      fails = true;
      async simulateTask(input: typeof taskFixture) {
        if (this.fails) throw new Error("Secret internal failure");
        return super.simulateTask(input);
      }
    }
    const provider = new Flaky(),
      { engine } = setup(provider);
    const run = await engine.queueRun("owner", queue);
    const failed = await engine.advanceRun("owner", {
      agencyId: "agency",
      runId: run.id,
    });
    expect(failed.status).toBe("failed");
    expect(failed.steps.some((step) => step.status === "failed")).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("Secret");
    provider.fails = false;
    const command = runArgs(failed, "retry"),
      retried = await engine.retryRun("owner", command);
    expect(retried.attempt).toBe(2);
    expect((await engine.retryRun("owner", command)).attempt).toBe(2);
    expect(
      (await engine.advanceRun("owner", { agencyId: "agency", runId: run.id }))
        .status,
    ).toBe("awaiting_review");
    expect(
      (await engine.readWorkspace("owner", "agency")).artifacts,
    ).toHaveLength(1);
  });
  it("cancellation wins over an in-flight result and prevents more steps", async () => {
    let resolve!: (content: ArtifactContent) => void, started!: () => void;
    const ready = new Promise<void>((done) => {
      started = done;
    });
    class Slow extends DemoProvider {
      async simulateTask() {
        started();
        return new Promise<ArtifactContent>((done) => {
          resolve = done;
        });
      }
    }
    const { engine } = setup(new Slow());
    const queued = await engine.queueRun("owner", queue);
    const work = engine.advanceRun("owner", {
      agencyId: "agency",
      runId: queued.id,
    });
    await ready;
    const running = (await engine.readWorkspace("owner", "agency")).runs[0];
    await engine.cancelRun("owner", runArgs(running, "cancel"));
    resolve(await new DemoProvider().simulateTask(taskFixture));
    expect((await work).status).toBe("cancelled");
    expect(
      (await engine.readWorkspace("owner", "agency")).artifacts,
    ).toHaveLength(0);
    expect(
      (
        await engine.advanceRun("owner", {
          agencyId: "agency",
          runId: queued.id,
        })
      ).status,
    ).toBe("cancelled");
  });
  it("recovers a persisted running marker without duplicate artifacts", async () => {
    const { engine, repo } = setup();
    const queued = await engine.queueRun("owner", queue);
    await repo.transact({ userId: "owner", agencyId: "agency" }, (tx) => {
      tx.state.runs[0].status = "running";
    });
    const restarted = new AgencyEngine(repo, new DemoProvider(), clock);
    const [first, second] = await Promise.all([
      restarted.advanceRun("owner", { agencyId: "agency", runId: queued.id }),
      restarted.advanceRun("owner", { agencyId: "agency", runId: queued.id }),
    ]);
    expect(first.artifactId).toBe(second.artifactId);
    expect(
      (await restarted.readWorkspace("owner", "agency")).artifacts,
    ).toHaveLength(1);
  });
  it("isolates each owner's records on reads and mutations", async () => {
    const { engine } = setup();
    await expect(
      engine.readWorkspace("attacker", "agency"),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    await expect(engine.queueRun("attacker", queue)).rejects.toMatchObject({
      code: "forbidden_or_missing",
    });
    await expect(
      engine.queueRun("owner", { ...queue, agencyId: "foreign" }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
  });
});

describe("private narrative and explanation evaluations", () => {
  it("keeps missing evidence explicit and carries the permitted educational disclaimer", async () => {
    const pitch = await new DemoProvider().draftPitch(pitchFixture);
    expect(pitch.sections).toHaveLength(12);
    expect(pitch.unresolvedClaims.length).toBeGreaterThan(5);
    expect(
      pitch.sections.find((section) => section.key === "traction")?.body,
    ).toContain("[Evidence needed]");
    expect(pitch.disclosure).toContain(PRIVATE_PITCH_DISCLOSURE);
    expect(containsSolicitation(JSON.stringify(pitch))).toBe(false);
    expect(pitch.sections.flatMap((section) => section.sourceIds)).toEqual([]);
  });
  it("copies numeric facts and dates exactly, without inferring growing recurring revenue", async () => {
    const input = {
      ...pitchFixture,
      fundingInterest: true,
      facts: [
        {
          id: "retainer",
          section: "retention" as const,
          label: "October earned retainer revenue",
          displayValue: "USD 6,000",
          origin: "sample" as const,
          sourceRef: "snapshot-october",
          asOf: "2026-10-31",
          formulaVersion: "agency-finance-v1.1",
          reviewStatus: "unreviewed" as const,
        },
      ],
    };
    const output = await new DemoProvider().draftPitch(input);
    const section = output.sections.find(
      (section) => section.key === "retention",
    )!;
    expect(section.body).toContain("USD 6,000");
    expect(section.body).toContain("2026-10-31");
    expect(section.sourceIds).toEqual(["retainer"]);
    expect(section.body).not.toMatch(/recurring revenue (?:is )?grow/i);
    expect(output.disclosure).toContain("Sample data");
    expect(output.sections[11].heading).toBe(
      "Hypothetical planning scenario — not an offer of securities",
    );
    await expect(
      new DemoProvider().draftPitch({
        ...input,
        facts: [
          ...input.facts,
          { ...input.facts[0], id: "actual", origin: "user_entered" },
        ],
      }),
    ).rejects.toThrow();
  });
  it.each([
    "Invest in us",
    "Join our round",
    "Reserve your spot",
    "Allocation available",
  ])("rejects rendered solicitation input: %s", async (phrase) => {
    await expect(
      new DemoProvider().draftPitch({ ...pitchFixture, positioning: phrase }),
    ).rejects.toThrow("call-to-invest");
  });
  it("preserves generated, edited and regenerated pitch versions", async () => {
    const { engine } = setup();
    const first = await engine.draftPitch("owner", {
      agencyId: "agency",
      idempotencyKey: "pitch",
      input: pitchFixture,
    });
    const content = first.content!;
    const edited = await engine.editPitch("owner", {
      agencyId: "agency",
      pitchId: first.id,
      expectedVersion: 1,
      content: { ...content, title: "Owner-edited title" },
    });
    expect(edited.previousPitchId).toBe(first.id);
    const regenerated = await engine.draftPitch("owner", {
      agencyId: "agency",
      idempotencyKey: "pitch-next",
      previousPitchId: edited.id,
      input: pitchFixture,
    });
    const state = await engine.readWorkspace("owner", "agency");
    expect(state.pitches).toHaveLength(3);
    expect(state.pitches[1].content?.title).toBe("Owner-edited title");
    expect(regenerated.previousPitchId).toBe(edited.id);
  });
  it("does not stack the owner-edit notice when an edited body is edited again", async () => {
    const { engine } = setup();
    const first = await engine.draftPitch("owner", {
      agencyId: "agency",
      idempotencyKey: "pitch",
      input: pitchFixture,
    });
    const [section, ...rest] = first.content!.sections;
    const edited = await engine.editPitch("owner", {
      agencyId: "agency",
      pitchId: first.id,
      expectedVersion: first.version,
      content: {
        ...first.content!,
        sections: [{ ...section, body: "Owner draft one." }, ...rest],
      },
    });
    const notice = edited.content!.sections[0].body.replace(
      "Owner draft one.",
      "",
    );
    expect(notice).toContain("[Evidence needed]");
    const again = await engine.editPitch("owner", {
      agencyId: "agency",
      pitchId: edited.id,
      expectedVersion: edited.version,
      content: {
        ...edited.content!,
        sections: [
          {
            ...edited.content!.sections[0],
            body: `${edited.content!.sections[0].body} Added line.`,
          },
          ...edited.content!.sections.slice(1),
        ],
      },
    });
    expect(again.content!.sections[0].body).toBe(
      `${notice}Owner draft one. Added line.`,
    );
    const unchanged = await engine.editPitch("owner", {
      agencyId: "agency",
      pitchId: again.id,
      expectedVersion: again.version,
      content: {
        ...again.content!,
        sections: [
          {
            ...again.content!.sections[0],
            body: "Owner draft one. Added line.",
          },
          ...again.content!.sections.slice(1),
        ],
      },
    });
    expect(unchanged.content!.sections[0].body).toBe(
      `${notice}Owner draft one. Added line.`,
    );
    expect(unchanged.content!.sections.slice(1)).toEqual(
      first.content!.sections.slice(1),
    );
  });
  it("orders computed gaps D,R,C and retains unfavorable risk flags without scoring", () => {
    const gaps = ["4", "3", "4", "5.6", "4", "3", "3"];
    const result = explainReadiness({
      snapshotId: "sample",
      rubricVersion: "readiness-v1.1",
      scoreDisplay: "73.4",
      stage: "Strengthen the evidence",
      coverageDisplay: "100%",
      asOf: "2026-10-31",
      evaluatedAt: clock().toISOString(),
      sample: true,
      provisional: false,
      riskFlags: ["Negative projected cash"],
      components: (["R", "G", "C", "D", "H", "I", "M"] as const).map(
        (key, index) => ({
          key,
          points: "0",
          maxPoints: "20",
          unearnedPoints: gaps[index],
          rawDisplay: null,
          availability: "missing",
          sourceIds: [],
          reasonCode: "missing_evidence",
          nextAction: "Record missing evidence",
        }),
      ),
    });
    expect(result.recommendations.map((row) => row.key)).toEqual([
      "D",
      "R",
      "C",
    ]);
    expect(result.summary).toContain("73.4");
    expect(result.riskFlags).toEqual(["Negative projected cash"]);
    expect(result.components[0].explanation).toContain("Unknown");
  });
});

describe("authenticated boundary", () => {
  it("reauthorizes saved-result replays without charging quota or invoking the provider", async () => {
    const provider = new DemoProvider(),
      generate = vi.spyOn(provider, "generateAgency"),
      { engine } = setup(provider);
    const context = vi.fn(async () => ({ userId: "owner" })),
      quota = vi.fn(async () => {});
    const actions = createEngineActions(engine, {
      requireContext: context,
      consumeGenerationLimit: quota,
    });
    const command = {
      type: "generateAgency",
      input: { idempotencyKey: "saved-replay", input: agencyFixture },
    };
    const first = await actions.command(command);
    expect(first).toMatchObject({ ok: true, data: { status: "generated" } });
    expect(await actions.command(command)).toEqual(first);
    expect(context).toHaveBeenCalledTimes(2);
    expect(quota).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    const exhausted = createEngineActions(engine, {
      requireContext: context,
      consumeGenerationLimit: async () => {
        throw new EngineError("rate_limited", "Quota exhausted");
      },
    });
    expect(await exhausted.command(command)).toEqual(first);
  });
  it("requires session/origin and quotas, and rejects submitted owner identity", async () => {
    const { engine } = setup(),
      context = vi.fn(async () => ({ userId: "owner" })),
      quota = vi.fn(async () => {});
    const actions = createEngineActions(engine, {
      requireContext: context,
      consumeGenerationLimit: quota,
    });
    expect(
      await actions.command({
        type: "generateAgency",
        input: {
          idempotencyKey: "boundary",
          input: agencyFixture,
          userId: "attacker",
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(
      await actions.command({
        type: "generateAgency",
        input: { idempotencyKey: "boundary", input: agencyFixture },
      }),
    ).toMatchObject({ ok: true, data: { status: "generated" } });
    expect(context).toHaveBeenCalledWith(true);
    expect(quota).toHaveBeenCalled();
    const blocked = createEngineActions(engine, {
      requireContext: async () => {
        throw new EngineError("unauthenticated", "Sign in");
      },
      consumeGenerationLimit: quota,
    });
    expect(await blocked.readWorkspace()).toMatchObject({
      ok: false,
      error: { code: "unauthenticated" },
    });
    const limited = createEngineActions(engine, {
      requireContext: context,
      consumeGenerationLimit: async () => {
        throw new EngineError("rate_limited", "Try later");
      },
    });
    expect(
      await limited.command({
        type: "generateAgency",
        input: { idempotencyKey: "limited", input: agencyFixture },
      }),
    ).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect((await engine.readWorkspace("owner")).drafts).toHaveLength(1);
  });
  it("returns safe errors rather than provider bodies or secrets", async () => {
    expect(
      await engineResult(async () => {
        throw new Error("credential=secret");
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "provider_failed",
        message:
          "The operation could not finish. Your saved work is preserved; retry.",
      },
    });
  });
  it("preserves shared security error codes without exposing their internal message", async () => {
    class QuotaError extends Error {
      code = "rate_limited";
    }
    expect(
      await engineResult(async () => {
        throw new QuotaError("internal bucket data");
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "rate_limited",
        message: "Too many requests. Try again later.",
      },
    });
  });
});
