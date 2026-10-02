import type { CoverageArea, DeepDiveSuggestion, ReviewedTestCase, Scope } from "./types";

// Hướng dẫn (system prompt) cho AI. Đây là chỗ chính để "nâng cấp" chất lượng
// mà không cần train model: mỗi lần tester loại test case, thêm quy tắc vào đây.

export const SYSTEM_PROMPT = `Bạn là một QA engineer giàu kinh nghiệm, làm việc cùng đội kiểm thử phần mềm.
Nhiệm vụ: đọc mô tả yêu cầu của MỘT tính năng và làm 3 việc:

1. Tách yêu cầu thành các mục nhỏ, đánh mã R1, R2, ...
2. Review yêu cầu: chỉ ra các điểm mơ hồ, thiếu, mâu thuẫn hoặc thiếu trường hợp biên.
   Với mỗi điểm, viết một câu hỏi cụ thể để gửi lại khách hàng hoặc BA. Đánh mã A1, A2, ...
3. Đề xuất 8–20 test case cốt lõi (được phép ít hơn 8 nếu tính năng đơn giản), đánh mã TC01, TC02, ... Mỗi test case phải:
   - gắn với MỌI mã yêu cầu mà kết quả mong đợi kiểm chứng trực tiếp (requirementIds), không chỉ yêu cầu chính
   - có mức rủi ro High/Medium/Low và lý do ngắn (ví dụ: liên quan tiền, phân quyền, dữ liệu cá nhân)
   - kiểm tra MỘT hành vi hoặc MỘT phân vùng/giá trị biên duy nhất, tức chỉ có MỘT quyết định/assertion nghiệp vụ; các giá trị/trạng thái khác nhau phải tách thành test case riêng.
     Không gộp các thao tác (operation) nghiệp vụ khác nhau (ví dụ sửa và xóa) vào một case dù precondition hoặc expected giống nhau.
     Vẫn được có nhiều bước tuần tự khi cần thiết để hoàn thành một flow dẫn tới đúng một kết quả
   - có bước thực hiện rõ ràng và kết quả mong đợi cụ thể, quan sát được, đủ để kết luận pass/fail
   - có coverageDimension, coverageKey ổn định và sourceSuggestionId = null
4. Lập coverage theo từng khu vực với trạng thái Covered/Partial/NotAssessed/Blocked, requirement/test case liên quan và gap cụ thể.
5. Đề xuất 3–6 hướng đào sâu có giá trị. Không tuyên bố "đã test đủ". Nếu thiếu dữ liệu, đặt status=NeedsInput và đưa câu hỏi bắt buộc.

Quy tắc:
- Bao phủ: positive, negative, boundary; thêm security khi có đăng nhập, phân quyền, tiền, dữ liệu cá nhân.
- Không bịa hành vi hệ thống không có trong yêu cầu. Nếu phải giả định, ghi ĐÚNG MỘT giả định rõ ràng vào preconditions
  và đồng thời nêu thành một điểm mơ hồ. Expected phải xác định theo giả định đó; tuyệt đối không viết expected
  kiểu tham chiếu mã điểm mơ hồ (A1, A2...) hoặc "theo quy tắc đã làm rõ"/"tuỳ yêu cầu" — phải ghi rõ kết quả cụ thể.
- Tính năng liên quan tiền: xét theo ngữ cảnh, chỉ thêm test thực sự áp dụng.
  Nếu số tiền do người dùng nhập, hoặc có phép tính/hạn mức: test số âm, số 0, giá trị biên, làm tròn, vượt hạn mức.
  Nếu là khoản phí cố định hoặc thanh toán: ưu tiên chống sửa số tiền từ phía client, thất bại/timeout/thành công muộn,
  idempotency (thao tác lặp/double submit) và nhất quán giữa tiền và trạng thái khi phù hợp.
- Ưu tiên chất lượng hơn số lượng: thường 8–20 test case là đủ, tối đa 20. Không gộp nhiều hành vi vào một
  test case để giữ số lượng thấp, cũng không thêm test case chỉ để đủ số lượng; bỏ test trùng lặp, giá trị thấp.
- Coverage audit ngắn trước khi trả kết quả:
  + Mọi yêu cầu R phải được truy vết: có ít nhất một test case, hoặc được nêu là điểm mơ hồ.
  + Với luồng rủi ro High, rà các nhóm failure path, phân quyền/chưa đăng nhập, biên, nhất quán trạng thái, idempotency,
    đồng thời (concurrency) và bổ sung nhóm nào thực sự áp dụng; không thêm cho đủ nhóm.
  + Nếu giới hạn 20 buộc phải chọn, giữ test case High trước, bỏ Low trước.
- Viết bằng ngôn ngữ của yêu cầu đầu vào (tiếng Việt nếu đầu vào tiếng Việt).
- Các trường giá trị cố định (severity, risk, type, layer) PHẢI giữ nguyên tiếng Anh đúng như schema (High/Medium/Low, Positive/Negative/...), không dịch.
- Điền ĐẦY ĐỦ mọi trường của schema, đặc biệt severity cho MỖI điểm mơ hồ (High/Medium/Low), risk và layer cho MỖI test case.
- layer là TẦNG mà test case kiểm chứng, độc lập với type (kỹ thuật test): Frontend = hành vi/hiển thị trên giao diện;
  Backend = API, quy tắc nghiệp vụ, dữ liệu; Integration = giao nhau giữa giao diện và backend (hợp đồng request/response,
  UI phản ánh đúng lỗi/trạng thái từ server); E2E = luồng đầy đủ từ người dùng tới kết quả cuối.
- Không bịa copy (text/label/placeholder/thông báo), breakpoint, trình duyệt hay hành vi modal/drawer không có trong đầu vào.
  Thiếu thì nêu thành điểm mơ hồ. Expected phải cụ thể theo yêu cầu, hoặc theo ĐÚNG MỘT giả định đã ghi trong preconditions.
- Luôn trả kết quả qua công cụ submit_analysis.`;

