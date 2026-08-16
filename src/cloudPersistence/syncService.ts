import { t } from "../i18n";
import type { ReferenceBootstrapClient } from "./bootstrap";
import { bootstrapReferences } from "./bootstrap";
import type { CloudPersistenceClient, CloudReferenceMap } from "./contracts";
import { mapDraft, mapLedgerRecord, mapMealEntry, mapMediaAsset, mapTemporaryScan, mapTemporaryScanMediaLink, stableCloudUuid } from "./mappers";
import { persistDraft, persistMealBundle, persistMediaAsset, persistProfile, persistRecordBundle, persistSourcePayload, type CloudPersistenceResult } from "./repository";
import {
  enqueueDraftSync,
  enqueueAccountSync,
  enqueueRecordSync,
  markCloudSyncFailure,
  markCloudSynced,
  markCloudSyncing,
  enqueueMealSync,
  enqueueMediaSync,
  enqueueScanSync,
  pendingCloudSyncItems,
  type CloudSyncQueueItem,
} from "./syncQueue";
import type { TransactionDraft } from "../appShell/drafts";
import type { LocalAccount } from "../manualLedger/accounts";
import type { LocalLedgerRecord } from "../manualLedger/records";
import type { TaxonomyAliasSeed } from "../taxonomy/defaults";
import type { MealEntry } from "../captureMedia/meals";
import type { TemporaryScan } from "../captureMedia/media";
import type { UploadQueueItem } from "../captureMedia/upload";

export type SyncLocalChangesInput = {
  client: CloudPersistenceClient;
  referenceClient: ReferenceBootstrapClient;
  userId: string;
  accounts: LocalAccount[];
  categories: string[];
  aliases: TaxonomyAliasSeed[];
  merchants: string[];
  tags: string[];
  events: string[];
  auditEvents: import("../manualLedger/records").LocalAuditEvent[];
  records: LocalLedgerRecord[];
  drafts: TransactionDraft[];
  meals: MealEntry[];
  media: UploadQueueItem[];
  scans: TemporaryScan[];
  queue: CloudSyncQueueItem[];
  now: string;
};

export type SyncLocalChangesResult = {
  records: LocalLedgerRecord[];
  meals: MealEntry[];
  media: UploadQueueItem[];
  scans: TemporaryScan[];
  queue: CloudSyncQueueItem[];
};

function orderPendingSyncItems(items: CloudSyncQueueItem[], records: LocalLedgerRecord[]): CloudSyncQueueItem[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  return [...items].sort((left, right) => {
    const leftRecord = left.target === "record" ? recordById.get(left.targetId) : undefined;
    const rightRecord = right.target === "record" ? recordById.get(right.targetId) : undefined;
    const leftIsFee = Boolean(leftRecord?.linkedRecordId);
    const rightIsFee = Boolean(rightRecord?.linkedRecordId);
    return Number(rightIsFee) - Number(leftIsFee);
  });
}

type SyncContext = { input: SyncLocalChangesInput; references: CloudReferenceMap };

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function accountsForBootstrap(accounts: LocalAccount[], records: LocalLedgerRecord[]): LocalAccount[] {
  const result = [...accounts];
  const names = new Set(result.map((account) => normalizedName(account.name)));

  const addRecordAccount = (id: string, name: string, currency?: string | null) => {
    const trimmedName = name.trim();
    const normalized = normalizedName(trimmedName);
    if (!trimmedName || names.has(normalized)) return;
    result.push({ id: id || `sync-account:${normalized}`, name: trimmedName, currency: currency?.trim() || "TWD" });
    names.add(normalized);
  };

  for (const record of records) {
    addRecordAccount(record.accountId, record.accountName, record.currency);
    if (record.kind === "transfer") {
      addRecordAccount(record.transferAccountId, record.transferAccountName, record.destinationCurrency || record.currency);
    }
    if (record.feeAccountName) {
      addRecordAccount(record.feeAccountId, record.feeAccountName, record.feeCurrency || record.currency);
    }
  }

  return result;
}

