import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI QA Copilot",
  description: "Review yêu cầu và gợi ý test case theo rủi ro, tester duyệt trước khi dùng.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
