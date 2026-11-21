import { z } from "zod";
import {
  DomainError,
  version,
  id,
  text,
  hours,
  dateTime,
  provenanceSchema,
  type Provenance,
} from "../workspace/contracts";
import { readinessSchema, type ReadinessInput } from "./contracts";

const human = readinessSchema.shape.humans
  .unwrap()
  .element.omit({ sourceIds: true });
const backup = readinessSchema.shape.backups
  .unwrap()
  .element.omit({ sourceId: true });
const delivery = readinessSchema.shape.deliveryHours
  .unwrap()
  .element.omit({ sourceId: true });
const capacity = readinessSchema.shape.capacity
  .unwrap()
  .element.omit({ sourceId: true });
export const teamEvidenceSchema = z
  .object({
    entryId: id,
    provenance: provenanceSchema,
    record: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("human"), data: human.strict() }),
      z.object({ kind: z.literal("backup"), data: backup.strict() }),
      z.object({ kind: z.literal("hours"), data: delivery.strict() }),
      z.object({ kind: z.literal("capacity"), data: capacity.strict() }),
      z.object({
        kind: z.literal("owner"),
        data: z.object({ note: text, asOf: dateTime }).strict(),
      }),
    ]),
  })
  .strict();
export const teamCommandSchema = teamEvidenceSchema.extend({
  expectedVersion: version.nullable().default(null),
});
export type TeamEvidence = z.infer<typeof teamEvidenceSchema>;
type Evidence = {
  id: string;
  version: number;
  metricKey: string;
  value: unknown;
  provenance: unknown;
  createdAt: Date;
};
export function teamRecords(
  rows: Evidence[],
  origin: Provenance["origin"],
  asOf?: string,
) {
  const seen = new Set<string>();
  return [...rows]
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    )
    .flatMap((row) => {
      if (row.metricKey !== "readiness_team") return [];
      const parsed = teamEvidenceSchema.safeParse(
        (row.value as { content?: unknown })?.content,
      );
      if (
        !parsed.success ||
        parsed.data.provenance.origin !== origin ||
        (asOf && new Date(parsed.data.provenance.asOf) > new Date(asOf))
      )
        return [];
      const key = `${parsed.data.record.kind}:${parsed.data.entryId}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ sourceId: row.id, version: row.version, ...parsed.data }];
    });
}
export function applyTeamEvidence(input: ReadinessInput, rows: Evidence[]) {
  const result = structuredClone(input);
  const records = teamRecords(rows, input.provenance.origin, input.asOf);
  for (const kind of [
    "human",
    "backup",
    "hours",
    "capacity",
    "owner",
  ] as const) {
    const selected = records.filter((r) => r.record.kind === kind);
    if (!selected.length) continue;
    if (kind === "human")
      result.humans = selected.flatMap((r) =>
        r.record.kind === "human"
          ? [{ ...r.record.data, sourceIds: [r.sourceId] }]
          : [],
      );
    if (kind === "backup")
      result.backups = selected.flatMap((r) =>
        r.record.kind === "backup"
          ? [{ ...r.record.data, sourceId: r.sourceId }]
          : [],
      );
    if (kind === "hours")
      result.deliveryHours = selected.flatMap((r) =>
        r.record.kind === "hours"
          ? [{ ...r.record.data, sourceId: r.sourceId }]
          : [],
      );
    if (kind === "capacity")
      result.capacity = selected.flatMap((r) =>
        r.record.kind === "capacity"
          ? [{ ...r.record.data, sourceId: r.sourceId }]
          : [],
      );
    if (kind === "owner")
      result.accountableOwner = {
        value: true,
        note:
          selected[0].record.kind === "owner"
            ? selected[0].record.data.note
            : "",
        sourceIds: [selected[0].sourceId],
      };
  }
  return readinessSchema.parse(result);
}
export function validateTeamReferences(
  value: TeamEvidence,
  rows: Evidence[],
  now: Date,
) {
  const p = value.provenance;
  if (p.origin === "assumption")
    throw new DomainError(
      "invalid_input",
      "Team evidence must be supplied facts, not assumptions.",
    );
  const records = teamRecords(rows, p.origin);
  const humans = records.flatMap((r) =>
    r.record.kind === "human" ? [r.record.data] : [],
  );
  const record = value.record;
  const dates: string[] = [p.asOf];
  if (record.kind === "human") {
    if (record.data.id !== value.entryId)
      throw new DomainError(
        "invalid_input",
        "The human identifier must match its stable evidence record key.",
      );
    dates.push(record.data.agreementStart);
    if (
      record.data.agreementEnd &&
      new Date(record.data.agreementEnd) < new Date(record.data.agreementStart)
    )
      throw new DomainError(
        "invalid_input",
        "Agreement end must follow its start.",
      );
  }
  if (record.kind === "backup") {
    dates.push(record.data.acceptedAt);
    if (
      !humans.some(
        (h) =>
          h.id === record.data.humanId &&
          !h.simulated &&
          !h.isFounder &&
          h.compensationMinor !== null &&
          h.compensationMinor > 0,
      )
    )
      throw new DomainError(
        "invalid_input",
        "Select a saved paid nonfounder for the backup.",
      );
  }
  if (record.kind === "hours") {
    dates.push(record.data.date);
    if (!humans.some((h) => h.id === record.data.humanId && !h.simulated))
      throw new DomainError(
        "invalid_input",
        "Select a saved human before logging delivery hours.",
      );
    hours.parse(record.data.hours);
  }
  if (record.kind === "capacity") {
    if (
      record.data.id !== value.entryId ||
      new Set(record.data.humanIds).size !== record.data.humanIds.length
    )
      throw new DomainError(
        "invalid_input",
        "Use the pool's stable record key and distinct paid humans.",
      );
    dates.push(record.data.attestedAt);
    if (
      records.some(
        (r) =>
          r.record.kind === "capacity" &&
          r.entryId !== value.entryId &&
          r.record.data.period === record.data.period &&
          r.record.data.humanIds.some((person) =>
            record.data.humanIds.includes(person),
          ),
      )
    )
      throw new DomainError(
        "invalid_input",
        "A paid human cannot be counted in multiple capacity pools for the same month.",
      );
    if (
      !record.data.humanIds.length ||
      record.data.humanIds.some(
        (person) =>
          !humans.some(
            (h) =>
              h.id === person &&
              !h.simulated &&
              h.compensationMinor !== null &&
              h.compensationMinor > 0,
          ),
      )
    )
      throw new DomainError(
        "invalid_input",
        "Capacity pools require saved paid humans.",
      );
  }
  if (record.kind === "owner") dates.push(record.data.asOf);
  if (dates.some((d) => new Date(d) > now || new Date(d) > new Date(p.asOf)))
    throw new DomainError(
      "invalid_input",
      "Team evidence dates must be on or before its as-of date and today.",
    );
}
