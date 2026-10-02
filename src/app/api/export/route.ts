import { z } from "zod";
import { NextResponse } from "next/server";
import { logMetric } from "@/lib/metrics";
import { buildExportWorkbook } from "@/lib/export-workbook";
import { AmbiguitySchema, CoverageAreaSchema, DeepDiveSuggestionSchema, RequirementSchema, TestCaseSchema } from "@/lib/types";

export const runtime = "nodejs";

const ExportSchema = z.object({
  mode: z.enum(["live", "mock"]),
  featureName: z.string().max(200),
  requirements: z.array(RequirementSchema).max(200),
  ambiguities: z.array(AmbiguitySchema).max(200),
  testCases: z
    .array(
      TestCaseSchema.extend({
        status: z.enum(["pending", "accepted", "edited", "rejected"]),
      }),
    )
    .max(500),
  coverage: z.array(CoverageAreaSchema).max(100),
  deepDiveSuggestions: z.array(DeepDiveSuggestionSchema).max(100),
});

export async function POST(req: Request) {
  let data: z.infer<typeof ExportSchema>;
  try {
    data = ExportSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Dữ liệu xuất file không hợp lệ." }, { status: 400 });
  }

  const wb = buildExportWorkbook(data);

  // Ghi số liệu duyệt (chỉ đếm, không ghi nội dung). Bỏ qua dữ liệu mô phỏng
  // để số liệu pitch chỉ phản ánh kết quả AI thật.
  const count = (s: string) => data.testCases.filter((t) => t.status === s).length;
  if (data.mode === "live") await logMetric({
    kind: "review",
    at: new Date().toISOString(),
    total: data.testCases.length,
    accepted: count("accepted"),
    edited: count("edited"),
    rejected: count("rejected"),
    pending: count("pending"),
  });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="test-cases.xlsx"',
    },
  });
}
