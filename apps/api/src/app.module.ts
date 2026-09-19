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
import { ContentCampaignModule } from "./content-campaign/content-campaign.module";
import { RetestOrchestrationModule } from "./retest-orchestration/retest-orchestration.module";
import { OutcomeComparisonModule } from "./outcome-comparison/outcome-comparison.module";
import { OutcomeAttributionModule } from "./outcome-attribution/outcome-attribution.module";
import { LearningModule } from "./learning/learning.module";

@Module({
  imports: [PrismaModule, AuthModule, OrganizationsModule, MonitorTasksModule, EvidenceModule, BenchmarkModule, CompetitorsModule, ReportsModule, DiagnosisModule, RecommendationsModule, OpportunitiesModule, ExperimentsModule, SitesModule, ChangePlansModule, PilotReviewsModule, QueryWorkspaceModule, ManualMeasurementsModule, ActivityModule, ContentExecutionModule, ContentStrategyModule, ContentCampaignModule, RetestOrchestrationModule, OutcomeComparisonModule, OutcomeAttributionModule, LearningModule],
  controllers: [HealthController],
})
export class AppModule {}
