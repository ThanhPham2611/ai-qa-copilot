import type { CoverageArea, DeepDiveSuggestion, Requirement, ReviewedTestCase, TestCase } from "./types";

export interface CandidateRejection {
  title: string;
  reason: string;
}

const WORD_OR_NUMBER = /[a-z0-9]+/g;
const IMPORTANT_VALUE = /^(?:\d+(?:\.\d+)*|\d{3}|true|false|null)$/;

export function normalizeScenario(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function scenarioText(testCase: TestCase): string {
  return [testCase.title, testCase.preconditions, ...testCase.steps, testCase.expected].join(" ");
}

export function scenarioFingerprint(testCase: TestCase): string {
  return normalizeScenario(scenarioText(testCase));
}

function tokens(testCase: TestCase): Set<string> {
  return new Set(normalizeScenario(scenarioText(testCase)).match(WORD_OR_NUMBER) ?? []);
}

function importantValues(testCase: TestCase): string[] {
  return [...tokens(testCase)].filter((token) => IMPORTANT_VALUE.test(token)).sort();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 1;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

function isNearDuplicate(a: TestCase, b: TestCase): boolean {
  if (!sameSet(a.requirementIds, b.requirementIds) || a.layer !== b.layer || a.type !== b.type) return false;
  if (!sameSet(importantValues(a), importantValues(b))) return false;
  return jaccard(tokens(a), tokens(b)) >= 0.88;
}

function nextTestCaseNumber(existingCases: readonly ReviewedTestCase[]): number {
  let max = 0;
  for (const testCase of existingCases) {
    const match = /^TC(\d+)$/i.exec(testCase.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export function filterDeepDiveCandidates({
  candidates,
  existingCases,
  requirements,
  suggestion,
}: {
  candidates: TestCase[];
  existingCases: ReviewedTestCase[];
  requirements: Requirement[];
  suggestion: DeepDiveSuggestion;
}): { accepted: TestCase[]; rejected: CandidateRejection[] } {
  const validRequirementIds = new Set(requirements.map((requirement) => requirement.id));
  const suggestionRequirementIds = new Set(suggestion.requirementIds);
  const activeCoverageKeys = new Set(
    existingCases.filter((testCase) => testCase.status !== "rejected").map((testCase) => testCase.coverageKey),
  );
  const allComparedCases: TestCase[] = [...existingCases];
  const allFingerprints = new Set(existingCases.map(scenarioFingerprint));
  const accepted: TestCase[] = [];
  const rejected: CandidateRejection[] = [];
  let nextId = nextTestCaseNumber(existingCases);

  for (const candidate of candidates) {
    let reason = "";
    if (candidate.requirementIds.some((id) => !validRequirementIds.has(id))) {
      reason = "Tham chiếu requirement ID không tồn tại";
    } else if (
      candidate.requirementIds.length === 0 ||
      candidate.requirementIds.some((id) => !suggestionRequirementIds.has(id))
    ) {
      reason = "Test case lệch khỏi hướng đào sâu đã chọn";
    } else if (activeCoverageKeys.has(candidate.coverageKey)) {
      reason = "Trùng coverageKey với test case hiện có";
    } else if (allFingerprints.has(scenarioFingerprint(candidate))) {
      reason = "Trùng nguyên văn sau khi chuẩn hóa fingerprint";
    } else if (allComparedCases.some((testCase) => isNearDuplicate(candidate, testCase))) {
      reason = "Gần trùng với test case hiện có";
    }

    if (reason) {
      rejected.push({ title: candidate.title, reason });
      continue;
    }

    const testCase = {
      ...candidate,
      id: `TC${String(nextId++).padStart(2, "0")}`,
      sourceSuggestionId: suggestion.id,
    };
    accepted.push(testCase);
    activeCoverageKeys.add(testCase.coverageKey);
    allFingerprints.add(scenarioFingerprint(testCase));
    allComparedCases.push(testCase);
  }

  return { accepted, rejected };
}

export function mergeCoverage(
  current: CoverageArea[],
  proposed: CoverageArea[],
  cases: ReviewedTestCase[],
  added: TestCase[],
): CoverageArea[] {
  const validIds = new Set(cases.filter((testCase) => testCase.status !== "rejected").map((testCase) => testCase.id));
  for (const testCase of added) validIds.add(testCase.id);
  const byDimension = new Map(current.map((area) => [area.dimension, { ...area, requirementIds: [...area.requirementIds], testCaseIds: [...area.testCaseIds] }]));
  for (const area of proposed) {
    const previous = byDimension.get(area.dimension);
    byDimension.set(area.dimension, {
      ...area,
      requirementIds: [...new Set([...(previous?.requirementIds ?? []), ...area.requirementIds])],
      testCaseIds: [...new Set([...(previous?.testCaseIds ?? []), ...area.testCaseIds])],
    });
  }
  const areas = [...byDimension.values()].map((area) => ({
    ...area,
    testCaseIds: area.testCaseIds.filter((id) => validIds.has(id)),
  }));
  for (const testCase of added) {
    const area = areas.find((item) => item.dimension === testCase.coverageDimension);
    if (area) {
      if (!area.testCaseIds.includes(testCase.id)) area.testCaseIds.push(testCase.id);
      area.requirementIds = [...new Set([...area.requirementIds, ...testCase.requirementIds])];
      if (area.status === "NotAssessed" || area.status === "Blocked") area.status = "Partial";
    } else {
      areas.push({
        dimension: testCase.coverageDimension,
        requirementIds: [...testCase.requirementIds],
        testCaseIds: [testCase.id],
        status: "Partial",
        gap: "Cần tester đánh giá thêm mức độ bao phủ của khu vực mới.",
      });
    }
  }
  return areas.map((area) => ({
    ...area,
    status: area.testCaseIds.length === 0 && area.status === "Covered" ? "NotAssessed" : area.status,
  }));
}
