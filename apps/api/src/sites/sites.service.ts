import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  assertPublicIp, assertSafeFetchUrl, canonicalAssetUrl, type MeasurementModeFact,
} from "@geo/core";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { CreateAssetDto, CreateSiteDto } from "./dto/sites.dto";

type FetchOk = { ok: true; finalUrl: string; status: number; body: string };
type FetchErr = { ok: false; error: string };

const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const MAX_SITEMAP_URLS = 500;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const TEXT_LIMIT = 40_000; // 快照文本上限（安全抽取，不存完整页面）

@Injectable()
export class SitesService {
  private readonly logger = new Logger("SitesService");

  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  // ---------------------------------------------------------------
  // Sites
  // ---------------------------------------------------------------
  async createSite(userId: string, projectId: string, dto: CreateSiteDto) {
    await this.tenant.assertUserInProject(userId, projectId);
    // 同站点 baseUrl 归一校验（本项目自己的站点才允许创建）
    const safe = assertSafeFetchUrl(dto.baseUrl);
    if (!safe.ok || !safe.normalizedUrl) throw new BadRequestException(`baseUrl 校验失败：${safe.reason ?? "不合法"}`);
    const created = await this.db.client.site.create({
      data: { projectId, name: dto.name, baseUrl: safe.normalizedUrl },
    });
    this.logger.log(JSON.stringify({ event: "site_created", siteId: created.id, projectId }));
    return this.presentSite(created);
  }

