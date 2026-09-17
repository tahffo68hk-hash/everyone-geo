import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { AuthModule } from "../auth/auth.module";
import { ContentStrategyModule } from "../content-strategy/content-strategy.module";
import { ContentCampaignController } from "./content-campaign.controller";
import { ContentCampaignService } from "./content-campaign.service";

@Module({
  imports: [PrismaModule, AuthModule, ContentStrategyModule],
  controllers: [ContentCampaignController],
  providers: [ContentCampaignService],
  exports: [ContentCampaignService],
})
export class ContentCampaignModule {}
