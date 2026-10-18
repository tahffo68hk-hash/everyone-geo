import { Report } from "@/components/app";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Report id={(await params).id} />;
}
