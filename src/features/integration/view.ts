import type { IntegratedRead } from "./read";
import { screens } from "../product-ui/catalog";
import type {
  Field,
  FormSpec,
  WorkspaceUI,
  ViewTable,
} from "../product-ui/contracts";
import { displayMinor } from "../product-ui/form-input";
import { factSchema, roleSchema } from "@/lib/ai/contracts";
import { z } from "zod";
import { actualSchema, provenanceSchema } from "../workspace/contracts";
import { scoreReadiness } from "../finance/readiness";
import { teamRecords } from "../finance/team";
import { milestoneTitle, type MilestonePreview } from "../finance/milestone";
import { D, money } from "../finance/decimal";
import { calculateEquity } from "../finance/equity";
import { forecast } from "../finance/forecast";
import { notificationHref } from "../automation/notifications";
export const field = (
  name: string,
  label: string,
  extra: Partial<Field> = {},
): Field => ({ name, label, required: true, ...extra });
export const form = (
  id: string,
  title: string,
  fields: Field[] = [],
  extra: Partial<FormSpec> = {},
): FormSpec => ({ id, title, submit: title, fields, ...extra });
const options = (rows: { id: string; title?: string; name?: string }[]) =>
  rows.map((r) => ({ value: r.id, label: r.title ?? r.name ?? r.id }));
const list = (v: unknown): string[] => z.array(z.string()).parse(v);
const date = (v: Date | string | null | undefined) =>
  v ? new Date(v).toISOString().slice(0, 10) : "";
const text = (v: unknown) =>
  v === null || v === undefined ? "Unknown" : String(v);
const moneyInput = (n: unknown) =>
  typeof n === "number"
    ? `${n < 0 ? "-" : ""}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, "0")}`
    : "";
