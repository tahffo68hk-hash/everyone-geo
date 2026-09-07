import { Module } from "@nestjs/common";
import { ManualMeasurementsController } from "./manual-measurements.controller";
import { ManualMeasurementsService } from "./manual-measurements.service";

@Module({
  controllers: [ManualMeasurementsController],
  providers: [ManualMeasurementsService],
})
export class ManualMeasurementsModule {}
