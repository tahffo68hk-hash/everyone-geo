import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma.module";
import { HealthController } from "./health.controller";
import { QuickStartModule } from "./quick-start/quick-start.module";

@Module({
  imports: [PrismaModule, QuickStartModule],
  controllers: [HealthController],
})
export class AppModule {}
