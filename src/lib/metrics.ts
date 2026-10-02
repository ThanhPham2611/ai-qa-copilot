import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

// Ghi số liệu ra file data/metrics.jsonl để có số thật khi pitch.
// CHỈ ghi con số (token, chi phí, thời gian, số test case được giữ lại),
// KHÔNG ghi nội dung yêu cầu, để tránh lộ dữ liệu.

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "metrics.jsonl");

export type MetricEvent =
  | {
      kind: "analyze";
      at: string;
      mode: "live" | "mock";
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      durationMs: number;
      testCaseCount: number;
      ambiguityCount: number;
    }
  | {
      kind: "review";
      at: string;
      total: number;
      accepted: number;
      edited: number;
      rejected: number;
      pending: number;
    };

export async function logMetric(event: MetricEvent): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(FILE, JSON.stringify(event) + "\n", "utf8");
  } catch {
    // Ghi số liệu thất bại không được làm hỏng luồng chính
  }
}

export async function readMetrics(): Promise<MetricEvent[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MetricEvent);
  } catch {
    return [];
  }
}
