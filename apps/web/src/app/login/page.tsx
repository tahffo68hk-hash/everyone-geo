"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { friendlyError } from "@/lib/labels";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("alice@geolens.local");
  const [password, setPassword] = useState("Password123!");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
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
        <h1 className="auth-title">登录 GeoLens</h1>
        <p className="auth-subtitle">AI 可见度智能平台（AI Visibility Intelligence）</p>

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
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="ui-button primary auth-submit"
        >
          {busy ? "登录中…" : "登录"}
        </button>

        <p className="text-center text-sm text-slate-500">
          还没有账号？{" "}
          <Link href="/register" className="auth-link">
            注册
          </Link>
        </p>
      </form>
    </main>
  );
}
