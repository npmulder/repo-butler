import { RunDetailClient } from "@/components/RunDetailClient";
import { requireAuth } from "@/lib/auth";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  await requireAuth();

  const { runId } = await params;

  return <RunDetailClient runId={runId} />;
}
