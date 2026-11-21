export const workspaceSections = [
  {
    slug: "agency",
    title: "Agency",
    description:
      "Give your practice a clear offer, a point of view, and a plan.",
    emptyTitle: "Room for your agency to take shape",
    emptyDescription:
      "The agency builder will help you review a draft before saving your studio. Agency editing is not available in this foundation yet.",
  },
  {
    slug: "crew",
    title: "Crew",
    description: "Define the roles that support your work, with you in charge.",
    emptyTitle: "A crew built around your practice",
    emptyDescription:
      "Crew setup and simulated assignments will appear here in a later feature release. No agents are running in this preview.",
  },
  {
    slug: "projects",
    title: "Projects",
    description: "Turn an idea into scoped work and visible next steps.",
    emptyTitle: "A clear place for the work",
    emptyDescription:
      "Project planning and delivery tools are coming in a later feature release. There are no projects in this foundation yet.",
  },
  {
    slug: "growth",
    title: "Growth",
    description: "Keep track of what you learn and what to try next.",
    emptyTitle: "Make space for the next chapter",
    emptyDescription:
      "Growth planning will help organize experiments and evidence. No campaigns, outreach, or automatic publishing are active.",
  },
  {
    slug: "investor-readiness",
    title: "Investor Readiness",
    description: "Bring your company story and supporting evidence into focus.",
    emptyTitle: "Preparation starts with evidence",
    emptyDescription:
      "Investor preparation tools are planned for a later feature release. This preview does not score your company or predict whether you will receive funding.",
  },
] as const;

export type WorkspaceSection = (typeof workspaceSections)[number]["slug"];
