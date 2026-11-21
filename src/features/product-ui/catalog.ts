import type { Field, FormSpec, ScreenView } from "./contracts";

const options = (values: string[]) =>
  values.map((value) => ({ value, label: value.replaceAll("_", " ") }));
const text = (
  name: string,
  label: string,
  extra: Partial<Field> = {},
): Field => ({ name, label, required: true, ...extra });
const number = (
  name: string,
  label: string,
  extra: Partial<Field> = {},
): Field =>
  text(name, label, {
    type: "number",
    min: 0,
    max: 1_000_000_000,
    step: 1,
    ...extra,
  });
const note = (name: string, label: string, extra: Partial<Field> = {}): Field =>
  text(name, label, { type: "textarea", ...extra });
const select = (
  name: string,
  label: string,
  values: string[],
  extra: Partial<Field> = {},
): Field =>
  text(name, label, { type: "select", options: options(values), ...extra });
const money = (
  name: string,
  label: string,
  extra: Partial<Field> = {},
): Field =>
  number(name, `${label} (USD cents)`, {
    hint: "Enter whole cents: 12500 means $125.00. Leave an unknown amount blank.",
    required: false,
    ...extra,
  });
const form = (
  id: string,
  title: string,
  submit: string,
  fields: Field[],
  extra: Partial<FormSpec> = {},
): FormSpec => ({ id, title, submit, fields, ...extra });
const table = (title: string, columns: string[], empty: string) => ({
  title,
  columns,
  rows: [],
  empty,
});
const financeLinks = [
  { label: "Financial model", href: "/app/investor-readiness/financials" },
  { label: "Equity education", href: "/app/investor-readiness/equity" },
  { label: "Pitch builder", href: "/app/investor-readiness/pitch" },
  { label: "Data room & export", href: "/app/investor-readiness/data-room" },
];
export const practices = [
  "musician",
  "visual_artist",
  "designer",
  "filmmaker",
  "writer",
  "photographer",
  "content_creator",
  "other",
];
export const onboardingFields: Field[] = [
  {
    name: "practices",
    label: "Your creative practice",
    type: "multiselect",
    required: true,
    options: options(practices),
  },
  text("proposedName", "Working agency name", {
    required: false,
    maxLength: 80,
  }),
  note("description", "Tell us about your work", {
    maxLength: 2000,
    hint: "Describe your practice in your own words. You can change this later.",
  }),
  text("targetBuyer", "Who do you want to serve?", { maxLength: 240 }),
  note("goal", "What would you like your company to make possible?", {
    maxLength: 2000,
  }),
  number("weeklyCapacityHours", "Weekly human capacity (hours)", {
    min: 1,
    max: 168,
    step: 0.5,
    hint: "Your real available time. Simulated crew roles do not add human capacity.",
  }),
  text("timezone", "Workspace timezone", {
    value: "America/New_York",
    hint: "Use a named timezone, such as America/New_York.",
  }),
  select("currency", "Functional currency", ["USD"], { value: "USD" }),
  select(
    "fundingInterest",
    "Your growth path",
    ["customer_funded", "exploring_options", "seed_preparation"],
    { value: "exploring_options" },
  ),
  note("existingOffers", "Existing offers or skills", { required: false }),
];
const packageFields: Field[] = [
  text("title", "Package name", { maxLength: 120 }),
  note("deliverables", "Deliverables (one per line)"),
  note("exclusions", "What is outside the scope?"),
  number("revisionLimit", "Included revision rounds", { max: 100 }),
  number("turnaroundDays", "Turnaround (days)", { min: 1, max: 365 }),
  number("laborHours", "Estimated human labor (hours)", {
    step: 0.5,
    max: 10000,
  }),
  money("priceMinor", "Service price", { required: true }),
  money("laborRateMinor", "Illustrative hourly labor rate"),
  money("directCostMinor", "Direct delivery cost"),
  number("targetMarginBps", "Target margin (basis points)", {
    max: 9999,
    hint: "5000 means 50%. Must be below 10000; this assumption is not a market benchmark.",
  }),
  {
    name: "explicitlyFree",
    label: "This is explicitly free or sample work",
    type: "checkbox",
  },
];
const clientFields: Field[] = [
  text("name", "Client name", { maxLength: 120 }),
  text("organization", "Organization", { required: false, maxLength: 160 }),
  text("economicClientGroupId", "Economic client group", {
    hint: "Use the same group for clients under common buying control.",
  }),
  text("email", "Contact email", { required: false, type: "email" }),
  note("notes", "Contact notes", {
    required: false,
    hint: "Internal notes only. Seedee does not contact this client.",
  }),
];
const projectFields: Field[] = [
  text("title", "Project title", { maxLength: 160 }),
  select("clientId", "Client", [], {
    required: false,
    hint: "Choose an active client or leave blank.",
  }),
  select("packageId", "Service package", [], {
    required: false,
    hint: "Leave blank to start a project without a package.",
  }),
  note("brief", "Project brief"),
  text("dueAt", "Due date", { type: "date", required: false }),
  money("budgetMinor", "Budget"),
  select("status", "Project status", ["planned", "active", "review"], {
    value: "planned",
  }),
];
const taskFields: Field[] = [
  text("title", "Task title"),
  note("input", "Task brief"),
  select("assignedRoleId", "Assignment", [], {
    required: false,
    hint: "Leave blank to assign to yourself.",
  }),
  text("dueAt", "Committed due date", { type: "date", required: false }),
  select("priority", "Priority", ["low", "normal", "high"], {
    value: "normal",
  }),
  {
    name: "dependencyIds",
    label: "Must happen first",
    type: "multiselect",
    options: [],
    hint: "Dependencies must be in this agency and cannot form a cycle.",
  },
];
const actualFields: Field[] = [
  text("yearMonth", "Closed UTC month", { type: "month" }),
  select("sourceMode", "Actuals source", ["manual", "derived"], {
    value: "manual",
    hint: "Manual totals and project-derived totals are alternatives; they are never added together.",
  }),
  money("recognizedRevenueMinor", "Earned service revenue"),
  money("cashReceiptsMinor", "Customer cash receipts"),
  money("deliveryCostsMinor", "Delivery cash costs"),
  money("overheadMinor", "Overhead cash costs"),
  money("founderPayMinor", "Founder compensation"),
  money("cashTaxPaymentsMinor", "Cash tax payments"),
  money("cashInterestPaymentsMinor", "Cash interest payments"),
  money("cashMinor", "Closing unrestricted cash"),
  money("receivablesMinor", "Closing receivables"),
  text("sourceReference", "Source reference", { required: false }),
  text("asOfDate", "As-of date", { type: "date" }),
];
const scenarioFields: Field[] = [
  text("name", "Scenario name"),
  select("horizonMonths", "Model horizon", ["12", "24"], { value: "24" }),
  number("volumeMultiplier", "Demand volume multiplier", {
    step: 0.01,
    max: 10,
    value: 1,
  }),
  number("monthlyGrowthRate", "Monthly demand growth (fraction)", {
    min: -1,
    max: 1,
    step: 0.001,
    value: 0.015,
    hint: "0.015 means 1.5%. This is an assumption.",
  }),
  number("currentCollectionFraction", "Same-month collection fraction", {
    max: 1,
    step: 0.01,
    value: 0.8,
  }),
  number("founderDeliveryPayFraction", "Founder pay allocated to delivery", {
    max: 1,
    step: 0.01,
    hint: "Separate from the founder's share of team delivery hours.",
  }),
  money("founderReplacementHourlyRateMinor", "Founder replacement hourly rate"),
  number("founderReplacementHours", "Founder replacement hours", {
    required: false,
    step: 0.5,
  }),
  money(
    "retainedFounderNonDeliveryPayMinor",
    "Retained founder nondelivery pay",
  ),
  number("hireMonth", "Planned capacity hire month", {
    required: false,
    min: 1,
    max: 24,
    hint: "Leave blank to model no hire. Hiring does not automatically reduce per-unit delivery costs.",
  }),
  money("reserveTargetMinor", "Modeled reserve"),
  number("contingencyRate", "Contingency fraction", {
    max: 1,
    step: 0.01,
    required: false,
  }),
  money("fixedFinancingCostsMinor", "Fixed planning costs"),
];

