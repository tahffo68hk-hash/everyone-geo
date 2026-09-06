import { Module } from "@nestjs/common";
import { ReportsModule } from "../reports/reports.module";
import { DiagnosisController } from "./diagnosis.controller";
import { DiagnosisService } from "./diagnosis.service";

@Module({
  imports: [ReportsModule],
  controllers: [DiagnosisController],
  providers: [DiagnosisService],
})
export class DiagnosisModule {}
