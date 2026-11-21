/** Presentation-only DTOs. Domain services own validation, money, state transitions and persistence. */
export type Origin = "sample" | "user_entered" | "assumption";
export type ActionState = {
  status?: "success" | "error" | "conflict";
  message?: string;
  fieldErrors?: Record<string, string>;
};
export type FormAction = (
  previous: ActionState,
  data: FormData,
) => Promise<ActionState>;
export type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "number"
    | "money"
    | "date"
    | "month"
    | "email"
    | "select"
    | "checkbox"
    | "multiselect";
  hint?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number | "any";
  signed?: boolean;
  maxLength?: number;
  value?: string | number | boolean | string[];
  options?: { value: string; label: string }[];
};
export type FormSpec = {
  id: string;
  title: string;
  description?: string;
  submit: string;
  fields: Field[];
  screenKey?: string;
  projectId?: string;
  recordId?: string;
  version?: number;
  recordVersions?: Record<string, number>;
  confirmation?: string;
  unavailableReason?: string;
};
export type ViewLink = { label: string; href: string };
export type ViewMetric = {
  label: string;
  value: string | null;
  detail: string;
  href?: string;
  origin?: Origin;
};
export type ViewTable = {
  title: string;
  description?: string;
  columns: string[];
  rows: { id: string; cells: string[]; href?: string; linkLabel?: string }[];
  empty: string;
};
export type ViewCard = {
  id: string;
  title: string;
  body: string;
  status?: string;
  details?: { label: string; value: string }[];
  link?: ViewLink;
};
export type ScreenView = {
  eyebrow: string;
  title: string;
  description: string;
  links?: ViewLink[];
  metrics?: ViewMetric[];
  cards?: ViewCard[];
  tables?: ViewTable[];
  forms?: FormSpec[];
  notices?: { title: string; body: string; kind?: "warning" | "info" }[];
  steps?: {
    title: string;
    state: "done" | "current" | "pending";
    detail: string;
  }[];
  finance?: boolean;
};
export type WorkspaceUI = {
  mode: "connected" | "empty" | "sample_preview";
  agencyName: string | null;
  /** All child references must already be authorized by the read adapter. */
  screen: ScreenView;
  source?: { origin: Origin; asOf: string; review: string; version: string };
};
export const EDUCATIONAL_BOUNDARY =
  "Educational planning only. Not financial, investment, accounting, tax or legal advice. No funding or return guarantee. Consult qualified advisers before acting.";
