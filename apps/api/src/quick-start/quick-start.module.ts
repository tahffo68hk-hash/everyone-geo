import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma.module";
import { AiGatewayService } from "./ai-gateway.service";
import { DistributionService } from "./distribution.service";
import { QuickStartController } from "./quick-start.controller";
import { QuickStartService } from "./quick-start.service";
import {
  DistributionController,
  ReportContentController,
} from "./report-content.controller";
import { ReportContentService } from "./report-content.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    QuickStartController,
    ReportContentController,
    DistributionController,
  ],
  providers: [AiGatewayService, QuickStartService, ReportContentService, DistributionService],
  exports: [AiGatewayService, QuickStartService, ReportContentService, DistributionService],
})
export class QuickStartModule {}
