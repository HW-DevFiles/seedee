import { z } from "zod";

export function safeExternalUrl(value: string): string | null {
  if (value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(value))
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export const externalUrlSchema = z
  .string()
  .max(2048)
  .transform((value, context) => {
    const url = safeExternalUrl(value);
    if (!url) {
      context.addIssue({
        code: "custom",
        message: "Enter an HTTPS link without credentials.",
      });
      return z.NEVER;
    }
    return url;
  });

// For user fields placed inside a trusted Markdown template. Never render raw
// HTML or feed the original field to a Markdown/HTML renderer afterward.
export function markdownText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1")
    .replace(/\r\n?/g, "\n");
}

export type CsvCell = string | number | boolean | null;
export function csvCell(value: CsvCell): string {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new TypeError("CSV numbers must be finite.");
  let text = value === null ? "" : String(value);
  // Quoting alone does not stop spreadsheet formulas. Preserve numeric values
  // as numbers; treat every string (including numeric-looking strings) as text.
  if (
    typeof value === "string" &&
    /^[\s\u0000-\u0020\u007f]*[=+\-@]/u.test(text)
  )
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
