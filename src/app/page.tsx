"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { SAMPLE_REQUIREMENT } from "@/lib/sample";
import { appendDeepDiveCases } from "@/lib/session";
import type { Analysis, AnalyzeResponse, CoverageStatus, DeepDiveSuggestion, DeepenResponse, Layer, Progress, ReviewStatus, ReviewedTestCase, Scope, Usage } from "@/lib/types";

const RISK_VI = { High: "Cao", Medium: "Trung bình", Low: "Thấp" } as const;
const RISK_ORDER = { High: 0, Medium: 1, Low: 2 } as const;
type Filter = "all" | "High" | "Medium" | "Low" | "pending";
const SCOPE_VI: Record<Scope, string> = {
  fullstack: "Fullstack (giao diện + backend)",
  frontend: "Frontend (giao diện)",
  backend: "Backend (API, nghiệp vụ, dữ liệu)",
};
const LAYERS: Layer[] = ["Frontend", "Backend", "Integration", "E2E"];
const COVERAGE_STATUS_VI: Record<CoverageStatus, string> = {
  Covered: "Đã bao phủ",
  Partial: "Một phần",
  NotAssessed: "Chưa đánh giá",
  Blocked: "Đang bị chặn",
};

// Đọc luồng NDJSON từ /api/analyze: nhiều dòng "progress", kết thúc bằng "done" hoặc "error".
async function readStream(res: Response, onProgress: (p: Progress) => void): Promise<AnalyzeResponse> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      const ev = JSON.parse(line);
      if (ev.type === "progress") onProgress(ev);
      else if (ev.type === "error") throw new Error(ev.error);
      else if (ev.type === "done") return ev.result;
    }
  }
  throw new Error("Kết nối bị ngắt trước khi AI trả kết quả. Thử lại.");
}

