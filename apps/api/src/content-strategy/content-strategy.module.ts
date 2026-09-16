import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { AuthModule } from "../auth/auth.module";
import { ContentStrategyController } from "./content-strategy.controller";
import { ContentStrategyService } from "./content-strategy.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ContentStrategyController],
  providers: [ContentStrategyService],
  exports: [ContentStrategyService],
})
export class ContentStrategyModule {}