export function pitchFacts(data: IntegratedRead) {
  return data.workspace.snapshots
    .filter((s) => ["readiness", "forecast"].includes(s.kind))
    .flatMap((s) => {
      const parsed = z
        .object({ facts: z.array(factSchema) })
        .safeParse(s.output);
      return parsed.success ? parsed.data.facts : [];
    });
}
export function connectedScreen(
  data: IntegratedRead,
  key: string,
  recordId?: string,
  projectId?: string,
  query?: Record<string, string | string[] | undefined>,
): WorkspaceUI | null {
  const { workspace: w, engine: e, automation: a } = data;
  const screen = structuredClone(screens[key]);
  if (!screen) return null;
  screen.cards = [];
  screen.notices ??= [];
  const packageRow = w.packages.find((p) => p.id === recordId),
    client = w.clients.find((c) => c.id === recordId),
    project = w.projects.find((p) => p.id === recordId),
    task = w.tasks.find((t) => t.id === recordId),
    run = e.runs.find((r) => r.id === recordId);
  const records = { package: packageRow, client, project, task, run };
  if (key in records && !records[key as keyof typeof records]) return null;
  if (
    projectId &&
    (key !== "task" ||
      task?.projectId !== projectId ||
      !w.projects.some((p) => p.id === projectId))
  )
    return null;
  const draft = e.drafts.filter((d) => d.content).at(-1);
  const pitch = e.pitches.filter((p) => p.content).at(-1);
  const roles =
    z
      .object({ roles: z.array(roleSchema).optional() })
      .passthrough()
      .parse(w.agency?.rolesAndWorkflows ?? {}).roles ?? [];
  const table = (
    title: string,
    columns: string[],
    rows: ViewTable["rows"],
  ): ViewTable => ({ title, columns, rows, empty: "No saved records yet." });
  const taskOrder = a?.state.workflows.flatMap((flow) => flow.taskIds) ?? [];
  const tasks = [...w.tasks]
    .sort((left, right) => {
      const l = taskOrder.indexOf(left.id),
        r = taskOrder.indexOf(right.id);
      return (
        (l < 0 ? Number.MAX_SAFE_INTEGER : l) -
        (r < 0 ? Number.MAX_SAFE_INTEGER : r)
      );
    })
    .filter((t) => key !== "project" || t.projectId === recordId)
    .filter((t) => !query?.status || t.status === query.status);
  const taskTable = table(
    "Work queue",
    ["Task", "Assignment", "Due", "Status"],
    tasks.map((t) => ({
      id: t.id,
      cells: [
        t.title,
        t.assignedRoleKey ?? "Owner",
        date(t.dueAt) || "Unscheduled",
        t.status,
      ],
      href: `/app/crew/tasks/${t.id}`,
    })),
  );
  if (key === "overview") {
    screen.title = `Welcome, ${data.userName}.`;
    screen.metrics = [
      {
        label: "Active projects",
        value: String(w.home.activeProjects),
        detail: "Saved work",
        href: "/app/projects?status=active",
      },
      {
        label: "Awaiting review",
        value: String(w.home.awaitingReview),
        detail: "Owner approval required",
        href: "/app/crew?status=awaiting_review",
      },
      {
        label: "Completed projects",
        value: String(w.home.completedProjects),
        detail: "Revenue recorded separately",
        href: "/app/projects?status=completed",
      },
      {
        label: "Tasks",
        value: String(w.home.taskCount),
        detail: "Saved work queue",
        href: "/app/crew",
      },
    ];
    screen.links = w.home.nextActions;
    if (!w.agency)
      screen.notices = [
        {
          title: "Your agency starts with you",
          body: "Save your practice, generate a draft, and review it before accepting your agency.",
        },
      ];
  }
  if (key === "agency")
    screen.tables = [
      table(
        "Service packages",
        ["Package", "Price", "Turnaround", "State"],
        w.packages.map((p) => ({
          id: p.id,
          cells: [
            p.title,
            displayMinor(p.priceMinor),
            `${p.turnaroundDays} days`,
            p.archivedAt ? "Archived" : "Active",
          ],
          href: `/app/agency/packages/${p.id}`,
        })),
      ),
    ];
  if (key === "clients")
    screen.tables = [
      table(
        "Clients",
        ["Client", "Organization", "Projects", "State"],
        w.clients
          .filter(
            (c) =>
              !query?.search ||
              c.name.toLowerCase().includes(String(query.search).toLowerCase()),
          )
          .map((c) => ({
            id: c.id,
            cells: [
              c.name,
              c.organization,
              String(c.projects.length),
              c.archivedAt ? "Archived" : "Active",
            ],
            href: `/app/projects/clients/${c.id}`,
          })),
      ),
    ];
  if (key === "projects" || key === "client")
    screen.tables = [
      table(
        "Projects",
        ["Project", "Client", "Due", "Budget", "Status"],
        w.projects
          .filter(
            (p) =>
              (!client || p.clientId === client.id) &&
              (!query?.status || p.status === query.status),
          )
          .map((p) => ({
            id: p.id,
            cells: [
              p.title,
              w.clients.find((c) => c.id === p.clientId)?.name ?? "Unassigned",
              date(p.dueAt) || "Unscheduled",
              displayMinor(p.budgetMinor),
              p.status,
            ],
            href: `/app/projects/${p.id}`,
          })),
      ),
    ];
  if (key === "crew") {
    screen.cards = roles.map((r) => ({
      id: r.key,
      title: r.title,
      body: r.responsibility,
      details: [
        { label: "Input", value: r.input.join("; ") },
        { label: "Output", value: r.output },
        { label: "Approval", value: r.approvalBoundary },
      ],
    }));
    screen.tables = [
      taskTable,
      table(
        "Crew runs",
        ["Task", "Status", "Version"],
        e.runs.map((r) => ({
          id: r.id,
          cells: [r.input.title, r.status, String(r.version)],
          href: `/app/crew/runs/${r.id}`,
        })),
      ),
    ];
  }
  if (key === "project") {
    screen.title = project!.title;
    screen.notices = [
      {
        title: "Finish delivery, then close out",
        body: "Complete the review and internal-delivery steps, move the project through Active and Review to Completed, record closeout amounts, then complete the final Closeout task. Project completion does not create revenue or receipts.",
      },
    ];
    screen.tables = [taskTable];
    const workflow = a?.state.workflows.find(
      (f) => f.projectId === project!.id,
    );
    screen.steps = workflow?.taskIds.map((id) => {
      const t = a!.state.tasks.find((t) => t.id === id)!;
      return {
        title: t.title,
        state:
          t.status === "done"
            ? "done"
            : t.status === "blocked"
              ? "pending"
              : "current",
        detail: t.status,
      };
    });
    screen.forms?.push(
      form("project.transition", "Change project stage", [
        field("status", "Project stage", {
          type: "select",
          options: ["planned", "active", "review", "completed"].map(
            (value) => ({ value, label: value }),
          ),
        }),
      ]),
    );
    screen.forms?.push(
      form("delivery.record", "Record internal delivery", [
        field("deliveryDate", "Delivery date", { type: "date" }),
        field("note", "Delivery note", { type: "textarea" }),
      ]),
    );
  }
  if (key === "task") {
    screen.title = task!.title;
    screen.links = [
      ...(screen.links ?? []),
      ...e.runs
        .filter((r) => r.taskId === task!.id)
        .map((r) => ({
          label: `Open run · ${r.status} · v${r.version}`,
          href: `/app/crew/runs/${r.id}`,
        })),
    ];
    screen.tables = [];
    const auto = a?.state.tasks.find((t) => t.id === task!.id);
    screen.cards = [
      {
        id: task!.id,
        title: task!.status,
        body: task!.input,
        details: [
          {
            label: "Original commitment",
            value: date(task!.originalCommittedDueAt) || "Unscheduled",
          },
          {
            label: "Current deadline",
            value: date(task!.dueAt) || "Unscheduled",
          },
        ],
      },
    ];
    if (auto)
      screen.forms = screen.forms?.filter((f) => f.id !== "task.update");
    screen.forms?.push(
      form("task.reschedule", "Change current deadline", [
        field("dueAt", "New deadline", { type: "date", required: false }),
        field("reason", "Reason for changing the deadline", {
          type: "textarea",
        }),
      ]),
    );
  }
  if (key === "run") {
    screen.title = run!.input.title;
    screen.tables = [
      table(
        "Persisted run steps",
        ["Step", "Status", "Attempt"],
        run!.steps.map((s) => ({
          id: s.key,
          cells: [s.kind, s.status, String(s.attempt)],
        })),
      ),
    ];
    const artifact = e.artifacts.find((x) => x.id === run!.artifactId);
    screen.cards =
      artifact?.content.sections.map((s, i) => ({
        id: String(i),
        title: s.heading,
        body: s.body,
        status: artifact.status,
      })) ?? [];
    screen.notices = [
      {
        title: `${run!.status} · Version ${run!.version}`,
        body: `Demo provider. ${run!.input.brief}`,
      },
    ];
    screen.forms?.unshift(form("run.advance", "Run or resume simulation"));
  }
  if (key === "draft" && draft?.content) {
    screen.cards = [
      {
        id: draft.id,
        title: draft.content.name,
        body: draft.content.positioning,
      },
      ...draft.content.packages.map((p) => ({
        id: p.key,
        title: p.title,
        body: p.deliverables.join("; "),
        details: [
          { label: "Illustrative price", value: displayMinor(p.priceMinor) },
        ],
      })),
      ...draft.content.roles.map((r) => ({
        id: r.key,
        title: r.title,
        body: r.responsibility,
      })),
    ];
  }
  if (key === "workflows")
    screen.tables = [
      table(
        "Saved routines",
        ["Routine", "Timezone", "Next due", "State"],
        a?.state.routines.map((r) => ({
          id: r.id,
          cells: [
            r.templateKey,
            r.timezone,
            r.nextDueAt,
            r.enabled ? "Enabled" : "Paused",
          ],
        })) ?? [],
      ),
    ];
  if (key === "notifications")
    screen.tables = [
      table(
        "Notifications",
        ["Event", "Recorded", "Read state"],
        a?.state.notifications.map((n) => ({
          id: n.id,
          cells: [n.message, n.createdAt, n.readAt ? "Read" : "Unread"],
          href: notificationHref(n),
        })) ?? [],
      ),
    ];
  if (key === "growth" && a) {
    screen.metrics = [
      {
        label: "Completed projects",
        value: String(a.metrics.completedProjects),
        detail: a.metrics.note,
      },
      {
        label: "Repeat clients",
        value: String(a.metrics.repeatClients),
        detail: "Economic buying groups",
      },
      {
        label: "Earned revenue",
        value:
          a.metrics.recognizedRevenueMinor === null
            ? null
            : displayMinor(a.metrics.recognizedRevenueMinor),
        detail: "Completed project closeouts",
      },
      {
        label: "Collections",
        value:
          a.metrics.collectionsMinor === null
            ? null
            : displayMinor(a.metrics.collectionsMinor),
        detail: "Recorded receipts",
      },
      {
        label: "Overdue tasks",
        value: String(a.metrics.overdueTasks),
        detail: `${a.metrics.period.from} – ${a.metrics.period.through}`,
      },
    ];
    screen.tables = [
      table(
        "Milestones",
        ["Milestone", "Target", "State"],
        a.state.milestones.map((m) => ({
          id: m.key,
          cells: [
            m.title,
            m.target,
            m.completedAt ? (m.completion ?? "Complete") : "Open",
          ],
        })),
      ),
      table(
        "Recommendations",
        ["Next step", "Reason"],
        a.state.recommendations
          .filter((r) => !r.resolvedAt && !r.dismissedAt)
          .map((r) => ({ id: r.key, cells: [r.title, r.reason] })),
      ),
    ];
    screen.forms?.unshift(
      form("growth.refresh", "Refresh evidence-based growth"),
      form("capacity.save", "Record human capacity", [
        field("availableHours", "Available human hours", {
          type: "number",
          min: 0,
          step: "any",
        }),
        field("plannedHours", "Planned human hours", {
          type: "number",
          min: 0,
          step: "any",
        }),
        field("asOfDate", "Capacity as-of date", { type: "date" }),
        field("sourceReference", "Capacity source reference"),
      ]),
      form(
        "sop.review",
        "Record a reviewed delivery process",
        [
          field("packageId", "Service package", {
            type: "select",
            options: options(w.packages),
          }),
          field("asOfDate", "Review date", { type: "date" }),
          field("sourceReference", "Review note or reference"),
        ],
        {
          confirmation:
            "I reviewed the saved SOP and acceptance checklist for this package.",
        },
      ),
    );
  }
  if (key === "growth") {
    const baselines = w.snapshots.filter(
      (s) => s.kind === "readiness" && s.formulaVersion === "readiness-v1.1",
    );
    screen.forms?.unshift(
      form(
        "milestone.preview",
        "Preview milestone impact",
        [
          field("baselineId", "Saved readiness baseline", {
            type: "select",
            options: baselines.map((s) => ({
              value: s.id,
              label: `${date(s.asOf)} · ${s.formulaVersion} · ${s.id}`,
            })),
            value: baselines[0]?.id,
          }),
          field("milestone", "Milestone", {
            type: "select",
            options: [
              { value: "revenue_fixed_dollars", label: milestoneTitle },
            ],
            value: "revenue_fixed_dollars",
          }),
          ...[1, 2, 3].map((i) =>
            field(
              `revenue${i}`,
              `Target earned revenue: recent month ${i} (USD)`,
              {
                type: "money",
                hint: "In chronological order within the baseline’s last three closed months.",
              },
            ),
          ),
        ],
        {
          description:
            "If achieved and evidenced; hypothetical only. Package and retainer dollars stay fixed. A preview saves a separate proposal and does not complete a milestone or change actual readiness.",
          unavailableReason: baselines.length
            ? undefined
            : "Evidence needed: save a readiness snapshot before previewing a milestone.",
        },
      ),
    );
    const saved = w.snapshots.find(
      (s) =>
        s.kind === "readiness_proposal" &&
        s.formulaVersion === "readiness-v1.1",
    );
    if (saved) {
      const p = saved.output as unknown as MilestonePreview;
      screen.cards?.push({
        id: saved.id,
        title: p.title,
        body: p.label,
        status: "Hypothetical proposal",
        details: [
          { label: "Baseline score", value: p.baseline.score },
          { label: "Hypothetical score", value: p.hypothetical.score },
          {
            label: "Full total delta",
            value: `${new D(p.totalDelta).gte(0) ? "+" : ""}${p.totalDelta}`,
          },
          {
            label: "Proposed target",
            value: p.targets
              .map((t) => `${t.period}: ${displayMinor(t.revenueMinor)}`)
              .join("; "),
          },
          {
            label: "Source snapshot / version",
            value: `${p.sourceSnapshotId} · ${p.sourceVersion}`,
          },
          { label: "Evaluation clock", value: p.evaluatedAt },
          { label: "Assumptions", value: p.assumptions.join(" ") },
        ],
      });
    }
  }
  const readiness = w.snapshots.find(
    (s) => s.kind === "readiness" && s.formulaVersion === "readiness-v1.1",
  );
  if (key === "readiness" && readiness) {
    const output = readiness.output as unknown as ReturnType<
      typeof scoreReadiness
    >;
    screen.metrics = [
      {
        label: "Preparation score",
        value: text(output.score),
        detail: readiness.formulaVersion,
      },
      {
        label: "Evidence coverage",
        value: text(output.coveragePercent),
        detail: "Availability, not verification",
      },
      {
        label: "As of",
        value: date(readiness.asOf),
        detail: "Immutable saved calculation",
      },
    ];
    screen.tables = [
      table(
        "Score components",
        ["Component", "Input", "Points / maximum", "Reason"],
        output.components.map((c) => ({
          id: c.key,
          cells: [
            c.key,
            c.rawValue ?? "Unknown",
            `${c.points} / ${c.maxPoints}`,
            c.reasonCode,
          ],
        })),
      ),
    ];
    screen.notices?.push({
      title: "Risk and evidence limits",
      body:
        [
          output.riskFlags.join("; "),
          ...(output.components.some(
            (c) => c.key === "H_founder" && c.rawValue === null,
          )
            ? [
                "Founder delivery workload and replacement cost not entered; founder dependence is unknown.",
              ]
            : []),
        ]
          .filter(Boolean)
          .join("; ") ||
        "Review the missing evidence before relying on this snapshot.",
    });
  }
  if (key === "readiness" && w.agency) {
    const origin = w.agency.sampleWorkspace ? "sample" : "user_entered";
    const records = teamRecords(w.evidence, origin);
    const humanOptions = records.flatMap((r) =>
      r.record.kind === "human"
        ? [
            {
              value: r.record.data.id,
              label: `${r.record.data.id} · ${r.record.data.role}`,
            },
          ]
        : [],
    );
    const common = [
      field("asOfDate", "Evidence as-of date", { type: "date" }),
      field("sourceReference", "Agreement, log or source reference"),
    ];
    const entry = field("entryId", "Evidence record key", {
      hint: "Use the same key to record a corrected version. Earlier snapshots remain unchanged.",
    });
    screen.forms?.push(
      form(
        "team.human",
        "Record human and compensation agreement",
        [
          entry,
          field("role", "Human role"),
          field("isFounder", "This human is a founder", {
            type: "checkbox",
            required: false,
          }),
          field("compensationMinor", "Agreed compensation (USD per month)", {
            type: "money",
            required: false,
            hint: "Leave blank if unknown. Enter 0 only for known unpaid work.",
          }),
          field("agreementStart", "Agreement start", { type: "date" }),
          field("agreementEnd", "Agreement end", {
            type: "date",
            required: false,
          }),
          ...common,
        ],
        {
          description:
            "Record real humans with documented roles and compensation. Simulated crew never counts as human capacity.",
        },
      ),
      form("team.backup", "Record accepted nonfounder backup", [
        entry,
        field("serviceId", "Material service key"),
        field("humanId", "Backup human", {
          type: "select",
          options: humanOptions,
        }),
        field("acceptedAt", "Backup acceptance date", { type: "date" }),
        ...common,
      ]),
      form("team.hours", "Log human delivery hours", [
        entry,
        field("humanId", "Delivery human", {
          type: "select",
          options: humanOptions,
        }),
        field("deliveryDate", "Delivery work date", { type: "date" }),
        field("hours", "Delivery hours", {
          type: "number",
          min: 0,
          step: "any",
        }),
        ...common,
      ]),
      form("team.capacity", "Record named paid capacity pool", [
        entry,
        field("period", "Capacity month", { type: "month" }),
        field("humanIds", "Paid humans in this pool", {
          type: "multiselect",
          options: humanOptions,
        }),
        field("serviceIds", "Covered material service keys", {
          type: "textarea",
          hint: "One service key per line. Each human belongs in only one pool for this month.",
        }),
        field("availableHours", "Pool available hours", {
          type: "number",
          min: 0,
          step: "any",
        }),
        field("plannedHours", "Pool planned hours", {
          type: "number",
          min: 0,
          step: "any",
        }),
        field("attestedAt", "Pool attestation date", { type: "date" }),
        ...common,
      ]),
      form("team.owner", "Record accountable human owner", [
        entry,
        field("note", "Accountability and responsibilities", {
          type: "textarea",
        }),
        ...common,
      ]),
    );
    screen.notices?.push({
      title: "Team evidence and saved readiness",
      body: "Team records are owner-reported evidence. After saving, calculate a new readiness snapshot for the relevant closed month. Existing snapshots and hypothetical proposals stay unchanged.",
    });
    screen.tables?.push(
      table(
        "Saved team evidence",
        ["Kind", "Record key", "Supplied facts", "As of"],
        records.map((r) => ({
          id: r.sourceId,
          cells: [
            r.record.kind,
            r.entryId,
            r.record.kind === "human"
              ? `${r.record.data.role} · ${r.record.data.isFounder ? "Founder" : "Nonfounder"} · ${r.record.data.compensationMinor === null ? "Compensation unknown" : displayMinor(r.record.data.compensationMinor) + "/month"} · agreement ${date(r.record.data.agreementStart)}–${date(r.record.data.agreementEnd) || "ongoing"}`
              : r.record.kind === "hours"
                ? `${r.record.data.humanId}: ${r.record.data.hours} hours on ${date(r.record.data.date)}`
                : r.record.kind === "backup"
                  ? `${r.record.data.humanId} accepted ${r.record.data.serviceId} on ${date(r.record.data.acceptedAt)}`
                  : r.record.kind === "capacity"
                    ? `${r.record.data.period}: ${r.record.data.plannedHours ?? "Unknown"} planned / ${r.record.data.availableHours ?? "Unknown"} available hours; humans ${r.record.data.humanIds.join(", ")}; services ${r.record.data.serviceIds.join(", ")}`
                    : r.record.data.note,
            date(r.provenance.asOf),
          ],
        })),
      ),
    );
  }
  const forecasts = w.snapshots.filter(
    (s) => s.kind === "forecast" && s.formulaVersion === "agency-finance-v1.1",
  );
  if (key === "financials") {
    screen.tables = [
      table(
        "Historical actuals",
        ["Month", "Revenue", "Receipts", "Cash", "Origin"],
        w.actuals.map((row) => {
          const d = actualSchema.parse(row.data);
          return {
            id: row.id,
            cells: [
              row.yearMonth,
              displayMinor(d.recognizedRevenueMinor),
              displayMinor(d.cashReceiptsMinor),
              displayMinor(d.cashMinor),
              d.provenance.origin,
            ],
          };
        }),
      ),
      table(
        "Saved scenarios",
        ["Scenario", "As of", "Formula", "Origin"],
        forecasts.map((s) => ({
          id: s.id,
          cells: [
            text((s.input as { name?: string }).name ?? "Sample scenario"),
            date(s.asOf),
            s.formulaVersion,
            provenanceSchema.parse(s.provenance).origin,
          ],
        })),
      ),
    ];
    for (const s of forecasts.slice(0, 4)) {
      const output = s.output as unknown as ReturnType<typeof forecast>;
      screen.cards!.push({
        id: s.id,
        title: text((s.input as { name?: string }).name ?? "Saved scenario"),
        body:
          output.status === "incomplete"
            ? output.reasons.join("; ")
            : output.warnings.join("; "),
        details:
          output.status === "complete"
            ? [
                { label: "First deficit", value: output.deficitLabel },
                {
                  label: "Planning capital (USD)",
                  value: money(output.planningCapital),
                },
                {
                  label: "Ending monthly net cash flow (USD)",
                  value: money(output.horizonMeanNetCashFlow),
                },
                {
                  label: "Ending net burn (USD)",
                  value: money(output.horizonNetBurn),
                },
                {
                  label: "Minimum cash at horizon",
                  value: output.minimumAtHorizon
                    ? "Yes — need may continue beyond the horizon"
                    : "No",
                },
              ]
            : [],
      });
      if (output.status === "complete")
        screen.tables.push(
          table(
            `Monthly projection · ${text((s.input as { name?: string }).name ?? "Saved scenario")}`,
            [
              "Month",
              "Revenue USD",
              "Receipts USD",
              "Closing cash USD",
              "Recorded / founder-loaded margin",
            ],
            output.rows.map((r) => ({
              id: r.period,
              cells: [
                r.period,
                money(r.revenue),
                money(r.receipts),
                money(r.cashClose),
                `${r.grossMargin === null ? "Unknown" : D(r.grossMargin).times(100).toFixed(2) + "%"} / ${r.founderLoadedDeliveryMargin === null ? "Unknown" : D(r.founderLoadedDeliveryMargin).times(100).toFixed(2) + "%"}`,
              ],
            })),
          ),
        );
    }
  }
  if (key === "pitch") {
    screen.cards =
      pitch?.content?.sections.map((s) => ({
        id: s.key,
        title: s.heading,
        body: s.body,
      })) ?? [];
    screen.tables = [
      table(
        "Claim references",
        ["Claim", "Value", "Origin", "As of", "Source version"],
        (pitch?.input.facts ?? []).map((f) => ({
          id: f.id,
          cells: [
            f.label,
            f.displayValue ?? "[Evidence needed]",
            f.origin,
            f.asOf,
            `${f.sourceRef} v${f.sourceVersion ?? 1}`,
          ],
        })),
      ),
    ];
  }
  if (key === "dataRoom") {
    screen.tables = [
      table(
        "Preparation checklist",
        ["Category", "State", "Note"],
        w.checklist.map((c) => ({
          id: c.id,
          cells: [c.title, c.state, c.note],
        })),
      ),
      table(
        "Saved private exports",
        ["Snapshot", "Created"],
        w.exports.map((x) => ({
          id: x.id,
          cells: [x.id, date(x.createdAt)],
          href: `/app/exports/${x.id}?format=markdown`,
          linkLabel: "Download Markdown",
        })),
      ),
    ];
    screen.links = [
      ...(screen.links ?? []),
      ...w.exports.slice(0, 5).map((x) => ({
        label: `Download CSV · ${date(x.createdAt)}`,
        href: `/app/exports/${x.id}?format=csv`,
      })),
    ];
  }
  if (key === "equity") {
    screen.tables = [];
    for (const row of w.snapshots.filter((s) => s.kind === "equity")) {
      const v = row.output as unknown as ReturnType<typeof calculateEquity>;
      screen.cards!.push({
        id: row.id,
        title: "Hypothetical ownership",
        body: v.supported ? v.assumptions.join(" ") : v.reason,
      });
      if (v.supported)
        screen.tables.push(
          table(
            `Ownership · ${date(row.createdAt)}`,
            ["Holder", "Shares", "Percent"],
            v.ownership.map((h) => ({
              id: h.id,
              cells: [
                h.id,
                D(h.shares).toFixed(4),
                D(h.percent).toFixed(4) + "%",
              ],
            })),
          ),
        );
    }
  }
  if (key === "settings")
    screen.forms = screen.forms?.filter((f) => f.id !== "settings.update");
  screen.forms = screen.forms?.map((f) => {
    if (f.id === "actual.save")
      f.recordVersions = Object.fromEntries(
        w.actuals.map((x) => [x.yearMonth, x.version]),
      );
    if (f.id === "checklist.save")
      f.recordVersions = Object.fromEntries(
        w.checklist.map((x) => [x.category, x.version]),
      );
    f.screenKey = key;
    f.projectId = projectId;
    f.recordId = recordId;
    let values: Record<string, unknown> = {};
    if (key === "onboarding") {
      values = (w.onboarding?.data ?? {}) as Record<string, unknown>;
      f.version = w.onboarding?.version;
    }
    if (f.id === "agency.update" && w.agency) {
      values = w.agency;
      f.recordId = w.agency.id;
      f.version = w.agency.version;
    }
    if (key === "draft" && draft) {
      values = draft.content ?? {};
      f.recordId = draft.id;
      f.version = draft.version;
    }
    if (key === "package" && packageRow) {
      values = {
        ...packageRow,
        ...(packageRow.pricingBasis as object),
        deliverables: list(packageRow.deliverables).join("\n"),
        exclusions: list(packageRow.exclusions).join("\n"),
      };
      f.version = packageRow.version;
    }
    if (key === "client" && client) {
      values = client;
      f.version = client.version;
    }
    if (key === "project" && project) {
      values = project;
      f.version = project.version;
      if (f.id === "closeout.save") {
        values = project.closeout ?? {};
        f.version = project.closeout?.version;
      }
    }
    if (key === "task" && task) {
      values = {
        ...task,
        predecessorIds: task.predecessors.map((p) => p.predecessorId),
      };
      f.version = task.version;
    }
    if (key === "run" && run) f.version = run.version;
    if (f.id === "pitch.update" && pitch) {
      f.recordId = pitch.id;
      f.version = pitch.version;
      f.fields = pitch.content!.sections.map((s) =>
        field(s.key, s.heading, {
          type: "textarea",
          maxLength: 16000,
          value: s.body,
        }),
      );
    }
    f.fields = f.fields.map((x) => {
      const v = values[x.name];
      if (v !== undefined && v !== null)
        x.value =
          x.type === "money"
            ? moneyInput(v)
            : x.type === "date"
              ? date(v as Date)
              : (v as Field["value"]);
      if (x.name === "clientId")
        x.options = options(w.clients.filter((c) => !c.archivedAt));
      if (x.name === "packageId")
        x.options = options(w.packages.filter((p) => !p.archivedAt));
      if (x.name === "assignedRoleKey")
        x.options = roles.map((r) => ({ value: r.key, label: r.title }));
      if (x.name === "predecessorIds")
        x.options = options(
          w.tasks.filter(
            (t) =>
              t.id !== recordId &&
              t.projectId === (task?.projectId ?? project?.id ?? null),
          ),
        );
      if (x.name === "routineId")
        x.options = options(
          a?.state.routines.map((r) => ({ id: r.id, title: r.templateKey })) ??
            [],
        );
      if (x.name === "recommendationId")
        x.options = options(
          a?.state.recommendations
            .filter((r) => !r.resolvedAt && !r.dismissedAt)
            .map((r) => ({ id: r.key, title: r.title })) ?? [],
        );
      if (f.id === "workflow.instantiate")
        x.options = [
          { value: "creative_delivery", label: "Creative delivery" },
          { value: "content_delivery", label: "Content delivery" },
        ];
      if (f.id === "routine.enable" && x.name === "templateKey")
        x.options = [
          { value: "weekly_planning", label: "Weekly planning" },
          { value: "monthly_evidence", label: "Monthly evidence review" },
        ];
      return x;
    });
    if (["project.create", "project.update"].includes(f.id))
      f.fields = f.fields.filter((x) => x.name !== "status");
    if (
      f.id.endsWith(".archive") &&
      (packageRow?.archivedAt || client?.archivedAt || project?.archivedAt)
    ) {
      f.title = f.title.replace("Archive", "Restore");
      f.submit = f.submit.replace("Archive", "Restore");
      f.confirmation =
        "Restore this saved record for new work while preserving its history.";
    }
    if (f.id === "package.create" || f.id === "package.update") {
      f.fields = f.fields.map((x) =>
        ["laborRateMinor", "directCostMinor"].includes(x.name)
          ? { ...x, required: true }
          : x,
      );
      f.fields.push(
        field("sopVersion", "Delivery SOP version", {
          required: false,
          value: packageRow?.sopVersion ?? "",
        }),
        field("sopCreatedAt", "SOP creation date", {
          type: "date",
          required: false,
          value: date(packageRow?.sopCreatedAt),
        }),
        field("acceptanceChecklist", "Acceptance checks, one per line", {
          type: "textarea",
          required: false,
          value: packageRow
            ? list(packageRow.acceptanceChecklist).join("\n")
            : "",
        }),
      );
    }
    if (f.id === "run.queue" && task) {
      const workflowTask = a?.state.tasks.find((t) => t.id === task.id);
      if (!["queued", "in_progress"].includes(task.status))
        f.unavailableReason =
          "Complete this task's prerequisites, or retry its failed run, before starting a simulation.";
      if (workflowTask && workflowTask.kind !== "work")
        f.unavailableReason =
          "This is an owner gate. Review the preceding artifact or record delivery/closeout, then update the task state.";
    }
    if (key === "run" && run) {
      const allowed: Record<string, string[]> = {
        "run.advance": ["queued", "running"],
        "run.approve": ["awaiting_review"],
        "run.revise": ["awaiting_review"],
        "run.retry": ["failed"],
        "run.cancel": ["queued", "running", "awaiting_review", "failed"],
      };
      if (allowed[f.id] && !allowed[f.id].includes(run.status))
        f.unavailableReason = `This action is unavailable while the run is ${run.status.replaceAll("_", " ")}.`;
    }
    if (f.id.startsWith("team."))
      f.recordVersions = Object.fromEntries(
        teamRecords(
          w.evidence,
          w.agency?.sampleWorkspace ? "sample" : "user_entered",
        ).map((r) => [`${r.record.kind}:${r.entryId}`, r.version]),
      );
    if (f.id === "agency.generate" && !w.onboarding)
      f.unavailableReason = "Save your creative practice and goals first.";
    if (["agency.accept", "agency.draft.edit"].includes(f.id) && !draft)
      f.unavailableReason = "Generate an agency draft first.";
    if (f.id === "agency.accept" && w.agency)
      f.unavailableReason =
        "Your agency is already active. Edit its profile and packages in Agency.";
    if (f.id === "pitch.update" && !pitch)
      f.unavailableReason = "Generate a pitch draft first.";
    if (f.id === "pitch.generate")
      f.fields = [
        field("sourceIds", "Saved calculation facts", {
          type: "multiselect",
          required: false,
          options: pitchFacts(data).map((x) => ({
            value: x.id,
            label: `${x.label}: ${x.displayValue ?? "Unknown"} · ${x.origin} · ${x.asOf} · v${x.sourceVersion ?? 1}`,
          })),
        }),
      ];
    if (f.id === "export.create") {
      f.confirmation =
        "I reviewed the selected saved versions, provenance, risk notices and pitch. Create a private preparation snapshot.";
      f.fields = [
        field("snapshotIds", "Readiness snapshots", {
          type: "multiselect",
          required: false,
          options: options(
            w.snapshots
              .filter((s) => s.kind === "readiness")
              .map((s) => ({
                id: s.id,
                title: `${date(s.asOf)} · ${s.formulaVersion}`,
              })),
          ),
        }),
        field("forecastId", "One forecast for the CSV", {
          type: "select",
          required: false,
          options: options(
            forecasts.map((s) => ({
              id: s.id,
              title: text((s.input as { name?: string }).name ?? s.id),
            })),
          ),
        }),
        field("evidenceIds", "Evidence references", {
          type: "multiselect",
          required: false,
          options: options(
            w.evidence.map((x) => ({ id: x.id, title: x.metricKey })),
          ),
        }),
        field("pitchId", "Pitch version", {
          type: "select",
          required: false,
          options: options(
            e.pitches
              .filter((p) => p.content)
              .map((p) => ({
                id: p.id,
                title: `${p.content!.title} · v${p.version}`,
              })),
          ),
        }),
      ];
    }
    if (f.id === "scenario.create") {
      f.description =
        "Choose a saved scenario to change its demand, collection, founder and hire assumptions, or leave the source blank and enter complete opening balances and one service below. All outputs are hypothetical.";
      f.fields.unshift(
        field("baseScenarioId", "Start from saved assumptions", {
          type: "select",
          required: false,
          options: options(
            forecasts.map((s) => ({
              id: s.id,
              title: text((s.input as { name?: string }).name ?? s.id),
            })),
          ),
        }),
      );
      f.fields.push(
        field("asOfDate", "Opening closed month end", {
          type: "date",
          required: false,
        }),
        field("serviceTitle", "Service name for a new model", {
          required: false,
        }),
      );
      for (const [name, label] of [
        ["demandUnits", "Monthly demand units"],
        ["hoursPerUnit", "Human hours per unit"],
        ["availableHours", "Monthly human hours available"],
        ["hireAdditionalHours", "Hours added by planned hire"],
        ["overheadGrowth", "Monthly overhead inflation fraction"],
        ["taxRate", "Tax buffer fraction"],
      ])
        f.fields.push(
          field(name, label, {
            type: "number",
            step: "any",
            min: 0,
            required: false,
          }),
        );
      for (const [name, label] of [
        ["unitPriceMinor", "Unit price"],
        ["unitDirectCostMinor", "Unit direct cost"],
        ["openingCashMinor", "Opening cash"],
        ["openingReceivablesMinor", "Opening receivables"],
        ["openingPayablesMinor", "Opening payables"],
        ["openingDeferredRevenueMinor", "Opening deferred revenue"],
        ["openingDebtMinor", "Opening debt"],
        ["overheadMinor", "Monthly overhead including founder pay"],
        ["founderPayMinor", "Founder compensation included in overhead"],
        ["hireMonthlyCostMinor", "Monthly cost of planned hire"],
        ["capexMinor", "Month-one capital expenditure"],
      ])
        f.fields.push(
          field(name, `${label} (USD)`, { type: "money", required: false }),
        );
    }
    if (f.id === "evidence.save" && w.agency?.sampleWorkspace) {
      f.fields = f.fields.map((x) =>
        x.name === "origin"
          ? {
              ...x,
              options: [
                { value: "sample", label: "Sample" },
                { value: "assumption", label: "Assumption" },
              ],
              value: "sample",
            }
          : x,
      );
    }
    if (f.id === "evidence.save")
      f.fields.push(
        field("reviewedAt", "External review date", {
          type: "date",
          required: false,
        }),
        field("reviewReference", "External review reference", {
          required: false,
        }),
      );
    if (f.id === "checklist.save")
      f.fields = f.fields.map((x) =>
        x.name === "reference"
          ? field("reference", "Evidence reference", {
              type: "select",
              required: false,
              options: options(
                w.evidence.map((e) => ({ id: e.id, title: e.metricKey })),
              ),
            })
          : x,
      );
    if (!w.agency && !["onboarding", "draft"].includes(key))
      f.unavailableReason = "Accept your agency draft first.";
    return f;
  });
  return {
    mode: w.agency ? "connected" : "empty",
    agencyName: w.agency?.name ?? null,
    screen,
    ...(w.agency?.sampleWorkspace
      ? {
          source: {
            origin: "sample" as const,
            asOf: "2026-10-31",
            review: "Not independently verified",
            version: "Local synthetic workspace",
          },
        }
      : {}),
  };
}
