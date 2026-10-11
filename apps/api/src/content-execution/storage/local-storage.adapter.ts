import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * DEV-ONLY 本地存储适配器（PHASE 5 · Asset Upload Foundation）。
 *
 * 明确 DEV_ONLY —— 仅用于本地开发 / 测试；**未接入**正式对象存储（S3/OSS 等）。
 * 安全约束：
 *   - 绝不接受用户提供的路径 / 文件名：storageKey 完全由服务端随机生成（uuid）。
 *   - 绝不从任意 URL 拉取（无 SSRF 面）：只写调用方已完成 MIME/大小校验的 Buffer。
 *   - 落盘目录固定为 <base>/<organizationId>/，与用户输入无关，天然租户隔离。
 *   - 默认落在 OS 临时目录，避免污染仓库工作区。
 * 真实对象存储接入属后续 Connector 阶段，届时替换本适配器即可（接口不变）。
 */

export interface StoredObject {
  /** 不透明引用（dev-local://...）。 */
  storageRef: string;
  /** 服务端生成的相对 key（不含任何用户输入）。 */
  storageKey: string;
  devOnly: true;
  adapter: "dev-local";
}

export function contentAssetStorageDir(): string {
  const base = process.env.CONTENT_ASSET_STORAGE_DIR
    ? resolve(process.env.CONTENT_ASSET_STORAGE_DIR)
    : join(tmpdir(), "geo-content-assets-dev");
  return base;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class DevLocalStorageAdapter {
  readonly devOnly = true;
  readonly adapter = "dev-local" as const;

  /** 写入 Buffer，返回不透明 storageRef + 服务端随机生成的相对 key。 */
  async put(organizationId: string, bytes: Buffer): Promise<StoredObject> {
    // key 完全由服务端生成；organizationId 非 UUID 时降级为 unknown（不信任入参拼接）。
    const safeOrg = UUID_RE.test(organizationId) ? organizationId : "unknown";
    const key = `${safeOrg}/${randomUUID()}`;
    const base = contentAssetStorageDir();
    await mkdir(join(base, safeOrg), { recursive: true });
    await writeFile(join(base, key), bytes);
    return { storageRef: `dev-local://${key}`, storageKey: key, devOnly: true, adapter: "dev-local" };
  }

  /** 读取 Buffer；针对 storageKey 执行防路径穿越检查。 */
  async get(key: string): Promise<Buffer | null> {
    const base = contentAssetStorageDir();
    const filePath = resolve(base, key);
    if (!filePath.startsWith(resolve(base))) {
      return null;
    }
    try {
      const { readFile } = await import("node:fs/promises");
      return await readFile(filePath);
    } catch {
      return null;
    }
  }
}
