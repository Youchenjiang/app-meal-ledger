import { t } from "../i18n";
import { parseMinorUnits } from "../manualLedger/money";
import type { LocalAccount } from "../manualLedger/accounts";
import type { LocalAuditEvent, LocalLedgerRecord } from "../manualLedger/records";
import type { TransactionDraft } from "../appShell/drafts";
import type { MealEntry } from "../captureMedia/meals";
import type { TemporaryScan } from "../captureMedia/media";
import type { UploadMediaKind, UploadQueueItem } from "../captureMedia/upload";
import type {
  CloudMealBundle,
  CloudMappingIssue,
  CloudMappingResult,
  CloudRecordBundle,
  CloudReferenceMap,
  CloudRow,
} from "./contracts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

function uploadStatus(status: UploadQueueItem["status"]): "failed" | "uploaded" | "queued" {
  if (status === "failed") {
    return "failed";
  }
  if (status === "uploaded") {
    return "uploaded";
  }
  return "queued";
}

export function stableCloudUuid(value: string): string {
  const seeds = [2166136261, 2246822519, 3266489917, 668265263];
  const parts = seeds.map((seed) => {
    let hash = seed;
    for (const character of value) {
      hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  });
  const hex = parts.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-8${hex.slice(15, 18)}-${hex.slice(18, 30)}`;
}

function issue(code: CloudMappingIssue["code"], field: string, message: string): CloudMappingIssue {
  return { code, field, message };
}

function reference(
  values: Record<string, string> | undefined,
  localId: string,
  field: string,
): CloudMappingResult<string> {
  // A local UUID is not evidence that the row belongs to the current cloud user.
  // Only bootstrap-resolved references are safe to send to an ownership-checked RPC.
  const remoteId = values?.[localId];
  return remoteId
    ? { ok: true, value: remoteId }
    : { ok: false, issues: [issue("missing-reference", field, t("cloud.mappingNoReference", { id: localId }))] };
}

function ledgerReference(
  values: Record<string, string> | undefined,
  localId: string,
  userId: string,
  field: string,
): CloudMappingResult<string> {
  const remoteId = values?.[localId] ?? (isUuid(localId) ? localId : stableCloudUuid(`ledger:${userId}:${localId}`));
  return remoteId
    ? { ok: true, value: remoteId }
    : { ok: false, issues: [issue("missing-reference", field, t("cloud.mappingNoReference", { id: localId }))] };
}

function money(value: string, currency: string, field: string, positive = false): CloudMappingResult<string> {
  const minorUnits = parseMinorUnits(value, currency);
  if (minorUnits === null || (positive && minorUnits <= 0n)) {
    return { ok: false, issues: [issue("invalid-money", field, t("cloud.mappingInvalidMoney", { field, currency }))] };
  }
  return { ok: true, value: minorUnits.toString() };
}

function collect<T>(results: CloudMappingResult<T>[]): CloudMappingIssue[] {
  return results.flatMap((result) => result.ok ? [] : result.issues);
}

export function mapLocalAccount(account: LocalAccount, userId: string): CloudRow {
  return {
    id: stableCloudUuid(`account:${userId}:${account.id}`),
    user_id: userId,
    name: account.name,
    currency: account.currency?.trim().toUpperCase() || "TWD",
    account_type: account.accountType ?? "cash",
    allow_negative_balance: account.allowNegativeBalance ?? true,
  };
}

export function mapDraft(draft: TransactionDraft, userId: string): CloudRow {
  return {
    ...(isUuid(draft.id) ? { id: draft.id } : {}),
    user_id: userId,
    draft_type: "manual",
    state: "pending",
    candidate_json: draft,
  };
}

export function mapMediaAsset(item: UploadQueueItem, userId: string, now: string): CloudRow {
  const kind: UploadMediaKind = item.kind ?? "attachment";
  const mediaId = item.remoteMediaId ?? stableCloudUuid(`media:${userId}:${item.id}`);
  const temporary = kind === "receipt-scan" || kind === "invoice-scan";
  return {
    id: mediaId,
    user_id: userId,
    storage_provider: "r2",
    bucket: item.bucket ?? "pending",
    object_key: item.objectKey ?? `pending/${userId}/${mediaId}/${encodeURIComponent(item.name)}`,
    content_type: item.type || "application/octet-stream",
    byte_size: item.size,
    captured_at: now,
    media_kind: kind,
    retention_kind: temporary ? "temporary-scan" : "permanent",
    expires_at: temporary ? new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString() : null,
    upload_status: uploadStatus(item.status),
  };
}

export function mapTemporaryScan(scan: TemporaryScan, userId: string): CloudRow {
  const sourceId = stableCloudUuid(`source:${userId}:${scan.id}`);
  return {
    id: sourceId,
    user_id: userId,
    source_type: scan.intent === "scan-invoice" ? "invoice-scan" : "receipt-scan",
    source_state: scan.state === "retained" ? "retained" : scan.state,
    payload_json: {
      file_name: scan.fileName,
      mime_type: scan.mimeType,
      byte_size: scan.byteSize,
      intent: scan.intent,
    },
    expires_at: scan.expiresAt,
    ...(scan.state === "discarded" ? { discarded_at: scan.createdAt } : {}),
  };
}

export function mapTemporaryScanMediaLink(scan: TemporaryScan, userId: string, mediaId?: string): CloudRow {
  return {
    user_id: userId,
    media_asset_id: mediaId ?? stableCloudUuid(`media:${userId}:${scan.id}`),
    target_type: "source-payload",
    target_id: stableCloudUuid(`source:${userId}:${scan.id}`),
    link_intent: scan.intent === "scan-invoice" ? "invoice-scan" : "receipt-evidence",
  };
}

export function mapMealEntry(
  meal: MealEntry,
  userId: string,
  references: CloudReferenceMap,
  timezone = "Asia/Taipei",
): CloudMappingResult<CloudMealBundle> {
  const mealDate = new Date(meal.occurredAt);
  if (!Number.isFinite(mealDate.getTime())) {
    return { ok: false, issues: [issue("invalid-date", "meal.occurredAt", t("cloud.mappingIssueDate"))] };
  }

  const mealId = stableCloudUuid(`meal:${userId}:${meal.id}`);
  const transactionLinks: CloudRow[] = [];
  const linkIssues: CloudMappingIssue[] = [];
  for (const transactionId of meal.transactionIds) {
    const remoteId = ledgerReference(references.ledgerRecordIds, transactionId, userId, "meal_transaction_links.ledger_record_id");
    if (!remoteId.ok) {
      linkIssues.push(...remoteId.issues);
    } else {
      transactionLinks.push({
        user_id: userId,
        meal_id: mealId,
        ledger_record_id: remoteId.value,
        link_reason: "manual",
        confirmed_at: meal.status === "synced" ? meal.occurredAt : null,
      });
    }
  }

  const mediaLinks: CloudRow[] = meal.mediaAssetIds.map((mediaAssetId) => ({
    user_id: userId,
    media_asset_id: references.mediaIds?.[mediaAssetId] ?? stableCloudUuid(`media:${userId}:${mediaAssetId}`),
    target_type: "meal",
    target_id: mealId,
    link_intent: "meal-photo",
  }));

  if (linkIssues.length > 0) return { ok: false, issues: linkIssues };
  return {
    ok: true,
    value: {
      mealEntry: {
        id: mealId,
        user_id: userId,
        meal_at: mealDate.toISOString(),
        timezone,
        description: meal.note || null,
      },
      transactionLinks,
      mediaLinks,
    },
  };
}

function mapAuditEvent(event: LocalAuditEvent, targetId = event.targetId): CloudRow {
  return {
    id: isUuid(event.id) ? event.id : stableCloudUuid(`audit:${event.userId}:${event.id}`),
    user_id: event.userId,
    event_type: event.eventType,
    target_type: event.targetType,
    target_id: targetId,
    summary: event.summary,
    changes_json: { changedFields: event.changedFields },
    created_at: event.createdAt,
  };
}

function mapLedgerTags(
  record: LocalLedgerRecord,
  userId: string,
  references: CloudReferenceMap,
  recordId: CloudMappingResult<string>,
): { rows: CloudRow[]; issues: CloudMappingIssue[] } {
  const rows: CloudRow[] = [];
  const issues: CloudMappingIssue[] = [];
  for (const tag of record.tags ?? []) {
    const tagId = reference(references.tagIds, tag, "ledger_record_tags.tag_id");
    if (!tagId.ok) {
      issues.push(...tagId.issues);
      continue;
    }

    rows.push({ user_id: userId, ledger_record_id: recordId.ok ? recordId.value : undefined, tag_id: tagId.value });
  }
  return { rows, issues };
}

function transferReferences(
  record: LocalLedgerRecord,
  userId: string,
  references: CloudReferenceMap,
  feeLedgerRecordId?: string,
): CloudMappingResult<{ destinationId: string; destinationAmount: string; destinationCurrency: string; feeId: string | null }> {
  const destinationId = reference(references.accountIds, record.transferAccountId, "destination_account_id");
  const destinationAmount = money(
    record.destinationAmount || record.amount,
    record.destinationCurrency || record.currency,
    "destination_amount",
    true,
  );
  const feeId = feeLedgerRecordId ? ledgerReference(references.ledgerRecordIds, feeLedgerRecordId, userId, "fee_ledger_record_id") : undefined;
  const issues = collect([destinationId, destinationAmount]);
  if (feeId && !feeId.ok) issues.push(...feeId.issues);
  if (issues.length > 0 || !destinationId.ok || !destinationAmount.ok) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      destinationId: destinationId.value,
      destinationAmount: destinationAmount.value,
      destinationCurrency: (record.destinationCurrency || record.currency).toUpperCase(),
      feeId: feeId?.ok ? feeId.value : null,
    },
  };
}

function mapTransferDetails(
  record: LocalLedgerRecord,
  userId: string,
  references: CloudReferenceMap,
  recordId: string,
  feeLedgerRecordId?: string,
): CloudMappingResult<CloudRow | undefined> {
  if (record.kind !== "transfer") return { ok: true, value: undefined };

  const mapped = transferReferences(record, userId, references, feeLedgerRecordId);
  if (!mapped.ok) return mapped;

  return {
    ok: true,
    value: {
      ledger_record_id: recordId,
      destination_account_id: mapped.value.destinationId,
      destination_account_name: record.transferAccountName,
      destination_amount_minor: mapped.value.destinationAmount,
      destination_currency: mapped.value.destinationCurrency,
      fee_ledger_record_id: mapped.value.feeId,
    },
  };
}

type RefundAllocation = { originalRecordId: string; amount: string; currency: string };

function mapRefundAllocation(
  record: LocalLedgerRecord,
  userId: string,
  references: CloudReferenceMap,
  recordId: string,
  allocation: RefundAllocation,
): CloudMappingResult<CloudRow> {
  const originalId = ledgerReference(references.ledgerRecordIds, allocation.originalRecordId, userId, "original_record_id");
  const linkedAmount = money(allocation.amount, allocation.currency, "refund_link.amount", true);
  const issues = collect([originalId, linkedAmount]);
  if (issues.length > 0 || !originalId.ok || !linkedAmount.ok) return { ok: false, issues };
  return {
    ok: true,
    value: {
      refund_record_id: recordId,
      original_record_id: originalId.value,
      amount_minor: linkedAmount.value,
      currency: allocation.currency.toUpperCase(),
      refund_subtype: record.refundSubtype,
      difference_kind: record.refundExcessHandling === "unclassified" ? null : record.refundExcessHandling,
    },
  };
}

function mapRefundAllocations(
  record: LocalLedgerRecord,
  userId: string,
  references: CloudReferenceMap,
  recordId: string,
  allocations: RefundAllocation[],
): CloudMappingResult<CloudRow[]> {
  const mapped = allocations.map((allocation) => mapRefundAllocation(record, userId, references, recordId, allocation));
  const issues = mapped.flatMap((result) => result.ok ? [] : result.issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: mapped.flatMap((result) => result.ok ? [result.value] : []) };
}

function mapRefundLinks(
  record: LocalLedgerRecord,
  userId: string,
  references: CloudReferenceMap,
  recordId: string,
  amount: string,
): CloudMappingResult<CloudRow[]> {
  if (record.kind !== "refund") return { ok: true, value: [] };

  const allocations = references.refundAllocations?.[record.id];
  if (allocations && allocations.length > 0) return mapRefundAllocations(record, userId, references, recordId, allocations);

  const linkedIds = record.refundLinkedRecordIds ?? [];
  if (linkedIds.length === 0 && record.refundLinkedRecordId) {
    linkedIds.push(record.refundLinkedRecordId);
  }
  if (linkedIds.length !== 1) {
    return { ok: false, issues: [issue("missing-refund-allocation", "refundLinkedRecordIds", t("cloud.mappingRefundAllocation"))] };
  }

  const originalId = ledgerReference(references.ledgerRecordIds, linkedIds[0], userId, "original_record_id");
  if (!originalId.ok) return { ok: false, issues: originalId.issues };
  return {
    ok: true,
    value: [{
      refund_record_id: recordId,
      original_record_id: originalId.value,
      amount_minor: amount,
      currency: record.currency.toUpperCase(),
      refund_subtype: record.refundSubtype,
      difference_kind: record.refundExcessHandling === "unclassified" ? null : record.refundExcessHandling,
    }],
  };
}

function mapRecordAuditEvents(
  record: LocalLedgerRecord,
  userId: string,
  recordId: string,
  auditEvents: LocalAuditEvent[],
): CloudRow[] {
  const recordAuditEvents = auditEvents.filter((event) => event.targetId === record.id);
  if (recordAuditEvents.length > 0) return recordAuditEvents.map((event) => mapAuditEvent(event, recordId));
  return [mapAuditEvent({
    id: `cloud-audit-${record.id}`,
    userId,
    eventType: "record-created",
    targetType: "ledger-record",
    targetId: record.id,
    summary: `Persisted ${record.kind} record`,
    changedFields: ["kind", "amount", "account"],
    createdAt: record.updatedAt,
  }, recordId)];
}

function optionalText(value: string | undefined): string | null {
  return value?.trim() || null;
}

function optionalReference(
  value: string,
  values: Record<string, string> | undefined,
  field: string,
): CloudMappingResult<string | undefined> {
  if (!value.trim()) return { ok: true, value: undefined };
  const result = reference(values, value, field);
  if (!result.ok) return { ok: false, issues: result.issues };
  return { ok: true, value: result.value };
}

type LedgerRowInput = {
  record: LocalLedgerRecord;
  userId: string;
  timezone: string;
  accountId: string;
  amount: string;
  categoryId: string | undefined;
  merchantId: string | undefined;
  eventId: string | undefined;
  recordId: string;
};

function createLedgerRow({ record, userId, timezone, accountId, amount, categoryId, merchantId, eventId, recordId }: LedgerRowInput): CloudRow {
  const isDay = record.timePrecision === "day";
  const source = record.kind === "income" || record.kind === "fund-addition" ? optionalText(record.counterparty) : null;
  return {
    id: recordId,
    user_id: userId,
    kind: record.kind,
    record_state: record.recordState,
    local_date: isDay ? record.localDate : null,
    timezone,
    time_precision: record.timePrecision,
    period_start: isDay ? null : record.periodStart,
    period_end: isDay ? null : record.periodEnd,
    account_id: accountId,
    amount_minor: amount,
    currency: record.currency.toUpperCase(),
    category_id: categoryId ?? null,
    merchant_id: merchantId ?? null,
    merchant_text: optionalText(record.counterparty),
    item_name: optionalText(record.itemName),
    source,
    reason: optionalText(record.reason) ?? optionalText(record.refundReason),
    event_id: eventId ?? null,
    source_label: optionalText(record.sourceLabel),
    note: optionalText(record.note),
    version: record.version,
    idempotency_key: record.idempotencyKey,
    voided_at: record.recordState === "voided" ? record.updatedAt : null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function mapLedgerDetails(
  record: LocalLedgerRecord,
  userId: string,
  references: CloudReferenceMap,
  recordId: string,
  amount: string,
  feeLedgerRecordId: string | undefined,
): CloudMappingResult<Pick<CloudRecordBundle, "transferDetails" | "refundLinks">> {
  const transferMapping = mapTransferDetails(record, userId, references, recordId, feeLedgerRecordId);
  const refundMapping = mapRefundLinks(record, userId, references, recordId, amount);
  const issues = [
    ...(transferMapping.ok ? [] : transferMapping.issues),
    ...(refundMapping.ok ? [] : refundMapping.issues),
  ];
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      transferDetails: transferMapping.ok ? transferMapping.value : undefined,
      refundLinks: refundMapping.ok ? refundMapping.value : [],
    },
  };
}

export function mapLedgerRecord(
  record: LocalLedgerRecord,
  userId: string,
  references: CloudReferenceMap,
  timezone = "Asia/Taipei",
  auditEvents: LocalAuditEvent[] = [],
  feeLedgerRecordId?: string,
): CloudMappingResult<CloudRecordBundle> {
  const normalizedRecord = { ...record, currency: record.currency?.trim() || "TWD" };
  const recordId = ledgerReference(references.ledgerRecordIds, record.id, userId, "id");
  const accountId = reference(references.accountIds, record.accountId, "account_id");
  const amount = money(record.amount, normalizedRecord.currency, "amount", record.kind !== "adjustment");
  const issues = collect([recordId, accountId, amount]);

  const needsCategory = ["expense", "income", "refund"].includes(record.kind);
  const categoryId = needsCategory
    ? optionalReference(record.category, references.categoryIds, "category_id")
    : { ok: true as const, value: undefined };
  if (!categoryId.ok) issues.push(...categoryId.issues);

  const eventId = optionalReference(record.event ?? "", references.eventIds, "event_id");
  if (!eventId.ok) issues.push(...eventId.issues);

  const merchantKinds = ["expense", "refund", "unresolved-expense"];
  const merchantId = references.merchantIds && merchantKinds.includes(record.kind)
    ? optionalReference(record.counterparty, references.merchantIds, "merchant_id")
    : { ok: true as const, value: undefined };
  if (!merchantId.ok) issues.push(...merchantId.issues);

  const tagMapping = mapLedgerTags(record, userId, references, recordId);
  issues.push(...tagMapping.issues);

  if (issues.length > 0 || !recordId.ok || !accountId.ok || !amount.ok || !categoryId.ok || !eventId.ok || !merchantId.ok) {
    return { ok: false, issues };
  }

  const ledgerRecord = createLedgerRow({
    record: normalizedRecord,
    userId,
    timezone,
    accountId: accountId.value,
    amount: amount.value,
    categoryId: categoryId.value,
    merchantId: merchantId.value,
    eventId: eventId.value,
    recordId: recordId.value,
  });
  if (record.kind === "transfer") {
    ledgerRecord.account_name = record.accountName;
  }

  const bundle: CloudRecordBundle = {
    ledgerRecord,
    refundLinks: [],
    ledgerRecordTags: tagMapping.rows,
    auditEvents: [],
  };

  const detailMapping = mapLedgerDetails(normalizedRecord, userId, references, recordId.value, amount.value, feeLedgerRecordId);
  if (!detailMapping.ok) return { ok: false, issues: [...issues, ...detailMapping.issues] };

  bundle.transferDetails = detailMapping.value.transferDetails;
  bundle.refundLinks = detailMapping.value.refundLinks;
  bundle.ledgerRecordTags = tagMapping.rows;
  bundle.auditEvents = mapRecordAuditEvents(record, userId, recordId.value, auditEvents);

  return { ok: true, value: bundle };
}
