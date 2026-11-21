import assert from "node:assert/strict";
import { createDatabase } from "../src/lib/db-client";
import { readEnvironment } from "../src/lib/env";
import { demoFixture } from "../src/lib/demo-fixture";

const env = readEnvironment();
assert.equal(env.NODE_ENV, "development");
const db = createDatabase(env.DATABASE_URL);
try {
  const user = await db.user.findUniqueOrThrow({
    where: { id: demoFixture.userId },
  });
  const agency = await db.agency.findUniqueOrThrow({
    where: { ownerId: user.id },
  });
  assert.equal(agency.id, demoFixture.agencyId);
  if (process.argv[2] === "create") {
    await db.user.create({
      data: {
        email: "container-restart@example.test",
        name: "Persisted across restart",
        passwordHash: user.passwordHash,
      },
    });
  } else {
    assert.equal(
      (
        await db.user.findUniqueOrThrow({
          where: { email: "container-restart@example.test" },
        })
      ).name,
      "Persisted across restart",
    );
  }
  console.log("Container sample and persistence probe passed.");
} finally {
  await db.$disconnect();
}