function rebindAccountReferences(
  references: CloudReferenceMap,
  accounts: LocalAccount[],
  records: LocalLedgerRecord[],
): CloudReferenceMap {
  const idsByName = new Map<string, string>();
  for (const account of accounts) {
    const cloudId = references.accountIds[account.id];
    if (cloudId) idsByName.set(normalizedName(account.name), cloudId);
  }

  const accountIds = { ...references.accountIds };
  for (const record of records) {
    const sourceId = idsByName.get(normalizedName(record.accountName));
    if (sourceId) accountIds[record.accountId] = sourceId;

    if (record.kind === "transfer") {
      const destinationId = idsByName.get(normalizedName(record.transferAccountName));
      if (destinationId) accountIds[record.transferAccountId] = destinationId;
    }
  }

  return { ...references, accountIds };
}


function markMediaSynced(media: UploadQueueItem[], id: string): UploadQueueItem[] {
  return media.map((candidate) => candidate.id === id ? { ...candidate, metadataStatus: "synced" as const } : candidate);
}

function markScansSynced(scans: TemporaryScan[], id: string): TemporaryScan[] {
  return scans.map((candidate) => candidate.id === id ? { ...candidate, cloudStatus: "synced" as const } : candidate);
}

export function mergeSyncedScans(current: TemporaryScan[], synced: TemporaryScan[]): TemporaryScan[] {
  const syncedById = new Map(synced.map((scan) => [scan.id, scan]));

  return current.map((scan) => {
    const syncedScan = syncedById.get(scan.id);
    if (syncedScan?.state !== scan.state) return scan;
    return { ...scan, cloudStatus: syncedScan.cloudStatus };
  });
}

export function mergeSyncedItems<T extends { id: string }>(current: T[], synced: T[]): T[] {
  const syncedById = new Map(synced.map((item) => [item.id, item]));
  return current.map((item) => syncedById.get(item.id) ?? item);
}

function markMealsSynced(meals: MealEntry[], id: string): MealEntry[] {
  return meals.map((candidate) => candidate.id === id ? { ...candidate, status: "synced" as const } : candidate);
}

function hasUploadedMedia(media: UploadQueueItem[], mediaIds: string[]): boolean {
  return mediaIds.every((mediaId) => {
    const item = media.find((candidate) => candidate.id === mediaId);
    return Boolean(item?.status === "uploaded" && item.remoteMediaId && item.objectKey);
  });
}

function markRecordsSynced(records: LocalLedgerRecord[], id: string): LocalLedgerRecord[] {
  return records.map((candidate) => candidate.id === id ? { ...candidate, status: "synced" as const } : candidate);
}

function applyPersistenceResult(
  queue: CloudSyncQueueItem[],
  item: CloudSyncQueueItem,
  result: CloudPersistenceResult,
  now: string,
): CloudSyncQueueItem[] {
  if (result.ok) return markCloudSynced(queue, item.id, now);
  return markCloudSyncFailure(queue, item.id, result.failure.message, result.failure.retryable, now, result.failure.code === "conflict" ? "conflict" : undefined);
}

function applyItemFailure(state: SyncLocalChangesResult, item: CloudSyncQueueItem, message: string, now: string, retryable = false): SyncLocalChangesResult {
  return { ...state, queue: markCloudSyncFailure(state.queue, item.id, message, retryable, now) };
}

async function syncDraftItem(item: CloudSyncQueueItem, context: SyncContext, state: SyncLocalChangesResult): Promise<SyncLocalChangesResult> {
  const { input } = context;
  const draft = input.drafts.find((candidate) => candidate.id === item.targetId);
  if (!draft) return applyItemFailure(state, item, t("cloud.draftGone"), input.now);
  const result = await persistDraft(input.client, mapDraft(draft, input.userId));
  return { ...state, queue: applyPersistenceResult(state.queue, item, result, input.now) };
}

