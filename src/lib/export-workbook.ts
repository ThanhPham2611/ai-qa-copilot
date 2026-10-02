import ExcelJS from "exceljs";
import type { Ambiguity, CoverageArea, DeepDiveSuggestion, Requirement, ReviewedTestCase } from "./types";

export interface ExportWorkbookData {
  mode: "live" | "mock";
  featureName: string;
  requirements: Requirement[];
  ambiguities: Ambiguity[];
  testCases: ReviewedTestCase[];
  coverage: CoverageArea[];
  deepDiveSuggestions: DeepDiveSuggestion[];
}

const STATUS_VI = { pending: "Chưa duyệt", accepted: "Chấp nhận", edited: "Đã sửa", rejected: "Loại" } as const;
const safe = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  row.alignment = { vertical: "middle", wrapText: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function finish(sheet: ExcelJS.Worksheet) {
  styleHeader(sheet);
  sheet.eachRow((row, number) => {
    if (number > 1) row.alignment = { vertical: "top", wrapText: true };
  });
}

export function buildExportWorkbook(data: ExportWorkbookData): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AI QA Copilot";
  workbook.created = new Date();
  const kept = data.testCases.filter((testCase) => testCase.status !== "rejected");

  const testCases = workbook.addWorksheet("Test cases");
  testCases.columns = [
    { header: "ID", key: "id", width: 8 }, { header: "Tiêu đề", key: "title", width: 40 },
    { header: "Yêu cầu", key: "req", width: 12 }, { header: "Loại", key: "type", width: 12 },
    { header: "Tầng", key: "layer", width: 12 }, { header: "Coverage", key: "dimension", width: 18 },
    { header: "Coverage key", key: "coverageKey", width: 28 }, { header: "Nguồn đào sâu", key: "source", width: 14 },
    { header: "Rủi ro", key: "risk", width: 10 }, { header: "Lý do rủi ro", key: "riskReason", width: 28 },
    { header: "Điều kiện trước", key: "pre", width: 30 }, { header: "Các bước", key: "steps", width: 50 },
    { header: "Kết quả mong đợi", key: "expected", width: 40 }, { header: "Trạng thái duyệt", key: "status", width: 14 },
    { header: "Kết quả test (Pass/Fail)", key: "result", width: 14 },
  ];
  for (const item of kept) testCases.addRow({
    id: safe(item.id), title: safe(item.title), req: safe(item.requirementIds.join(", ")), type: item.type,
    layer: item.layer, dimension: item.coverageDimension, coverageKey: safe(item.coverageKey),
    source: safe(item.sourceSuggestionId ?? "Lô đầu"), risk: item.risk, riskReason: safe(item.riskReason),
    pre: safe(item.preconditions), steps: safe(item.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")),
    expected: safe(item.expected), status: STATUS_VI[item.status], result: "",
  });
  finish(testCases);

  const ambiguities = workbook.addWorksheet("Điểm mơ hồ");
  ambiguities.columns = [
    { header: "ID", key: "id", width: 8 }, { header: "Yêu cầu", key: "req", width: 10 },
    { header: "Mức độ", key: "sev", width: 10 }, { header: "Vấn đề", key: "issue", width: 50 },
    { header: "Câu hỏi cho khách hàng / BA", key: "q", width: 50 }, { header: "Trả lời", key: "answer", width: 30 },
  ];
  for (const item of data.ambiguities) ambiguities.addRow({
    id: safe(item.id), req: safe(item.requirementId ?? ""), sev: item.severity, issue: safe(item.issue), q: safe(item.question), answer: "",
  });
  finish(ambiguities);

  const coverage = workbook.addWorksheet("Coverage");
  coverage.columns = [
    { header: "Dimension", key: "dimension", width: 20 }, { header: "Trạng thái", key: "status", width: 16 },
    { header: "Yêu cầu", key: "requirements", width: 20 }, { header: "Test case được giữ", key: "testCases", width: 28 },
    { header: "Khoảng trống", key: "gap", width: 55 },
  ];
  const keptIds = new Set(kept.map((item) => item.id));
  for (const area of data.coverage) coverage.addRow({
    dimension: area.dimension, status: area.status, requirements: safe(area.requirementIds.join(", ")),
    testCases: safe(area.testCaseIds.filter((id) => keptIds.has(id)).join(", ")), gap: safe(area.gap),
  });
  finish(coverage);

  const suggestions = workbook.addWorksheet("Gợi ý đào sâu");
  suggestions.columns = [
    { header: "ID", key: "id", width: 14 }, { header: "Hướng", key: "title", width: 34 },
    { header: "Ưu tiên", key: "priority", width: 12 }, { header: "Trạng thái", key: "status", width: 14 },
    { header: "Yêu cầu", key: "requirements", width: 18 }, { header: "Giá trị", key: "value", width: 40 },
    { header: "Lý do", key: "reason", width: 40 }, { header: "Ước lượng", key: "estimate", width: 14 },
    { header: "Cần làm rõ", key: "questions", width: 50 },
  ];
  for (const item of data.deepDiveSuggestions) suggestions.addRow({
    id: safe(item.id), title: safe(item.title), priority: item.priority, status: item.status,
    requirements: safe(item.requirementIds.join(", ")), value: safe(item.value), reason: safe(item.reason),
    estimate: `${item.estimatedTestCases.min}–${item.estimatedTestCases.max}`,
    questions: safe(item.questions.map((question) => question.question).join("\n")),
  });
  finish(suggestions);

  const trace = workbook.addWorksheet("Truy vết");
  trace.columns = [
    { header: "Yêu cầu", key: "id", width: 10 }, { header: "Nội dung", key: "text", width: 50 },
    { header: "Test case bao phủ", key: "tcs", width: 30 }, { header: "Trạng thái", key: "cov", width: 16 },
  ];
  for (const requirement of data.requirements) {
    const ids = kept.filter((item) => item.requirementIds.includes(requirement.id)).map((item) => item.id);
    trace.addRow({ id: safe(requirement.id), text: safe(requirement.text), tcs: safe(ids.join(", ")), cov: ids.length ? "Đã bao phủ" : "CHƯA có test case" });
  }
  finish(trace);
  return workbook;
}
