import { t } from "../i18n";

export const captureIntents = [
  { id: "manual-ledger", labelKey: "capture.intent.manualLedger", detailKey: "capture.intent.manualLedgerDetail", kind: "ledger" },
  { id: "ai-ledger", labelKey: "capture.intent.aiLedger", detailKey: "capture.intent.aiLedgerDetail", kind: "ledger" },
  { id: "scan-invoice", labelKey: "capture.intent.scanInvoice", detailKey: "capture.intent.scanInvoiceDetail", kind: "scan" },
  { id: "scan-receipt", labelKey: "capture.intent.scanReceipt", detailKey: "capture.intent.scanReceiptDetail", kind: "scan" },
  { id: "record-meal", labelKey: "capture.intent.recordMeal", detailKey: "capture.intent.recordMealDetail", kind: "meal" },
  { id: "attach-photo", labelKey: "capture.intent.attachPhoto", detailKey: "capture.intent.attachPhotoDetail", kind: "attachment" },
] as const;

export type CaptureIntent = (typeof captureIntents)[number]["id"];

function intentDefinition(intent: CaptureIntent): (typeof captureIntents)[number] | undefined {
  return captureIntents.find((item) => item.id === intent);
}

export function captureIntentLabel(intent: CaptureIntent): string {
  return intentDefinition(intent) ? t(intentDefinition(intent)!.labelKey) : t("capture.intent.fallback");
}

export function captureIntentDetail(intent: CaptureIntent): string {
  return intentDefinition(intent) ? t(intentDefinition(intent)!.detailKey) : "";
}
