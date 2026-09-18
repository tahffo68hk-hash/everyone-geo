import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { TenantService } from "../common/tenant.service";
import { OutcomeComparisonController } from "./outcome-comparison.controller";
import { OutcomeComparisonService } from "./outcome-comparison.service";

@Module({
  imports: [PrismaModule],
  controllers: [OutcomeComparisonController],
  providers: [OutcomeComparisonService, TenantService],
  exports: [OutcomeComparisonService],
})
export class OutcomeComparisonModule {}
