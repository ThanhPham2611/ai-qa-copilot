import { NextResponse } from "next/server";
import { readMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tổng hợp số liệu thật từ các lần chạy, dùng cho slide pitch.
export async function GET() {
  const events = await readMetrics();
  const runs = events.filter((e) => e.kind === "analyze");
  const reviews = events.filter((e) => e.kind === "review");

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

  const reviewed = sum(reviews.map((r) => r.total - r.pending));
  const keptCount = sum(reviews.map((r) => r.accepted + r.edited));

  return NextResponse.json({
    liveRuns: runs.length,
    totalCostUsd: sum(runs.map((r) => r.costUsd)),
    avgCostUsd: avg(runs.map((r) => r.costUsd)),
    avgDurationMs: avg(runs.map((r) => r.durationMs)),
    avgTestCases: avg(runs.map((r) => r.testCaseCount)),
    avgAmbiguities: avg(runs.map((r) => r.ambiguityCount)),
    reviewedTestCases: reviewed,
    // Tỷ lệ test case AI gợi ý được tester giữ lại (chấp nhận + sửa) trên số đã duyệt
    keepRate: reviewed ? keptCount / reviewed : null,
  });
}
