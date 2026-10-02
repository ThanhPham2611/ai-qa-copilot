import type { Analysis, Layer, Scope } from "./types";

// Yêu cầu mẫu tự viết (không phải dữ liệu khách hàng) để demo.
export const SAMPLE_REQUIREMENT = `Tính năng: Chuyển tiền nội bộ

- Người dùng đã đăng nhập có thể chuyển tiền cho tài khoản khác trong cùng ngân hàng.
- Người dùng nhập số tài khoản nhận, số tiền và nội dung chuyển khoản.
- Hệ thống hiển thị tên chủ tài khoản nhận để người dùng xác nhận.
- Số tiền tối thiểu 10.000đ. Hạn mức mỗi ngày 50.000.000đ.
- Người dùng xác nhận bằng mã OTP gửi qua SMS.
- Giao dịch thành công thì trừ tiền tài khoản gửi và hiển thị biên lai.`;

// Kết quả mô phỏng dùng khi chưa có API key, để demo không tốn credit.
export const MOCK_ANALYSIS: Analysis = {
  featureName: "Chuyển tiền nội bộ",
  requirements: [
    { id: "R1", text: "Chỉ người dùng đã đăng nhập được chuyển tiền trong cùng ngân hàng" },
    { id: "R2", text: "Nhập số tài khoản nhận, số tiền, nội dung chuyển khoản" },
    { id: "R3", text: "Hiển thị tên chủ tài khoản nhận để xác nhận" },
    { id: "R4", text: "Số tiền tối thiểu 10.000đ, hạn mức 50.000.000đ/ngày" },
    { id: "R5", text: "Xác nhận bằng OTP qua SMS" },
    { id: "R6", text: "Thành công: trừ tiền tài khoản gửi và hiển thị biên lai" },
  ],
  ambiguities: [
    {
      id: "A1",
      requirementId: "R4",
      issue: "Chưa rõ hạn mức 50 triệu tính theo ngày dương lịch hay 24 giờ trượt, và theo múi giờ nào.",
      question: "Hạn mức ngày được reset lúc 00:00 (giờ Việt Nam) hay tính 24 giờ gần nhất?",
      severity: "High",
    },
    {
      id: "A2",
      requirementId: "R4",
      issue: "Không nói số dư không đủ thì xử lý thế nào, và có tính phí giao dịch không.",
      question: "Khi số dư nhỏ hơn số tiền chuyển, hệ thống báo lỗi ở bước nhập hay bước xác nhận? Có phí giao dịch không?",
      severity: "High",
    },
    {
      id: "A3",
      requirementId: "R5",
      issue: "Thiếu thời hạn hiệu lực OTP, số lần nhập sai tối đa và việc gửi lại OTP.",
      question: "OTP hết hạn sau bao lâu? Nhập sai bao nhiêu lần thì khóa? Có cho gửi lại OTP không?",
      severity: "High",
    },
    {
      id: "A4",
      requirementId: "R2",
      issue: "Chưa có giới hạn độ dài và ký tự cho phép của nội dung chuyển khoản.",
      question: "Nội dung chuyển khoản tối đa bao nhiêu ký tự, có cho tiếng Việt có dấu và emoji không?",
      severity: "Medium",
    },
    {
      id: "A5",
      requirementId: "R1",
      issue: "Chưa rõ có được chuyển cho chính tài khoản của mình không.",
      question: "Người dùng có được chuyển tiền giữa hai tài khoản của chính mình không?",
      severity: "Low",
    },
  ],
  testCases: [
    {
      id: "TC01",
      title: "Chuyển tiền thành công với số tiền hợp lệ",
      requirementIds: ["R2", "R3", "R5", "R6"],
      type: "Positive",
      layer: "E2E",
      risk: "High",
      riskReason: "Luồng chính liên quan tiền",
      preconditions: "Đã đăng nhập, số dư 1.000.000đ, chưa chuyển khoản nào trong ngày",
      steps: [
        "Nhập số tài khoản nhận hợp lệ",
        "Kiểm tra tên chủ tài khoản hiển thị đúng",
        "Nhập số tiền 100.000đ và nội dung",
        "Nhập OTP đúng",
      ],
      expected: "Giao dịch thành công, số dư còn 900.000đ, hiển thị biên lai đúng thông tin",
      coverageDimension: "Happy path", coverageKey: "transfer-success", sourceSuggestionId: null,
    },
    {
      id: "TC02",
      title: "Số tiền bằng mức tối thiểu 10.000đ",
      requirementIds: ["R4"],
      type: "Boundary",
      layer: "Backend",
      risk: "Medium",
      riskReason: "Giá trị biên của quy tắc tiền",
      preconditions: "Đã đăng nhập, số dư đủ",
      steps: ["Nhập số tài khoản hợp lệ", "Nhập số tiền 10.000đ", "Xác nhận OTP"],
      expected: "Giao dịch thành công",
      coverageDimension: "Boundary", coverageKey: "amount-minimum-10000", sourceSuggestionId: null,
    },
    {
      id: "TC03",
      title: "Số tiền nhỏ hơn mức tối thiểu (9.999đ)",
      requirementIds: ["R4"],
      type: "Negative",
      layer: "Frontend",
      risk: "Medium",
      riskReason: "Giá trị biên của quy tắc tiền",
      preconditions: "Đã đăng nhập",
      steps: ["Nhập số tài khoản hợp lệ", "Nhập số tiền 9.999đ"],
      expected: "Không cho tiếp tục, hiển thị thông báo số tiền tối thiểu 10.000đ",
      coverageDimension: "Boundary", coverageKey: "amount-below-minimum-9999", sourceSuggestionId: null,
    },
    {
      id: "TC04",
      title: "Tổng giao dịch trong ngày vượt hạn mức 50 triệu",
      requirementIds: ["R4"],
      type: "Boundary",
      layer: "Backend",
      risk: "High",
      riskReason: "Hạn mức tiền, dễ bị lợi dụng",
      preconditions: "Đã chuyển 49.990.000đ trong ngày",
      steps: ["Chuyển thêm 20.000đ"],
      expected: "Bị từ chối, thông báo vượt hạn mức ngày",
      coverageDimension: "Boundary", coverageKey: "daily-limit-exceeded", sourceSuggestionId: null,
    },
    {
      id: "TC05",
      title: "Nhập số tiền âm, bằng 0 hoặc có phần thập phân",
      requirementIds: ["R4"],
      type: "Negative",
      layer: "Integration",
      risk: "High",
      riskReason: "Nhập liệu sai trên trường tiền",
      preconditions: "Đã đăng nhập",
      steps: ["Lần lượt nhập -10.000, 0 và 10.000,5 vào ô số tiền"],
      expected: "Cả ba giá trị đều bị từ chối với thông báo phù hợp",
      coverageDimension: "Validation", coverageKey: "amount-invalid-format", sourceSuggestionId: null,
    },
    {
      id: "TC06",
      title: "Số tài khoản nhận không tồn tại",
      requirementIds: ["R2", "R3"],
      type: "Negative",
      layer: "Integration",
      risk: "Medium",
      riskReason: "Tránh chuyển nhầm tài khoản",
      preconditions: "Đã đăng nhập",
      steps: ["Nhập số tài khoản không tồn tại"],
      expected: "Không hiển thị tên, báo tài khoản không hợp lệ, không cho tiếp tục",
      coverageDimension: "Validation", coverageKey: "recipient-not-found", sourceSuggestionId: null,
    },
    {
      id: "TC07",
      title: "Nhập sai OTP",
      requirementIds: ["R5"],
      type: "Security",
      layer: "Backend",
      risk: "High",
      riskReason: "Xác thực giao dịch tiền",
      preconditions: "Đang ở bước nhập OTP",
      steps: ["Nhập OTP sai"],
      expected: "Giao dịch không thực hiện, số dư không đổi (số lần sai tối đa chờ làm rõ A3)",
      coverageDimension: "Security", coverageKey: "otp-invalid", sourceSuggestionId: null,
    },
    {
      id: "TC08",
      title: "Bấm xác nhận hai lần liên tiếp (double submit)",
      requirementIds: ["R6"],
      type: "Negative",
      layer: "Integration",
      risk: "High",
      riskReason: "Có thể trừ tiền hai lần",
      preconditions: "Đang ở bước xác nhận OTP, OTP đúng",
      steps: ["Bấm nút xác nhận hai lần thật nhanh"],
      expected: "Chỉ tạo đúng một giao dịch, tiền chỉ bị trừ một lần",
      coverageDimension: "Concurrency", coverageKey: "double-submit-idempotent", sourceSuggestionId: null,
    },
    {
      id: "TC09",
      title: "Truy cập màn hình chuyển tiền khi chưa đăng nhập",
      requirementIds: ["R1"],
      type: "Security",
      layer: "Integration",
      risk: "High",
      riskReason: "Phân quyền truy cập",
      preconditions: "Chưa đăng nhập",
      steps: ["Mở trực tiếp đường dẫn màn hình chuyển tiền"],
      expected: "Bị chuyển về màn hình đăng nhập",
      coverageDimension: "Authorization", coverageKey: "anonymous-transfer-denied", sourceSuggestionId: null,
    },
    {
      id: "TC10",
      title: "Biên lai hiển thị đúng thông tin giao dịch",
      requirementIds: ["R6"],
      type: "UI",
      layer: "Frontend",
      risk: "Low",
      riskReason: "Hiển thị, không ảnh hưởng số dư",
      preconditions: "Vừa chuyển tiền thành công",
      steps: ["Xem biên lai"],
      expected: "Có mã giao dịch, thời gian, tài khoản nhận, tên người nhận, số tiền, nội dung",
      coverageDimension: "Integration", coverageKey: "receipt-details", sourceSuggestionId: null,
    },
  ],
  coverage: [
    { dimension: "Happy path", requirementIds: ["R2", "R3", "R5", "R6"], testCaseIds: ["TC01"], status: "Covered", gap: "" },
    { dimension: "Boundary", requirementIds: ["R4"], testCaseIds: ["TC02", "TC03", "TC04"], status: "Partial", gap: "Chưa đánh giá thời điểm reset hạn mức ngày." },
    { dimension: "Security", requirementIds: ["R1", "R5"], testCaseIds: ["TC07", "TC09"], status: "Partial", gap: "Thiếu quy tắc vòng đời và giới hạn OTP." },
    { dimension: "Concurrency", requirementIds: ["R6"], testCaseIds: ["TC08"], status: "Partial", gap: "Chưa đánh giá hai yêu cầu đồng thời từ nhiều thiết bị." },
  ],
  deepDiveSuggestions: [
    {
      id: "S1", title: "Vòng đời và khôi phục OTP", reason: "Quy tắc OTP còn thiếu.",
      value: "Giảm rủi ro xác thực sai hoặc khóa nhầm.", priority: "High", requirementIds: ["R5"],
      estimatedTestCases: { min: 5, max: 8 }, status: "NeedsInput",
      questions: [{ id: "Q1", question: "OTP hết hạn sau bao lâu và được nhập sai tối đa mấy lần?", required: true }],
    },
    {
      id: "S2", title: "Đồng thời và idempotency", reason: "Giao dịch tiền có nguy cơ bị thực hiện lặp.",
      value: "Bảo vệ số dư khi retry hoặc gửi từ nhiều thiết bị.", priority: "High", requirementIds: ["R6"],
      estimatedTestCases: { min: 5, max: 7 }, status: "Ready", questions: [],
    },
    {
      id: "S3", title: "Biên hạn mức theo ngày", reason: "Mốc reset hạn mức chưa được kiểm tra.",
      value: "Phát hiện sai lệch tính hạn mức ở ranh giới thời gian.", priority: "Medium", requirementIds: ["R4"],
      estimatedTestCases: { min: 5, max: 6 }, status: "NeedsInput",
      questions: [{ id: "Q1", question: "Hạn mức reset theo múi giờ và mốc thời gian nào?", required: true }],
    },
  ],
};

