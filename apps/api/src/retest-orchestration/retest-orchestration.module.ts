import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { TenantService } from "../common/tenant.service";
import { RetestOrchestrationController } from "./retest-orchestration.controller";
import { RetestOrchestrationService } from "./retest-orchestration.service";

@Module({
  imports: [PrismaModule],
  controllers: [RetestOrchestrationController],
  providers: [RetestOrchestrationService, TenantService],
  exports: [RetestOrchestrationService],
})
export class RetestOrchestrationModule {}
