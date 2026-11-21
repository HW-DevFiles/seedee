import { AutomationError } from "./contracts";

export type Clock = () => Date;
export function checkedInstant(value: string | Date): Date {
  const result =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(result.getTime()))
    throw new AutomationError("invalid_input", "Invalid UTC instant.");
  return result;
}
export function checkTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new AutomationError(
      "invalid_input",
      "Choose a valid named timezone.",
    );
  }
}
type Local = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};
function localParts(at: Date, timezone: string): Local {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (key: string) => Number(parts.find((p) => p.type === key)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}
const localEpoch = (p: Local) =>
  Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
// Calendar slots retain local wall time across DST. For a missing spring hour use
// the wall time shifted forward by the DST gap; for a repeated fall hour use the first.
function fromLocal(p: Local, timezone: string): Date {
  const target = localEpoch(p);
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const sample = new Date(target + delta);
    offsets.add(localEpoch(localParts(sample, timezone)) - sample.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(target - offset))
    .sort((a, b) => a.getTime() - b.getTime());
  return (
    candidates.find((at) => localEpoch(localParts(at, timezone)) === target) ??
    candidates.filter(
      (at) => localEpoch(localParts(at, timezone)) > target,
    )[0] ??
    candidates[candidates.length - 1]
  );
}
export function nextSlot(
  anchor: string,
  timezone: string,
  cadence: "weekly" | "monthly",
  count: number,
): string {
  checkTimezone(timezone);
  const p = localParts(checkedInstant(anchor), timezone);
  if (cadence === "weekly") {
    const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + 7 * count));
    p.year = shifted.getUTCFullYear();
    p.month = shifted.getUTCMonth() + 1;
    p.day = shifted.getUTCDate();
  } else {
    const shifted = new Date(Date.UTC(p.year, p.month - 1 + count, 1));
    p.year = shifted.getUTCFullYear();
    p.month = shifted.getUTCMonth() + 1;
    p.day = Math.min(
      p.day,
      new Date(Date.UTC(p.year, p.month, 0)).getUTCDate(),
    );
  }
  return fromLocal(p, timezone).toISOString();
}
export function dueSlots(
  anchor: string,
  timezone: string,
  cadence: "weekly" | "monthly",
  now: Date,
  currentIndex = 0,
): { nextDueAt: string; nextSlotIndex: number; skippedCount: number } {
  let count = currentIndex + 1;
  let next = nextSlot(anchor, timezone, cadence, count);
  // Bound old/malicious dates rather than blocking a request indefinitely.
  while (checkedInstant(next) <= now) {
    if (++count > 10000)
      throw new AutomationError(
        "invalid_input",
        "Routine is too old; choose a recent next due date.",
      );
    next = nextSlot(anchor, timezone, cadence, count);
  }
  return {
    nextDueAt: next,
    nextSlotIndex: count,
    skippedCount: count - currentIndex - 1,
  };
}
