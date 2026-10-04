import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { TenantService } from "../common/tenant.service";
import { AiGatewayService } from "./ai-gateway.service";
import { AiAuditService } from "./ai-audit.service";
import { AiService } from "./ai.service";
import { AiController } from "./ai.controller";

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [AiGatewayService, AiAuditService, AiService, TenantService],
  exports: [AiGatewayService, AiAuditService, AiService],
})
export class AiModule {}

