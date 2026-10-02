import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { buildUserPrompt } from "../src/lib/prompt.ts";
import { MOCK_ANALYSIS, scopeMockAnalysis } from "../src/lib/sample.ts";
import { AnalysisSchema, DeepDiveSuggestionSchema, TestCaseSchema } from "../src/lib/types.ts";

const REQ = "Tính năng: Đăng ký tài khoản bằng email và mật khẩu";

test("buildUserPrompt: uiContext đã trim được đưa vào prompt cùng scope", () => {
  const p = buildUserPrompt(REQ, { scope: "frontend", uiContext: "  Nút: 'Tạo tài khoản'  " });
  assert.match(p, /<scope>frontend<\/scope>/);
  assert.match(p, /<ui_context>\nNút: 'Tạo tài khoản'\n<\/ui_context>/);
});

test("buildUserPrompt: uiContext rỗng hoặc chỉ có khoảng trắng thì không gửi", () => {
  assert.doesNotMatch(buildUserPrompt(REQ, { scope: "frontend", uiContext: "   \n " }), /ui_context/);
  assert.doesNotMatch(buildUserPrompt(REQ, { scope: "frontend" }), /ui_context/);
});

test("buildUserPrompt: scope backend bỏ qua uiContext vì không sinh test trình bày", () => {
  assert.doesNotMatch(buildUserPrompt(REQ, { scope: "backend", uiContext: "Nút: 'Gửi'" }), /ui_context/);
});

test("buildUserPrompt: không truyền scope thì mặc định fullstack (request cũ)", () => {
  assert.equal(buildUserPrompt(REQ), buildUserPrompt(REQ, { scope: "fullstack" }));
  assert.match(buildUserPrompt(REQ), /<scope>fullstack<\/scope>/);
});

test("buildUserPrompt: hướng dẫn khác nhau theo từng scope", () => {
  const prompts = ["fullstack", "frontend", "backend"].map((scope) => buildUserPrompt(REQ, { scope }));
  assert.equal(new Set(prompts).size, 3);
});

const validCase = {
  id: "TC01",
  title: "t",
  requirementIds: ["R1"],
  type: "Positive",
  layer: "Integration",
  risk: "High",
  riskReason: "r",
  preconditions: "",
  steps: ["s"],
  expected: "e",
  coverageDimension: "Happy path",
  coverageKey: "valid-case",
  sourceSuggestionId: null,
};
const baseSuggestions = [1, 2, 3].map((n) => ({
  id: `S${n}`, title: `s${n}`, reason: "r", value: "v", priority: "Low",
  requirementIds: ["R1"], estimatedTestCases: { min: 5, max: 5 }, status: "Ready", questions: [],
}));
const withCase = (tc) => ({
  featureName: "f", requirements: [], ambiguities: [], testCases: [tc], coverage: [],
  deepDiveSuggestions: baseSuggestions,
});

test("AnalysisSchema: giữ nguyên layer của test case", () => {
  const out = AnalysisSchema.parse(withCase(validCase));
  assert.equal(out.testCases[0].layer, "Integration");
});

test("AnalysisSchema: layer là bắt buộc và chỉ nhận Frontend/Backend/Integration/E2E", () => {
  assert.equal(AnalysisSchema.safeParse(withCase({ ...validCase, layer: undefined })).success, false);
  assert.equal(AnalysisSchema.safeParse(withCase({ ...validCase, layer: "Mobile" })).success, false);
});

test("JSON schema gửi cho AI yêu cầu layer cho mỗi test case", () => {
  const schema = z.toJSONSchema(AnalysisSchema);
  assert.ok(schema.properties.testCases.items.required.includes("layer"));
});

test("MOCK_ANALYSIS: mọi test case có layer hợp lệ và qua AnalysisSchema", () => {
  const out = AnalysisSchema.parse(MOCK_ANALYSIS);
  for (const tc of out.testCases) assert.ok(tc.layer, `${tc.id} thiếu layer`);
});

test("buildUserPrompt: scope có giao diện hướng dẫn accessible name, focus và live announcement; không bịa aria", () => {
  for (const scope of ["frontend", "fullstack"]) {
    const p = buildUserPrompt(REQ, { scope });
    assert.match(p, /accessible name/, `${scope} thiếu accessible name`);
    assert.match(p, /focus visible/, `${scope} thiếu focus visible`);
    assert.match(p, /live announcement/, `${scope} thiếu live announcement`);
    assert.match(p, /toast/);
    assert.match(p, /inline error/);
    assert.match(p, /loading/);
    assert.match(p, /điểm mơ hồ[^\n]*không bịa aria-live/, `${scope} thiếu quy tắc ambiguity thay vì bịa`);
  }
  assert.doesNotMatch(buildUserPrompt(REQ, { scope: "backend" }), /accessible name|live announcement/);
});

