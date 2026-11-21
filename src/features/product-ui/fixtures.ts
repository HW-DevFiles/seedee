/** Explicit presentation fixtures. Never write these into a user's actuals or use them as calculation results. */
import type { ScreenView, ViewCard } from "./contracts";
import { screens } from "./catalog";

const roles = [
  [
    "creative-lead",
    "Creative Lead",
    "Shape the creative direction and acceptance criteria.",
    "Practice, client brief, intended outcome",
    "Creative direction and review checklist",
  ],
  [
    "research-strategy",
    "Research / Strategy",
    "Organize questions, sources and buyer assumptions.",
    "Buyer, problem statement, source notes",
    "Research plan with evidence gaps",
  ],
  [
    "producer",
    "Producer / Project Manager",
    "Plan scope, dependencies and human review.",
    "Package scope, schedule, human capacity",
    "Delivery plan and risk checklist",
  ],
  [
    "delivery",
    "Delivery Specialist",
    "Draft a discipline-specific internal work plan.",
    "Approved brief and acceptance checks",
    "Draft text, checklist or production plan",
  ],
  [
    "quality",
    "Quality Reviewer",
    "Check the draft against the brief.",
    "Draft artifact and acceptance criteria",
    "Quality checklist for owner review",
  ],
  [
    "growth",
    "Growth / Business Analyst",
    "Explain rules and evidence gaps.",
    "Saved delivery records and computed metrics",
    "Rule-based next-step explanation",
  ],
  [
    "finance",
    "Finance / Evidence Analyst",
    "Organize the provenance of computed facts.",
    "Versioned finance results and source references",
    "Evidence-linked preparation outline",
  ],
];
const roleCards: ViewCard[] = roles.map(([id, title, body, input, output]) => ({
  id,
  title,
  body,
  status: "Simulated role",
  details: [
    { label: "Input", value: input },
    { label: "Output", value: output },
    {
      label: "Approval boundary",
      value: "Owner review required; no external actions",
    },
  ],
}));
const packages: ViewCard[] = [
  {
    id: "sample-brand",
    title: "Brand system",
    body: "A focused visual identity, style guide and internal handoff checklist.",
    status: "Illustrative assumption",
    details: [
      { label: "Price", value: "$6,000.00 USD" },
      { label: "Labor / turnaround", value: "60 hours / 14 days" },
      {
        label: "Scope boundary",
        value: "Two revision rounds; no trademark or legal clearance",
      },
    ],
    link: {
      label: "Inspect package",
      href: "/app/agency/packages/sample-brand",
    },
  },
  {
    id: "sample-website",
    title: "Launch website",
    body: "A scoped website plan, page structure and reviewable content handoff.",
    status: "Illustrative assumption",
    details: [
      { label: "Price", value: "$9,000.00 USD" },
      { label: "Labor / turnaround", value: "90 hours / 21 days" },
      {
        label: "Scope boundary",
        value: "Two revision rounds; hosting and domains excluded",
      },
    ],
    link: {
      label: "Inspect package",
      href: "/app/agency/packages/sample-website",
    },
  },
  {
    id: "sample-retainer",
    title: "Care retainer",
    body: "A bounded monthly support package with an explicit review and delivery cadence.",
    status: "Illustrative assumption",
    details: [
      { label: "Price", value: "$3,000.00 USD / service month" },
      { label: "Labor", value: "30 hours per service unit" },
      {
        label: "Scope boundary",
        value:
          "An actual contract is required before classifying earned revenue as contracted recurrence",
      },
    ],
    link: {
      label: "Inspect package",
      href: "/app/agency/packages/sample-retainer",
    },
  },
];
export function sampleScreen(key: string): ScreenView {
  const screen = structuredClone(screens[key]);
  screen.forms = screen.forms?.map((form) => ({
    ...form,
    unavailableReason:
      "This sample is read-only. Save, review, run and export actions are unavailable here. No workspace record will change.",
  }));
  const row = (id: string, cells: string[], href?: string) => ({
    id,
    cells,
    href,
  });
  if (key === "overview") {
    screen.title = "Good things take a little tending.";
    screen.description =
      "Moss Studio · A fictional creative company. This sample shows how active work, human review and evidence fit together.";
    screen.metrics = [
      {
        label: "Active projects",
        value: "1",
        detail: "Fictional record",
        href: "/app/projects",
      },
      {
        label: "Awaiting your review",
        value: "1",
        detail: "A draft needs a human decision",
        href: "/app/crew/runs/sample-run",
      },
      {
        label: "Completed milestones",
        value: "2 / 6",
        detail: "Illustrative milestone state",
        href: "/app/growth",
      },
      {
        label: "Earned revenue",
        value: null,
        detail: "Historical actuals are unavailable in this sample",
        href: "/app/investor-readiness/financials",
      },
    ];
    screen.cards = [
      {
        id: "next",
        title: "A draft is ready for your eye.",
        body: "Review the launch website plan before anything moves into delivery. The sample output is an internal checklist, not a built website.",
        status: "Awaiting review",
        link: {
          label: "Review the sample artifact",
          href: "/app/crew/runs/sample-run",
        },
      },
      {
        id: "milestone",
        title: "Make your process repeatable.",
        body: "A reviewed delivery process is a useful next step. It becomes business evidence only when supported by saved versions and real delivery records.",
        link: { label: "See growth milestones", href: "/app/growth" },
      },
    ];
  }
  if (key === "agency" || key === "draft") screen.cards = packages;
  if (key === "draft") {
    screen.cards = [
      {
        id: "identity",
        title: "Moss Studio",
        body: "Thoughtful brand and web systems for independent creative businesses.",
        status: "Draft · Not accepted",
        details: [
          {
            label: "Buyer",
            value: "Independent makers and small creative businesses",
          },
          {
            label: "Provenance",
            value: "Explicit sample fixture; no market validation",
          },
        ],
      },
      ...packages,
      ...roleCards,
    ];
    screen.notices?.push({
      title: "Two proposed workflows",
      body: "Brief → Plan → Draft → Human review → Delivery recorded → Closeout; and Weekly planning → Evidence review → Owner decision. Templates are versioned and do not start until instantiated.",
    });
  }
  if (key === "crew") {
    screen.cards = roleCards;
    screen.tables![0].rows = [
      row(
        "sample-task",
        ["Launch plan", "Producer", "2026-11-25 UTC", "awaiting_review"],
        "/app/crew/tasks/sample-task",
      ),
    ];
    screen.tables![1].rows = [
      row(
        "sample-run",
        [
          "Launch website plan",
          "demo",
          "template v1 / revision 1",
          "awaiting_review",
        ],
        "/app/crew/runs/sample-run",
      ),
    ];
  }
  if (key === "projects")
    screen.tables![0].rows = [
      row(
        "sample-project",
        [
          "Fern launch website",
          "Fern Collective (fictional)",
          "2026-11-30",
          "$9,000.00 USD",
          "review",
        ],
        "/app/projects/sample-project",
      ),
    ];
  if (key === "project") {
    screen.title = "Fern launch website";
    screen.cards = [
      {
        id: "brief",
        title: "A considered first impression.",
        body: "Plan a simple launch website for a fictional independent design collective. Draft a page structure and handoff checklist for the owner to review.",
        details: [
          { label: "Client", value: "Fern Collective · Sample" },
          { label: "Budget", value: "$9,000.00 USD · Proposed" },
          { label: "Delivery", value: "Not yet recorded" },
        ],
      },
    ];
    screen.steps = screen.steps?.map((step, i) => ({
      ...step,
      state: i < 3 ? "done" : i === 3 ? "current" : "pending",
    }));
    screen.tables![0].rows = [
      row(
        "sample-task",
        ["Review launch plan", "Owner", "2026-11-25", "awaiting_review"],
        "/app/projects/sample-project/tasks/sample-task",
      ),
    ];
  }
  if (key === "clients")
    screen.tables![0].rows = [
      row(
        "sample-client",
        ["Fern Collective", "Fictional design studio", "1", "active"],
        "/app/projects/clients/sample-client",
      ),
    ];
  if (key === "client") {
    screen.title = "Fern Collective";
    screen.tables![0].rows = [
      row(
        "sample-project",
        ["Fern launch website", "2026-11-30", "$9,000.00 USD", "review"],
        "/app/projects/sample-project",
      ),
    ];
  }
  if (key === "run") {
    screen.title = "Review the launch website plan";
    screen.cards = [
      {
        id: "input",
        title: "What went into this run",
        body: "A fictional launch brief for Fern Collective, three proposed pages and a bounded handoff checklist.",
        details: [
          { label: "Provider", value: "demo · deterministic template v1" },
          { label: "Status", value: "awaiting_review" },
          {
            label: "Artifact",
            value: "sample-artifact · revision 1 · unapproved",
          },
        ],
      },
      {
        id: "artifact",
        title: "Draft artifact · Launch plan",
        body: "1. Confirm the buyer and single primary page outcome. 2. Outline Home, Work and Contact content. 3. Check rights and permission for every portfolio item. 4. Review the copy and accessibility checklist. 5. Record owner acceptance before internal delivery.",
        status: "Human review required",
      },
    ];
    screen.tables![0].rows = [
      row("1", [
        "Normalize brief",
        "completed",
        "Validated sample input",
        "v1",
      ]),
      row("2", ["Draft plan", "completed", "Internal checklist", "v1"]),
      row("3", [
        "Owner review",
        "awaiting_review",
        "No approval recorded",
        "v1",
      ]),
    ];
  }
  if (key === "task") {
    screen.title = "Review launch plan";
    screen.cards = [
      {
        id: "task",
        title: "Your review is the gate.",
        body: "Inspect the linked artifact and decide whether it meets the accepted brief. A simulated quality role does not replace your approval.",
        status: "awaiting_review",
        details: [
          { label: "Assignment", value: "Accountable human owner" },
          { label: "Prerequisite", value: "Sample draft task · done" },
          { label: "Original due date", value: "2026-11-25 UTC" },
          { label: "Task version", value: "1" },
        ],
        link: {
          label: "Open artifact review",
          href: "/app/crew/runs/sample-run",
        },
      },
    ];
  }
  if (key === "workflows")
    screen.tables![0].rows = [
      row("weekly", [
        "Weekly planning",
        "Weekly",
        "America/New_York",
        "2026-11-23T14:00Z",
        "enabled",
      ]),
      row("monthly", [
        "Monthly evidence review",
        "Monthly",
        "America/New_York",
        "2026-12-01T14:00Z",
        "paused",
      ]),
    ];
  if (key === "notifications")
    screen.tables![0].rows = [
      row(
        "review",
        ["Launch plan is awaiting owner review", "2026-11-20T15:00Z", "unread"],
        "/app/crew/runs/sample-run",
      ),
    ];
  if (key === "growth") {
    screen.cards = [
      {
        id: "first-offer",
        title: "A focused first offer",
        body: "At least one saved, scoped offer with an explicit price basis.",
        status: "Sample · Complete",
      },
      {
        id: "review-process",
        title: "A delivery process you have reviewed",
        body: "A versioned workflow with human acceptance criteria.",
        status: "Sample · Complete",
      },
      {
        id: "backup",
        title: "An accepted human backup",
        body: "A named nonfounder accepts handoff for every material service. An AI persona cannot satisfy this rule.",
        status: "Evidence needed",
      },
      {
        id: "rights",
        title: "Permissioned outcome cases",
        body: "Two completed-client cases need quantified outcomes, source references and permission to share.",
        status: "Evidence needed",
      },
    ];
  }
  if (["readiness", "financials", "equity", "pitch", "dataRoom"].includes(key))
    screen.notices = [
      ...(screen.notices ?? []),
      {
        title: "Reference inputs, not calculated outputs",
        body: "This sample shows how evidence and assumptions are organized. Calculated scores, cash projections and ownership results are unavailable in this preview. Sample evidence is never copied into your actuals.",
      },
    ];
  if (key === "readiness")
    screen.cards = [
      {
        id: "D",
        title: "Repeatable delivery",
        body: "Inspect package/SOP versions, earned retainer recognition and original due-date acceptance records.",
        status: "Needs connected calculation",
      },
      {
        id: "risk",
        title: "Keep business risks in view",
        body: "Founder dependence, missing IP rights, concentrated clients, unserved demand and cash deficits stay visible even when preparation points rise.",
        status: "Independent risk context",
      },
    ];
  if (key === "pitch")
    screen.cards = [
      {
        id: "outline",
        title: "Moss Studio · Private draft outline",
        body: "Agency thesis → Buyer problem → Offer → Delivery system → Traction → Recurrence and concentration → Unit economics → Market → IP → Human team → Milestones/scenarios → Optional capital planning.",
        status: "[Evidence needed]",
      },
    ];
  if (key === "dataRoom")
    screen.tables![0].rows = [
      "Company",
      "Ownership",
      "Financials",
      "Customers",
      "Product / operations",
      "IP / brand",
      "Market",
      "Risk / security",
      "Fundraising preparation",
    ].map((title, index) =>
      row(`folder-${index}`, [
        title,
        "draft",
        "Sample owner",
        "2026-10",
        "Not reviewed",
        "[Evidence needed]",
      ]),
    );
  return screen;
}
