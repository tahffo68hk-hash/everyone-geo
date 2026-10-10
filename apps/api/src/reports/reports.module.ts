import { Module } from "@nestjs/common";
import { BenchmarkModule } from "../benchmark/benchmark.module";
import { ReportsController } from "./reports.controller";
import { PublicReportsController } from "./public-reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [BenchmarkModule],
  controllers: [ReportsController, PublicReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})

export class ReportsModule {}
