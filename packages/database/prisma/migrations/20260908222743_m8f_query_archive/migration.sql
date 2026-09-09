-- R2: add soft-archive flag to BenchmarkQuery (does not touch historical snapshots)
ALTER TABLE "BenchmarkQuery" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