function syncAccountItem(item: CloudSyncQueueItem, context: SyncContext, state: SyncLocalChangesResult): SyncLocalChangesResult {
  const { input, references } = context;
  const account = input.accounts.find((candidate) => candidate.id === item.targetId);
  if (!account) return applyItemFailure(state, item, t("cloud.accountGone"), input.now);
  if (!references.accountIds[account.id]) return applyItemFailure(state, item, t("cloud.accountRefMissing"), input.now);
  return { ...state, queue: markCloudSynced(state.queue, item.id, input.now) };
}

async function syncMediaItem(item: CloudSyncQueueItem, context: SyncContext, state: SyncLocalChangesResult): Promise<SyncLocalChangesResult> {
  const { input } = context;
  const media = input.media.find((candidate) => candidate.id === item.targetId);
  if (!media) return applyItemFailure(state, item, t("cloud.mediaGone"), input.now);
  const result = await persistMediaAsset(input.client, mapMediaAsset(media, input.userId, input.now));
  const nextMedia = result.ok ? markMediaSynced(state.media, media.id) : state.media;
  return { ...state, media: nextMedia, queue: applyPersistenceResult(state.queue, item, result, input.now) };
}

async function syncScanItem(item: CloudSyncQueueItem, context: SyncContext, state: SyncLocalChangesResult): Promise<SyncLocalChangesResult> {
  const { input } = context;
  const scan = input.scans.find((candidate) => candidate.id === item.targetId);
  if (!scan) return applyItemFailure(state, item, t("cloud.scanGone"), input.now);
  const media = input.media.find((candidate) => candidate.id === scan.id);
  if (media && !hasUploadedMedia(input.media, [scan.id])) return state;
  const mediaLink = media
    ? [mapTemporaryScanMediaLink(scan, input.userId, media.remoteMediaId ?? stableCloudUuid(`media:${input.userId}:${scan.id}`))]
    : [];
  const result = await persistSourcePayload(input.client, mapTemporaryScan(scan, input.userId), mediaLink);
  const nextScans = result.ok ? markScansSynced(state.scans, scan.id) : state.scans;
  return { ...state, scans: nextScans, queue: applyPersistenceResult(state.queue, item, result, input.now) };
}

async function syncMealItem(item: CloudSyncQueueItem, context: SyncContext, state: SyncLocalChangesResult): Promise<SyncLocalChangesResult> {
  const { input, references } = context;
  const meal = input.meals.find((candidate) => candidate.id === item.targetId);
  if (!meal) return applyItemFailure(state, item, t("cloud.mealGone"), input.now);
  if (!hasUploadedMedia(input.media, meal.mediaAssetIds)) return state;
  const mediaIds = Object.fromEntries(input.media.map((media) => [
    media.id,
    media.remoteMediaId ?? stableCloudUuid(`media:${input.userId}:${media.id}`),
  ]));
  const mappedMeal = mapMealEntry(meal, input.userId, { ...references, mediaIds });
  if (!mappedMeal.ok) return applyItemFailure(state, item, mappedMeal.issues.map((entry) => entry.message).join(" "), input.now);
  const result = await persistMealBundle(input.client, mappedMeal.value);
  const nextMeals = result.ok ? markMealsSynced(state.meals, meal.id) : state.meals;
  return { ...state, meals: nextMeals, queue: applyPersistenceResult(state.queue, item, result, input.now) };
}

async function syncRecordItem(item: CloudSyncQueueItem, context: SyncContext, state: SyncLocalChangesResult): Promise<SyncLocalChangesResult> {
  const { input, references } = context;
  const record = input.records.find((candidate) => candidate.id === item.targetId);
  if (!record) return applyItemFailure(state, item, t("cloud.recordGone"), input.now);
  const feeRecord = record.kind === "transfer"
    ? input.records.find((candidate) => candidate.kind === "expense" && candidate.linkedRecordId === record.id)
    : undefined;
  const mapped = mapLedgerRecord(record, input.userId, references, "Asia/Taipei", input.auditEvents, feeRecord?.id);
  if (!mapped.ok) return applyItemFailure(state, item, mapped.issues.map((entry) => entry.message).join(" "), input.now);
  const result = await persistRecordBundle(input.client, {
    userId: input.userId,
    actionType: item.actionType,
    idempotencyKey: item.idempotencyKey,
    requestHash: item.requestHash,
    expiresAt: new Date(new Date(input.now).getTime() + 180 * 24 * 60 * 60 * 1000).toISOString(),
  }, mapped.value);
  const nextRecords = result.ok ? markRecordsSynced(state.records, record.id) : state.records;
  return { ...state, records: nextRecords, queue: applyPersistenceResult(state.queue, item, result, input.now) };
}

