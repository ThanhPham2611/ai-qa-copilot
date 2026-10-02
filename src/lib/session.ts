import type { ReviewedTestCase, TestCase } from "./types";

export function appendDeepDiveCases(existing: ReviewedTestCase[], added: TestCase[]): ReviewedTestCase[] {
  return [...existing, ...added.map((testCase) => ({ ...testCase, status: "pending" as const }))];
}
