import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { DiagnosisService } from "./diagnosis.service";
import { CreateDiagnosisDto } from "./dto/create-diagnosis.dto";

/**
 * M7A GEO Diagnosis API（auth + tenant ownership + DB isolation）。
 * 注：@nestjs/swagger 为 ESM-only，只在 main.ts 运行时启用，模块图不引入装饰器。
 */
@Controller()
@UseGuards(AuthGuard)
export class DiagnosisController {
  constructor(private readonly diagnosis: DiagnosisService) {}

  /** 为一份已完成 Benchmark Report 生成 GEO 问题诊断（绑定 Report 快照；幂等）。 */
  @Post("reports/:reportId/diagnoses")
  @HttpCode(201)
  create(
    @CurrentUser() user: JwtUserPayload,
    @Param("reportId", ParseUUIDPipe) reportId: string,
    @Body() dto: CreateDiagnosisDto,
  ) {
    return this.diagnosis.createDiagnosis(user.sub, reportId, dto);
  }

  @Get("reports/:reportId/diagnoses")
  listByReport(@CurrentUser() user: JwtUserPayload, @Param("reportId", ParseUUIDPipe) reportId: string) {
    return this.diagnosis.listByReport(user.sub, reportId);
  }

  @Get("diagnoses/:id")
  get(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.diagnosis.get(user.sub, id);
  }

  @Get("diagnoses/:id/findings")
  findings(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.diagnosis.findings(user.sub, id);
  }

  @Get("diagnosis-findings/:id")
  getFinding(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.diagnosis.getFinding(user.sub, id);
  }

  @Get("diagnosis-findings/:id/evidence")
  findingEvidence(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.diagnosis.findingEvidence(user.sub, id);
  }
}
