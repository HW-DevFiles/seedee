-- CreateTable
CREATE TABLE "OnboardingDraft" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OnboardingDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgencyDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "onboardingVersion" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "providerVersion" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "version" INTEGER NOT NULL DEFAULT 1,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgencyDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgencyEngineState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgencyEngineState_id_fkey" FOREIGN KEY ("id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgencyEngineState_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationState" (
    "agencyId" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 0,
    "stateJson" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutomationState_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServicePackage" (
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

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "economicGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "archivedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Client_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
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
    CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
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
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,

    PRIMARY KEY ("taskId", "predecessorId"),
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectCloseout" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "deliveryDate" DATETIME NOT NULL,
    "recognizedRevenueMinor" INTEGER,
    "receiptsMinor" INTEGER,
    "deliveryCostMinor" INTEGER,
    "founderLaborHours" REAL,
    "founderCostTreatment" TEXT NOT NULL,
    "repeatabilityNotes" TEXT NOT NULL,
    "recurrenceType" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectCloseout_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancialActualPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sourceMode" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FinancialActualPeriod_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "sourceRecordId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvidenceItem_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "asOf" DATETIME NOT NULL,
    "evaluatedAt" DATETIME NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinanceSnapshot_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataRoomItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'missing',
    "note" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "evidenceIds" JSONB NOT NULL,
    "period" TEXT,
    "reviewedAt" DATETIME,
    "ownerLabel" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DataRoomItem_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExportSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "markdown" TEXT NOT NULL,
    "csv" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExportSnapshot_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "correlationKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityEvent_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
INSERT INTO "new_Agency" ("createdAt", "description", "id", "name", "ownerId", "updatedAt") SELECT "createdAt", "description", "id", "name", "ownerId", "updatedAt" FROM "Agency";
DROP TABLE "Agency";
ALTER TABLE "new_Agency" RENAME TO "Agency";
CREATE UNIQUE INDEX "Agency_ownerId_key" ON "Agency"("ownerId");
CREATE UNIQUE INDEX "Agency_acceptedDraftId_key" ON "Agency"("acceptedDraftId");
CREATE UNIQUE INDEX "Agency_acceptanceKey_key" ON "Agency"("acceptanceKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AgencyDraft_userId_createdAt_idx" ON "AgencyDraft"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyEngineState_agencyId_key" ON "AgencyEngineState"("agencyId");

-- CreateIndex
CREATE INDEX "ServicePackage_agencyId_archivedAt_idx" ON "ServicePackage"("agencyId", "archivedAt");

-- CreateIndex
CREATE INDEX "Client_agencyId_archivedAt_idx" ON "Client"("agencyId", "archivedAt");

-- CreateIndex
CREATE INDEX "Client_agencyId_economicGroupId_idx" ON "Client"("agencyId", "economicGroupId");

-- CreateIndex
CREATE INDEX "Project_agencyId_status_archivedAt_idx" ON "Project"("agencyId", "status", "archivedAt");

-- CreateIndex
CREATE INDEX "Task_agencyId_status_dueAt_idx" ON "Task"("agencyId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "ProjectCloseout_agencyId_deliveryDate_idx" ON "ProjectCloseout"("agencyId", "deliveryDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialActualPeriod_agencyId_yearMonth_key" ON "FinancialActualPeriod"("agencyId", "yearMonth");

-- CreateIndex
CREATE INDEX "EvidenceItem_agencyId_category_idx" ON "EvidenceItem"("agencyId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceItem_agencyId_sourceRecordId_metricKey_key" ON "EvidenceItem"("agencyId", "sourceRecordId", "metricKey");

-- CreateIndex
CREATE INDEX "FinanceSnapshot_agencyId_kind_createdAt_idx" ON "FinanceSnapshot"("agencyId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "DataRoomItem_agencyId_category_idx" ON "DataRoomItem"("agencyId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ExportSnapshot_agencyId_idempotencyKey_key" ON "ExportSnapshot"("agencyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ActivityEvent_agencyId_createdAt_idx" ON "ActivityEvent"("agencyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityEvent_agencyId_correlationKey_key" ON "ActivityEvent"("agencyId", "correlationKey");
