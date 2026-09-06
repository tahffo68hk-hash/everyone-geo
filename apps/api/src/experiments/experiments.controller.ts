import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ExperimentsService } from "./experiments.service";
import { CreateExecutionDto } from "./dto/create-execution.dto";
import { UpdateExperimentStatusDto } from "./dto/update-experiment-status.dto";

/**
 * M7D Optimization Experiment & Re-test API（auth + tenant + DB isolation）。
 * 注：@nestjs/swagger 为 ESM-only，只在 main.ts 运行时启用，模块图不引入装饰器（与 M6–M7C 同风格）。
 */
@Controller()
@UseGuards(AuthGuard)
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  /** 为 ContentOpportunity 创建 Optimization Experiment（幂等：同 opportunity+version+baseline 返回既有）。 */
  @Post("content-opportunities/:id/experiments")
  @HttpCode(201)
  create(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.createFromOpportunity(user.sub, id);
  }

  @Get("content-opportunities/:id/experiments")
  listByOpportunity(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.listByOpportunity(user.sub, id);
  }

  @Get("experiments/:id")
  get(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.getExperiment(user.sub, id);
  }

  @Get("experiments/:id/executions")
  executions(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.executions(user.sub, id);
  }

  @Post("experiments/:id/executions")
  @HttpCode(201)
  recordExecution(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateExecutionDto) {
    return this.experiments.recordExecution(user.sub, id, dto);
  }

  /** Re-test 计划预览（只读；不产生调用）。 */
  @Post("experiments/:id/retest-plan")
  retestPlan(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.retestPlan(user.sub, id);
  }

  /** 开始 Frozen Re-test（走既有 Benchmark pipeline；Demo=Mock 0 成本；Real 受 cost guard）。 */
  @Post("experiments/:id/retests")
  @HttpCode(201)
  createRetest(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.createRetest(user.sub, id);
  }

  @Get("experiments/:id/retests")
  retests(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.retests(user.sub, id);
  }

  @Get("experiment-retests/:id")
  getRetest(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.getRetest(user.sub, id);
  }

  @Post("experiment-retests/:id/evaluate")
  @HttpCode(201)
  evaluate(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.evaluateRetest(user.sub, id);
  }

  @Get("experiments/:id/evaluations")
  evaluations(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.evaluations(user.sub, id);
  }

  @Get("experiment-evaluations/:id")
  getEvaluation(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.getEvaluation(user.sub, id);
  }

  @Get("experiment-evaluations/:id/metric-deltas")
  metricDeltas(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.metricDeltas(user.sub, id);
  }

  @Get("experiment-evaluations/:id/query-deltas")
  queryDeltas(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.queryDeltas(user.sub, id);
  }

  @Get("experiment-query-deltas/:id/evidence")
  queryDeltaEvidence(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.experiments.queryDeltaEvidence(user.sub, id);
  }

  @Patch("experiments/:id/status")
  updateStatus(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateExperimentStatusDto) {
    return this.experiments.updateStatus(user.sub, id, dto);
  }
}