const LAYERS_BY_SCOPE = {
  frontend: ["Frontend", "Integration", "E2E"],
  backend: ["Backend", "Integration"], // E2E cần giao diện nên không thuộc backend-only
  fullstack: ["Frontend", "Backend", "Integration", "E2E"],
};

test("scopeMockAnalysis: chỉ giữ layer thuộc scope, fullstack giữ tất cả", () => {
  for (const [scope, layers] of Object.entries(LAYERS_BY_SCOPE)) {
    const out = scopeMockAnalysis(MOCK_ANALYSIS, scope);
    assert.ok(out.testCases.length > 0);
    for (const tc of out.testCases) assert.ok(layers.includes(tc.layer), `${scope}: ${tc.id} layer ${tc.layer}`);
  }
  assert.deepEqual(scopeMockAnalysis(MOCK_ANALYSIS, "fullstack").testCases, MOCK_ANALYSIS.testCases);
  assert.ok(scopeMockAnalysis(MOCK_ANALYSIS, "frontend").testCases.length < MOCK_ANALYSIS.testCases.length);
  assert.ok(scopeMockAnalysis(MOCK_ANALYSIS, "backend").testCases.length < MOCK_ANALYSIS.testCases.length);
});

test("scopeMockAnalysis: không mutate MOCK_ANALYSIS", () => {
  const before = JSON.stringify(MOCK_ANALYSIS);
  for (const scope of Object.keys(LAYERS_BY_SCOPE)) {
    const out = scopeMockAnalysis(MOCK_ANALYSIS, scope);
    assert.notEqual(out, MOCK_ANALYSIS);
    assert.notEqual(out.testCases, MOCK_ANALYSIS.testCases);
  }
  assert.equal(JSON.stringify(MOCK_ANALYSIS), before);
});

test("scopeMockAnalysis: kết quả hợp lệ schema và mọi yêu cầu vẫn có test case (không phá truy vết)", () => {
  for (const scope of Object.keys(LAYERS_BY_SCOPE)) {
    const out = AnalysisSchema.parse(scopeMockAnalysis(MOCK_ANALYSIS, scope));
    for (const r of out.requirements) {
      assert.ok(out.testCases.some((t) => t.requirementIds.includes(r.id)), `${scope}: ${r.id} mất truy vết`);
    }
  }
});

test("TestCaseSchema: yêu cầu metadata coverage và nguồn đào sâu", () => {
  const out = TestCaseSchema.parse({
    ...validCase,
    coverageDimension: "Validation",
    coverageKey: "registration-email-valid",
    sourceSuggestionId: null,
  });
  assert.equal(out.coverageDimension, "Validation");
  assert.equal(out.coverageKey, "registration-email-valid");
  assert.equal(out.sourceSuggestionId, null);
});

test("AnalysisSchema: chứa coverage giải thích gap và 3–6 gợi ý đào sâu", () => {
  const result = AnalysisSchema.safeParse({
    featureName: "Đăng ký",
    requirements: [{ id: "R1", text: "Đăng ký bằng email" }],
    ambiguities: [],
    testCases: [{
      ...validCase,
      coverageDimension: "Happy path",
      coverageKey: "register-success",
      sourceSuggestionId: null,
    }],
    coverage: [{
      dimension: "Validation",
      requirementIds: ["R1"],
      testCaseIds: ["TC01"],
      status: "Partial",
      gap: "Chưa đánh giá email Unicode",
    }],
    deepDiveSuggestions: [1, 2, 3].map((n) => ({
      id: `S${n}`,
      title: `Hướng ${n}`,
      reason: "Còn rủi ro",
      value: "Tăng độ tin cậy",
      priority: "High",
      requirementIds: ["R1"],
      estimatedTestCases: { min: 5, max: 8 },
      status: "Ready",
      questions: [],
    })),
  });
  assert.equal(result.success, true);
  assert.equal(result.data.coverage[0].status, "Partial");
  assert.equal(result.data.deepDiveSuggestions.length, 3);
});

test("DeepDiveSuggestionSchema: NeedsInput phải có câu hỏi bắt buộc", () => {
  const base = {
    id: "S1",
    title: "OTP recovery",
    reason: "Thiếu quy tắc",
    value: "Tránh khóa tài khoản sai",
    priority: "High",
    requirementIds: ["R1"],
    estimatedTestCases: { min: 5, max: 10 },
    status: "NeedsInput",
    questions: [],
  };
  assert.equal(DeepDiveSuggestionSchema.safeParse(base).success, false);
  assert.equal(DeepDiveSuggestionSchema.safeParse({
    ...base,
    questions: [{ id: "Q1", question: "OTP hết hạn sau bao lâu?", required: true }],
  }).success, true);
});
