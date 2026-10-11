import { t } from "../i18n";

export type CategoryAliasReview = {
  input: string;
  status: "accepted" | "review";
  suggestedCategory: string | null;
  suggestedEvent: string | null;
  suggestedTag: string | null;
  reason: string;
};

// Reasons resolve through t() at call time so they follow the selected locale
// instead of freezing at module load.
type AmbiguousAlias = Omit<CategoryAliasReview, "input" | "status" | "reason"> & { reasonKey: string };

const ambiguousAliases: Record<string, AmbiguousAlias> = {
  特殊: {
    suggestedCategory: null,
    suggestedEvent: null,
    suggestedTag: null,
    reasonKey: "import.aliasMoreSpecific",
  },
  "0": {
    suggestedCategory: "缺漏支出",
    suggestedEvent: null,
    suggestedTag: null,
    reasonKey: "import.aliasUnresolved",
  },
  "?": {
    suggestedCategory: "缺漏支出",
    suggestedEvent: null,
    suggestedTag: null,
    reasonKey: "import.aliasUnresolved",
  },
  AI: {
    suggestedCategory: "訂閱 > AI",
    suggestedEvent: null,
    suggestedTag: null,
    reasonKey: "import.aliasAi",
  },
  登山: {
    suggestedCategory: "旅行活動",
    suggestedEvent: "登山",
    suggestedTag: "登山",
    reasonKey: "import.aliasActivity",
  },
  浪費: {
    suggestedCategory: null,
    suggestedEvent: null,
    suggestedTag: "浪費",
    reasonKey: "import.aliasTag",
  },
};

export function classifyCategoryAlias(value: string): CategoryAliasReview {
  const input = value.trim();
  const alias = ambiguousAliases[input];

  if (alias) {
    return {
      input,
      status: "review",
      suggestedCategory: alias.suggestedCategory,
      suggestedEvent: alias.suggestedEvent,
      suggestedTag: alias.suggestedTag,
      reason: t(alias.reasonKey),
    };
  }

  if (!input) {
    return {
      input,
      status: "review",
      suggestedCategory: "缺漏支出",
      suggestedEvent: null,
      suggestedTag: null,
      reason: t("import.aliasEmpty"),
    };
  }

  return {
    input,
    status: "accepted",
    suggestedCategory: input,
    suggestedEvent: null,
    suggestedTag: null,
    reason: t("import.aliasAccepted"),
  };
}

export function categoryReviewSummary(value: string): string | null {
  const review = classifyCategoryAlias(value);
  if (review.status !== "review") {
    return null;
  }

  const suggestion = review.suggestedCategory ? t("import.suggestion", { category: review.suggestedCategory }) : "";
  return `${t("import.reviewNeeded", { input: review.input || t("common.blankName") })}${suggestion}${review.reason}`;
}