  async listSites(userId: string, projectId: string) {
    await this.tenant.assertUserInProject(userId, projectId);
    const rows = await this.db.client.site.findMany({
      where: { projectId },
      include: { _count: { select: { assets: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(r => ({ ...this.presentSite(r), assetCount: r._count.assets }));
  }

  private async siteForUser(userId: string, siteId: string) {
    const site = await this.db.client.site.findFirst({
      where: { id: siteId, project: { organization: { members: { some: { userId } } } } },
    });
    if (!site) throw new NotFoundException("站点不存在或无权访问");
    return site;
  }

  // ---------------------------------------------------------------
  // Assets（manual inventory + sitemap import + snapshot）
  // ---------------------------------------------------------------
  async listAssets(userId: string, siteId: string) {
    const site = await this.siteForUser(userId, siteId);
    const assets = await this.db.client.siteAsset.findMany({
      where: { siteId: site.id },
      include: {
        _count: { select: { snapshots: true, assetMappings: true } },
      },
      orderBy: [{ status: "asc" }, { canonicalUrl: "asc" }],
    });
    return { siteId: site.id, assets: assets.map(a => this.presentAsset(a)) };
  }

  async getAsset(userId: string, assetId: string) {
    const asset = await this.db.client.siteAsset.findFirst({
      where: { id: assetId, site: { project: { organization: { members: { some: { userId } } } } } },
      include: {
        site: { select: { id: true, name: true, baseUrl: true } },
        snapshots: { orderBy: { capturedAt: "desc" }, take: 5 },
        assetMappings: { include: { contentOpportunity: { select: { id: true, titleDirection: true } } } },
      },
    });
    if (!asset) throw new NotFoundException("站点资产不存在或无权访问");
    return {
      ...this.presentAsset(asset),
      site: asset.site,
      recentSnapshots: asset.snapshots,
      mappedOpportunities: asset.assetMappings.map(m => ({
        mappingId: m.id, contentOpportunityId: m.contentOpportunityId,
        titleDirection: m.contentOpportunity.titleDirection, mappingType: m.mappingType,
        confirmedByUser: m.confirmedByUser,
      })),
    };
  }

  /** 人工登记资产（MANUAL 来源；canonicalUrl 去重）。 */
  async addManualAsset(userId: string, siteId: string, dto: CreateAssetDto) {
    const site = await this.siteForUser(userId, siteId);
    const canonical = canonicalAssetUrl(dto.url, { stripQuery: true });
    if (!canonical) throw new BadRequestException("URL 无法归一化或不可访问（http/https 白名单内）。");
    const existing = await this.db.client.siteAsset.findUnique({
      where: { siteId_canonicalUrl: { siteId: site.id, canonicalUrl: canonical } },
    });
    if (existing) return this.presentAsset(existing); // dedup 幂等
    const created = await this.db.client.siteAsset.create({
      data: {
        siteId: site.id, url: dto.url.trim(), canonicalUrl: canonical,
        assetType: dto.assetType ?? null, title: dto.title ?? null,
        source: "MANUAL", status: "KNOWN", lastObservedAt: new Date(),
        metadata: dto.note ? { note: dto.note } : {},
      },
    });
    this.logger.log(JSON.stringify({ event: "site_asset_added", assetId: created.id, siteId: site.id, source: "MANUAL" }));
    return this.presentAsset(created);
  }

  /** 受限 sitemap/robots 导入：只允许同站点域名、最多 MAX_SITEMAP_URLS。 */
  async importSitemap(userId: string, siteId: string, sitemapUrl?: string) {
    const site = await this.siteForUser(userId, siteId);
    const allowedHost = new URL(site.baseUrl).hostname;
    const base = new URL(site.baseUrl);
    const candidate = sitemapUrl ?? `${base.protocol}//${allowedHost}/sitemap.xml`;
    const safe = assertSafeFetchUrl(candidate, { allowedHosts: [allowedHost] });
    if (!safe.ok || !safe.normalizedUrl) throw new BadRequestException(`sitemap URL 校验失败：${safe.reason}`);
    const fetched = await this.fetchText(safe.normalizedUrl, allowedHost);
    if (!fetched.ok) throw new BadRequestException(`sitemap 获取失败：${fetched.error}`);
    const locs = [...fetched.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/giu)]
      .map(m => m[1]!.trim())
      .filter(u => {
        const s = assertSafeFetchUrl(u, { allowedHosts: [allowedHost] });
        return s.ok && s.normalizedUrl !== undefined;
      });
    const unique = [...new Set(locs.map(u => canonicalAssetUrl(u, { stripQuery: true }) ?? u))].slice(0, MAX_SITEMAP_URLS);
    if (unique.length === 0) throw new BadRequestException("sitemap 中未发现可导入的站点 URL。");
    const created: Array<Record<string, unknown>> = [];
    for (const canonical of unique) {
      const existing = await this.db.client.siteAsset.findUnique({
        where: { siteId_canonicalUrl: { siteId: site.id, canonicalUrl: canonical } },
      });
      if (existing) continue;
      const row = await this.db.client.siteAsset.create({
        data: {
          siteId: site.id, url: canonical, canonicalUrl: canonical,
          source: "SITEMAP", status: "KNOWN",
        },
      });
      created.push(this.presentAsset(row));
    }
    this.logger.log(JSON.stringify({ event: "site_sitemap_imported", siteId: site.id, urls: unique.length, created: created.length }));
    return { siteId: site.id, requestedUrls: locs.length, importedUrls: unique.length, created: created.length, assets: created };
  }

  /** 抓取资产并写快照（OBSERVED；AFTER_CHANGE 用于执行后校验 hash 变化）。 */
  async captureSnapshot(userId: string, assetId: string, snapshotType: "OBSERVED" | "BEFORE_CHANGE" | "AFTER_CHANGE" = "OBSERVED") {
    const asset = await this.getAssetRow(userId, assetId);
    const site = await this.siteForUser(userId, asset.siteId);
    const allowedHost = new URL(site.baseUrl).hostname;
    const fetched = await this.fetchText(asset.url, allowedHost);
    if (!fetched.ok) throw new BadRequestException(`抓取失败：${fetched.error}`);
    const { title, text, headings } = this.extractPage(fetched.body);
    const contentHash = this.hashPage(title, text);
    const snapshot = await this.db.client.siteAssetSnapshot.create({
      data: {
        assetId: asset.id, snapshotType, contentHash,
        title: title?.slice(0, 200) ?? null,
        textSnapshot: text.slice(0, TEXT_LIMIT),
        textLength: text.length,
        headings: { items: headings.slice(0, 50) },
        source: "CRAWLER",
        metadata: { finalUrl: fetched.finalUrl, httpStatus: fetched.status },
      },
    });
    await this.db.client.siteAsset.update({
      where: { id: asset.id },
      data: { lastObservedAt: new Date(), contentHash, title: title?.slice(0, 200) ?? asset.title },
    });
    this.logger.log(JSON.stringify({ event: "site_snapshot_captured", assetId: asset.id, snapshotType, contentHash, textLength: text.length }));
    return this.presentSnapshot(snapshot);
  }

  /** 人工快照录入（源为 MANUAL_IMPORT —— 用户无法抓取/不想抓取时记录变更事实）。 */
  async manualSnapshot(userId: string, assetId: string, dto: { snapshotType?: string; title?: string; text?: string }) {
    const asset = await this.getAssetRow(userId, assetId);
    const text = (dto.text ?? "").trim();
    if (!text && !dto.title) throw new BadRequestException("至少提供 title 或 text 之一");
    const contentHash = this.hashPage(dto.title ?? asset.title, text);
    const snapshot = await this.db.client.siteAssetSnapshot.create({
      data: {
        assetId: asset.id,
        snapshotType: dto.snapshotType === "BEFORE_CHANGE" || dto.snapshotType === "AFTER_CHANGE" ? dto.snapshotType : "MANUAL_IMPORT",
        contentHash,
        title: dto.title?.slice(0, 200) ?? asset.title,
        textSnapshot: text.slice(0, TEXT_LIMIT),
        textLength: text.length,
        source: "MANUAL",
        metadata: { note: "人工录入快照；仅记录用户确认的文本，不自动验证页面。" },
      },
    });
    return this.presentSnapshot(snapshot);
  }

  async listSnapshots(userId: string, assetId: string) {
    await this.getAssetRow(userId, assetId);
    const rows = await this.db.client.siteAssetSnapshot.findMany({
      where: { assetId },
      orderBy: { capturedAt: "desc" },
    });
    return { assetId, snapshots: rows.map(r => this.presentSnapshot(r)) };
  }

  // ---------------------------------------------------------------
  // Opportunity → Asset mapping
  // ---------------------------------------------------------------
  async listMappingsForOpportunity(userId: string, contentOpportunityId: string) {
    const opp = await this.opportunityForUser(userId, contentOpportunityId);
    const rows = await this.db.client.opportunityAssetMapping.findMany({
      where: { contentOpportunityId: opp.id },
      include: { siteAsset: { include: { site: { select: { id: true, name: true } } } } },
      orderBy: { updatedAt: "desc" },
    });
    return { contentOpportunityId: opp.id, mappings: rows.map(r => this.presentMapping(r)) };
  }

  async upsertMapping(userId: string, contentOpportunityId: string, dto: {
    mappingType: string; siteAssetId?: string | null; note?: string;
  }) {
    const opp = await this.opportunityForUser(userId, contentOpportunityId);
    if (!["UPDATE_EXISTING", "CREATE_NEW", "UNKNOWN"].includes(dto.mappingType)) {
      throw new BadRequestException("mappingType 只允许 UPDATE_EXISTING / CREATE_NEW / UNKNOWN。");
    }
    if (dto.mappingType === "UPDATE_EXISTING" && !dto.siteAssetId) {
      throw new BadRequestException("UPDATE_EXISTING 必须指定 siteAssetId。");
    }
    if (dto.siteAssetId) await this.getAssetRow(userId, dto.siteAssetId);
    // 幂等：同 opportunity+siteAsset（siteAssetId null 时按 mappingType）去重
    const existing = await this.db.client.opportunityAssetMapping.findFirst({
      where: dto.siteAssetId
        ? { contentOpportunityId: opp.id, siteAssetId: dto.siteAssetId }
        : { contentOpportunityId: opp.id, mappingType: dto.mappingType, siteAssetId: null },
    });
    if (existing) {
      const updated = await this.db.client.opportunityAssetMapping.update({
        where: { id: existing.id },
        data: { mappingType: dto.mappingType, confirmedByUser: true, note: dto.note ?? existing.note, siteAssetId: dto.siteAssetId ?? null },
      });
      return this.presentMapping(await this.withAsset(updated.id));
    }
    const created = await this.db.client.opportunityAssetMapping.create({
      data: {
        contentOpportunityId: opp.id,
        siteAssetId: dto.siteAssetId ?? null,
        mappingType: dto.mappingType,
        confirmedByUser: true,
        note: dto.note ?? null,
      },
    });
    return this.presentMapping(await this.withAsset(created.id));
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------
  private async opportunityForUser(userId: string, contentOpportunityId: string) {
    const opp = await this.db.client.contentOpportunity.findFirst({
      where: { id: contentOpportunityId, opportunityRun: { project: { organization: { members: { some: { userId } } } } } },
    });
    if (!opp) throw new NotFoundException("内容机会不存在或无权访问");
    return opp;
  }

  private async getAssetRow(userId: string, assetId: string) {
    const asset = await this.db.client.siteAsset.findFirst({
      where: { id: assetId, site: { project: { organization: { members: { some: { userId } } } } } },
    });
    if (!asset) throw new NotFoundException("站点资产不存在或无权访问");
    return asset;
  }

  private async withAsset(mappingId: string) {
    return this.db.client.opportunityAssetMapping.findUniqueOrThrow({
      where: { id: mappingId },
      include: { siteAsset: { include: { site: { select: { id: true, name: true } } } } },
    });
  }

  /** SSRF-safe GET：host 白名单 + DNS 复查 + redirect 逐跳复查 + 大小/超时限制。 */
  private async fetchText(rawUrl: string, allowedHost: string): Promise<FetchOk | FetchErr> {
    const first = assertSafeFetchUrl(rawUrl, { allowedHosts: [allowedHost] });
    if (!first.ok || !first.normalizedUrl) return { ok: false, error: first.reason ?? "URL 校验失败" };

    let current = first.normalizedUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(current);
      // DNS 复查：不允许解析到私网
      try {
        const addrs = await lookup(parsed.hostname, { all: true, verbatim: true });
        for (const a of addrs) {
          const ipOk = assertPublicIp(a.address);
          if (!ipOk.ok) return { ok: false, error: `DNS 解析到非公网地址（${a.address}）` };
        }
      } catch (e) {
        return { ok: false, error: `DNS 解析失败：${(e as Error).message}` };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(current, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": "GeoLensSiteProbe/1.0 (read-only; contact owner)" },
        });
      } catch (e) {
        clearTimeout(timer);
        return { ok: false, error: `请求失败：${(e as Error).message}` };
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return { ok: false, error: `重定向缺少 Location（HTTP ${res.status}）` };
        const next = new URL(location, current).href;
        const safeNext = assertSafeFetchUrl(next, { allowedHosts: [allowedHost] });
        if (!safeNext.ok || !safeNext.normalizedUrl) return { ok: false, error: `重定向目标校验失败：${safeNext.reason}` };
        current = safeNext.normalizedUrl;
        continue;
      }
      if (res.status >= 400) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xml|text\/xml|text\/plain/i.test(contentType)) {
        return { ok: false, error: `不支持的 Content-Type：${contentType}` };
      }
      const reader = res.body?.getReader();
      if (!reader) return { ok: false, error: "响应体不可读" };
      let body = "";
      let received = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BYTES) {
          await reader.cancel();
          return { ok: false, error: "响应体超过大小限制（3MB）" };
        }
        body += Buffer.from(value).toString("utf8");
      }
      return { ok: true, finalUrl: current, status: res.status, body };
    }
    return { ok: false, error: `超过 ${MAX_REDIRECTS} 次重定向` };
  }