// Mock theo phạm vi: giữ test case có layer thuộc scope; ghi đè requirement/ambiguity nguyên vẹn để schema và truy vết không đổi.
// Integration giữ cho cả hai scope (giao điểm UI-backend); E2E cần giao diện nên không thuộc backend-only, khớp prompt live.
// Mã TC không đánh số lại.
// Mọi yêu cầu mẫu vẫn có ít nhất một test case ở mỗi scope (có test kiểm tra).
const MOCK_LAYERS: Record<Scope, readonly Layer[]> = {
  fullstack: ["Frontend", "Backend", "Integration", "E2E"],
  frontend: ["Frontend", "Integration", "E2E"],
  backend: ["Backend", "Integration"],
};

export function scopeMockAnalysis(analysis: Analysis, scope: Scope): Analysis {
  const testCases = analysis.testCases.filter((t) => MOCK_LAYERS[scope].includes(t.layer));
  const ids = new Set(testCases.map((testCase) => testCase.id));
  return {
    ...analysis,
    testCases,
    coverage: analysis.coverage.map((area) => ({
      ...area,
      testCaseIds: area.testCaseIds.filter((id) => ids.has(id)),
      status: area.testCaseIds.some((id) => ids.has(id)) ? area.status : "NotAssessed",
    })),
  };
}
