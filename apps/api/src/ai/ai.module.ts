import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { TenantService } from "../common/tenant.service";
import { AiGatewayService } from "./ai-gateway.service";
import { AiService } from "./ai.service";
import { AiController } from "./ai.controller";

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [AiGatewayService, AiService, TenantService],
  exports: [AiGatewayService, AiService],
})
export class AiModule {}
