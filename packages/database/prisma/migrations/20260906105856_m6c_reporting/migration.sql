-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "requestedModel" TEXT,
ADD COLUMN     "responseModel" TEXT;

-- CreateTable
CREATE TABLE "BenchmarkReport" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "benchmarkRunId" UUID NOT NULL,
    "runType" "BenchmarkRunType" NOT NULL,
    "suiteName" TEXT NOT NULL,
    "suiteVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "engineKey" TEXT NOT NULL,
    "engineName" TEXT NOT NULL,
    "requestedModel" TEXT,
    "responseModel" TEXT,
    "metricSource" TEXT NOT NULL,
    "analysisVersion" TEXT NOT NULL,
    "competitorSetId" UUID,
    "competitorSetName" TEXT,
    "competitorSetVersion" TEXT,
    "completedRuns" INTEGER NOT NULL,
    "succeededRuns" INTEGER NOT NULL,
    "failedRuns" INTEGER NOT NULL,
    "analyzedRuns" INTEGER NOT NULL,
    "partial" BOOLEAN NOT NULL,
    "metricsSnapshot" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BenchmarkReport_projectId_generatedAt_idx" ON "BenchmarkReport"("projectId", "generatedAt");

-- CreateIndex
CREATE INDEX "BenchmarkReport_benchmarkRunId_generatedAt_idx" ON "BenchmarkReport"("benchmarkRunId", "generatedAt");

-- CreateIndex
CREATE INDEX "BenchmarkReport_projectId_analysisVersion_idx" ON "BenchmarkReport"("projectId", "analysisVersion");

-- AddForeignKey
ALTER TABLE "BenchmarkReport" ADD CONSTRAINT "BenchmarkReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkReport" ADD CONSTRAINT "BenchmarkReport_benchmarkRunId_fkey" FOREIGN KEY ("benchmarkRunId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- M6C 历史 Model Identity 安全回填（受控数据迁移，不猜历史）
-- 原则：只有从代码路径 100% 可证明的值才回填，否则保持 NULL（UI 显示
-- 「历史记录未保存 / 未知」），严禁用当前 Engine 配置猜历史请求模型。
--   a) provider='mock'：MockProvider 恒以 'geolens-mock' 作为请求与响应身份
--      （代码常量，与 Engine 配置无关）→ requested/response 均可证明。
--   b) provider='deepseek'：responseModel 仅在 metadata.rawProviderPayload 回显的
--      model 与 Evidence.model 一致时回填（= Provider 实际声明）；requestedModel
--      从不可变的 rawPrompt JSON 中读取实际发送的 model（'{"model":...' 结构），
--      无法解析/不在该结构内则保持 NULL。
-- Evidence immutable trigger（evidence_immutable）在迁移事务内临时禁用。
-- ============================================================
ALTER TABLE "Evidence" DISABLE TRIGGER evidence_immutable;

-- b) deepseek：先回填 requestedModel（rawPrompt 为可证明的不可变发送记录）
UPDATE "Evidence"
SET "requestedModel" = ("rawPrompt"::jsonb->>'model')
WHERE provider = 'deepseek'
  AND "rawPrompt" LIKE '{"model":%'
  AND ("rawPrompt"::jsonb->>'model') IS NOT NULL
  AND ("rawPrompt"::jsonb->>'model') <> '';

-- b) deepseek：responseModel 仅在 Provider 回显（rawProviderPayload.model =
--    Evidence.model）时成立（= 响应中实际声明的模型）；否则保持 NULL。
UPDATE "Evidence"
SET "responseModel" = "model"
WHERE provider = 'deepseek'
  AND ("metadata"->'rawProviderPayload'->>'model') = "model";

-- a) mock：请求/响应身份均为 mock 常量 'geolens-mock'（代码可证明）
UPDATE "Evidence"
SET "requestedModel" = 'geolens-mock', "responseModel" = 'geolens-mock'
WHERE provider = 'mock'
  AND ("requestedModel" IS NULL OR "responseModel" IS NULL);

ALTER TABLE "Evidence" ENABLE TRIGGER evidence_immutable;
