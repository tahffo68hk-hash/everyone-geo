"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useProjectContext } from "@/components/project-context";
import { DistributionWorkbench } from "@/components/content/distribution/distribution-workbench";
import { PageHeader } from "@/components/ui";

function ContentDistributionInner() {
  const { projectId } = useProjectContext();

  return (
    <main className="space-y-6">
      <PageHeader
        title="内容发布"
        description="支持手工录入与 AI 智能生成双入口，提供本地受控浏览器辅助发布与精准人工发布指引无缝协同。"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/app/content?project=${encodeURIComponent(projectId)}`}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 bg-white px-3 py-1.5 rounded-lg shadow-sm"
            >
              ← 返回内容管理
            </Link>
          </div>
        }
      />
      <DistributionWorkbench projectId={projectId} />
    </main>
  );
}

export default function ContentDistributionPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">正在加载内容发布工作台…</div>}>
      <ContentDistributionInner />
    </Suspense>
  );
}
