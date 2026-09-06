import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { BenchmarkService } from "./benchmark.service";
import { CreateBenchmarkSuiteDto } from "./dto/create-benchmark-suite.dto";
import { StartBenchmarkRunDto } from "./dto/start-benchmark-run.dto";

/**
 * M6A Benchmark API（auth + org/project ownership + DB isolation 全部经
 * AuthGuard / TenantService 校验；跨租户一律 404 不泄露存在性）。
 * 注：@nestjs/swagger 为 ESM-only 包，仅在 main.ts 运行时启用（Node>=22 支持
 * require(esm)），模块图不引入装饰器，避免 jest CJS 链路被拖入。
 */
@Controller()
@UseGuards(AuthGuard)
export class BenchmarkController {
  constructor(private readonly benchmark: BenchmarkService) {}

  @Get("projects/:projectId/benchmark-suites")
  listSuites(@CurrentUser() user: JwtUserPayload, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.benchmark.listSuites(user.sub, projectId);
  }

  @Post("projects/:projectId/benchmark-suites")
  @HttpCode(201)
  createSuite(
    @CurrentUser() user: JwtUserPayload,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() dto: CreateBenchmarkSuiteDto,
  ) {
    return this.benchmark.createSuite(user.sub, projectId, dto);
  }

  @Get("benchmark-suites/:id")
  getSuite(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.benchmark.getSuite(user.sub, id);
  }

  @Post("benchmark-suites/:id/runs")
  @HttpCode(202)
  startRun(
    @CurrentUser() user: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: StartBenchmarkRunDto,
  ) {
    return this.benchmark.startRun(user.sub, id, dto);
  }

  @Get("benchmark-runs/:id")
  getRun(@CurrentUser() user: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.benchmark.getRun(user.sub, id);
  }

  @Get("benchmark-runs/:id/metrics")
  getMetrics(
    @CurrentUser() user: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("analysisVersion") analysisVersion?: string,
  ) {
    if (analysisVersion !== undefined &&
      (typeof analysisVersion !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(analysisVersion))) {
      throw new BadRequestException("analysisVersion 必须为 1–64 位字母、数字、点、下划线或连字符");
    }
    return this.benchmark.getMetrics(user.sub, id, analysisVersion);
  }
}