export const screens: Record<string, ScreenView> = {
  overview: {
    eyebrow: "Your creative company",
    title: "A little structure. More possibility.",
    description:
      "Keep the next piece of work moving, make room for your craft, and build a record of what your company can do.",
    links: [
      { label: "Create a project", href: "/app/projects" },
      { label: "Review crew work", href: "/app/crew" },
    ],
    metrics: [
      {
        label: "Active projects",
        value: "0",
        detail: "Saved work in progress",
        href: "/app/projects?status=active",
      },
      {
        label: "Awaiting your review",
        value: "0",
        detail: "Human judgment comes next",
        href: "/app/crew?status=awaiting_review",
      },
      {
        label: "Completed milestones",
        value: "0",
        detail: "Evidence behind your progress",
        href: "/app/growth",
      },
      {
        label: "Recorded revenue",
        value: null,
        detail: "Recognized revenue remains unknown until entered",
        href: "/app/investor-readiness/financials",
      },
    ],
    cards: [
      {
        id: "next",
        title: "Your agency starts with you",
        body: "Describe your practice, review a draft, and choose what becomes your agency. Your account starts without business evidence.",
        link: { label: "Describe your practice", href: "/app/onboarding" },
      },
    ],
  },
  onboarding: {
    eyebrow: "01 / Shape your agency",
    title: "Start with your craft.",
    description:
      "A few thoughtful details give your agency draft a useful starting point. Saving a draft does not activate an agency.",
    links: [{ label: "Review agency draft", href: "/app/onboarding/review" }],
    forms: [
      form(
        "onboarding.save",
        "Creative practice & goals",
        "Save practice & goals",
        onboardingFields,
      ),
    ],
  },
  draft: {
    eyebrow: "02 / Your judgment comes first",
    title: "A company taking shape.",
    description:
      "Review the name, offer, pricing assumptions, simulated roles and delivery workflows. Only explicit acceptance creates your agency.",
    links: [{ label: "Edit practice & goals", href: "/app/onboarding" }],
    forms: [
      form("agency.generate", "Generate a draft", "Generate agency draft", [], {
        description:
          "Built-in demo logic creates editable suggestions. No external model or paid AI is used.",
      }),
      form(
        "agency.draft.edit",
        "Refine your agency draft",
        "Save draft edits",
        [
          text("name", "Agency name"),
          note("positioning", "Positioning"),
          text("buyer", "Intended buyer"),
        ],
      ),
      form(
        "agency.accept",
        "Make this your starting point",
        "Accept agency draft",
        [],
        {
          confirmation:
            "I have reviewed the draft, its illustrative prices, simulated crew and workflow assumptions. Accepting creates my agency once.",
        },
      ),
    ],
    notices: [
      {
        title: "A draft is a proposal",
        body: "Suggested prices are assumptions. Generated text does not establish clients, revenue, incorporation, IP rights or market validation.",
      },
    ],
  },
  agency: {
    eyebrow: "Your agency",
    title: "Give your work a clear offer.",
    description:
      "Keep your point of view, scope and pricing assumptions together. Edit an offer before taking it into a project.",
    links: [{ label: "Projects", href: "/app/projects" }],
    forms: [
      form("agency.update", "Agency profile", "Save agency profile", [
        text("name", "Agency name"),
        note("positioning", "Positioning"),
        text("buyer", "Intended buyer"),
        note("goals", "Creative and business goals"),
      ]),
      form(
        "package.create",
        "Create a service package",
        "Save service package",
        packageFields,
      ),
    ],
    tables: [
      table(
        "Service packages",
        ["Package", "Price", "Turnaround", "State"],
        "Accept your agency draft to start with three scoped packages, or add a package once your agency exists.",
      ),
    ],
  },
  package: {
    eyebrow: "Agency / Service package",
    title: "An offer with room to focus.",
    description:
      "Scope, labor and pricing belong to the same decision. Changes apply to this package; existing project history remains traceable.",
    links: [{ label: "All packages", href: "/app/agency" }],
    forms: [
      form(
        "package.update",
        "Edit service package",
        "Save package changes",
        packageFields,
      ),
      form("package.archive", "Archive package", "Archive package", [], {
        confirmation:
          "Archive this package for new work while preserving its project and evidence history.",
      }),
    ],
  },
  crew: {
    eyebrow: "Your simulated crew",
    title: "Support for the work. Judgment stays yours.",
    description:
      "Inspect each role's inputs, outputs and approval boundary. These are deterministic demo roles, with no autonomous live workers or additional human capacity.",
    links: [{ label: "Workflows & routines", href: "/app/crew/workflows" }],
    tables: [
      table(
        "Work queue",
        ["Task", "Assignment", "Due", "Status"],
        "Your work queue is clear. Create a project or enable a routine to begin.",
      ),
      table(
        "Crew runs",
        ["Run", "Provider", "Version", "Status"],
        "No crew simulations have been requested.",
      ),
    ],
  },
  run: {
    eyebrow: "Crew / Run & artifact review",
    title: "Make the work yours.",
    description:
      "Inspect the input, deterministic steps, draft output and provenance before approving. Approval completes this reviewable output; client delivery is recorded separately.",
    links: [{ label: "Back to crew", href: "/app/crew" }],
    tables: [
      table(
        "Persisted run steps",
        ["Step", "Status", "Result", "Version"],
        "Open a saved run from your crew queue to inspect its steps.",
      ),
    ],
    forms: [
      form("run.approve", "Approve this artifact", "Approve artifact", [], {
        confirmation:
          "I reviewed this artifact and approve this specific version.",
      }),
      form("run.revise", "Ask for a revision", "Request revision", [
        note("feedback", "What should change?"),
      ]),
      form("run.retry", "Recover a failed run", "Retry run", []),
      form("run.cancel", "Stop this run", "Cancel run", [], {
        confirmation:
          "Cancel this run. Existing versions remain in its history.",
      }),
    ],
  },
  clients: {
    eyebrow: "Projects / Clients",
    title: "Good work starts with a clear relationship.",
    description:
      "Keep a small, private client record and connect it to the work. These records never trigger outreach.",
    links: [{ label: "All projects", href: "/app/projects" }],
    tables: [
      table(
        "Clients",
        ["Client", "Organization", "Projects", "State"],
        "No clients saved. Add your first client to connect projects and business evidence.",
      ),
    ],
    forms: [form("client.create", "Add a client", "Save client", clientFields)],
  },
  client: {
    eyebrow: "Projects / Client",
    title: "A relationship, with the work in view.",
    description:
      "See associated projects and maintain the minimal details you need. Archived clients stay attached to existing work.",
    links: [{ label: "All clients", href: "/app/projects/clients" }],
    tables: [
      table(
        "Project history",
        ["Project", "Due", "Budget", "Status"],
        "No projects have been associated with this client.",
      ),
    ],
    forms: [
      form("client.update", "Edit client", "Save client changes", clientFields),
      form("client.archive", "Archive client", "Archive client", [], {
        confirmation:
          "Archive this client for new work while keeping project history.",
      }),
    ],
  },
  projects: {
    eyebrow: "The work",
    title: "From a good brief to a considered delivery.",
    description:
      "Scope a project, plan its dependencies, review the draft, and record what was delivered. A project is not recognized revenue or collected cash.",
    links: [
      { label: "Clients", href: "/app/projects/clients" },
      { label: "Crew queue", href: "/app/crew" },
    ],
    tables: [
      table(
        "Projects",
        ["Project", "Client", "Due", "Budget", "Status"],
        "No projects yet. Choose an offer or start with a blank project below.",
      ),
    ],
    forms: [
      form(
        "project.create",
        "Start a project",
        "Create project",
        projectFields,
      ),
    ],
  },
  project: {
    eyebrow: "Projects / Workspace",
    title: "Give this project a working plan.",
    description:
      "Keep the brief, human review gates, artifacts and delivery record together. Dependencies control what can move next.",
    links: [
      { label: "All projects", href: "/app/projects" },
      { label: "Crew queue", href: "/app/crew" },
    ],
    steps: [
      {
        title: "Brief",
        state: "current",
        detail: "Agree the scope and acceptance checks.",
      },
      {
        title: "Plan",
        state: "pending",
        detail: "Set tasks, responsibility and dependencies.",
      },
      {
        title: "Draft",
        state: "pending",
        detail: "Produce internal work for review.",
      },
      {
        title: "Human review",
        state: "pending",
        detail: "You approve a specific artifact version.",
      },
      {
        title: "Delivery recorded",
        state: "pending",
        detail: "Record delivery internally; nothing is sent.",
      },
      {
        title: "Closeout",
        state: "pending",
        detail: "Record revenue, cash, cost and evidence separately.",
      },
    ],
    tables: [
      table(
        "Project tasks",
        ["Task", "Assignment", "Due", "Status"],
        "No tasks have been added to this project.",
      ),
    ],
    forms: [
      form(
        "project.update",
        "Project details",
        "Save project changes",
        projectFields,
      ),
      form(
        "workflow.instantiate",
        "Use a repeatable process",
        "Create delivery workflow",
        [select("templateKey", "Workflow", ["delivery-pipeline-v1"])],
      ),
      form("task.create", "Add a task", "Create task", taskFields),
      form(
        "project.closeout",
        "Record project closeout",
        "Save closeout",
        [
          text("deliveryDate", "Delivery date", { type: "date" }),
          money("recognizedRevenueMinor", "Recognized revenue"),
          money("receiptsMinor", "Collected cash"),
          money("deliveryCostMinor", "Delivery cost"),
          number("founderLaborHours", "Founder labor (hours)", {
            step: 0.5,
            required: false,
          }),
          select("founderCostTreatment", "Founder cost treatment", [
            "included_in_delivery",
            "included_in_overhead",
            "unpaid",
            "unknown",
          ]),
          select("recurrenceType", "Revenue recurrence", [
            "one_off",
            "contracted_retainer",
            "unknown",
          ]),
          note("repeatabilityNotes", "Repeatability notes", {
            required: false,
          }),
        ],
        {
          description:
            "Project completion creates no payment. Updating this record corrects its evidence rather than adding duplicate revenue.",
        },
      ),
      form("project.archive", "Archive project", "Archive project", [], {
        confirmation:
          "Preserve project tasks, artifacts and evidence while archiving this project.",
      }),
    ],
  },
  task: {
    eyebrow: "Crew / Task",
    title: "A clear next step.",
    description:
      "See the responsible role, input, deadline and prerequisites. Original committed dates and review history stay attached to the work.",
    links: [{ label: "Work queue", href: "/app/crew" }],
    tables: [
      table(
        "Activity & review history",
        ["When", "Actor", "Event", "Reference"],
        "No recorded activity for this task.",
      ),
    ],
    forms: [
      form("task.update", "Task details", "Save task changes", taskFields),
      form("run.queue", "Run eligible simulated work", "Queue demo run", [], {
        description:
          "Only queued work with completed dependencies can run. Draft output requires your review.",
      }),
      form("task.transition", "Update task state", "Apply transition", [
        select("status", "Next state", [
          "in_progress",
          "awaiting_review",
          "done",
          "failed",
          "cancelled",
        ]),
        note("reason", "Transition note", { required: false }),
      ]),
    ],
  },
  workflows: {
    eyebrow: "Crew / Workflows & routines",
    title: "Make room for a repeatable rhythm.",
    description:
      "Plan delivery with human gates, weekly planning and monthly evidence review. Due routines run through an authenticated action, with one coalesced catch-up occurrence.",
    links: [{ label: "Crew queue", href: "/app/crew" }],
    forms: [
      form("routine.enable", "Enable a routine", "Save routine", [
        select("templateKey", "Routine", [
          "weekly_planning",
          "monthly_evidence_review",
        ]),
        text("timezone", "Routine timezone", { value: "America/New_York" }),
      ]),
      form("routine.runDue", "Run the due work", "Run due routines", [], {
        description:
          "Process each due occurrence once. Missed intervals coalesce; retries cannot duplicate tasks.",
      }),
      form("routine.pause", "Pause a routine", "Pause routine", [
        select("routineId", "Routine", []),
      ]),
    ],
    tables: [
      table(
        "Saved routines",
        ["Routine", "Cadence", "Timezone", "Next due", "Status"],
        "No recurring routines have been enabled.",
      ),
    ],
  },
  notifications: {
    eyebrow: "Your workspace",
    title: "A quieter way to stay in the loop.",
    description:
      "Internal updates about review, failed work, overdue tasks and milestones. Nothing is emailed or pushed outside the workspace.",
    tables: [
      table(
        "Notifications",
        ["Event", "Recorded", "Read state"],
        "You are all caught up. New saved events will appear here.",
      ),
    ],
    forms: [
      form(
        "notification.readAll",
        "Clear the unread queue",
        "Mark all as read",
        [],
      ),
    ],
  },
  growth: {
    eyebrow: "Nurture your company",
    title: "Progress you can point to.",
    description:
      "Turn delivery records into useful next steps. A recommendation explains a rule; it cannot improve factual inputs by itself.",
    links: [{ label: "Investor preparation", href: "/app/investor-readiness" }],
    metrics: [
      {
        label: "Completed projects",
        value: "0",
        detail: "Saved project completion records",
      },
      {
        label: "Repeat clients",
        value: null,
        detail: "Distinct economic client groups; period shown when known",
      },
      {
        label: "Earned revenue",
        value: null,
        detail: "Recognized revenue, separate from receipts",
      },
      {
        label: "Human capacity",
        value: null,
        detail: "Named paid human pools; AI roles add no capacity",
      },
    ],
    tables: [
      table(
        "Milestones",
        ["Milestone", "Target / evidence", "Status"],
        "Save your agency to begin an evidence-backed milestone plan.",
      ),
      table(
        "Recommendations",
        ["Next step", "Reason", "Evidence needed"],
        "Recommendations appear when saved facts support a rule.",
      ),
    ],
    forms: [
      form(
        "recommendation.task",
        "Make a recommendation actionable",
        "Create task from recommendation",
        [select("recommendationId", "Recommendation", [])],
      ),
      form(
        "recommendation.dismiss",
        "Dismiss a recommendation",
        "Dismiss recommendation",
        [select("recommendationId", "Recommendation", [])],
      ),
    ],
  },
  readiness: {
    eyebrow: "Optional / Investor preparation",
    title: "A clearer company story starts with evidence.",
    description:
      "Inspect what is documented, what remains unknown, and where your business needs attention. Preparation is not funding probability or investor endorsement.",
    finance: true,
    links: financeLinks,
    metrics: [
      {
        label: "Preparation score",
        value: null,
        detail: "readiness-v1.1 · 100 possible points",
      },
      {
        label: "Evidence coverage",
        value: null,
        detail: "Weighted availability; not independent verification",
      },
      { label: "As-of date", value: null, detail: "Closed UTC calendar month" },
      {
        label: "Cash risk",
        value: null,
        detail: "Risk flags remain visible regardless of score",
      },
    ],
    tables: [
      table(
        "Score components",
        ["Component", "Input", "Earned / maximum", "Coverage", "Reason"],
        "Save dated evidence to calculate a versioned preparation snapshot. Missing inputs remain unknown business facts.",
      ),
    ],
    forms: [
      form(
        "readiness.create",
        "Create a preparation snapshot",
        "Calculate readiness snapshot",
        [text("asOfDate", "As-of closed month end", { type: "date" })],
      ),
    ],
  },
  financials: {
    eyebrow: "Investor preparation / Financial model",
    title: "Keep the cash story in focus.",
    description:
      "Record actuals separately from scenarios. Forecast work is limited by entered human capacity; receivables and collected cash follow their own timing.",
    finance: true,
    links: financeLinks.filter((link) => !link.href.endsWith("financials")),
    tables: [
      table(
        "Historical actuals",
        [
          "Closed month",
          "Recognized revenue",
          "Receipts",
          "Operating cash costs",
          "Cash",
          "Source",
        ],
        "No historical observations saved. A missing month stays unknown; a confirmed zero is entered explicitly.",
      ),
      table(
        "Scenario comparison",
        [
          "Scenario",
          "First deficit",
          "Horizon cash",
          "Ending mean cash flow",
          "Capacity risk",
        ],
        "No calculated scenarios. Save complete assumptions to compare base, downside, upside and a downside without the planned hire.",
      ),
      table(
        "Monthly projection",
        [
          "Month / projected",
          "Revenue",
          "Receipts",
          "Costs",
          "Founder pay",
          "Closing AR",
          "Closing cash",
        ],
        "No projection available. Unsupported or incomplete balances are explained rather than replaced with zero.",
      ),
    ],
    notices: [
      {
        title: "Read the denominators",
        body: "Historical net burn includes operating cash tax and interest. Historical receipts-stop uses observed outflows; forward core-cost stress excludes tax buffer, interest, capex and principal. Neither receipts-stop measure is runway.",
      },
      {
        title: "Founder pay and capacity",
        body: "Show recorded gross margin beside founder-loaded delivery margin. Allocating existing pay changes display buckets, never total cash cost. Replacement pay is a separate, nullable assumption. The sample hire adds capacity without reducing direct unit labor cost; it is conservative.",
      },
      {
        title: "Cash need can continue beyond the horizon",
        body: "Compare planning capital with the final three months' signed mean net cash flow. A minimum at month 24 requires a continuing-funding warning, even when an illustrative injection covers that modeled period.",
      },
    ],
    forms: [
      form(
        "actual.save",
        "Record a closed month",
        "Save monthly actuals",
        actualFields,
      ),
      form(
        "scenario.create",
        "Model a scenario",
        "Calculate and save scenario",
        scenarioFields,
      ),
    ],
  },
  equity: {
    eyebrow: "Investor preparation / Equity education",
    title: "Explore dilution, with the assumptions visible.",
    description:
      "Private hypothetical arithmetic for a simple priced round or supported cap-only post-money SAFEs. Scenarios are separate from actual ownership and never execute an instrument.",
    finance: true,
    links: financeLinks.filter((link) => !link.href.endsWith("equity")),
    notices: [
      {
        title: "Hypothetical planning scenario — not an offer of securities",
        body: "SAFE interests are contractual before conversion. Pool changes can alter cap binding. Unsupported discounts, MFN, notes, side letters or below-cap conversions return an explicit unsupported result.",
      },
    ],
    tables: [
      table(
        "Hypothetical fully diluted ownership",
        ["Category", "Before", "After conversion", "After new money"],
        "No hypothetical scenario calculated. An unallocated option pool is a reserve, not a person with voting rights.",
      ),
    ],
    forms: [
      form(
        "equity.create",
        "Explore a supported scenario",
        "Calculate hypothetical ownership",
        [
          select("kind", "Illustration type", [
            "priced_round",
            "cap_only_safe",
          ]),
          number("founderShares", "Founder shares"),
          number("poolShares", "Existing unallocated pool shares"),
          money("preMoneyMinor", "Pre-money valuation", { required: true }),
          money("newCashMinor", "New primary cash", { required: true }),
          money("safeAAmountMinor", "SAFE A funded amount"),
          money("safeACapMinor", "SAFE A post-money cap"),
          money("safeBAmountMinor", "SAFE B funded amount"),
          money("safeBCapMinor", "SAFE B post-money cap"),
          number(
            "finalPoolFraction",
            "Target final unallocated pool fraction",
            { required: false, max: 0.99, step: 0.01 },
          ),
          {
            name: "hypothetical",
            label: "I understand this is a hypothetical educational scenario",
            type: "checkbox",
            required: true,
          },
        ],
      ),
    ],
  },
  pitch: {
    eyebrow: "Investor preparation / Pitch builder",
    title: "Tell the story your evidence supports.",
    description:
      "Draft a private narrative, review each claim, and keep unresolved support visible as [Evidence needed]. Generating a new version preserves the previous one.",
    finance: true,
    links: financeLinks.filter((link) => !link.href.endsWith("pitch")),
    forms: [
      form(
        "pitch.generate",
        "Draft from saved evidence",
        "Generate private pitch draft",
        [],
        {
          description:
            "The deterministic demo provider uses referenced computed facts and placeholders. It does not invent customers, market size, returns or legal status.",
        },
      ),
      form("pitch.update", "Edit the private narrative", "Save pitch version", [
        note("content", "Pitch narrative", {
          maxLength: 30000,
          hint: "Include agency thesis, buyer problem, offer, delivery, traction, recurrence, unit economics, market, IP, human team, milestones and optional hypothetical capital planning.",
        }),
      ]),
    ],
    tables: [
      table(
        "Claim references",
        ["Claim", "Origin", "As of", "Evidence reference", "Unresolved"],
        "No generated claims yet. Numeric claims must retain their source evidence or assumption reference.",
      ),
    ],
  },
  dataRoom: {
    eyebrow: "Investor preparation / Data room & export",
    title: "Bring the supporting pieces together.",
    description:
      "Keep notes and safe references, then create a private versioned preparation pack. An export is a snapshot of evidence, assumptions, gaps and risks.",
    finance: true,
    links: financeLinks.filter((link) => !link.href.endsWith("data-room")),
    tables: [
      table(
        "Preparation checklist",
        [
          "Folder",
          "Status",
          "Owner",
          "Period",
          "Last reviewed",
          "Evidence reference",
        ],
        "Save checklist metadata for company, ownership, financials, customers, operations, IP, market, risk/security and fundraising preparation.",
      ),
      table(
        "Saved private exports",
        ["Snapshot", "Created", "Origin", "Versions"],
        "No exports created. Saved snapshots are immutable and downloads recheck your ownership.",
      ),
    ],
    forms: [
      form("evidence.save", "Add an evidence reference", "Save evidence", [
        select("category", "Folder", [
          "company",
          "ownership",
          "financials",
          "customers",
          "operations",
          "ip_brand",
          "market",
          "risk_security",
          "fundraising_preparation",
        ]),
        text("title", "Evidence title"),
        note("note", "Evidence notes", { required: false }),
        text("sourceUrl", "HTTPS reference", {
          required: false,
          hint: "Metadata only; Seedee does not fetch or upload the document.",
        }),
        select("origin", "Origin", ["user_entered", "assumption"], {
          value: "user_entered",
        }),
        text("asOfDate", "As-of date", { type: "date" }),
        select("reviewStatus", "Review status", [
          "unreviewed",
          "owner_attested",
          "externally_reviewed",
        ]),
        text("reviewer", "Reviewer / reference", {
          required: false,
          hint: "External review requires supporting reviewer, date and evidence metadata. It is never inferred.",
        }),
      ]),
      form(
        "checklist.update",
        "Review a checklist item",
        "Save checklist status",
        [
          select("category", "Folder", [
            "company",
            "ownership",
            "financials",
            "customers",
            "operations",
            "ip_brand",
            "market",
            "risk_security",
            "fundraising_preparation",
          ]),
          select("status", "Checklist status", [
            "missing",
            "draft",
            "owner_attested",
            "externally_reviewed",
            "not_applicable_with_reason",
          ]),
          text("reference", "Evidence reference", { required: false }),
          note("reason", "Gap or not-applicable reason", { required: false }),
        ],
      ),
      form(
        "export.create",
        "Create a private preparation pack",
        "Create export snapshot",
        [],
        {
          description:
            "Create a snapshot first, then download its Markdown pack and CSV table. Mixed sample and real actuals are rejected; create separate snapshots.",
        },
      ),
    ],
  },
  settings: {
    eyebrow: "Your workspace",
    title: "Keep your space in good order.",
    description:
      "Manage local workspace preferences and your session. This demo has no email verification or email-based password recovery.",
    forms: [
      form("settings.update", "Workspace preferences", "Save preferences", [
        text("timezone", "Workspace timezone"),
        select("currency", "Functional currency", ["USD"], { value: "USD" }),
      ]),
      form(
        "workspace.reset",
        "Reset your synthetic sample workspace",
        "Reset sample workspace",
        [],
        {
          confirmation:
            "Delete only my synthetic sample agency and its records. This cannot reset a real workspace or another owner's data.",
        },
      ),
    ],
    notices: [
      {
        title: "Local demo boundaries",
        body: "No live AI providers, real payments, outbound email, public publishing, investor introductions or domains are configured. Use Sign out in the header to revoke this browser's session.",
      },
    ],
  },
};

