"use client";

import { useProjectContext } from "@/components/project-context";
import { DistributionWorkbench } from "@/components/content/distribution/distribution-workbench";
import { PageHeader } from "@/components/ui";

export default function ContentDistributionPage() {
  const { projectId } = useProjectContext();

  return (
    <main className="space-y-6">
      <PageHeader
        title="多平台内容分发中心"
        description="一站式管理官方授权自动发布与多端人工辅助分发，打通微信公众号、WordPress、小红书、知乎、抖音等重点渠道，并回填真实资产闭环接入 GEO 效果验证。"
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 text-teal-800 text-xs px-2.5 py-0.5 font-semibold">
            自动同步 + 人工辅助
          </span>
        }
      />
      <DistributionWorkbench projectId={projectId} />
    </main>
  );
}
