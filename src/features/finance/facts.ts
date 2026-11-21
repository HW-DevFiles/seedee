import type { Provenance } from "../workspace/contracts";
export function buildFacts(
  snapshotId: string,
  asOf: string,
  formulaVersion: string,
  p: Provenance,
  values: {
    key: string;
    label: string;
    value: string | null;
    section: string;
  }[],
) {
  return values.map((v) => ({
    id: `${snapshotId}:${v.key}`,
    section: v.section,
    label: v.label,
    displayValue: v.value,
    origin: p.origin,
    sourceRef: snapshotId,
    asOf: asOf.slice(0, 10),
    formulaVersion,
    reviewStatus: p.reviewStatus,
    sourceVersion: 1,
  }));
}
