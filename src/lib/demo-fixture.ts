// Public synthetic fixture, not real customer data. IDs reserve the reset boundary.
export const demoFixture = {
  version: "local-demo-v1",
  userId: "seedee-demo-user-v1",
  agencyId: "seedee-demo-agency-v1",
  email: "demo@seedee.local",
  password: "SeedeeDemo!2026",
  name: "Alex Creative",
  agencyName: "Fieldwork Studio",
  agencyDescription:
    "A fictional brand and digital design studio. Sample data for exploring Seedee.",
} as const;
