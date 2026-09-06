-- CreateEnum
CREATE TYPE "BenchmarkSuiteStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "BenchmarkRunType" AS ENUM ('DEMO', 'REAL');

-- CreateTable
CREATE TABLE "BenchmarkSuite" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "status" "BenchmarkSuiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkSuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkQuery" (
    "id" UUID NOT NULL,
    "suiteId" UUID NOT NULL,
    "projectQueryId" UUID,
    "queryText" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sanity" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "suiteId" UUID NOT NULL,
    "suiteName" TEXT NOT NULL,
    "suiteVersion" TEXT NOT NULL,
    "runType" "BenchmarkRunType" NOT NULL DEFAULT 'DEMO',
    "provider" TEXT NOT NULL,
    "engineId" UUID NOT NULL,
    "monitorTaskId" UUID NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "plannedRuns" INTEGER NOT NULL,
    "completedRuns" INTEGER NOT NULL DEFAULT 0,
    "failedRuns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "BenchmarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BenchmarkSuite_projectId_status_idx" ON "BenchmarkSuite"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkSuite_projectId_name_version_key" ON "BenchmarkSuite"("projectId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkQuery_projectQueryId_key" ON "BenchmarkQuery"("projectQueryId");

-- CreateIndex
CREATE INDEX "BenchmarkQuery_suiteId_enabled_idx" ON "BenchmarkQuery"("suiteId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkQuery_suiteId_sortOrder_key" ON "BenchmarkQuery"("suiteId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkRun_monitorTaskId_key" ON "BenchmarkRun"("monitorTaskId");

-- CreateIndex
CREATE INDEX "BenchmarkRun_projectId_createdAt_idx" ON "BenchmarkRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BenchmarkRun_suiteId_createdAt_idx" ON "BenchmarkRun"("suiteId", "createdAt");

-- CreateIndex
CREATE INDEX "BenchmarkRun_organizationId_createdAt_idx" ON "BenchmarkRun"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "BenchmarkSuite" ADD CONSTRAINT "BenchmarkSuite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkQuery" ADD CONSTRAINT "BenchmarkQuery_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "BenchmarkSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkQuery" ADD CONSTRAINT "BenchmarkQuery_projectQueryId_fkey" FOREIGN KEY ("projectQueryId") REFERENCES "Query"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "BenchmarkSuite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "Engine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_monitorTaskId_fkey" FOREIGN KEY ("monitorTaskId") REFERENCES "MonitorTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
