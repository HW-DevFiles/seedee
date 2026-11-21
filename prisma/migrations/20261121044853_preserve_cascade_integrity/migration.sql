-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "positioning" TEXT NOT NULL DEFAULT '',
    "buyer" TEXT NOT NULL DEFAULT '',
    "practices" JSONB NOT NULL DEFAULT '[]',
    "goal" TEXT NOT NULL DEFAULT '',
    "weeklyCapacityHours" REAL,
    "sampleWorkspace" BOOLEAN NOT NULL DEFAULT false,
    "acceptedDraftId" TEXT,
    "acceptanceKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rolesAndWorkflows" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Agency_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Agency" ("acceptanceKey", "acceptedDraftId", "buyer", "createdAt", "currency", "description", "goal", "id", "name", "ownerId", "positioning", "practices", "rolesAndWorkflows", "sampleWorkspace", "timezone", "updatedAt", "version", "weeklyCapacityHours") SELECT "acceptanceKey", "acceptedDraftId", "buyer", "createdAt", "currency", "description", "goal", "id", "name", "ownerId", "positioning", "practices", "rolesAndWorkflows", "sampleWorkspace", "timezone", "updatedAt", "version", "weeklyCapacityHours" FROM "Agency";
DROP TABLE "Agency";
ALTER TABLE "new_Agency" RENAME TO "Agency";
CREATE UNIQUE INDEX "Agency_ownerId_key" ON "Agency"("ownerId");
CREATE UNIQUE INDEX "Agency_acceptedDraftId_key" ON "Agency"("acceptedDraftId");
CREATE UNIQUE INDEX "Agency_acceptanceKey_key" ON "Agency"("acceptanceKey");
CREATE TABLE "new_AgencyEngineState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgencyEngineState_id_fkey" FOREIGN KEY ("id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgencyEngineState_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgencyEngineState" ("agencyId", "id", "payload", "updatedAt", "version") SELECT "agencyId", "id", "payload", "updatedAt", "version" FROM "AgencyEngineState";
DROP TABLE "AgencyEngineState";
ALTER TABLE "new_AgencyEngineState" RENAME TO "AgencyEngineState";
CREATE UNIQUE INDEX "AgencyEngineState_agencyId_key" ON "AgencyEngineState"("agencyId");
CREATE TABLE "new_AutomationState" (
    "agencyId" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 0,
    "stateJson" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutomationState_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AutomationState" ("agencyId", "stateJson", "updatedAt", "version") SELECT "agencyId", "stateJson", "updatedAt", "version" FROM "AutomationState";
DROP TABLE "AutomationState";
ALTER TABLE "new_AutomationState" RENAME TO "AutomationState";
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT,
    "packageId" TEXT,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "dueAt" DATETIME,
    "budgetMinor" INTEGER,
    "archivedAt" DATETIME,
    "completedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "Project_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("agencyId", "archivedAt", "brief", "budgetMinor", "clientId", "completedAt", "createdAt", "dueAt", "id", "packageId", "status", "title", "updatedAt", "version") SELECT "agencyId", "archivedAt", "brief", "budgetMinor", "clientId", "completedAt", "createdAt", "dueAt", "id", "packageId", "status", "title", "updatedAt", "version" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_agencyId_status_archivedAt_idx" ON "Project"("agencyId", "status", "archivedAt");
CREATE TABLE "new_ServicePackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "deliverables" JSONB NOT NULL,
    "exclusions" JSONB NOT NULL,
    "revisionLimit" INTEGER NOT NULL,
    "turnaroundDays" INTEGER NOT NULL,
    "laborHours" REAL NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "freeSample" BOOLEAN NOT NULL DEFAULT false,
    "pricingBasis" JSONB NOT NULL,
    "sopVersion" TEXT,
    "sopCreatedAt" DATETIME,
    "acceptanceChecklist" JSONB NOT NULL DEFAULT '[]',
    "archivedAt" DATETIME,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServicePackage_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ServicePackage" ("acceptanceChecklist", "agencyId", "archivedAt", "createdAt", "currency", "deliverables", "draft", "exclusions", "freeSample", "id", "laborHours", "priceMinor", "pricingBasis", "revisionLimit", "sopCreatedAt", "sopVersion", "title", "turnaroundDays", "updatedAt", "version") SELECT "acceptanceChecklist", "agencyId", "archivedAt", "createdAt", "currency", "deliverables", "draft", "exclusions", "freeSample", "id", "laborHours", "priceMinor", "pricingBasis", "revisionLimit", "sopCreatedAt", "sopVersion", "title", "turnaroundDays", "updatedAt", "version" FROM "ServicePackage";
DROP TABLE "ServicePackage";
ALTER TABLE "new_ServicePackage" RENAME TO "ServicePackage";
CREATE INDEX "ServicePackage_agencyId_archivedAt_idx" ON "ServicePackage"("agencyId", "archivedAt");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "input" TEXT NOT NULL DEFAULT '',
    "assignedRoleKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "dueAt" DATETIME,
    "originalCommittedDueAt" DATETIME,
    "dueDateHistory" JSONB NOT NULL DEFAULT '[]',
    "acceptedAt" DATETIME,
    "cancellationRecord" JSONB,
    "approvedArtifact" JSONB,
    "reviewNeeded" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("acceptedAt", "agencyId", "approvedArtifact", "assignedRoleKey", "cancellationRecord", "createdAt", "dueAt", "dueDateHistory", "id", "input", "originalCommittedDueAt", "priority", "projectId", "reviewNeeded", "status", "title", "updatedAt", "version") SELECT "acceptedAt", "agencyId", "approvedArtifact", "assignedRoleKey", "cancellationRecord", "createdAt", "dueAt", "dueDateHistory", "id", "input", "originalCommittedDueAt", "priority", "projectId", "reviewNeeded", "status", "title", "updatedAt", "version" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_agencyId_status_dueAt_idx" ON "Task"("agencyId", "status", "dueAt");
CREATE TABLE "new_TaskDependency" (
    "taskId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,

    PRIMARY KEY ("taskId", "predecessorId"),
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "Task" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_TaskDependency" ("predecessorId", "taskId") SELECT "predecessorId", "taskId" FROM "TaskDependency";
DROP TABLE "TaskDependency";
ALTER TABLE "new_TaskDependency" RENAME TO "TaskDependency";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
