import { t } from "../i18n";

export const captureIntents = [
  { id: "manual-ledger", labelKey: "capture.intent.manualLedger", kind: "ledger" },
  { id: "ai-ledger", labelKey: "capture.intent.aiLedger", kind: "ledger" },
  { id: "scan-invoice", labelKey: "capture.intent.scanInvoice", kind: "scan" },
  { id: "scan-receipt", labelKey: "capture.intent.scanReceipt", kind: "scan" },
  { id: "record-meal", labelKey: "capture.intent.recordMeal", kind: "meal" },
  { id: "attach-photo", labelKey: "capture.intent.attachPhoto", kind: "attachment" },
] as const;

export type CaptureIntent = (typeof captureIntents)[number]["id"];

function intentDefinition(intent: CaptureIntent): (typeof captureIntents)[number] | undefined {
  return captureIntents.find((item) => item.id === intent);
}

export function captureIntentLabel(intent: CaptureIntent): string {
  return intentDefinition(intent) ? t(intentDefinition(intent)!.labelKey) : t("capture.intent.fallback");
}
