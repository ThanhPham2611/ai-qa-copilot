import assert from "node:assert/strict";
import { test } from "node:test";
import { filterDeepDiveCandidates, mergeCoverage } from "../src/lib/coverage.ts";
import { buildDeepenPrompt } from "../src/lib/prompt.ts";
import { FixedWindowRateLimiter } from "../src/lib/rate-limit.ts";

const makeCase = (overrides = {}) => ({
  id: "ignored",
  title: "Từ chối số tiền 9.999đ",
  requirementIds: ["R1"],
  type: "Boundary",
  layer: "Backend",
  risk: "High",
  riskReason: "Biên tiền",
  preconditions: "Đã đăng nhập",
  steps: ["Nhập 9.999đ"],
  expected: "Từ chối giao dịch",
  coverageDimension: "Boundary",
  coverageKey: "amount-below-minimum-9999",
  sourceSuggestionId: "S1",
  ...overrides,
});

const existing = [{ ...makeCase({ id: "TC09", sourceSuggestionId: null }), status: "accepted" }];
const suggestion = {
  id: "S1", title: "Biên số tiền", reason: "Rủi ro", value: "Giá trị", priority: "High",
  requirementIds: ["R1"], estimatedTestCases: { min: 5, max: 8 }, status: "Ready", questions: [],
};

test("dedup: chặn coverageKey trùng và server tự gán ID tiếp nối", () => {
  const result = filterDeepDiveCandidates({
    candidates: [makeCase(), makeCase({ coverageKey: "amount-minimum-10000", title: "Chấp nhận 10.000đ", steps: ["Nhập 10.000đ"], expected: "Chấp nhận giao dịch" })],
    existingCases: existing,
    requirements: [{ id: "R1", text: "Số tiền tối thiểu 10.000đ" }],
    suggestion,
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].id, "TC10");
  assert.equal(result.rejected[0].reason, "Trùng coverageKey với test case hiện có");
});

test("dedup: fingerprint chuẩn hóa Unicode, hoa thường, dấu câu và khoảng trắng", () => {
  const rejected = [{ ...makeCase({ id: "TC02", title: "ĐĂNG NHẬP thành công!", steps: ["Nhập e-mail"] }), status: "rejected" }];
  const candidate = makeCase({
    coverageKey: "alternative-key",
    title: "dang nhap thanh cong",
    steps: ["Nhap e mail"],
  });
  const result = filterDeepDiveCandidates({
    candidates: [candidate], existingCases: rejected,
    requirements: [{ id: "R1", text: "Đăng nhập" }], suggestion,
  });
  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].reason, /nguyên văn|fingerprint/i);
});

test("dedup: không gộp hai boundary case khác giá trị", () => {
  const result = filterDeepDiveCandidates({
    candidates: [makeCase({ coverageKey: "amount-minimum-10000", title: "Số tiền 10.000đ", steps: ["Nhập 10.000đ"] })],
    existingCases: existing,
    requirements: [{ id: "R1", text: "Số tiền tối thiểu 10.000đ" }], suggestion,
  });
  assert.equal(result.accepted.length, 1);
});

test("dedup: loại requirement ID giả và case lệch hướng đào sâu", () => {
  const result = filterDeepDiveCandidates({
    candidates: [
      makeCase({ coverageKey: "fake", requirementIds: ["R404"] }),
      makeCase({ coverageKey: "off-scope", requirementIds: ["R2"] }),
    ],
    existingCases: [],
    requirements: [{ id: "R1", text: "Số tiền" }, { id: "R2", text: "Ảnh đại diện" }],
    suggestion,
  });
  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].reason, /không tồn tại/);
  assert.match(result.rejected[1].reason, /hướng đào sâu/);
});

test("buildDeepenPrompt: chỉ dùng requirement gốc, hướng chọn, câu trả lời và catalog hiện có", () => {
  const prompt = buildDeepenPrompt({
    requirement: "Người dùng chuyển tối thiểu 10.000đ",
    scope: "backend",
    uiContext: "Nội dung UI không được dùng",
    existingCases: existing,
    coverage: [],
    suggestion: { ...suggestion, status: "NeedsInput", questions: [{ id: "Q1", question: "Mốc biên?", required: true }] },
    answers: { Q1: "10.000đ" },
  });
  assert.match(prompt, /10\.000đ/);
  assert.match(prompt, /amount-below-minimum-9999/);
  assert.match(prompt, /<answers>/);
  assert.doesNotMatch(prompt, /Nội dung UI không được dùng/);
});

test("rate limit: dùng chung một ngân sách và nhả request sau một giờ", () => {
  const limiter = new FixedWindowRateLimiter();
  assert.equal(limiter.allow(2, 1_000), true);
  assert.equal(limiter.allow(2, 2_000), true);
  assert.equal(limiter.allow(2, 3_000), false);
  assert.equal(limiter.allow(2, 3_601_001), true);
});

test("mergeCoverage: coverage cục bộ từ lượt đào sâu không làm mất khu vực cũ", () => {
  const current = [
    { dimension: "Happy path", requirementIds: ["R1"], testCaseIds: ["TC01"], status: "Covered", gap: "" },
    { dimension: "Security", requirementIds: ["R1"], testCaseIds: ["TC02"], status: "Partial", gap: "Còn thiếu" },
  ];
  const proposed = [
    { dimension: "Security", requirementIds: ["R1"], testCaseIds: ["TC02", "AI1"], status: "Covered", gap: "" },
  ];
  const reviewed = [
    { ...makeCase({ id: "TC01", coverageDimension: "Happy path", coverageKey: "happy" }), status: "accepted" },
    { ...makeCase({ id: "TC02", coverageDimension: "Security", coverageKey: "security" }), status: "accepted" },
  ];
  const added = [makeCase({ id: "TC03", coverageDimension: "Security", coverageKey: "security-new" })];
  const merged = mergeCoverage(current, proposed, reviewed, added);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.find((area) => area.dimension === "Happy path").testCaseIds, ["TC01"]);
  assert.deepEqual(merged.find((area) => area.dimension === "Security").testCaseIds.sort(), ["TC02", "TC03"]);
});
