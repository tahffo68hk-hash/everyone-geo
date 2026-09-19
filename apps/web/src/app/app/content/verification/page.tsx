"use client";

import { useSearchParams } from "next/navigation";
import { useProjectContext } from "@/components/project-context";
import { OutcomeWorkspaceView } from "@/components/content/outcome-workspace/outcome-workspace-view";

export default function ContentVerificationPage() {
  const { projectId } = useProjectContext();
  const searchParams = useSearchParams();
  const assetId = searchParams.get("assetId") || undefined;

  return (
    <main className="py-2">
      <OutcomeWorkspaceView projectId={projectId} initialAssetId={assetId} />
    </main>
  );
}
