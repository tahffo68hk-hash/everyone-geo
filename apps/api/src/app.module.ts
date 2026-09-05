import { Module } from "@nestjs/common";
import { MonitorTasksModule } from "./monitor-tasks/monitor-tasks.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [PrismaModule, AuthModule, OrganizationsModule, MonitorTasksModule],
  controllers: [HealthController],
})
export class AppModule {}
