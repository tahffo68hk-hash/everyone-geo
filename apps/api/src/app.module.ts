import { Module } from "@nestjs/common";
import { MonitorTasksModule } from "./monitor-tasks/monitor-tasks.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma.module";
import { HealthController } from "./health.controller";
import { EvidenceModule } from "./evidence/evidence.module";
import { BenchmarkModule } from "./benchmark/benchmark.module";
import { CompetitorsModule } from "./competitors/competitors.module";
import { ReportsModule } from "./reports/reports.module";
import { DiagnosisModule } from "./diagnosis/diagnosis.module";
import { RecommendationsModule } from "./recommendations/recommendations.module";
import { OpportunitiesModule } from "./opportunities/opportunities.module";
import { ExperimentsModule } from "./experiments/experiments.module";

@Module({
  imports: [PrismaModule, AuthModule, OrganizationsModule, MonitorTasksModule, EvidenceModule, BenchmarkModule, CompetitorsModule, ReportsModule, DiagnosisModule, RecommendationsModule, OpportunitiesModule, ExperimentsModule],
  controllers: [HealthController],
})
export class AppModule {}
