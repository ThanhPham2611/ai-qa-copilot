// Cấu hình chỉ đọc ở phía server. Không có biến nào dùng tiền tố NEXT_PUBLIC_,
// nên API key không bao giờ bị đóng gói vào code chạy trên trình duyệt.

export function getConfig() {
  return {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    // Slug model của OpenRouter (xem openrouter.ai/models).
    // Model phải hỗ trợ "tools", vì app ép AI trả JSON qua tool call.
    model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5.5",
    // Giới hạn để bảo vệ credit khi demo
    maxInputChars: Number(process.env.MAX_INPUT_CHARS) || 12000,
    maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS) || 12000,
    maxCallsPerHour: Number(process.env.MAX_CALLS_PER_HOUR) || 30,
    // MOCK_MODE=true: không gọi API, trả kết quả mô phỏng (không tốn tiền)
    forceMock: process.env.MOCK_MODE === "true",
  };
}
