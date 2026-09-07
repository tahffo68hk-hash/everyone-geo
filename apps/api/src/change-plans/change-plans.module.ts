import { Module } from "@nestjs/common";
import { ChangePlansController } from "./change-plans.controller";
import { ChangePlansService } from "./change-plans.service";

@Module({
  controllers: [ChangePlansController],
  providers: [ChangePlansService],
  exports: [ChangePlansService],
})
export class ChangePlansModule {}