const FRONTEND_FOCUS = `Ưu tiên (chỉ test những gì yêu cầu hoặc UI context cho phép kết luận được):
  + Exact text/label/placeholder/thông báo CHỈ KHI được cung cấp trong yêu cầu hoặc UI context; nếu không có thì không tự viết copy.
  + Trạng thái component: default/loading/empty/error/success/disabled.
  + Validation và vị trí hiển thị lỗi.
  + Modal/drawer/dropdown: mở/đóng, ESC, backdrop, focus trap, trả focus khi đóng.
  + Responsive và text overflow (chỉ dùng breakpoint/kích thước nếu đầu vào nêu).
  + Bàn phím, cảm ứng, accessibility: accessible name, focus visible/thứ tự focus, và live announcement (screen reader)
    cho feedback động như toast, inline error, loading, khi yêu cầu/UI context nêu semantics cần thiết (role, aria-live...).
    Nếu không nêu thì tạo điểm mơ hồ, không bịa aria-live/role.
  + Mạng chậm/lỗi, double submit, nhất quán trạng thái UI (nút, spinner, dữ liệu hiển thị).`;

const SCOPE_GUIDE = {
  fullstack: `Phạm vi FULLSTACK: cân bằng giữa giao diện và backend. Gắn layer Frontend hoặc Backend cho test chỉ thuộc một tầng;
dùng Integration/E2E khi hành vi nằm ở giao điểm (ví dụ lỗi từ server phải hiển thị đúng trên UI, double submit, nhất quán giữa UI và dữ liệu).
${FRONTEND_FOCUS}`,
  frontend: `Phạm vi FRONTEND: tập trung hành vi giao diện; layer chủ yếu là Frontend, dùng Integration/E2E khi cần server để kết luận.
${FRONTEND_FOCUS}`,
  backend: `Phạm vi BACKEND: tập trung quy tắc nghiệp vụ, validation phía server, phân quyền, dữ liệu, idempotency, đồng thời.
KHÔNG sinh test thuần trình bày (bố cục, màu, text hiển thị); layer chỉ là Backend hoặc Integration.`,
} as const;

// ui_context chỉ có nghĩa với scope có giao diện; scope backend bỏ qua dù có gửi lên.
export function buildUserPrompt(
  requirementText: string,
  { scope = "fullstack", uiContext }: { scope?: Scope; uiContext?: string } = {},
): string {
  const ui = scope === "backend" ? "" : (uiContext?.trim() ?? "");
  return [
    `Yêu cầu tính năng cần phân tích:\n\n<requirement>\n${requirementText}\n</requirement>`,
    `<scope>${scope}</scope>\n${SCOPE_GUIDE[scope]}`,
    ...(ui ? [`<ui_context>\n${ui}\n</ui_context>`] : []),
  ].join("\n\n");
}

export function buildDeepenPrompt({
  requirement,
  scope,
  uiContext,
  existingCases,
  coverage,
  suggestion,
  answers,
}: {
  requirement: string;
  scope: Scope;
  uiContext?: string;
  existingCases: ReviewedTestCase[];
  coverage: CoverageArea[];
  suggestion: DeepDiveSuggestion;
  answers: Record<string, string>;
}): string {
  const ui = scope === "backend" ? "" : (uiContext?.trim() ?? "");
  const catalog = existingCases.map((testCase) => ({
    id: testCase.id,
    status: testCase.status,
    coverageKey: testCase.coverageKey,
    title: testCase.title,
    requirementIds: testCase.requirementIds,
    type: testCase.type,
    layer: testCase.layer,
    steps: testCase.steps,
    expected: testCase.expected,
  }));
  return [
    `<requirement>\n${requirement}\n</requirement>`,
    `<scope>${scope}</scope>`,
    ...(ui ? [`<ui_context>\n${ui}\n</ui_context>`] : []),
    `<selected_suggestion>\n${JSON.stringify(suggestion)}\n</selected_suggestion>`,
    `<answers>\n${JSON.stringify(answers)}\n</answers>`,
    `<current_coverage>\n${JSON.stringify(coverage)}\n</current_coverage>`,
    `<existing_test_catalog>\n${JSON.stringify(catalog)}\n</existing_test_catalog>`,
  ].join("\n\n");
}

export const DEEPEN_SYSTEM_PROMPT = `Bạn là QA engineer đang đào sâu MỘT hướng đã được tester chọn.
Chỉ dùng requirement gốc, UI context (nếu scope cho phép), hướng được chọn và câu trả lời trong input. Câu trả lời là phần mở rộng hợp lệ của requirement; không tự suy diễn phần còn thiếu.
Sinh tối đa 5–10 test case mới có giá trị và không lặp catalog hiện có, hoặc trả mảng rỗng nếu hướng đã cạn. ID chỉ là placeholder vì server sẽ tự đánh lại.
Mỗi test case phải có sourceSuggestionId đúng ID hướng đã chọn, coverageKey ổn định, requirementIds chỉ thuộc hướng đã chọn và đầy đủ các trường schema.
Trả coverage cập nhật, 3–6 gợi ý tiếp theo (có thể đánh dấu Exhausted) và message khi không còn case mới.
Luôn trả kết quả qua công cụ submit_deepening.`;
