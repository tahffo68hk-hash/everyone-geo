/**
 * GeoLens Web API 客户端
 * 统一携带 HttpOnly Cookie 请求凭据；API 地址默认本地 3001。
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = init?.body instanceof FormData ? { ...(init?.headers ?? {}) } : {
    "Content-Type": "application/json",
    ...(init?.headers ?? {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers,
    ...init,
  });

  const data: unknown =
    res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    if (data && typeof data === "object" && "message" in data) {
      const raw = (data as { message: unknown }).message;
      msg = Array.isArray(raw)
        ? String(raw[0] ?? msg)
        : String(raw ?? msg);
    }
    throw new Error(msg);
  }

  return data as T;
}
