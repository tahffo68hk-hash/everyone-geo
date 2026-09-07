import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { SitesService } from "./sites.service";
import { CreateAssetDto, CreateSiteDto } from "./dto/sites.dto";
import { MapOpportunityDto, ManualSnapshotDto, SitemapImportDto } from "./dto/map.dto";

@Controller()
@UseGuards(AuthGuard)
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  // ---- Sites ----
  @Post("projects/:projectId/sites")
  createSite(@CurrentUser() u: JwtUserPayload, @Param("projectId", ParseUUIDPipe) projectId: string, @Body() dto: CreateSiteDto) {
    return this.sites.createSite(u.sub, projectId, dto);
  }

  @Get("projects/:projectId/sites")
  listSites(@CurrentUser() u: JwtUserPayload, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.sites.listSites(u.sub, projectId);
  }

  // ---- Assets ----
  @Post("sites/:id/assets")
  addAsset(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateAssetDto) {
    return this.sites.addManualAsset(u.sub, id, dto);
  }

  @Post("sites/:id/sitemap/import")
  importSitemap(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SitemapImportDto) {
    return this.sites.importSitemap(u.sub, id, dto.sitemapUrl ?? undefined);
  }

  @Get("sites/:id/assets")
  listAssets(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.sites.listAssets(u.sub, id);
  }

  @Get("site-assets/:id")
  getAsset(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.sites.getAsset(u.sub, id);
  }

  // ---- Snapshots ----
  @Post("site-assets/:id/snapshots/capture")
  capture(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Query("type") type?: string) {
    const t = type === "BEFORE_CHANGE" || type === "AFTER_CHANGE" ? type : "OBSERVED";
    return this.sites.captureSnapshot(u.sub, id, t);
  }

  @Post("site-assets/:id/snapshots/manual")
  manualSnapshot(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ManualSnapshotDto) {
    return this.sites.manualSnapshot(u.sub, id, dto);
  }

  @Get("site-assets/:id/snapshots")
  listSnapshots(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.sites.listSnapshots(u.sub, id);
  }

  // ---- Opportunity mapping ----
  @Get("content-opportunities/:id/asset-mappings")
  listMappings(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.sites.listMappingsForOpportunity(u.sub, id);
  }

  @Post("content-opportunities/:id/asset-mappings")
  upsertMapping(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: MapOpportunityDto) {
    return this.sites.upsertMapping(u.sub, id, dto);
  }
}
