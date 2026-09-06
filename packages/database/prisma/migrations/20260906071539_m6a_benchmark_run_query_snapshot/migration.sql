-- CreateTable
CREATE TABLE "BenchmarkRunQuery" (
    "id" UUID NOT NULL,
    "benchmarkRunId" UUID NOT NULL,
    "benchmarkQueryId" UUID NOT NULL,
    "projectQueryId" UUID NOT NULL,
    "queryText" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL,
    "sanity" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BenchmarkRunQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BenchmarkRunQuery_benchmarkRunId_idx" ON "BenchmarkRunQuery"("benchmarkRunId");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkRunQuery_benchmarkRunId_sortOrder_key" ON "BenchmarkRunQuery"("benchmarkRunId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkRunQuery_benchmarkRunId_projectQueryId_key" ON "BenchmarkRunQuery"("benchmarkRunId", "projectQueryId");

-- AddForeignKey
ALTER TABLE "BenchmarkRunQuery" ADD CONSTRAINT "BenchmarkRunQuery_benchmarkRunId_fkey" FOREIGN KEY ("benchmarkRunId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
