import { Module } from "@nestjs/common";
import { BenchmarkModule } from "../benchmark/benchmark.module";
import { ReportsModule } from "../reports/reports.module";
import { ExperimentsController } from "./experiments.controller";
import { ExperimentsService } from "./experiments.service";

@Module({
  imports: [BenchmarkModule, ReportsModule],
  controllers: [ExperimentsController],
  providers: [ExperimentsService],
})
export class ExperimentsModule {}
