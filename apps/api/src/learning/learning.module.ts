import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { TenantService } from "../common/tenant.service";
import { LearningController } from "./learning.controller";
import { LearningService } from "./learning.service";

@Module({
  imports: [PrismaModule],
  controllers: [LearningController],
  providers: [LearningService, TenantService],
  exports: [LearningService],
})
export class LearningModule {}
