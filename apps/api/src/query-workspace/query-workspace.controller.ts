import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { QueryWorkspaceService } from "./query-workspace.service";
import {
  AddAliasDto, BuilderPreviewDto, CloneSuiteDto, CostPreflightDto, ImportPreviewDto,
  QueryListDto, BatchQueriesDto, SaveQueriesDto,
  UpdateAliasDto, UpsertTargetDto,
} from "./dto/query-workspace.dto";

@Controller()
@UseGuards(AuthGuard)
export class QueryWorkspaceController {
  constructor(private readonly workspace: QueryWorkspaceService) {}

  // ---- Target Profile ----
  @Get("projects/:id/target-profile")
  getTarget(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.workspace.getTarget(u.sub, id);
  }

  @Put("projects/:id/target-profile")
  upsertTarget(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpsertTargetDto) {
    return this.workspace.upsertTarget(u.sub, id, dto);
  }

  @Post("projects/:id/target-aliases")
  @HttpCode(201)
  addAlias(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AddAliasDto) {
    return this.workspace.addAlias(u.sub, id, dto);
  }

  @Patch("target-aliases/:id")
  updateAlias(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateAliasDto) {
    return this.workspace.updateAlias(u.sub, id, dto);
  }

  @Delete("target-aliases/:id")
  deleteAlias(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.workspace.deleteAlias(u.sub, id);
  }

  // ---- Query Builder / Import / Save（preview 一律无副作用） ----
  @Post("projects/:id/query-builder/preview")
  builderPreview(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: BuilderPreviewDto) {
    return this.workspace.builderPreview(u.sub, id, {
      category: dto.category,
      scenario: dto.scenario, intents: dto.intents as never[], audience: dto.audience,
      modifiers: dto.modifiers, custom: dto.custom, cap: dto.cap,
    });
  }

  @Post("projects/:id/queries/import-preview")
  importPreview(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ImportPreviewDto) {
    return this.workspace.importPreview(u.sub, id, dto);
  }

  @Post("benchmark-suites/:id/queries/batch")
  @HttpCode(201)
  saveQueries(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SaveQueriesDto) {
    return this.workspace.saveQueries(u.sub, id, dto);
  }

  @Post("benchmark-suites/:id/clone")
  @HttpCode(201)
  cloneSuite(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CloneSuiteDto) {
    return this.workspace.cloneSuite(u.sub, id, dto.version);
  }

  // ---- R2 · Query 运营（分页列表 / 批量启停移 / Cost Preflight 占位） ----
  @Get("projects/:id/queries")
  listQueries(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Query() dto: QueryListDto) {
    return this.workspace.listQueries(u.sub, id, dto);
  }

  @Post("projects/:id/queries/batch")
  batchQueries(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: BatchQueriesDto) {
    return this.workspace.batchQueries(u.sub, id, dto);
  }

  @Post("projects/:id/queries/cost-preflight")
  costPreflight(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CostPreflightDto) {
    return this.workspace.costPreflight(u.sub, id, dto);
  }
}
