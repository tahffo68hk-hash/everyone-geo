"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { friendlyError } from "@/lib/labels";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, organizationName }),
      });
      router.push("/app");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form
        onSubmit={onSubmit}
        className="auth-card"
      >
        <h1 className="auth-title">注册 GeoLens</h1>
        <p className="auth-subtitle">
          注册后将自动创建你的组织（OWNER）
        </p>

        <label className="block text-sm font-medium text-slate-700">
          姓名
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          密码（至少 8 位）
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            minLength={8}
            required
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          组织名（可选）
          <input
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="ui-button primary auth-submit"
        >
          {busy ? "注册中…" : "注册"}
        </button>

        <p className="text-center text-sm text-slate-500">
          已有账号？{" "}
          <Link href="/login" className="auth-link">
            登录
          </Link>
        </p>
      </form>
    </main>
  );
}
