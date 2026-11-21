import type { ActionState, FormSpec } from "./contracts";

/** Exact display-unit conversion at the form boundary, not a finance formula. */
export function dollarsToMinor(value: string, signed = false): number | null {
  if (value.trim() === "") return null;
  if (!(signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(value))
    throw new Error(
      "Enter a nonnegative USD amount with up to two decimal places.",
    );
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("This amount is too large. Enter a smaller amount.");
  return Number(negative ? -minor : minor);
}
export function displayMinor(value: number | null): string {
  if (value === null) return "Unknown";
  if (!Number.isSafeInteger(value))
    throw new Error("Money must be safe integer cents.");
  const minor = BigInt(value);
  const absolute = minor < BigInt(0) ? -minor : minor;
  return `${minor < BigInt(0) ? "−" : ""}$${(absolute / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}
export type ParsedForm =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; state: ActionState };
export function parseFormInput(spec: FormSpec, data: FormData): ParsedForm {
  const input: Record<string, unknown> = {};
  const fieldErrors: Record<string, string> = {};
  for (const field of spec.fields) {
    const raw = data.get(field.name);
    if (raw !== null && typeof raw !== "string") {
      fieldErrors[field.name] = "Files are not accepted in this form.";
      continue;
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.type === "multiselect") {
      const selected = data.getAll(field.name);
      if (
        selected.some(
          (item) =>
            typeof item !== "string" ||
            !field.options?.some((option) => option.value === item),
        )
      )
        fieldErrors[field.name] = "Choose only listed options.";
      else if (field.required && selected.length === 0)
        fieldErrors[field.name] = "Choose at least one practice.";
      else input[field.name] = [...new Set(selected)];
    } else if (field.type === "checkbox") {
      input[field.name] = value === "on";
      if (field.required && value !== "on")
        fieldErrors[field.name] = "Confirm this before continuing.";
    } else if (!value) {
      if (field.required)
        fieldErrors[field.name] = `${field.label} is required.`;
      else input[field.name] = null;
    } else if (field.type === "money") {
      try {
        input[field.name] = dollarsToMinor(value, field.signed);
      } catch (error) {
        fieldErrors[field.name] =
          error instanceof Error ? error.message : "Check this amount.";
      }
    } else if (field.type === "number") {
      const numeric = Number(value);
      if (
        !/^-?\d+(?:\.\d+)?$/.test(value) ||
        !Number.isFinite(numeric) ||
        (field.min !== undefined && numeric < field.min) ||
        (field.max !== undefined && numeric > field.max) ||
        (field.step === 1 && !Number.isInteger(numeric))
      )
        fieldErrors[field.name] =
          `Enter a valid number${field.min !== undefined ? ` from ${field.min}` : ""}${field.max !== undefined ? ` to ${field.max}` : ""}.`;
      else input[field.name] = numeric;
    } else if (
      field.type === "select" &&
      !field.options?.some((option) => option.value === value)
    ) {
      fieldErrors[field.name] = "Choose a listed option.";
    } else if (
      value.length >
      (field.maxLength ?? (field.type === "textarea" ? 4000 : 240))
    ) {
      fieldErrors[field.name] =
        "This value is too long. Shorten it and try again.";
    } else input[field.name] = value;
  }
  if (spec.confirmation && data.get("confirmed") !== "on")
    fieldErrors.confirmed =
      "Confirm that you understand this action before continuing.";
  if (Object.keys(fieldErrors).length)
    return {
      ok: false,
      state: {
        status: "error",
        message: "Your changes were not saved. Check the highlighted fields.",
        fieldErrors,
      },
    };
  // Ignore all unknown fields, especially browser-submitted owner/user IDs.
  return { ok: true, input };
}
export type CommandResult =
  | { ok: true; data?: unknown }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fields?: Record<string, string | string[]>;
      };
    };
export function commandState(
  result: CommandResult,
  successMessage: string,
): ActionState {
  return result.ok
    ? { status: "success", message: successMessage }
    : {
        status: result.error.code === "conflict" ? "conflict" : "error",
        message: result.error.message,
        fieldErrors: result.error.fields
          ? Object.fromEntries(
              Object.entries(result.error.fields).map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(" ") : value,
              ]),
            )
          : undefined,
      };
}
