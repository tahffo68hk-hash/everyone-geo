-- CreateEnum
CREATE TYPE "DiagnosisSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateTable
CREATE TABLE "DiagnosisRun" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "diagnosisVersion" TEXT NOT NULL,
    "secondaryReportId" UUID,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "summarySnapshot" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosisFinding" (
    "id" UUID NOT NULL,
    "diagnosisRunId" UUID NOT NULL,
    "findingType" TEXT NOT NULL,
    "severity" "DiagnosisSeverity" NOT NULL,
    "category" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "metricName" TEXT,
    "currentValue" DOUBLE PRECISION,
    "referenceValue" DOUBLE PRECISION,
    "queryCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "requestedModel" TEXT,
    "responseModel" TEXT,
    "competitorName" TEXT,
    "priorityScore" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosisFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosisFindingEvidence" (
    "id" UUID NOT NULL,
    "findingId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "queryTextSnapshot" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosisFindingEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiagnosisRun_projectId_generatedAt_idx" ON "DiagnosisRun"("projectId", "generatedAt");

-- CreateIndex
CREATE INDEX "DiagnosisRun_reportId_generatedAt_idx" ON "DiagnosisRun"("reportId", "generatedAt");

-- CreateIndex
CREATE INDEX "DiagnosisRun_reportId_diagnosisVersion_secondaryReportId_idx" ON "DiagnosisRun"("reportId", "diagnosisVersion", "secondaryReportId");

-- CreateIndex
CREATE INDEX "DiagnosisFinding_diagnosisRunId_severity_idx" ON "DiagnosisFinding"("diagnosisRunId", "severity");

-- CreateIndex
CREATE INDEX "DiagnosisFinding_diagnosisRunId_findingType_idx" ON "DiagnosisFinding"("diagnosisRunId", "findingType");

-- CreateIndex
CREATE INDEX "DiagnosisFindingEvidence_findingId_idx" ON "DiagnosisFindingEvidence"("findingId");

-- CreateIndex
CREATE INDEX "DiagnosisFindingEvidence_evidenceId_idx" ON "DiagnosisFindingEvidence"("evidenceId");

-- AddForeignKey
ALTER TABLE "DiagnosisRun" ADD CONSTRAINT "DiagnosisRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosisFinding" ADD CONSTRAINT "DiagnosisFinding_diagnosisRunId_fkey" FOREIGN KEY ("diagnosisRunId") REFERENCES "DiagnosisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosisFindingEvidence" ADD CONSTRAINT "DiagnosisFindingEvidence_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "DiagnosisFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
