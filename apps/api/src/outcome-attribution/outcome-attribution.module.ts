import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { TenantService } from "../common/tenant.service";
import { OutcomeAttributionController } from "./outcome-attribution.controller";
import { OutcomeAttributionService } from "./outcome-attribution.service";

@Module({
  imports: [PrismaModule],
  controllers: [OutcomeAttributionController],
  providers: [OutcomeAttributionService, TenantService],
  exports: [OutcomeAttributionService],
})
export class OutcomeAttributionModule {}
