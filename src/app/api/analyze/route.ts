import { z } from "zod";
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { logMetric } from "@/lib/metrics";
import { buildUserPrompt, SYSTEM_PROMPT } from "@/lib/prompt";
import { MOCK_ANALYSIS, scopeMockAnalysis } from "@/lib/sample";
import { AnalysisSchema, Scope, type AnalyzeResponse, type Progress } from "@/lib/types";
import { aiRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const BodySchema = z.object({
  requirement: z.string().trim().min(20, "Mô tả yêu cầu quá ngắn (tối thiểu 20 ký tự)."),
  mock: z.boolean().optional(),
  scope: Scope.default("fullstack"), // request cũ không có scope vẫn chạy như trước
  uiContext: z.string().trim().max(3000, "UI context quá dài (tối đa 3.000 ký tự).").optional(),
});

// Schema JSON cho công cụ submit_analysis: ép AI trả đúng cấu trúc.
const analysisJsonSchema = (() => {
  const schema = z.toJSONSchema(AnalysisSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
})();

// Đếm số mục AI đã viết ra trong JSON đang stream (id R1.., A1.., TC01..)
function countIds(args: string, prefix: string): number {
  return (args.match(new RegExp(`"id"\\s*:\\s*"${prefix}\\d+"`, "g")) ?? []).length;
}

function friendlyError(status: number): string {
  return status === 401 || status === 403
    ? "API key không hợp lệ."
    : status === 429
      ? "API đang quá tải hoặc hết hạn mức. Thử lại sau."
      : status === 402
        ? "Hết credit trên OpenRouter. Nạp thêm hoặc dùng chế độ mô phỏng."
        : status === 400 || status === 404
          ? "Yêu cầu gửi tới AI không hợp lệ (kiểm tra tên model trong OPENROUTER_MODEL)."
          : "Gọi AI thất bại. Thử lại hoặc dùng chế độ mô phỏng.";
}

export async function POST(req: Request) {
  const cfg = getConfig();

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues[0]?.message : "Dữ liệu gửi lên không hợp lệ.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (body.requirement.length > cfg.maxInputChars) {
    return NextResponse.json(
      { error: `Yêu cầu quá dài (tối đa ${cfg.maxInputChars} ký tự).` },
      { status: 413 },
    );
  }

  const started = Date.now();

  // Chế độ mô phỏng: khi người dùng chọn, khi bật MOCK_MODE, hoặc khi chưa có API key.
  if (body.mock || cfg.forceMock || !cfg.apiKey) {
    const result: AnalyzeResponse = {
      analysis: scopeMockAnalysis(MOCK_ANALYSIS, body.scope),
      usage: { mode: "mock", model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 },
    };
    return NextResponse.json(result);
  }

  if (!aiRateLimiter.allow(cfg.maxCallsPerHour)) {
    return NextResponse.json(
      { error: "Đã chạm giới hạn số lần gọi AI trong 1 giờ. Thử lại sau hoặc dùng chế độ mô phỏng." },
      { status: 429 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxOutputTokens,
        stream: true,
        // include: true -> OpenRouter trả về usage.cost (số tiền thật của model đang dùng)
        usage: { include: true },
        // reasoning tính vào max_tokens; để thấp cho khỏi cắt cụt JSON (Sonnet 5.5 không cho tắt hẳn)
        reasoning: { effort: "low" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(body.requirement, body) },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_analysis",
              description:
                "Nộp kết quả phân tích yêu cầu: danh sách yêu cầu, điểm mơ hồ và test case.",
              parameters: analysisJsonSchema,
            },
          },
        ],
        // "auto": nhiều model (vd Claude Sonnet 5.5) từ chối ép tool_choice; system prompt đã yêu cầu dùng submit_analysis
        tool_choice: "auto",
      }),
    });
  } catch {
    console.error("[analyze] lỗi kết nối OpenRouter");
    return NextResponse.json({ error: friendlyError(0) }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    // Không trả chi tiết lỗi nội bộ (có thể chứa thông tin cấu hình) ra trình duyệt
    console.error("[analyze] lỗi gọi OpenRouter:", upstream.status);
    return NextResponse.json({ error: friendlyError(upstream.status) }, { status: 502 });
  }

  // Trả về NDJSON: mỗi dòng là một sự kiện {type:"progress"|"done"|"error"}.
  const enc = new TextEncoder();
  const upstreamBody = upstream.body;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(enc.encode(JSON.stringify(event) + "\n"));
      try {
        let args = "";
        let finish = "";
        let model = cfg.model;
        let usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
        let lastProgress = "";

        const report = () => {
          const progress: Progress = args
            ? {
                stage: "writing",
                requirements: countIds(args, "R"),
                ambiguities: countIds(args, "A"),
                testCases: countIds(args, "TC"),
              }
            : { stage: "thinking", requirements: 0, ambiguities: 0, testCases: 0 };
          const key = JSON.stringify(progress);
          if (key === lastProgress) return;
          lastProgress = key;
          send({ type: "progress", ...progress });
        };
        report();

        // Đọc SSE của OpenRouter (dòng "data: {...}", bỏ qua dòng keep-alive bắt đầu bằng ":")
        const reader = upstreamBody.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let chunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }
            if (chunk.error) throw new Error("OpenRouter báo lỗi giữa chừng");
            const choice = chunk.choices?.[0];
            args += choice?.delta?.tool_calls?.[0]?.function?.arguments ?? "";
            if (choice?.finish_reason) finish = choice.finish_reason;
            if (chunk.usage) usage = chunk.usage;
            if (chunk.model) model = chunk.model;
            report();
          }
        }

        if (finish === "length") {
          send({
            type: "error",
            error: "AI bị cắt giữa chừng do hết giới hạn token. Tăng MAX_OUTPUT_TOKENS hoặc rút gọn yêu cầu.",
          });
          return;
        }

        let raw: unknown;
        try {
          raw = JSON.parse(args);
        } catch {
          send({ type: "error", error: "AI không trả về kết quả đúng định dạng." });
          return;
        }

        // Kiểm tra lại output của AI trước khi dùng
        const parsed = AnalysisSchema.safeParse(raw);
        if (!parsed.success) {
          send({ type: "error", error: "Kết quả AI thiếu trường hoặc sai kiểu dữ liệu. Thử chạy lại." });
          return;
        }

        const inputTokens = usage?.prompt_tokens ?? 0;
        const outputTokens = usage?.completion_tokens ?? 0;
        const result: AnalyzeResponse = {
          analysis: parsed.data,
          usage: {
            mode: "live",
            model,
            inputTokens,
            outputTokens,
            costUsd: usage?.cost ?? 0,
            durationMs: Date.now() - started,
          },
        };

        await logMetric({
          kind: "analyze",
          at: new Date().toISOString(),
          mode: "live",
          model,
          inputTokens,
          outputTokens,
          costUsd: result.usage.costUsd,
          durationMs: result.usage.durationMs,
          testCaseCount: parsed.data.testCases.length,
          ambiguityCount: parsed.data.ambiguities.length,
        });

        send({ type: "done", result });
      } catch {
        console.error("[analyze] lỗi khi đọc stream từ OpenRouter");
        send({ type: "error", error: friendlyError(0) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
