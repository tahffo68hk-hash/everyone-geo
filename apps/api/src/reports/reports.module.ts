import { Module } from "@nestjs/common";
import { BenchmarkModule } from "../benchmark/benchmark.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [BenchmarkModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
