"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

export type ProjectOption = { id: string; name: string };
type Identity = { user: { id: string; name: string | null; email: string }; organizations: { id: string; name: string }[] };
type Context = { projects: ProjectOption[]; projectId: string; project?: ProjectOption; setProjectId: (id: string) => void; target: { canonicalName: string; productCategory: string | null } | null; me: Identity | null; loading: boolean; error: string; resourceName: string; refresh: () => void };
const ProjectContext = createContext<Context | null>(null);

// Resolve resource ownership using existing API relations; never infer it from a remembered project.
async function resourceProject(section: string, id: string, signal: AbortSignal): Promise<{ projectId: string; name?: string }> {
  const read = <T,>(path: string) => api<T>(path, { signal });
  if (section === "queries") return read(`/benchmark-suites/${id}`);
  if (section === "reports") {
    const report = await read<{ benchmarkRunId: string; suiteName: string }>(`/reports/${id}`);
    const run = await read<{ suite: { id: string } }>(`/benchmark-runs/${report.benchmarkRunId}`);
    const suite = await read<{ projectId: string }>(`/benchmark-suites/${run.suite.id}`);
    return { ...suite, name: report.suiteName };
  }
  if (section === "manual-runs") {
    const run = await read<{ suite: { id: string; name: string } }>(`/benchmark-runs/${id}`);
    return { ...await read<{ projectId: string }>(`/benchmark-suites/${run.suite.id}`), name: run.suite.name };
  }
  const paths: Record<string, string> = { diagnosis: "diagnoses", recommendations: "recommendation-runs", opportunities: "content-opportunities", content: "content-drafts", experiments: "experiments", "site-assets": "site-assets", "change-plans": "change-plans" };
  const resource = await read<{ projectId?: string; title?: string; name?: string; project?: { id: string }; site?: { projectId: string } }>(`/${paths[section]}/${id}`);
  const projectId = resource.projectId ?? resource.project?.id ?? resource.site?.projectId;
  if (!projectId) throw new Error("无法确认该资源所属项目");
  return { projectId, name: resource.title ?? resource.name };
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, selectProject] = useState("");
  const [me, setMe] = useState<Identity | null>(null);
  const [target, setTarget] = useState<Context["target"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [revision, setRevision] = useState(0);
  const requested = params.get("project");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setResourceName("");
    async function load() {
      try {
        const [identity, options] = await Promise.all([api<Identity>("/auth/me", {signal:controller.signal}), api<{ projects: ProjectOption[] }>("/monitor-tasks/options", {signal:controller.signal})]);
        if (controller.signal.aborted) return;
        setMe(identity); setProjects(options.projects);
        const segments = pathname.split("/").filter(Boolean);
        const detail = segments.length === 3 && !["new", "compare"].includes(segments[2]);
        let id = requested;
        if (detail) {
          const owner = await resourceProject(segments[1], segments[2], controller.signal);
          id = owner.projectId; setResourceName(owner.name ?? "详情");
        }
        if (id && !options.projects.some(p => p.id === id)) throw new Error("项目不存在或无权访问");
        const remembered = sessionStorage.getItem(`geolens-project:${identity.user.id}`);
        const selected = id ?? (options.projects.some(p => p.id === remembered) ? remembered : options.projects[0]?.id) ?? "";
        if (controller.signal.aborted) return;
        selectProject(selected);
        if (selected) sessionStorage.setItem(`geolens-project:${identity.user.id}`, selected);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法加载项目上下文");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [pathname, requested, revision]);
  useEffect(() => {
    setTarget(null);
    if (!projectId) return;
    const controller = new AbortController();
    api<Context["target"]>(`/projects/${projectId}/target-profile`, {signal:controller.signal}).then(setTarget).catch(() => {});
    return () => controller.abort();
  }, [projectId, revision]);
  const setProjectId = useCallback((id: string) => {
    if (!projects.some(p => p.id === id) || !me) return;
    sessionStorage.setItem(`geolens-project:${me.user.id}`, id);
    const segment = pathname.split("/")[2];
    const base = !segment ? "/app" : segment === "manual-runs" ? "/app/activity" : segment === "change-plans" ? "/app/site-assets" : `/app/${segment}`;
    router.push(`${base}?project=${encodeURIComponent(id)}`);
  }, [projects, me, pathname, router]);
  return <ProjectContext.Provider value={{ projects, projectId, project: projects.find(p => p.id === projectId), setProjectId, target, me, loading, error, resourceName, refresh: () => setRevision(n => n+1) }}>{children}</ProjectContext.Provider>;
}
export function useProjectContext() { const context = useContext(ProjectContext); if (!context) throw new Error("ProjectProvider is required"); return context; }
