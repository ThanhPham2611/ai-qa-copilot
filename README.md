# AI QA Copilot – Prototype

Nhập mô tả tính năng → AI chỉ ra điểm mơ hồ và gợi ý test case theo rủi ro → tester duyệt (Chấp nhận / Sửa / Loại) → xem bảng truy vết → xuất Excel. App tự ghi số token, chi phí và tỷ lệ test case được giữ lại để có số liệu thật khi pitch.

## Chạy thử

```bash
npm install
cp .env.example .env.local   # điền OPENROUTER_API_KEY nếu muốn gọi AI thật
npm run dev                  # mở http://localhost:3000
```

- **Chưa có API key:** app tự chạy chế độ mô phỏng với dữ liệu mẫu "Chuyển tiền nội bộ", không tốn tiền.
- **Có API key:** bỏ tick "Chế độ mô phỏng" trên giao diện để gọi AI thật.

## Phạm vi, UI context và tầng

- **Phạm vi kiểm thử:** Fullstack (mặc định), Frontend hoặc Backend; chỉnh hướng dẫn gửi cho AI. Backend bỏ qua UI context.
- **UI context (tùy chọn):** dán text/label/thông báo, breakpoint, hành vi modal, semantics accessibility (role, aria-live) có thật. AI chỉ dùng những gì có ở đây; thiếu thì nêu thành điểm mơ hồ.
- **Tầng (layer):** mỗi test case có Frontend/Backend/Integration/E2E, lọc được trên giao diện, độc lập với loại test (type).
- **Chế độ mô phỏng theo phạm vi:** Frontend giữ Frontend/Integration/E2E, Backend chỉ giữ Backend/Integration (E2E cần giao diện, khớp prompt AI thật), Fullstack giữ tất cả. Mã TC không đánh số lại nên có thể có khoảng trống.

## Cấu trúc

| File | Vai trò |
| --- | --- |
| `src/app/page.tsx` | Giao diện: nhập, điểm mơ hồ, duyệt test case, truy vết, xuất |
| `src/app/api/analyze/route.ts` | Gọi OpenRouter, ép trả JSON đúng cấu trúc, kiểm tra lại bằng zod, ghi token/chi phí |
| `src/app/api/export/route.ts` | Tạo file Excel 3 sheet: Test cases, Điểm mơ hồ, Truy vết |
| `src/app/api/metrics/route.ts` | Tổng hợp số liệu thật cho slide: chi phí trung bình, thời gian, tỷ lệ giữ lại |
| `src/lib/prompt.ts` | Hướng dẫn cho AI. Sửa ở đây để cải thiện chất lượng, không cần train |
| `src/lib/sample.ts` | Yêu cầu mẫu và kết quả mô phỏng |
| `src/lib/config.ts` | Model, giá token, các giới hạn bảo vệ credit |

## Vì sao làm như vậy

- **Công cụ bắt buộc (`tool_choice`) + kiểm tra zod:** AI buộc phải trả đúng cấu trúc JSON; nếu thiếu trường thì báo lỗi thay vì hiển thị dữ liệu hỏng.
- **Key chỉ ở server:** không có biến `NEXT_PUBLIC_`, nên key không lọt vào code trình duyệt.
- **Giới hạn gọi:** tối đa 30 lần/giờ, 12.000 ký tự đầu vào, 12.000 token đầu ra, để không cháy $20–30 credit.
- **Số liệu chỉ lưu con số:** `data/metrics.jsonl` không chứa nội dung yêu cầu. Dữ liệu mô phỏng không được tính.
- **Chặn công thức Excel độc:** ô bắt đầu bằng `= + - @` được thêm `'` để Excel không chạy như công thức.

## Tiết kiệm credit

1. Đặt credit limit cho key ngay khi tạo ở openrouter.ai/keys.
2. Khi chỉnh prompt dùng model rẻ, ví dụ `OPENROUTER_MODEL=openai/gpt-5.4-mini`.
   Model phải hỗ trợ `tools` (xem supported parameters ở openrouter.ai/models).
3. Demo trước bằng chế độ mô phỏng; chỉ gọi thật 1–2 lần khi pitch.

## Xem số liệu

Mở `http://localhost:3000/api/metrics` sau vài lần chạy thật và xuất Excel.

## Giới hạn hiện tại

- Chưa có đăng nhập, chưa lưu lịch sử vào database (dữ liệu mất khi tải lại trang).
- Chưa nhận ảnh màn hình, chỉ nhận văn bản.
- Chưa sinh script Playwright (giai đoạn sau trong lộ trình).
- Không dán tài liệu thật của khách hàng vào bản demo.