export const screenRoutes: Record<string, string> = {
  "": "overview",
  onboarding: "onboarding",
  "onboarding/review": "draft",
  agency: "agency",
  crew: "crew",
  "crew/workflows": "workflows",
  projects: "projects",
  "projects/clients": "clients",
  growth: "growth",
  notifications: "notifications",
  settings: "settings",
  "investor-readiness": "readiness",
  "investor-readiness/financials": "financials",
  "investor-readiness/equity": "equity",
  "investor-readiness/pitch": "pitch",
  "investor-readiness/data-room": "dataRoom",
};
export function resolveScreen(
  path: string[],
): { key: string; recordId?: string; projectId?: string } | null {
  const exact = screenRoutes[path.join("/")];
  if (exact) return { key: exact };
  if (path.length === 3 && path[0] === "agency" && path[1] === "packages")
    return { key: "package", recordId: path[2] };
  if (path.length === 3 && path[0] === "projects" && path[1] === "clients")
    return { key: "client", recordId: path[2] };
  if (path.length === 2 && path[0] === "projects")
    return { key: "project", recordId: path[1] };
  if (path.length === 3 && path[0] === "crew" && path[1] === "runs")
    return { key: "run", recordId: path[2] };
  if (path.length === 3 && path[0] === "crew" && path[1] === "tasks")
    return { key: "task", recordId: path[2] };
  if (path.length === 4 && path[0] === "projects" && path[2] === "tasks")
    return { key: "task", projectId: path[1], recordId: path[3] };
  return null;
}