  private extractPage(html: string): { title: string | null; text: string; headings: string[] } {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
    const title = titleMatch ? this.stripHtml(titleMatch[1]!).trim().slice(0, 200) : null;
    const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/giu)]
      .map(m => this.stripHtml(m[2]!).trim())
      .filter(Boolean);
    const noScript = html.replace(/<script[\s\S]*?<\/script>/giu, " ").replace(/<style[\s\S]*?<\/style>/giu, " ");
    const text = this.stripHtml(noScript).replace(/\s+/gu, " ").trim();
    return { title, text: text.slice(0, TEXT_LIMIT), headings };
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<")
      .replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/&nbsp;/gu, " ");
  }

  private hashPage(title: string | null | undefined, text: string): string {
    return createHash("sha256").update(`${title ?? ""}\u0000${text.normalize("NFKC").slice(0, TEXT_LIMIT)}`).digest("hex").slice(0, 32);
  }

  private presentSite(s: any) {
    return { id: s.id, projectId: s.projectId, name: s.name, baseUrl: s.baseUrl, status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt };
  }

  private presentAsset(a: any) {
    return {
      id: a.id, siteId: a.siteId, url: a.url, canonicalUrl: a.canonicalUrl,
      assetType: a.assetType, title: a.title, status: a.status, source: a.source,
      lastObservedAt: a.lastObservedAt, contentHash: a.contentHash,
      snapshotCount: a._count?.snapshots ?? null,
      mappingCount: a._count?.assetMappings ?? null,
      createdAt: a.createdAt, updatedAt: a.updatedAt,
    };
  }

  private presentSnapshot(s: any) {
    return {
      id: s.id, assetId: s.assetId, snapshotType: s.snapshotType, capturedAt: s.capturedAt,
      contentHash: s.contentHash, title: s.title, textLength: s.textLength,
      source: s.source, metadata: s.metadata,
      textSnapshotPreview: (s.textSnapshot ?? "").slice(0, 500),
    };
  }

  private presentMapping(m: any) {
    return {
      id: m.id, contentOpportunityId: m.contentOpportunityId,
      siteAssetId: m.siteAssetId, mappingType: m.mappingType,
      confirmedByUser: m.confirmedByUser, note: m.note,
      siteAsset: m.siteAsset ? {
        id: m.siteAsset.id, url: m.siteAsset.url, canonicalUrl: m.siteAsset.canonicalUrl,
        assetType: m.siteAsset.assetType, title: m.siteAsset.title, status: m.siteAsset.status,
        site: m.siteAsset.site ?? undefined,
      } : null,
      createdAt: m.createdAt, updatedAt: m.updatedAt,
    };
  }
}

export type { MeasurementModeFact };
