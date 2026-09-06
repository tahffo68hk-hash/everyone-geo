import { Module } from "@nestjs/common";
import { BenchmarkModule } from "../benchmark/benchmark.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [BenchmarkModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService], // M7A Diagnosis 复用 compare 语义（Provider Gap compatibility）
})
export class ReportsModule {}
