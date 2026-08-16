import { describe, expect, test } from "vitest";
import { categoryReviewSummary, classifyCategoryAlias } from "./aliases";

describe("legacy category aliases", () => {
  test("keeps 特殊 in review with specific category choices", () => {
    const result = classifyCategoryAlias("特殊");

    expect(result).toMatchObject({ status: "review", suggestedCategory: null });
    expect(result.reason).toContain("更具體");
  });

  test("maps 0 and ? to unresolved review suggestions", () => {
    expect(classifyCategoryAlias("0")).toMatchObject({ status: "review", suggestedCategory: "缺漏支出" });
    expect(classifyCategoryAlias("?")).toMatchObject({ status: "review", suggestedCategory: "缺漏支出" });
  });

  test("suggests the subscription path for AI without auto-finalizing it", () => {
    const result = classifyCategoryAlias("AI");

    expect(result).toMatchObject({ status: "review", suggestedCategory: "訂閱 > AI" });
  });

  test("keeps 登山 and 浪費 in context dimensions", () => {
    expect(classifyCategoryAlias("登山")).toMatchObject({ suggestedEvent: "登山", suggestedTag: "登山" });
    expect(classifyCategoryAlias("浪費")).toMatchObject({ suggestedTag: "浪費", suggestedCategory: null });
  });

  test("returns no review summary for a normal category", () => {
    expect(categoryReviewSummary("日用")).toBeNull();
    expect(categoryReviewSummary("特殊")).toContain("需審核");
  });
});
