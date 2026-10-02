import assert from "node:assert/strict";
import { test } from "node:test";
import { appendDeepDiveCases } from "../src/lib/session.ts";
import { buildExportWorkbook } from "../src/lib/export-workbook.ts";

const baseCase = {
  id: "TC01", title: "Cũ", requirementIds: ["R1"], type: "Positive", layer: "E2E", risk: "High",
  riskReason: "r", preconditions: "", steps: ["s"], expected: "e", coverageDimension: "Happy path",
  coverageKey: "old", sourceSuggestionId: null,
};

test("appendDeepDiveCases: giữ trạng thái và nội dung đã sửa, testcase mới là pending", () => {
  const old = [{ ...baseCase, title: "Tester đã sửa", status: "edited", note: "giữ lại" }];
  const added = [{ ...baseCase, id: "TC02", title: "Mới", coverageKey: "new", sourceSuggestionId: "S1" }];
  const result = appendDeepDiveCases(old, added);
  assert.equal(result[0], old[0]);
  assert.equal(result[0].title, "Tester đã sửa");
  assert.equal(result[0].status, "edited");
  assert.equal(result[1].status, "pending");
});

test("buildExportWorkbook: xuất test case, ambiguity, coverage, gợi ý và traceability", () => {
  const workbook = buildExportWorkbook({
    mode: "mock",
    featureName: "F",
    requirements: [{ id: "R1", text: "Requirement" }],
    ambiguities: [],
    testCases: [{ ...baseCase, status: "accepted" }],
    coverage: [{ dimension: "Happy path", requirementIds: ["R1"], testCaseIds: ["TC01"], status: "Covered", gap: "" }],
    deepDiveSuggestions: [1, 2, 3].map((n) => ({
      id: `S${n}`, title: `Hướng ${n}`, reason: "r", value: "v", priority: "Low", requirementIds: ["R1"],
      estimatedTestCases: { min: 5, max: 5 }, status: "Ready", questions: [],
    })),
  });
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    "Test cases", "Điểm mơ hồ", "Coverage", "Gợi ý đào sâu", "Truy vết",
  ]);
  assert.equal(workbook.getWorksheet("Coverage").getRow(2).getCell(1).value, "Happy path");
});
