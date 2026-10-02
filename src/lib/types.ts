import { z } from "zod";

// Schema kết quả AI trả về. Dùng zod để kiểm tra lại dữ liệu từ model,
// vì không bao giờ tin tuyệt đối vào output của AI.

export const RiskLevel = z.enum(["High", "Medium", "Low"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const RequirementSchema = z.object({
  id: z.string(), // ví dụ "R1"
  text: z.string(),
});

export const AmbiguitySchema = z.object({
  id: z.string(), // ví dụ "A1"
  requirementId: z.string().nullable(),
  issue: z.string(), // điểm mơ hồ / thiếu
  question: z.string(), // câu hỏi nên gửi lại khách hàng / BA
  severity: RiskLevel,
});

// Phạm vi phân tích do tester chọn; layer là tầng mà test case kiểm tra (type vẫn là kỹ thuật test)
export const Scope = z.enum(["fullstack", "frontend", "backend"]);
export type Scope = z.infer<typeof Scope>;

export const Layer = z.enum(["Frontend", "Backend", "Integration", "E2E"]);
export type Layer = z.infer<typeof Layer>;

export const CoverageDimension = z.enum([
  "Happy path",
  "Validation",
  "Boundary",
  "Error/Recovery",
  "Authorization",
  "Security",
  "Concurrency",
  "State transition",
  "Accessibility",
  "Responsive",
  "Integration",
]);
export type CoverageDimension = z.infer<typeof CoverageDimension>;

export const TestCaseSchema = z.object({
  id: z.string(), // ví dụ "TC01"
  title: z.string(),
  requirementIds: z.array(z.string()),
  type: z.enum(["Positive", "Negative", "Boundary", "Security", "UI", "Other"]),
  layer: Layer,
  risk: RiskLevel,
  riskReason: z.string(),
  preconditions: z.string(),
  steps: z.array(z.string()),
  expected: z.string(),
  coverageDimension: CoverageDimension,
  coverageKey: z.string().trim().min(1).max(120),
  sourceSuggestionId: z.string().nullable(),
});

export const CoverageStatus = z.enum(["Covered", "Partial", "NotAssessed", "Blocked"]);
export type CoverageStatus = z.infer<typeof CoverageStatus>;

export const CoverageAreaSchema = z.object({
  dimension: CoverageDimension,
  requirementIds: z.array(z.string()),
  testCaseIds: z.array(z.string()),
  status: CoverageStatus,
  gap: z.string(),
});

export const SuggestionQuestionSchema = z.object({
  id: z.string().trim().min(1),
  question: z.string().trim().min(1),
  required: z.boolean().default(true),
});

export const DeepDiveSuggestionSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    value: z.string().trim().min(1),
    priority: RiskLevel,
    requirementIds: z.array(z.string()).min(1),
    estimatedTestCases: z.object({ min: z.number().int().min(1).max(10), max: z.number().int().min(1).max(10) }),
    status: z.enum(["Ready", "NeedsInput", "Exhausted"]),
    questions: z.array(SuggestionQuestionSchema),
  })
  .superRefine((value, ctx) => {
    if (value.estimatedTestCases.min > value.estimatedTestCases.max) {
      ctx.addIssue({ code: "custom", path: ["estimatedTestCases"], message: "Khoảng ước lượng không hợp lệ." });
    }
    if (value.status === "NeedsInput" && !value.questions.some((question) => question.required)) {
      ctx.addIssue({ code: "custom", path: ["questions"], message: "NeedsInput cần ít nhất một câu hỏi bắt buộc." });
    }
  });

export const AnalysisSchema = z.object({
  featureName: z.string(),
  requirements: z.array(RequirementSchema),
  ambiguities: z.array(AmbiguitySchema),
  testCases: z.array(TestCaseSchema).max(20),
  coverage: z.array(CoverageAreaSchema),
  deepDiveSuggestions: z.array(DeepDiveSuggestionSchema).min(3).max(6),
});

export type Requirement = z.infer<typeof RequirementSchema>;
export type Ambiguity = z.infer<typeof AmbiguitySchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type CoverageArea = z.infer<typeof CoverageAreaSchema>;
export type DeepDiveSuggestion = z.infer<typeof DeepDiveSuggestionSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

export interface Usage {
  mode: "live" | "mock";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

// Tiến độ server đẩy về trình duyệt khi AI đang chạy (đếm từ phần JSON AI đã viết ra)
export interface Progress {
  stage: "thinking" | "writing";
  requirements: number;
  ambiguities: number;
  testCases: number;
}

export interface AnalyzeResponse {
  analysis: Analysis;
  usage: Usage;
}

// Quyết định của tester cho từng test case
export type ReviewStatus = "pending" | "accepted" | "edited" | "rejected";

export interface ReviewedTestCase extends TestCase {
  status: ReviewStatus;
  note?: string;
}

export interface RejectedCandidate {
  title: string;
  reason: string;
}

export interface DeepenResponse {
  testCases: TestCase[];
  coverage: CoverageArea[];
  deepDiveSuggestions: DeepDiveSuggestion[];
  rejectedCandidates: RejectedCandidate[];
  message: string | null;
  usage: Usage;
}