async function syncItem(item: CloudSyncQueueItem, context: SyncContext, state: SyncLocalChangesResult): Promise<SyncLocalChangesResult> {
  if (item.target === "account") return syncAccountItem(item, context, state);
  if (item.target === "draft") return await syncDraftItem(item, context, state);
  if (item.target === "media") return await syncMediaItem(item, context, state);
  if (item.target === "scan") return await syncScanItem(item, context, state);
  if (item.target === "meal") return await syncMealItem(item, context, state);
  return await syncRecordItem(item, context, state);
}

export async function syncLocalChanges(input: SyncLocalChangesInput): Promise<SyncLocalChangesResult> {
  const pending = orderPendingSyncItems(pendingCloudSyncItems(input.queue, input.now), input.records);
  let state: SyncLocalChangesResult = { records: input.records, meals: input.meals, media: input.media, scans: input.scans, queue: input.queue };
  if (pending.length === 0) return state;

  const syncAccounts = accountsForBootstrap(input.accounts, input.records);

  const profileResult = await persistProfile(input.client, {
    user_id: input.userId,
    default_currency: syncAccounts[0]?.currency.toUpperCase() ?? "TWD",
    default_timezone: "Asia/Taipei",
  });
  if (!profileResult.ok) {
    return {
      ...state,
      queue: pending.reduce(
        (current, item) => markCloudSyncFailure(current, item.id, profileResult.failure.message, profileResult.failure.retryable, input.now),
        state.queue,
      ),
    };
  }

  const bootstrap = await bootstrapReferences(input.referenceClient, {
    userId: input.userId,
    accounts: syncAccounts,
    categories: input.categories,
    aliases: input.aliases,
    merchants: input.merchants,
    tags: input.tags,
    events: input.events,
  });
  if (!bootstrap.ok) {
    state = {
      ...state,
      queue: pending.reduce((current, item) => markCloudSyncFailure(current, item.id, bootstrap.message, true, input.now), state.queue),
    };
    return state;
  }

  const references = rebindAccountReferences(bootstrap.references, syncAccounts, input.records);
  const context: SyncContext = { input, references };
  for (const item of pending) {
    state = { ...state, queue: markCloudSyncing(state.queue, item.id, input.now) };
    state = await syncItem(item, context, state);
  }
  return state;
}

export function enqueueLocalChanges({
  queue,
  accounts,
  records,
  drafts,
  meals,
  media,
  scans,
  now,
}: Readonly<{
  queue: CloudSyncQueueItem[];
  accounts: LocalAccount[];
  records: LocalLedgerRecord[];
  drafts: TransactionDraft[];
  meals: MealEntry[];
  media: UploadQueueItem[];
  scans: TemporaryScan[];
  now: string;
}>): CloudSyncQueueItem[] {
  let next = queue;
  for (const account of accounts) next = enqueueAccountSync(next, account, now);
  for (const item of media) {
    next = enqueueMediaSync(next, item, now);
  }
  const orderedRecords = [...records].sort((left, right) => {
    const leftIsFee = Boolean(left.linkedRecordId);
    const rightIsFee = Boolean(right.linkedRecordId);
    return Number(rightIsFee) - Number(leftIsFee);
  });
  for (const record of orderedRecords) next = enqueueRecordSync(next, record, now);
  for (const draft of drafts) next = enqueueDraftSync(next, draft, now);
  for (const scan of scans) next = enqueueScanSync(next, scan, now);
  for (const meal of meals) next = enqueueMealSync(next, meal, now);
  return next;
}
