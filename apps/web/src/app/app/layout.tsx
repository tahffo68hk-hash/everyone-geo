import { Suspense, type ReactNode } from "react";
import { ProjectProvider } from "@/components/project-context";
import { AppShell } from "@/components/app-shell";
import { LoadingSkeleton } from "@/components/ui";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingSkeleton/>}><ProjectProvider><AppShell>{children}</AppShell></ProjectProvider></Suspense>;
}