// Các bước hiển thị khi AI chạy. Bước hiện tại suy ra từ phần JSON AI đã viết ra (không phải đồng hồ giả).
function LoadingPanel({ progress }: { progress: Progress | null }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const p = progress ?? { stage: "thinking", requirements: 0, ambiguities: 0, testCases: 0 };
  const active = p.stage === "thinking" ? 0 : p.testCases ? 3 : p.ambiguities ? 2 : 1;
  const steps = [
    { label: "AI đọc yêu cầu và suy nghĩ", count: 0 },
    { label: "Tách yêu cầu", count: p.requirements },
    { label: "Tìm điểm mơ hồ", count: p.ambiguities },
    { label: "Viết test case", count: p.testCases },
  ];

  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <div className={styles.loadingHead}>
        <span className={styles.spinner} aria-hidden="true" />
        <strong>AI đang làm việc</strong>
        <span className={styles.spacer} />
        <span className={styles.muted}>{elapsed}s · thường mất 20–60 giây</span>
      </div>
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li key={s.label} className={i < active ? styles.stepDone : i === active ? styles.stepActive : ""}>
            <span className={styles.stepIcon} aria-hidden="true">
              {i < active ? "✓" : i === active ? "…" : "○"}
            </span>
            {s.label}
            {s.count > 0 && <span className={styles.muted}> · {s.count}</span>}
          </li>
        ))}
      </ol>
      {elapsed > 90 && (
        <div className={styles.muted}>
          Lâu hơn bình thường. Nếu vẫn không thấy tiến triển, tải lại trang và thử lại.
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [requirement, setRequirement] = useState("");
  const [useMock, setUseMock] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [cases, setCases] = useState<ReviewedTestCase[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [layerFilter, setLayerFilter] = useState<Layer | "all">("all");
  const [scope, setScope] = useState<Scope>("fullstack");
  const [uiContext, setUiContext] = useState("");
  const [deepeningId, setDeepeningId] = useState<string | null>(null);
  const [deepDiveError, setDeepDiveError] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({});
  const [deepDiveNotice, setDeepDiveNotice] = useState("");
  const [skippedDuplicates, setSkippedDuplicates] = useState(0);

  async function analyze() {
    setLoading(true);
    setProgress(null);
    setError("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement, mock: useMock, scope, uiContext }),
      });
      let result: AnalyzeResponse;
      if (res.headers.get("content-type")?.includes("application/x-ndjson")) {
        result = await readStream(res, setProgress);
      } else {
        // Chế độ mô phỏng và các lỗi sớm (400/413/429/502) trả JSON thường
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Có lỗi xảy ra.");
        result = data as AnalyzeResponse;
      }
      setAnalysis(result.analysis);
      setUsage(result.usage);
      setCases(
        [...result.analysis.testCases]
          .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk])
          .map((t) => ({ ...t, status: "pending" as ReviewStatus })),
      );
      setFilter("all");
      setLayerFilter("all");
      setAnswers({});
      setDeepDiveError({});
      setDeepDiveNotice("");
      setSkippedDuplicates(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra.");
    } finally {
      setLoading(false);
    }
  }

  async function deepen(suggestion: DeepDiveSuggestion) {
    if (!analysis || !usage || deepeningId) return;
    setDeepeningId(suggestion.id);
    setDeepDiveError((current) => ({ ...current, [suggestion.id]: "" }));
    setDeepDiveNotice("");
    try {
      const res = await fetch("/api/deepen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirement, mock: useMock, scope, uiContext,
          requirements: analysis.requirements,
          existingCases: cases,
          coverage: analysis.coverage,
          suggestion,
          answers: answers[suggestion.id] ?? {},
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Đào sâu thất bại. Kết quả hiện có vẫn được giữ nguyên.");
      const result = data as DeepenResponse;
      setCases((current) => appendDeepDiveCases(current, result.testCases));
      setAnalysis((current) => current ? {
        ...current,
        coverage: result.coverage,
        deepDiveSuggestions: result.deepDiveSuggestions,
      } : current);
      setUsage((current) => current ? {
        ...current,
        inputTokens: current.inputTokens + result.usage.inputTokens,
        outputTokens: current.outputTokens + result.usage.outputTokens,
        costUsd: current.costUsd + result.usage.costUsd,
        durationMs: current.durationMs + result.usage.durationMs,
      } : current);
      setSkippedDuplicates((count) => count + result.rejectedCandidates.length);
      setDeepDiveNotice(
        result.message || `Đã thêm ${result.testCases.length} test case; bỏ qua ${result.rejectedCandidates.length} trường hợp trùng hoặc lệch phạm vi.`,
      );
    } catch (caught) {
      setDeepDiveError((current) => ({
        ...current,
        [suggestion.id]: caught instanceof Error ? caught.message : "Đào sâu thất bại. Kết quả hiện có vẫn được giữ nguyên.",
      }));
    } finally {
      setDeepeningId(null);
    }
  }

  function updateCase(id: string, patch: Partial<ReviewedTestCase>) {
    setCases((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function exportExcel() {
    if (!analysis || !usage) return;
    setError("");
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: usage.mode,
          featureName: analysis.featureName,
          requirements: analysis.requirements,
          ambiguities: analysis.ambiguities,
          testCases: cases,
          coverage: analysis.coverage,
          deepDiveSuggestions: analysis.deepDiveSuggestions,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Xuất file thất bại.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `test-cases-${analysis.featureName.replace(/[^\p{L}\p{N}]+/gu, "-")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xuất file thất bại.");
    }
  }

  const stats = useMemo(() => {
    const c = (s: ReviewStatus) => cases.filter((t) => t.status === s).length;
    const reviewed = cases.length - c("pending");
    const kept = c("accepted") + c("edited");
    return { accepted: c("accepted"), edited: c("edited"), rejected: c("rejected"), pending: c("pending"), reviewed, kept };
  }, [cases]);

  // Truy vết: yêu cầu nào đã có test case (không tính test case bị loại)
  const trace = useMemo(() => {
    if (!analysis) return [];
    const kept = cases.filter((t) => t.status !== "rejected");
    return analysis.requirements.map((r) => ({
      ...r,
      tcs: kept.filter((t) => t.requirementIds.includes(r.id)).map((t) => t.id),
    }));
  }, [analysis, cases]);

  const visible = cases.filter(
    (t) =>
      (layerFilter === "all" || t.layer === layerFilter) &&
      (filter === "all" ? true : filter === "pending" ? t.status === "pending" : t.risk === filter),
  );

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <h1>AI QA Copilot</h1>
          <p>Review yêu cầu, gợi ý test case theo rủi ro. Tester là người quyết định cuối cùng.</p>
        </div>
      </header>

      {/* Bước 1: nhập yêu cầu */}
      <section className={styles.card}>
        <h2>1. Nhập yêu cầu tính năng</h2>
        <textarea
          className={styles.textarea}
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          placeholder="Dán mô tả tính năng / user story. Không dán tài liệu thật của khách hàng."
          maxLength={12000}
        />
        <label className={`${styles.field} ${styles.scopeField}`}>
          Phạm vi kiểm thử
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            {(Object.keys(SCOPE_VI) as Scope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_VI[s]}
              </option>
            ))}
          </select>
        </label>
        {scope !== "backend" && (
          <label className={styles.field}>
            UI context (tùy chọn)
            <textarea
              className={`${styles.textarea} ${styles.uiContext}`}
              value={uiContext}
              onChange={(e) => setUiContext(e.target.value)}
              maxLength={3000}
            />
            <span className={styles.muted}>
              Dán text/label/placeholder/thông báo lỗi chính xác, breakpoint, trình duyệt hoặc hành vi modal nếu có.
              AI chỉ dùng đúng những gì có ở đây, không tự bịa; thiếu sẽ được nêu thành điểm mơ hồ.
            </span>
          </label>
        )}
        <div className={styles.row}>
          <button className={styles.btn} onClick={() => setRequirement(SAMPLE_REQUIREMENT)}>
            Dùng yêu cầu mẫu
          </button>
          <label className={styles.muted}>
            <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} /> Chế độ mô
            phỏng (không gọi AI, không tốn tiền)
          </label>
          <span className={styles.spacer} />
          <span className={styles.muted}>{requirement.length}/12000</span>
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={analyze}
            disabled={loading || requirement.trim().length < 20}
          >
            {loading ? "AI đang phân tích..." : "Phân tích"}
          </button>
        </div>
        {loading && <LoadingPanel progress={progress} />}
        {error && <div className={styles.error}>{error}</div>}
      </section>

      {analysis && usage && (
        <>
          {/* Số liệu */}
          <section className={styles.card}>
            <h2>Số liệu lần chạy: {analysis.featureName}</h2>
            <div className={styles.stats}>
              <Stat value={analysis.ambiguities.length} label="Điểm mơ hồ" />
              <Stat value={cases.length} label="Test case gợi ý" />
              <Stat
                value={stats.reviewed ? `${Math.round((stats.kept / stats.reviewed) * 100)}%` : "–"}
                label={`Tỷ lệ giữ lại (${stats.reviewed}/${cases.length} đã duyệt)`}
              />
              <Stat
                value={`${trace.filter((r) => r.tcs.length).length}/${trace.length}`}
                label="Yêu cầu đã bao phủ"
              />
              <Stat
                value={usage.mode === "mock" ? "Mô phỏng" : `$${usage.costUsd.toFixed(4)}`}
                label={
                  usage.mode === "mock"
                    ? "Chưa gọi AI thật"
                    : `${usage.inputTokens.toLocaleString()} vào / ${usage.outputTokens.toLocaleString()} ra`
                }
              />
              <Stat
                value={usage.mode === "mock" ? "–" : `${(usage.durationMs / 1000).toFixed(1)}s`}
                label={usage.mode === "mock" ? "Thời gian" : `Thời gian (${usage.model})`}
              />
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>2. Coverage &amp; Gợi ý đào sâu</h2>
                <p className={styles.muted}>Coverage là chỉ báo có giải thích, không phải cam kết tính năng đã được kiểm thử đầy đủ.</p>
              </div>
              <span className={styles.tag}>{skippedDuplicates} trùng đã bỏ qua</span>
            </div>
            <div className={styles.coverageGrid}>
              {analysis.coverage.map((area) => {
                const generated = cases.filter((testCase) => area.testCaseIds.includes(testCase.id));
                const retained = generated.filter((testCase) => testCase.status !== "rejected");
                const effectiveStatus: CoverageStatus = retained.length === 0 ? "NotAssessed" : area.status;
                return (
                  <article key={`${area.dimension}-${area.requirementIds.join("-")}`} className={styles.coverageCard}>
                    <div className={styles.itemHead}>
                      <strong>{area.dimension}</strong>
                      <span className={`${styles.coverageStatus} ${styles[effectiveStatus]}`}>{COVERAGE_STATUS_VI[effectiveStatus]}</span>
                    </div>
                    <div className={styles.muted}>Yêu cầu: {area.requirementIds.join(", ") || "—"}</div>
                    <div className={styles.muted}>AI sinh: {generated.length} · Tester giữ: {retained.length}</div>
                    {retained.length > 0 && <div className={styles.caseLinks}>{retained.map((testCase) => testCase.id).join(", ")}</div>}
                    <p className={area.gap ? styles.gap : styles.muted}>{area.gap || "Chưa ghi nhận khoảng trống cụ thể."}</p>
                  </article>
                );
              })}
            </div>

            <h3 className={styles.subheading}>Hướng tiếp theo</h3>
            {deepDiveNotice && <div className={styles.notice} role="status">{deepDiveNotice}</div>}
            <div className={styles.suggestionGrid}>
              {analysis.deepDiveSuggestions.map((suggestion) => {
                const suggestionAnswers = answers[suggestion.id] ?? {};
                const missingRequired = suggestion.questions.some((question) => question.required && !suggestionAnswers[question.id]?.trim());
                const disabled = Boolean(deepeningId) || suggestion.status === "Exhausted" || missingRequired;
                return (
                  <article key={suggestion.id} className={styles.suggestionCard}>
                    <div className={styles.itemHead}>
                      <span className={styles.tag}>{suggestion.id}</span>
                      <strong>{suggestion.title}</strong>
                      <span className={`${styles.badge} ${styles[suggestion.priority]}`}>{RISK_VI[suggestion.priority]}</span>
                    </div>
                    <p>{suggestion.value}</p>
                    <p className={styles.muted}>{suggestion.reason}</p>
                    <div className={styles.muted}>Yêu cầu: {suggestion.requirementIds.join(", ")} · Dự kiến {suggestion.estimatedTestCases.min}–{suggestion.estimatedTestCases.max} case</div>
                    {suggestion.questions.map((question) => (
                      <label className={styles.field} key={question.id}>
                        {question.question} {question.required && <span aria-hidden="true">*</span>}
                        <textarea
                          rows={2}
                          value={suggestionAnswers[question.id] ?? ""}
                          onChange={(event) => setAnswers((current) => ({
                            ...current,
                            [suggestion.id]: { ...current[suggestion.id], [question.id]: event.target.value },
                          }))}
                          disabled={Boolean(deepeningId)}
                        />
                      </label>
                    ))}
                    {deepDiveError[suggestion.id] && <div className={styles.error} role="alert">{deepDiveError[suggestion.id]}</div>}
                    <div className={styles.row}>
                      <button className={`${styles.btn} ${styles.primary}`} disabled={disabled} onClick={() => deepen(suggestion)}>
                        {deepeningId === suggestion.id ? "Đang đào sâu…" : suggestion.status === "Exhausted" ? "Hướng đã cạn" : "Đào sâu hướng này"}
                      </button>
                      {missingRequired && <span className={styles.muted}>Trả lời đủ câu hỏi để mở khóa.</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Bước 2: điểm mơ hồ */}
          <section className={styles.card}>
            <h2>3. Điểm mơ hồ cần hỏi lại khách hàng / BA</h2>
            {analysis.ambiguities.length === 0 ? (
              <p className={styles.muted}>AI không tìm thấy điểm mơ hồ. Tester vẫn nên đọc lại yêu cầu.</p>
            ) : (
              <ul className={styles.list}>
                {analysis.ambiguities.map((a) => (
                  <li key={a.id} className={styles.item}>
                    <div className={styles.itemHead}>
                      <span className={styles.tag}>{a.id}</span>
                      {a.requirementId && <span className={styles.tag}>{a.requirementId}</span>}
                      <strong>{a.issue}</strong>
                      <span className={`${styles.badge} ${styles[a.severity]}`}>{RISK_VI[a.severity]}</span>
                    </div>
                    <p className={styles.muted} style={{ margin: "6px 0 0" }}>
                      Câu hỏi: {a.question}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Bước 3: duyệt test case */}
          <section className={styles.card}>
            <h2>4. Duyệt test case (xếp theo rủi ro)</h2>
            <div className={styles.filters} role="group" aria-label="Lọc theo rủi ro hoặc trạng thái duyệt">
              {(
                [
                  ["all", `Tất cả (${cases.length})`],
                  ["High", "Rủi ro cao"],
                  ["Medium", "Trung bình"],
                  ["Low", "Thấp"],
                  ["pending", `Chưa duyệt (${stats.pending})`],
                ] as [Filter, string][]
              ).map(([f, label]) => (
                <button
                  key={f}
                  className={`${styles.btn} ${styles.small} ${filter === f ? styles.active : ""}`}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {label}
                </button>
              ))}
              <span className={styles.spacer} />
              <button
                className={`${styles.btn} ${styles.small}`}
                onClick={() => setCases((p) => p.map((t) => (t.status === "pending" ? { ...t, status: "accepted" } : t)))}
                disabled={stats.pending === 0}
              >
                Chấp nhận tất cả chưa duyệt
              </button>
            </div>
            <div className={styles.filters} role="group" aria-label="Lọc theo tầng">
              {(["all", ...LAYERS] as const).map((l) => (
                <button
                  key={l}
                  className={`${styles.btn} ${styles.small} ${layerFilter === l ? styles.active : ""}`}
                  aria-pressed={layerFilter === l}
                  onClick={() => setLayerFilter(l)}
                >
                  {l === "all" ? "Mọi tầng" : `${l} (${cases.filter((t) => t.layer === l).length})`}
                </button>
              ))}
            </div>
            {/* Vùng live luôn có trong DOM để screen reader đọc được thông báo khi danh sách trở nên rỗng */}
            <div role="status">
              {visible.length === 0 && (
                <p className={styles.muted}>
                  {cases.length === 0
                    ? "AI không đề xuất test case nào."
                    : "Không có test case nào khớp bộ lọc hiện tại. Thử đổi bộ lọc rủi ro hoặc tầng."}
                </p>
              )}
            </div>
            {visible.length > 0 && (
              <ul className={styles.list}>
                {visible.map((t) => (
                  <TestCaseItem key={t.id} tc={t} onChange={(patch) => updateCase(t.id, patch)} />
                ))}
              </ul>
            )}
          </section>

          {/* Bước 4: truy vết */}
          <section className={styles.card}>
            <h2>5. Bảng truy vết yêu cầu ↔ test case</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Yêu cầu</th>
                    <th>Nội dung</th>
                    <th>Test case bao phủ</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.text}</td>
                      <td>{r.tcs.length ? r.tcs.join(", ") : <span className={styles.missing}>Chưa có test case</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Bước 5: xuất */}
          <section className={styles.card}>
            <h2>6. Xuất Excel</h2>
            <div className={styles.row}>
              <span className={styles.muted}>
                File gồm 5 sheet: test case (bỏ các case đã loại), điểm mơ hồ, coverage, gợi ý đào sâu và truy vết.
                {stats.pending > 0 && ` Còn ${stats.pending} test case chưa duyệt.`}
              </span>
              <span className={styles.spacer} />
              <button className={`${styles.btn} ${styles.primary}`} onClick={exportExcel}>
                Tải file Excel
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className={styles.stat}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function TestCaseItem({ tc, onChange }: { tc: ReviewedTestCase; onChange: (p: Partial<ReviewedTestCase>) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: tc.title, steps: tc.steps.join("\n"), expected: tc.expected });

  function save() {
    onChange({
      title: draft.title.trim() || tc.title,
      steps: draft.steps.split("\n").map((s) => s.trim()).filter(Boolean),
      expected: draft.expected.trim() || tc.expected,
      status: "edited",
    });
    setEditing(false);
  }

  return (
    <li className={`${styles.item} ${styles[tc.status] ?? ""}`}>
      <div className={styles.itemHead}>
        <span className={styles.tag}>{tc.id}</span>
        <strong>{tc.title}</strong>
        <span className={styles.tag}>{tc.type}</span>
        <span className={styles.tag}>{tc.layer}</span>
        <span className={`${styles.badge} ${styles[tc.risk]}`} title={tc.riskReason}>
          {RISK_VI[tc.risk]}
        </span>
      </div>
      <div className={styles.muted}>
        Yêu cầu: {tc.requirementIds.join(", ")} · Coverage: {tc.coverageDimension} · Lý do rủi ro: {tc.riskReason}
      </div>

      {editing ? (
        <>
          <label className={styles.field}>
            Tiêu đề
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className={styles.field}>
            Các bước (mỗi dòng một bước)
            <textarea rows={4} value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} />
          </label>
          <label className={styles.field}>
            Kết quả mong đợi
            <textarea rows={2} value={draft.expected} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} />
          </label>
          <div className={styles.row}>
            <button className={`${styles.btn} ${styles.small} ${styles.primary}`} onClick={save}>
              Lưu
            </button>
            <button className={`${styles.btn} ${styles.small}`} onClick={() => setEditing(false)}>
              Hủy
            </button>
          </div>
        </>
      ) : (
        <>
          {tc.preconditions && <div style={{ marginTop: 6 }}>Điều kiện trước: {tc.preconditions}</div>}
          <ol>
            {tc.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div>
            <b>Mong đợi:</b> {tc.expected}
          </div>
          <div className={styles.row}>
            <button
              className={`${styles.btn} ${styles.small} ${tc.status === "accepted" ? styles.active : ""}`}
              onClick={() => onChange({ status: "accepted" })}
            >
              Chấp nhận
            </button>
            <button className={`${styles.btn} ${styles.small}`} onClick={() => setEditing(true)}>
              Sửa
            </button>
            <button
              className={`${styles.btn} ${styles.small} ${tc.status === "rejected" ? styles.active : ""}`}
              onClick={() => onChange({ status: "rejected" })}
            >
              Loại
            </button>
            {tc.status !== "pending" && (
              <button className={`${styles.btn} ${styles.small}`} onClick={() => onChange({ status: "pending" })}>
                Hoàn tác
              </button>
            )}
            <span className={styles.spacer} />
            <span className={styles.muted}>
              {{ pending: "Chưa duyệt", accepted: "Đã chấp nhận", edited: "Đã sửa", rejected: "Đã loại" }[tc.status]}
            </span>
          </div>
        </>
      )}
    </li>
  );
}
