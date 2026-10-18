import { Run } from "@/components/app";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Run id={(await params).id} />;
}
