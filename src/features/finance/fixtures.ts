import { readinessSchema, type ReadinessInput } from "./contracts";
import { emptyReadiness } from "./readiness";

// Explicitly synthetic fixture; never used as a fallback for an owner's records.
export function sampleReadiness(): ReadinessInput {
  const v = emptyReadiness("2026-10-31T00:00:00Z", "sample"),
    p = v.provenance;
  const periods = [
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ],
    revenues = [1700000, 1800000, 1900000, 1900000, 2000000, 2100000],
    retainers = [950000, 1000000, 1050000, 1050000, 1050000, 600000];
  v.months = periods.map((period, i) => ({
    period,
    revenueMinor: revenues[i],
    closed: true,
    provenance: p,
  }));
  v.packages = [
    {
      id: "qualified",
      fixedScope: "Synthetic brand delivery",
      priceCostBasis: "Illustrative labor/cost basis",
      sopVersion: "sop-1",
      sopCreatedAt: "2026-04-01T00:00:00Z",
      checklist: ["Owner acceptance"],
    },
  ];
  v.contracts = [
    {
      id: "recurring",
      cadence: "Monthly",
      terms: "Monthly earned work; entered cancellation terms",
      serviceStart: "2026-05-01T00:00:00Z",
      serviceEnd: "2026-10-31T00:00:00Z",
    },
  ];
  v.recognition = [];
  v.deliveries = [];
  for (let m = 0; m < 6; m++)
    for (let g = 0; g < 5; g++) {
      const share = [30, 25, 20, 15, 10][g],
        amount = (revenues[m] * share) / 100,
        retainer = (retainers[m] * share) / 100,
        packageAmount = amount * 0.75,
        when = `${periods[m]}-01T00:00:00Z`,
        deliveryId = `delivery-${m}-${g}`;
      v.deliveries.push({
        id: deliveryId,
        clientGroupId: `group-${g}`,
        serviceId: "brand",
        packageId: "qualified",
        sopVersion: "sop-1",
        originalDueAt: when,
        completedAt: when,
        cancelledAt: null,
        cancellationReason: null,
      });
      for (const [suffix, cents, pack, contract] of [
        ["retainer", retainer, "qualified", "recurring"],
        ["package", packageAmount - retainer, "qualified", null],
        ["custom", amount - packageAmount, null, null],
      ] as const)
        v.recognition.push({
          id: `recognition-${m}-${g}-${suffix}`,
          period: periods[m],
          amountMinor: cents,
          clientGroupId: `group-${g}`,
          serviceId: "brand",
          deliveryId,
          deliveryDate: when,
          packageId: pack,
          sopVersion: pack ? "sop-1" : null,
          contractId: contract,
          provenance: p,
          creditReference: null,
        });
    }
  // Ten September/October deliveries above plus ten commitments below = W90 20, 18 on time.
  for (let i = 0; i < 10; i++)
    v.deliveries.push({
      id: `review-${i}`,
      clientGroupId: `group-${i % 5}`,
      serviceId: "brand",
      packageId: null,
      sopVersion: null,
      originalDueAt: "2026-08-15T00:00:00Z",
      completedAt: i < 8 ? "2026-08-15T00:00:00Z" : null,
      cancelledAt: null,
      cancellationReason: null,
    });
  const yes = {
      value: true,
      sourceIds: ["sample-evidence"],
      note: "Synthetic, owner-attested fixture only",
    },
    no = { ...yes, value: false };
  v.accountableOwner = yes;
  v.humans = [
    {
      id: "founder",
      isFounder: true,
      simulated: false,
      compensationMinor: 400000,
      agreementStart: "2026-04-01T00:00:00Z",
      agreementEnd: null,
      role: "Delivery and review",
      sourceIds: ["human-founder"],
    },
    {
      id: "collaborator-1",
      isFounder: false,
      simulated: false,
      compensationMinor: 250000,
      agreementStart: "2026-04-01T00:00:00Z",
      agreementEnd: null,
      role: "Delivery",
      sourceIds: ["human-1"],
    },
    {
      id: "collaborator-2",
      isFounder: false,
      simulated: false,
      compensationMinor: 100000,
      agreementStart: "2026-04-01T00:00:00Z",
      agreementEnd: null,
      role: "Review",
      sourceIds: ["human-2"],
    },
  ];
  v.backups = [];
  v.capacity = [
    {
      id: "brand",
      period: "2026-11",
      availableHours: 300,
      plannedHours: 210,
      attestedAt: "2026-10-31T00:00:00Z",
      sourceId: "capacity-plan",
      serviceIds: ["brand"],
      humanIds: ["founder", "collaborator-1", "collaborator-2"],
    },
  ];
  v.deliveryHours = [
    {
      humanId: "founder",
      date: "2026-10-15T00:00:00Z",
      hours: 70,
      sourceId: "hours-founder",
    },
    {
      humanId: "collaborator-1",
      date: "2026-10-15T00:00:00Z",
      hours: 30,
      sourceId: "hours-1",
    },
  ];
  v.ip = {
    chainOfTitle: yes,
    assetRegister: yes,
    brandPermissions: yes,
    caseStudies: no,
    inventory: [
      {
        id: "sample-deliverable",
        material: true,
        assignmentOrLicenseRef: "sample-evidence",
        ownerAttested: true,
      },
    ],
    assets: [
      {
        id: "sample-asset",
        rights: "agency_owned",
        sourceId: "sample-evidence",
      },
    ],
    identity: { name: "Moss Studio", permissionSourceIds: ["sample-evidence"] },
    cases: [],
  };
  v.market = {
    segment: "Synthetic small businesses",
    buyer: "Owner",
    geography: "Fictional demo region",
    problem: "Coherent creative delivery",
    interviews: Array.from({ length: 5 }, (_, i) => ({
      organization: `buyer-${i}`,
      date: "2026-10-01T00:00:00Z",
      problem: "Sample problem",
      budget: "Sample entered budget",
      alternatives: "Sample alternative",
      sourceId: `interview-${i}`,
    })),
    alternatives: Array.from({ length: 3 }, (_, i) => ({
      id: `alternative-${i}`,
      priceMinor: 10000,
      sourceUrl: `https://example.test/alternative-${i}`,
      checkedAt: "2026-10-01T00:00:00Z",
    })),
    model: null,
    modelAssessed: true,
  };
  return readinessSchema.parse(v);
}
