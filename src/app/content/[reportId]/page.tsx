import { ContentCenter } from "@/components/content-center";
export default async function Page({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  return <ContentCenter id={(await params).reportId} />;
}
