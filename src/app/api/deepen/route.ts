import { NextResponse } from "next/server";
import { z } from "zod";
import { filterDeepDiveCandidates, mergeCoverage } from "@/lib/coverage";
import { getConfig } from "@/lib/config";
import { DEEPEN_SYSTEM_PROMPT, buildDeepenPrompt } from "@/lib/prompt";
import { aiRateLimiter } from "@/lib/rate-limit";
import {
  CoverageAreaSchema,
  DeepDiveSuggestionSchema,
  RequirementSchema,
  Scope,
  TestCaseSchema,
  type DeepenResponse,
  type TestCase,
} from "@/lib/types";

export const runtime = "nodejs";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ReviewedCaseSchema = TestCaseSchema.extend({
  status: z.enum(["pending", "accepted", "edited", "rejected"]),
  note: z.string().optional(),
});
const BodySchema = z.object({
  requirement: z.string().trim().min(20),
  mock: z.boolean().optional(),
  scope: Scope.default("fullstack"),
  uiContext: z.string().trim().max(3000).optional(),
  requirements: z.array(RequirementSchema).min(1).max(200),
  existingCases: z.array(ReviewedCaseSchema).max(500),
  coverage: z.array(CoverageAreaSchema).max(100),
  suggestion: DeepDiveSuggestionSchema,
  answers: z.record(z.string(), z.string().trim().max(2000)).default({}),
});
const ModelResultSchema = z.object({
  testCases: z.array(TestCaseSchema).max(10),
  coverage: z.array(CoverageAreaSchema).max(100),
  deepDiveSuggestions: z.array(DeepDiveSuggestionSchema).min(3).max(6),
  message: z.string().nullable(),
});
const modelJsonSchema = (() => {
  const schema = z.toJSONSchema(ModelResultSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
})();

function missingAnswers(body: z.infer<typeof BodySchema>): string[] {
  if (body.suggestion.status !== "NeedsInput") return [];
  return body.suggestion.questions
    .filter((question) => question.required && !body.answers[question.id]?.trim())
    .map((question) => question.id);
}

function mockCandidates(body: z.infer<typeof BodySchema>): TestCase[] {
  const requirementId = body.suggestion.requirementIds[0];
  const labels = ["giá trị hợp lệ", "dữ liệu không hợp lệ", "ranh giới dưới", "lỗi tạm thời", "thao tác lặp"];
  return labels.map((label, index) => ({
    id: `AI${index + 1}`,
    title: `${body.suggestion.title}: ${label}`,
    requirementIds: [requirementId],
    type: index === 0 ? "Positive" : index === 2 ? "Boundary" : "Negative",
    layer: body.scope === "frontend" ? "Frontend" : "Backend",
    risk: body.suggestion.priority,
    riskReason: body.suggestion.reason,
    preconditions: "Dữ liệu nền đáp ứng requirement gốc và câu trả lời bổ sung.",
    steps: [`Thực hiện hướng ${body.suggestion.title} với ${label}`],
    expected: `Hệ thống xử lý đúng ${label} theo requirement và câu trả lời đã cung cấp.`,
    coverageDimension: index === 0 ? "Happy path" : index === 2 ? "Boundary" : index === 4 ? "Concurrency" : "Error/Recovery",
    coverageKey: `${body.suggestion.id.toLowerCase()}-${index + 1}`,
    sourceSuggestionId: body.suggestion.id,
  }));
}

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : "Dữ liệu đào sâu không hợp lệ.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const missing = missingAnswers(body);
  if (missing.length) {
    return NextResponse.json({ error: `Cần trả lời đầy đủ trước khi đào sâu: ${missing.join(", ")}.` }, { status: 400 });
  }
  if (body.suggestion.status === "Exhausted") {
    return NextResponse.json({ error: "Hướng đào sâu này đã cạn." }, { status: 409 });
  }

  const cfg = getConfig();
  if (body.requirement.length > cfg.maxInputChars) {
    return NextResponse.json({ error: `Yêu cầu quá dài (tối đa ${cfg.maxInputChars} ký tự).` }, { status: 413 });
  }

  const started = Date.now();
  let raw: z.infer<typeof ModelResultSchema>;
  let usage: DeepenResponse["usage"];

  if (body.mock || cfg.forceMock || !cfg.apiKey) {
    raw = {
      testCases: mockCandidates(body),
      coverage: body.coverage,
      deepDiveSuggestions: body.suggestion.status === "Ready"
        ? [
            { ...body.suggestion, status: "Exhausted" },
            { ...body.suggestion, id: `${body.suggestion.id}-NEXT-1`, title: `${body.suggestion.title} — biến thể dữ liệu`, status: "Ready" },
            { ...body.suggestion, id: `${body.suggestion.id}-NEXT-2`, title: `${body.suggestion.title} — phục hồi lỗi`, status: "Ready" },
          ]
        : [
            { ...body.suggestion, status: "Exhausted" },
            { ...body.suggestion, id: `${body.suggestion.id}-NEXT-1`, title: `${body.suggestion.title} — biến thể dữ liệu`, status: "Ready", questions: [] },
            { ...body.suggestion, id: `${body.suggestion.id}-NEXT-2`, title: `${body.suggestion.title} — phục hồi lỗi`, status: "Ready", questions: [] },
          ],
      message: null,
    };
    usage = { mode: "mock", model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
  } else {
    if (!aiRateLimiter.allow(cfg.maxCallsPerHour)) {
      return NextResponse.json({ error: `Đã chạm giới hạn ${cfg.maxCallsPerHour} lần gọi AI trong 1 giờ.` }, { status: 429 });
    }
    let upstream: Response;
    try {
      upstream = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: cfg.maxOutputTokens,
          usage: { include: true },
          reasoning: { effort: "low" },
          messages: [
            { role: "system", content: DEEPEN_SYSTEM_PROMPT },
            { role: "user", content: buildDeepenPrompt(body) },
          ],
          tools: [{ type: "function", function: { name: "submit_deepening", description: "Nộp kết quả đào sâu coverage.", parameters: modelJsonSchema } }],
          tool_choice: "auto",
        }),
      });
    } catch {
      return NextResponse.json({ error: "Không kết nối được AI. Kết quả hiện có vẫn được giữ nguyên." }, { status: 502 });
    }
    if (!upstream.ok) return NextResponse.json({ error: "AI không thể xử lý hướng đào sâu lúc này." }, { status: 502 });
    const response = await upstream.json();
    const args = response.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(args ?? "");
    } catch {
      return NextResponse.json({ error: "AI trả về kết quả đào sâu sai định dạng." }, { status: 502 });
    }
    const parsed = ModelResultSchema.safeParse(parsedJson);
    if (!parsed.success) return NextResponse.json({ error: "Kết quả đào sâu thiếu trường hoặc sai kiểu dữ liệu." }, { status: 502 });
    raw = parsed.data;
    usage = {
      mode: "live",
      model: response.model ?? cfg.model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      costUsd: response.usage?.cost ?? 0,
      durationMs: Date.now() - started,
    };
  }

  const filtered = filterDeepDiveCandidates({
    candidates: raw.testCases,
    existingCases: body.existingCases,
    requirements: body.requirements,
    suggestion: body.suggestion,
  });
  const result: DeepenResponse = {
    testCases: filtered.accepted,
    coverage: mergeCoverage(body.coverage, raw.coverage, body.existingCases, filtered.accepted),
    deepDiveSuggestions: raw.deepDiveSuggestions,
    rejectedCandidates: filtered.rejected,
    message: filtered.accepted.length ? raw.message : raw.message || "Không còn test case mới có giá trị cho hướng này.",
    usage,
  };
  return NextResponse.json(result);
}
