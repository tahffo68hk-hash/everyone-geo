// ============================================================================
// M8B — URL / SSRF Safety（纯函数判定，确定性；实际网络 fetch 由 API 层执行）
// ============================================================================
// 用途：站点资产抓取/sitemap 读取前，判定目标 URL/host 是否允许访问。
//   - 只允许 http/https
//   - 禁止 loopback / link-local / private / metadata / 任何非公网 IP
//   - 禁止带 userinfo；host 必须是合法域名或公网 IP
// 说明：纯函数只能做 hostname 文本/IP 判定；DNS 解析到私网的场景（域名指向内网）
// 需 API 层在 fetch 前做解析复查（validateResolvedIp）。此处提供可复用的判定块。
import { isIP } from 'node:net';

export interface UrlSafetyResult {
  ok: boolean;
  reason?: string;
  /** 规范化后的 URL（http(s) 且无 fragment/userinfo） */
  normalizedUrl?: string;
  hostname?: string;
}

const PRIVATE_IPV4 = /^(?:10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168)\./;
const RESERVED_IPV4 = /^(?:0\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.0\.|192\.0\.2\.|198\.(?:18|19)\.|198\.51\.100\.|203\.0\.113\.|224\.|240\.|255\.)/;

function classifyIpv4(host: string): 'public' | 'blocked' {
  const parts = host.split('.').map(n => Number(n));
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return 'blocked';
  if (PRIVATE_IPV4.test(host)) return 'blocked';
  if (RESERVED_IPV4.test(host)) return 'blocked';
  return 'public';
}

function classifyIpv6(host: string): 'public' | 'blocked' {
  const lower = host.toLowerCase();
  // loopback ::1
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return 'blocked';
  // unspecified ::
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return 'blocked';
  // link-local fe80::/10, unique-local fc00::/7, documentation 2001:db8::/32, 64:ff9b:: (NAT64), ipv4-mapped ::ffff:
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return 'blocked';
  if (/^f[cd][0-9a-f]:/i.test(lower)) return 'blocked';
  if (/^2001:db8:/i.test(lower)) return 'blocked';
  if (/^::ffff:/i.test(lower)) {
    const mapped = lower.replace(/^::ffff:/, '');
    return classifyIpv4(mapped);
  }
  return 'public';
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  const ip = isIP(lower);
  if (ip === 4) return classifyIpv4(lower) === 'blocked' && /^(127|0|10|192\.168|172\.(1[6-9]|2\d|3[01])|169\.254)\./.test(lower);
  if (ip === 6) return classifyIpv6(lower) === 'blocked';
  return false;
}

/** 校验一个待抓取 URL 是否允许（GET-only 前置判定）。 */
export function assertSafeFetchUrl(rawUrl: string, options: { allowedHosts?: string[] } = {}): UrlSafetyResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, reason: 'URL 无法解析。' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `仅允许 http/https（当前 ${parsed.protocol}）。` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URL 不允许携带用户名/密码。' };
  }
  const hostname = parsed.hostname.toLowerCase();
  // 去掉 IPv6 括号
  const cleanHost = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  const ip = isIP(cleanHost);

  const blockedIp =
    ip === 4 ? classifyIpv4(cleanHost) === 'blocked' :
    ip === 6 ? classifyIpv6(cleanHost) === 'blocked' : false;
  const loopbackName = /^(localhost|.*\.localhost)$/.test(cleanHost);
  // metadata / 云元数据域名
  const metadataHost = /^(metadata\.google\.internal|169\.254\.169\.254)$/i.test(cleanHost);

  if (blockedIp || loopbackName || metadataHost) {
    return { ok: false, reason: '禁止访问回环/内网/链路本地/云元数据地址。', hostname: cleanHost };
  }

  // allowedHosts：若指定，host 必须在白名单内（精确 host 或其后缀边界）
  if (options.allowedHosts && options.allowedHosts.length > 0) {
    const allowed = options.allowedHosts.map(h => h.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\[|\]$/g, ''));
    const match = allowed.some(a => cleanHost === a || cleanHost.endsWith('.' + a));
    if (!match) {
      return { ok: false, reason: `host 不在允许站点白名单内（${cleanHost}）。`, hostname: cleanHost };
    }
  }

  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  return { ok: true, normalizedUrl: parsed.href, hostname: cleanHost };
}

/** 解析后的 IP 复查（API 层 fetch 前对 DNS 结果调用）：禁止解析到私网。 */
export function assertPublicIp(ipAddress: string): { ok: boolean; reason?: string } {
  const cleaned = ipAddress.replace(/^\[|\]$/g, '');
  const ip = isIP(cleaned);
  if (ip === 0) return { ok: false, reason: `无法识别的 IP：${ipAddress}` };
  const blocked = ip === 4 ? classifyIpv4(cleaned) === 'blocked' : classifyIpv6(cleaned) === 'blocked';
  if (blocked) return { ok: false, reason: `解析到非公网地址：${ipAddress}` };
  return { ok: true };
}

/** canonicalUrl（去 fragment、尾部斜杠/默认端口归一；去 query 可选）。 */
export function canonicalAssetUrl(rawUrl: string, options: { stripQuery?: boolean } = {}): string | null {
  const result = assertSafeFetchUrl(rawUrl);
  if (!result.ok || !result.normalizedUrl) return null;
  let url = result.normalizedUrl;
  const parsed = new URL(url);
  if (options.stripQuery) parsed.search = '';
  parsed.hash = '';
  // 默认端口归一（https:443 / http:80 去掉显式端口）
  if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) parsed.port = '';
  let href = parsed.href;
  if (href.endsWith('/')) href = href.slice(0, -1);
  return href;
}
