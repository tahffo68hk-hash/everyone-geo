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
import { SitesModule } from "./sites/sites.module";
import { ChangePlansModule } from "./change-plans/change-plans.module";
import { PilotReviewsModule } from "./pilot-reviews/pilot-reviews.module";
import { QueryWorkspaceModule } from "./query-workspace/query-workspace.module";
import { ManualMeasurementsModule } from "./manual-measurements/manual-measurements.module";
import { ActivityModule } from "./activity/activity.module";
import { ContentExecutionModule } from "./content-execution/content-execution.module";
import { ContentStrategyModule } from "./content-strategy/content-strategy.module";

@Module({
  imports: [PrismaModule, AuthModule, OrganizationsModule, MonitorTasksModule, EvidenceModule, BenchmarkModule, CompetitorsModule, ReportsModule, DiagnosisModule, RecommendationsModule, OpportunitiesModule, ExperimentsModule, SitesModule, ChangePlansModule, PilotReviewsModule, QueryWorkspaceModule, ManualMeasurementsModule, ActivityModule, ContentExecutionModule, ContentStrategyModule],
  controllers: [HealthController],
})
export class AppModule {}
