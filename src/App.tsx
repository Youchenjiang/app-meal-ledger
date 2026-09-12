import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import {
  AlertCircle,
  Banknote,
  Camera,
  CheckCircle2,
  Cloud,
  CloudOff,
  Eye,
  EyeOff,
  Home,
  ImagePlus,
  KeyRound,
  LayoutGrid,
  LogIn,
  LogOut,
  Plus,
  UserPlus,
  ReceiptText,
  Settings,
  Sparkles,
  Upload,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { isLocalDevelopmentMode, isSupabaseConfigured, supabase } from "./lib/supabase";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { alreadyRegisteredMessage, type LinkedIdentity, type OAuthProvider } from "./auth/authActions";
import googleG from "./assets/google-g.svg";
import facebookF from "./assets/facebook-f.svg";
import type { AppLocation, AppRoute, AuthState, NavItem } from "./types";
import { canAutoRecordNextCycle, createTransactionDraft, draftKinds, missingCounterpartyLabel, missingItemNameLabel, monthToPeriodRange, normalizeDraftForm, type DraftForm, type TransactionDraft } from "./appShell/drafts";
import { applyResolvedTheme, readStoredTheme, resolveTheme, writeStoredTheme, type ThemeMode } from "./appShell/theme";
import { t } from "./i18n";
import { useI18n } from "./i18n/react";
import { createLocalAccount, type LocalAccount } from "./manualLedger/accounts";
import { readDeleteAction, writeDeleteAction, type DeleteAction } from "./manualLedger/deletePolicy";
import { negativeBalanceRejectionReason, readNegativeBalancePolicy, writeNegativeBalancePolicy, type NegativeBalancePolicy } from "./manualLedger/negativeBalance";
import { calculateAccountBalances, formatAccountBalance } from "./manualLedger/balances";
import { calculateAccountReports, type AccountReport } from "./manualLedger/reports";
import { appendIdempotentRecords, convertUnresolvedExpense, createOfficialRecordBundle, updateOfficialRecord, voidOfficialRecord, type EditableRecordFields, type LocalAuditEvent, type LocalLedgerRecord, type UnresolvedExpenseConversion } from "./manualLedger/records";
import { createMultiTableExportWithProgress, serializeCleanCsv, serializeCleanJson } from "./manualLedger/export";
import { validateCsvBytes } from "./importExport/csv";
import { mapImportHeaders, mapImportRow } from "./importExport/mapping";
import { validateImportRows, type ImportRowValidation, type NormalizedImportRow } from "./importExport/rowValidation";
import { categoryReviewSummary } from "./importExport/aliases";
import { toImportedTransactionDraft } from "./importExport/recordDraft";
import { detectImportDuplicates, type ImportDuplicate } from "./importExport/duplicates";
import { createInitialFundingDraft } from "./onboarding/initialFunding";
import { applyDefaultTaxonomy, type TaxonomyAliasSeed } from "./taxonomy/defaults";
import { captureIntentLabel, captureIntents, type CaptureIntent } from "./captureMedia/intents";
import { createMealEntry, type MealEntry } from "./captureMedia/meals";
import { createTemporaryScan, discardTemporaryScan, expireTemporaryScans, retainTemporaryScan, type TemporaryScan } from "./captureMedia/media";
import { queueUploadFiles, uploadMediaFile, validateMediaBatch, type SignedUploadClient, type UploadQueueItem } from "./captureMedia/upload";
import { createSupabasePersistenceClient, createSupabaseReferenceBootstrapClient, type RawSupabaseClient } from "./cloudPersistence/supabaseClient";
import { enqueueRecordSync, retryCloudSyncItem, type CloudSyncQueueItem } from "./cloudPersistence/syncQueue";
import { enqueueLocalChanges, mergeSyncedItems, mergeSyncedQueue, mergeSyncedScans, syncLocalChanges } from "./cloudPersistence/syncService";
import { rebindLocalWorkspace } from "./cloudPersistence/workspaceHandoff";
import { AiLedgerPanel, AiModeSwitch } from "./ai/AiLedgerPanel";
import { readAiEntityPolicy, writeAiEntityPolicy, type AiEntityPolicy, type AiEntityPolicyOption } from "./ai/entityPolicy";
import { buildPrefillForm, type NewEntityCarrier } from "./ai/parse";

const navItems: NavItem[] = [
  { route: "overview", labelKey: "nav.overview", path: "/", icon: Home },
  { route: "ledger", labelKey: "nav.ledger", path: "/ledger", icon: Banknote },
  { route: "capture", labelKey: "nav.capture", path: "/capture", icon: Plus },
  { route: "zone", labelKey: "nav.zone", path: "/zone", icon: LayoutGrid },
  { route: "settings", labelKey: "nav.settings", path: "/settings", icon: Settings },
];

type RouteDefinition = {
  segments: string[];
  route: Exclude<AppRoute, "not-found">;
};

type ImportReviewItem = ImportRowValidation & {
  reviewId: string;
  aliasReview: string | null;
  duplicates: ImportDuplicate[];
  status: "pending" | "confirmed" | "skipped" | "failed" | "kept-separate" | "linked" | "merged";
};

type PhotoInput = FileList | File[] | null;
type QuickAccountField = "account" | "transferAccount" | "feeAccount";

const routeDefinitions: RouteDefinition[] = [
  { segments: [], route: "overview" },
  { segments: ["overview"], route: "overview" },
  { segments: ["ledger"], route: "ledger" },
  { segments: ["ledger", "draft", ":draftId"], route: "ledger" },
  { segments: ["capture"], route: "capture" },
  { segments: ["zone"], route: "zone" },
  { segments: ["settings"], route: "settings" },
  { segments: ["settings", "localization"], route: "settings" },
  // /account stays reachable as the password-reset redirect target; it renders
  // the settings page with the 登入 section open (see the settings spec).
  { segments: ["account"], route: "settings" },
];

function navItemFor(route: AppRoute): NavItem {
  return navItems.find((item) => item.route === route) ?? navItems[0];
}

function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function localDateTime(): string {
  return `${localDate()}T12:00`;
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}`;
}

function metricDetail(count: number, populated: string, empty: string): string {
  return count > 0 ? populated : empty;
}

function timePrecisionLabel(precision: DraftForm["timePrecision"]): string {
  if (precision === "day") return t("common.day");
  if (precision === "month") return t("common.month");
  return t("common.period");
}

function selectedRefundIdsFor(form: DraftForm): string[] {
  if (form.refundLinkedRecordIds?.length) return form.refundLinkedRecordIds;
  return form.refundLinkedRecordId ? [form.refundLinkedRecordId] : [];
}

function missingExpenseFieldPatch(field: "counterparty" | "itemName", missing: boolean): Partial<DraftForm> {
  if (field === "counterparty") {
    return { counterpartyMissing: missing, counterparty: missing ? missingCounterpartyLabel : "" };
  }
  return { itemNameMissing: missing, itemName: missing ? missingItemNameLabel : "" };
}

function importStatus(kind: "confirmed" | "kept-separate" | "merged", imported: boolean): ImportReviewItem["status"] {
  return imported ? kind : "failed";
}

function exportStageMessage(stage: "preparing" | "building" | "complete"): string {
  if (stage === "complete") return t("export.zipComplete");
  if (stage === "building") return t("export.zipBuilding");
  return t("export.zipPreparing");
}

function duplicateCandidateName(duplicate: ImportDuplicate): string {
  return duplicate.candidateType === "existing-record"
    ? duplicate.candidateId
    : t("draft.duplicateCandidateRow", { row: duplicate.candidateRowNumber ?? 0 });
}

function duplicateCandidateLabel(duplicate: ImportDuplicate): string {
  return `${duplicateCandidateName(duplicate)}: ${duplicate.reason}`;
}

function downloadTextFile(content: string, fileName: string, mimeType: string): void {
  const urlApi = window.URL;
  if (!urlApi.createObjectURL) {
    return;
  }

  const url = urlApi.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  urlApi.revokeObjectURL(url);
}

function downloadBinaryFile(content: Uint8Array, fileName: string, mimeType: string): void {
  const urlApi = window.URL;
  if (!urlApi.createObjectURL) {
    return;
  }

  const bytes = new Uint8Array(content.byteLength);
  bytes.set(content);
  const url = urlApi.createObjectURL(new Blob([bytes.buffer], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  urlApi.revokeObjectURL(url);
}

let draftSequence = 0;

const draftsStorageKey = "mealledger.app-shell.drafts";
const accountsStorageKey = "mealledger.manual-ledger.accounts";
const recordsStorageKey = "mealledger.manual-ledger.records";
const auditEventsStorageKey = "mealledger.manual-ledger.audit-events";
const categoriesStorageKey = "mealledger.manual-ledger.custom-categories";
const sourcesStorageKey = "mealledger.manual-ledger.custom-sources";
const onboardingStorageKey = "mealledger.onboarding.completed";
const tagsStorageKey = "mealledger.taxonomy.tags";
const aliasesStorageKey = "mealledger.taxonomy.aliases";
const mealsStorageKey = "mealledger.capture.meals";
const scansStorageKey = "mealledger.capture.temporary-scans";
const uploadQueueStorageKey = "mealledger.capture.upload-queue";
const cloudSyncQueueStorageKey = "mealledger.cloud-sync.queue";
const localDataOwnerStorageKey = "mealledger.local-data-owner";

function draftId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  draftSequence += 1;
  return `draft-${Date.now()}-${draftSequence}`;
}

function readStoredRecords(): LocalLedgerRecord[] {
  try {
    const stored = window.localStorage.getItem(recordsStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as LocalLedgerRecord[]) : [];
  } catch {
    return [];
  }
}

function readStoredAccounts(): LocalAccount[] {
  try {
    const stored = window.localStorage.getItem(accountsStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as LocalAccount[]) : [];
  } catch {
    return [];
  }
}

function readOnboardingCompleted(): boolean {
  try {
    return window.localStorage.getItem(onboardingStorageKey) === "true";
  } catch {
    return false;
  }
}

function readStoredLabels(key: string): string[] {
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredAliases(): TaxonomyAliasSeed[] {
  try {
    const stored = window.localStorage.getItem(aliasesStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      && parsed.every((item) => item && typeof item === "object" && "alias" in item && "canonical" in item)
      ? parsed as TaxonomyAliasSeed[]
      : [];
  } catch {
    return [];
  }
}

function readStoredMeals(): MealEntry[] {
  try {
    const stored = window.localStorage.getItem(mealsStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed as MealEntry[] : [];
  } catch {
    return [];
  }
}

function readStoredScans(): TemporaryScan[] {
  try {
    const stored = window.localStorage.getItem(scansStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed as TemporaryScan[] : [];
  } catch {
    return [];
  }
}

function readStoredUploadQueue(): UploadQueueItem[] {
  try {
    const stored = window.localStorage.getItem(uploadQueueStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return (parsed as UploadQueueItem[])
      // Legacy smoke runs stored only file metadata. There are no bytes to
      // retry, so discard those orphaned local queue entries on read.
      .filter((item) => item.status === "uploaded" || item.remoteMediaId || item.objectKey || item.bytesStatus === "available")
      .map((item) => ({
      ...item,
      // File bytes cannot survive a localStorage round-trip. Require a new
      // selection instead of presenting an unrecoverable item as uploadable.
      bytesStatus: item.status === "uploaded" ? "available" : "metadata-only",
      }));
  } catch {
    return [];
  }
}

function readStoredCloudSyncQueue(): CloudSyncQueueItem[] {
  try {
    const stored = window.localStorage.getItem(cloudSyncQueueStorageKey);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed as CloudSyncQueueItem[] : [];
  } catch {
    return [];
  }
}

function readLocalDataOwner(): string {
  try {
    return window.localStorage.getItem(localDataOwnerStorageKey) ?? "";
  } catch {
    return "";
  }
}

function readStoredCategories(): string[] {
  try {
    const stored = window.localStorage.getItem(categoriesStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed as string[] : [];
  } catch {
    return [];
  }
}

function readStoredSources(): string[] {
  try {
    const stored = window.localStorage.getItem(sourcesStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed as string[] : [];
  } catch {
    return [];
  }
}

function readStoredAuditEvents(): LocalAuditEvent[] {
  try {
    const stored = window.localStorage.getItem(auditEventsStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as LocalAuditEvent[]) : [];
  } catch {
    return [];
  }
}

const expenseCategories = [
  "日用",
  "電子",
  "清潔",
  "交通",
  "早餐",
  "午餐",
  "晚餐",
  "服飾",
  "學習",
  "醫藥",
  "文具",
  "娛樂",
  "登山",
  "禮物",
  "AI",
  "手續費",
];

const incomeCategories = ["零用錢", "薪資", "利息", "禮物", "報銷", "獎勵", "其他收入"];

function createEmptyDraftForm(): DraftForm {
  return {
    date: localDate(), account: "", kind: "expense", category: "", counterparty: "", counterpartyMissing: false,
    itemName: "", itemNameMissing: false, transferAccount: "", transferMode: "same-currency", amount: "", currency: "TWD",
    destinationAmount: "", destinationCurrency: "JPY", feeEnabled: false, feeAccount: "", feeAmount: "", feeCurrency: "TWD",
    feeCategory: "", refundReason: "", refundSubtype: "refund", refundLinkedRecordId: "", refundLinkedRecordIds: [], refundExcessHandling: "unclassified",
    recurrenceChoice: "current-cycle-only", recurrenceAmountMode: "fixed", reason: "", timePrecision: "day", periodStart: "",
    periodEnd: "", note: "",
  };
}

function draftDisplayName(draft: TransactionDraft): string {
  return draft.kind === "transfer" ? t("app.transferTo", { account: draft.account, target: draft.transferAccount }) : draft.counterparty;
}

function recordDisplayName(record: LocalLedgerRecord): string {
  return record.kind === "transfer" ? t("app.recordTransfer", { account: record.accountName, target: record.transferAccountName || t("common.destination") }) : record.counterparty || record.reason || record.kind;
}

function recordDetailLine(record: LocalLedgerRecord): string {
  if (record.kind === "transfer") {
    return t("app.detailTransfer", { date: record.localDate, account: record.accountName, target: record.transferAccountName || t("common.destination") });
  }

  if (record.kind === "fund-addition") {
    return t("app.detailFundAddition", { date: record.localDate, account: record.accountName, reason: record.reason || t("common.initialFunding") });
  }

  return t("app.detailDefault", { date: record.localDate, account: record.accountName, category: record.category || record.reason || t("common.needCategory") });
}

function syncTargetLabel(target: CloudSyncQueueItem["target"]): string {
  switch (target) {
    case "record":
      return t("status.syncTargetRecord");
    case "draft":
      return t("status.syncTargetDraft");
    case "meal":
      return t("status.syncTargetMeal");
    case "media":
      return t("status.syncTargetMedia");
    default:
      return t("status.syncTargetScan");
  }
}

function formatAmountStep(step: number): string {
  if (step === 1000) {
    return t("status.amountStepK");
  }
  if (step === -1000) {
    return t("status.amountStepMinusK");
  }
  return step > 0 ? t("status.amountStepPlus", { step }) : t("status.amountStepMinus", { step: Math.abs(step) });
}

function draftCountLabel(draftCount: number): string {
  if (draftCount === 0) {
    return t("draft.noPending");
  }

  return t("draft.pendingCount", { count: draftCount });
}

function draftReviewCopy(draftCount: number): string {
  if (draftCount === 0) {
    return t("draft.reviewEmptyDetail");
  }

  return t("draft.reviewDetail", { count: draftCount });
}

function formatAliasReviewMessage(items: Array<{ rowNumber: number; summary: string }>): string {
  if (items.length === 0) return "";
  const details = items.map((item) => `${t("draft.rowNumber", { row: item.rowNumber })}:${item.summary}`).join(" ");
  return ` ${t("draft.aliasReview", { details })}`;
}

function formatDuplicateReviewMessage(rowNumbers: number[]): string {
  if (rowNumbers.length === 0) return "";
  const details = rowNumbers.map((rowNumber) => t("draft.rowNumber", { row: rowNumber })).join("、");
  return ` ${t("draft.duplicateReview", { details })}`;
}

function counterpartyLabelForKind(kind: DraftForm["kind"]): string {
  switch (kind) {
    case "income":
    case "fund-addition":
      return t("field.source");
    case "adjustment":
      return t("field.reason");
    case "expense":
      return t("field.merchant");
    case "refund":
      return t("field.merchantOrSource");
    default:
      return t("field.merchantOrSource");
  }
}

function readStoredDrafts(): TransactionDraft[] {
  try {
    const stored = window.localStorage.getItem(draftsStorageKey);
    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as TransactionDraft[]) : [];
  } catch {
    return [];
  }
}


type StatusItem = { label: string; detail: string; tone: string; icon: LucideIcon; hideInShell?: boolean };
type HandoffCounts = { accounts: number; records: number; drafts: number; meals: number; media: number };
type AccountPageProps = Readonly<{
  authState: AuthState;
  authMessage: string;
  cloudDataOwnerMatches: boolean;
  handoffCounts: HandoffCounts;
  storageStatus: Pick<StatusItem, "label" | "detail" | "tone">;
  identities: LinkedIdentity[];
  onSignIn: (email?: string, password?: string) => Promise<void>;
  onSignUp: (email?: string, password?: string) => Promise<void>;
  onRequestPasswordReset: (email?: string) => Promise<void>;
  onRecoverPasswordFromLink: (link?: string) => Promise<void>;
  onUpdatePassword: (password?: string) => Promise<void>;
  onSignInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  onLinkIdentity: (provider: OAuthProvider) => Promise<void>;
  onUnlinkIdentity: (identity: LinkedIdentity) => Promise<void>;
  onClaimLocalWorkspace: () => void;
  onSignOut: () => Promise<void>;
}>;

function disabledSyncStatus(online: boolean, authState: AuthState, localWorkspace: boolean): StatusItem {
  if (!online) {
    return { label: t("status.offline"), detail: t("status.offlineDetail"), icon: WifiOff, tone: "neutral" };
  }

  if (localWorkspace || authState === "signed-out") {
    return { label: t("status.localOnly"), detail: t("status.localOnlyDetail"), icon: CloudOff, tone: "neutral", hideInShell: true };
  }

  if (authState === "auth-error") {
    return { label: t("status.localOnly"), detail: t("status.localOnlyAuthErrorDetail"), icon: CloudOff, tone: "warn", hideInShell: true };
  }

  return { label: t("status.checkingCloud"), detail: t("status.checkingCloudDetail"), icon: Wifi, tone: "neutral" };
}

type EnabledSyncStatusInput = {
  pendingCount: number;
  conflictCount: number;
  errorCount: number;
  uploadCount: number;
  unavailableUploadCount: number;
  uploadErrorCount: number;
  firstError?: string;
  firstUploadError?: string;
};

function enabledSyncStatus({
  pendingCount,
  conflictCount,
  errorCount,
  uploadCount,
  unavailableUploadCount,
  uploadErrorCount,
  firstError,
  firstUploadError,
}: Readonly<EnabledSyncStatusInput>): StatusItem {
  if (conflictCount > 0) return { label: t("status.syncConflictsPending", { count: conflictCount }), detail: t("status.syncConflictsPendingDetail"), icon: CloudOff, tone: "danger" };
  if (errorCount > 0) return { label: t("status.syncErrors", { count: errorCount }), detail: firstError ? t("status.syncErrorsDetail", { error: firstError }) : t("status.syncErrorsDetailFallback"), icon: CloudOff, tone: "danger" };
  if (uploadErrorCount > 0) return { label: t("status.uploadErrors", { count: uploadErrorCount }), detail: firstUploadError ? t("status.uploadErrorsDetail", { error: firstUploadError }) : t("status.uploadErrorsDetailFallback"), icon: CloudOff, tone: "danger" };
  if (pendingCount > 0) return { label: t("status.syncPending", { count: pendingCount }), detail: t("status.syncPendingDetail"), icon: CloudOff, tone: "warn" };
  if (uploadCount > 0) {
    return { label: t("status.syncIncomplete"), detail: t("status.syncIncompleteDetail", { count: t("status.imagesCount", { count: uploadCount }) }), icon: CloudOff, tone: "warn" };
  }
  if (unavailableUploadCount > 0) {
    return { label: t("status.mediaReselect"), detail: t("status.mediaReselectDetail", { count: t("status.imagesCount", { count: unavailableUploadCount }) }), icon: CloudOff, tone: "warn" };
  }
  return { label: t("status.syncReady"), detail: t("status.syncReadyDetail"), icon: Wifi, tone: "neutral", hideInShell: true };
}

function syncStatusItem({
  authState,
  userId,
  enabled,
  blocked,
  online,
  pendingCount,
  conflictCount,
  errorCount,
  uploadCount,
  unavailableUploadCount,
  uploadErrorCount,
  firstUploadError,
  firstError,
}: Readonly<{
  authState: AuthState;
  userId: string;
  enabled: boolean;
  blocked: boolean;
  online: boolean;
  pendingCount: number;
  conflictCount: number;
  errorCount: number;
  uploadCount: number;
  unavailableUploadCount: number;
  uploadErrorCount: number;
  firstUploadError?: string;
  firstError?: string;
}>): StatusItem {
  if (blocked) {
    return { label: t("status.needsReview"), detail: t("status.needsReviewDetail"), icon: CloudOff, tone: "danger" };
  }
  return enabled ? enabledSyncStatus({
    pendingCount,
    conflictCount,
    errorCount,
    uploadCount,
    unavailableUploadCount,
    uploadErrorCount,
    firstError,
    firstUploadError,
  }) : disabledSyncStatus(online, authState, userId === "local-user");
}

function markCloudSyncRetryable(items: CloudSyncQueueItem[], message: string): CloudSyncQueueItem[] {
  return items.map((item) => {
    if (item.state !== "pending" && item.state !== "retryable-error") return item;
    return { ...item, state: "retryable-error", lastError: message, nextAttemptAt: new Date(Date.now() + 1_000).toISOString(), updatedAt: new Date().toISOString() };
  });
}

function mergeUploadedQueueItems(current: UploadQueueItem[], uploadedItems: UploadQueueItem[]): UploadQueueItem[] {
  const uploadedById = new Map(uploadedItems.map((item) => [item.id, item]));
  return current.map((item) => uploadedById.get(item.id) ?? item);
}

function removeUploadedFileReferences(files: Map<string, File>, uploadedItems: UploadQueueItem[]) {
  for (const item of uploadedItems) {
    if (item.status === "uploaded") files.delete(item.id);
  }
}

function releaseUploadCandidates(inFlight: Set<string>, candidates: Array<{ item: UploadQueueItem; file: File }>) {
  for (const { item } of candidates) inFlight.delete(item.id);
}

function draftReviewStatus(draftCount: number): StatusItem {
  return {
    label: draftCountLabel(draftCount),
    detail: draftCount > 0 ? t("draft.reviewDetailShort") : t("draft.reviewNoneDetail"),
    icon: draftCount > 0 ? AlertCircle : CheckCircle2,
    tone: draftCount > 0 ? "warn" : "good",
    hideInShell: true,
  };
}

function statusWhen(condition: boolean, item: StatusItem): StatusItem[] {
  return condition ? [item] : [];
}

function recordStorageStatus(recordCount: number, cloudSyncEnabled: boolean): StatusItem {
  if (cloudSyncEnabled) {
    return { label: t("status.recordsSynced", { count: recordCount }), detail: t("status.recordsSyncedDetail"), icon: Cloud, tone: "good", hideInShell: true };
  }
  return { label: t("status.recordsLocal", { count: recordCount }), detail: t("status.recordsLocalDetail"), icon: CloudOff, tone: "warn", hideInShell: true };
}

function buildStatusItems({
  authState,
  userId,
  cloudDataOwnerMatches,
  cloudSyncQueue,
  isOnline,
  draftCount,
  persistenceWarning,
  uploadCount,
  unavailableUploadCount,
  uploadErrorCount,
  firstUploadError,
  recordCount,
}: Readonly<{
  authState: AuthState;
  userId: string;
  cloudDataOwnerMatches: boolean;
  cloudSyncQueue: CloudSyncQueueItem[];
  isOnline: boolean;
  draftCount: number;
  persistenceWarning: boolean;
  uploadCount: number;
  unavailableUploadCount: number;
  uploadErrorCount: number;
  firstUploadError?: string;
  recordCount: number;
}>): StatusItem[] {
  const signedInCloudAccount = isSupabaseConfigured && authState === "signed-in" && userId !== "local-user";
  const cloudSyncEnabled = signedInCloudAccount && cloudDataOwnerMatches;
  const errorItems = cloudSyncQueue.filter((item) => item.state === "retryable-error" || item.state === "failed");
  const syncItem = syncStatusItem({
      authState,
      userId,
      enabled: cloudSyncEnabled,
      blocked: signedInCloudAccount && !cloudDataOwnerMatches,
      online: isOnline,
      pendingCount: cloudSyncQueue.filter((item) => item.state !== "synced").length,
      conflictCount: cloudSyncQueue.filter((item) => item.state === "conflict").length,
      errorCount: errorItems.length,
      uploadCount,
      unavailableUploadCount,
      uploadErrorCount,
      firstUploadError,
      firstError: errorItems.find((item) => item.lastError)?.lastError,
    });

  return [
    syncItem,
    draftReviewStatus(draftCount),
    ...statusWhen(persistenceWarning, { label: t("status.storageUnavailable"), detail: t("status.storageUnavailableDetail"), icon: AlertCircle, tone: "warn" }),
    ...statusWhen(draftCount > 0, { label: t("status.localDraftData"), detail: cloudSyncEnabled ? t("status.localDraftDataSyncedDetail") : t("status.localDraftDataLocalDetail"), icon: CloudOff, tone: "warn", hideInShell: true }),
    ...statusWhen(uploadCount > 0, { label: t("status.localImages", { count: uploadCount }), detail: t("status.localImagesDetail"), icon: CloudOff, tone: "warn" }),
    ...statusWhen(uploadErrorCount > 0, { label: t("status.imageUploadFailed", { count: uploadErrorCount }), detail: firstUploadError ? t("status.imageUploadFailedDetail", { error: firstUploadError }) : t("status.imageUploadFailedDetailFallback"), icon: CloudOff, tone: "danger" }),
    ...statusWhen(unavailableUploadCount > 0, { label: t("status.imageReselect", { count: unavailableUploadCount }), detail: t("status.imageReselectDetail"), icon: CloudOff, tone: "warn" }),
    ...statusWhen(recordCount > 0, recordStorageStatus(recordCount, cloudSyncEnabled)),
  ];
}

function shellStatusItems(items: StatusItem[]): StatusItem[] {
  return items.filter((item) => !item.hideInShell);
}

function StatusStrip({ items, compact = false }: Readonly<{ items: StatusItem[]; compact?: boolean }>) {
  const { t } = useI18n();
  if (items.length === 0) return null;

  return (
    <section className={`status-strip ${compact ? "status-strip-compact" : ""}`} aria-label={t("nav.appStatus")}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className={`status-item ${item.tone}`} key={item.label} title={item.detail} aria-label={`${item.label}. ${item.detail}`}>
            <Icon size={16} aria-hidden="true" />
            <strong>{item.label}</strong>
          </div>
        );
      })}
    </section>
  );
}

function Brand({ caption, large = false }: Readonly<{ caption: string; large?: boolean }>) {
  const { t } = useI18n();
  return (
    <div className={`brand ${large ? "large" : ""}`}>
      <div className="brand-mark">
        <ReceiptText size={large ? 22 : 20} aria-hidden="true" />
      </div>
      <div>
        <p className="brand-name">{t("nav.brand")}</p>
        <p className="brand-caption">{caption}</p>
      </div>
    </div>
  );
}

function BottomNav({ route, reviewCount, navigate }: Readonly<{
  route: AppRoute;
  reviewCount: number;
  navigate: (item: NavItem) => void;
}>) {
  const { t: translate } = useI18n();
  return (
    <nav className="bottom-nav" aria-label={translate("nav.navAria")}>
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={`nav-item ${route === item.route ? "active" : ""} ${item.route === "capture" ? "nav-create" : ""}`}
            key={item.route}
            type="button"
            aria-current={route === item.route ? "page" : undefined}
            onClick={() => navigate(item)}
          >
            <span className="nav-icon" aria-hidden="true"><Icon size={20} /></span>
            <span>{translate(item.labelKey)}</span>
            {item.route === "ledger" && reviewCount > 0 ? (
              <>
                <span className="nav-badge" aria-hidden="true">{reviewCount}</span>
                <span className="visually-hidden">, {translate("nav.reviewCount", { count: reviewCount })}</span>
              </>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function WorkspaceHeader({ route, statusItems, headerAction }: Readonly<{
  route: AppRoute;
  statusItems: StatusItem[];
  // Replaces the status strip on routes that host their own header control
  // (e.g. the 整段口說/逐欄口說 switch on the voice capture page).
  headerAction?: ReactNode;
}>) {
  const { t } = useI18n();
  return (
    <section className="page-header" aria-labelledby="page-title">
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">{t("nav.brandCaption")}</p>
          <h1 id="page-title">{routeTitle(route)}</h1>
        </div>
        {headerAction ?? <StatusStrip items={statusItems} compact />}
      </header>
    </section>
  );
}

function routeFromLocation(): AppLocation {
  if (window.location.pathname === "/overview") {
    window.history.replaceState(null, "", "/");
  }

  const segments = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  for (const definition of routeDefinitions) {
    if (definition.segments.length !== segments.length) {
      continue;
    }

    const params: Record<string, string> = {};
    const matches = definition.segments.every((segment, index) => {
      const value = segments[index];
      if (segment.startsWith(":")) {
        params[segment.slice(1)] = value;
        return true;
      }
      return segment === value;
    });

    if (matches) {
      return { route: definition.route, params };
    }
  }

  return { route: "not-found", params: {} };
}

export function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

// 深色 default, with 淺色 / 跟隨系統 options. Applies the resolved theme to
// <html data-theme> (styles.css variables), persists the choice, and follows
// the OS preference while the mode is 跟隨系統. See src/appShell/theme.ts.
function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(readStoredTheme);

  useEffect(() => {
    const apply = () => applyResolvedTheme(resolveTheme(mode));
    apply();
    writeStoredTheme(mode);
    if (mode === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
    return undefined;
  }, [mode]);

  return [mode, setMode] as const;
}

function AuthenticatedApp() {
  const [location, setLocation] = useState<AppLocation>(routeFromLocation);
  const [themeMode, setThemeMode] = useThemeMode();
  const { state: authState, userId, message: authMessage, signIn, signUp, requestPasswordReset, recoverPasswordFromLink, updatePassword, signInWithOAuth, identities, linkIdentity, unlinkIdentity, signOut } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [accounts, setAccounts] = useState<LocalAccount[]>(readStoredAccounts);
  const [onboardingCompleted, setOnboardingCompleted] = useState(readOnboardingCompleted);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [meals, setMeals] = useState<MealEntry[]>(readStoredMeals);
  const [scans, setScans] = useState<TemporaryScan[]>(() => expireTemporaryScans(readStoredScans()));
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>(readStoredUploadQueue);
  const [mediaPreviewUrls, setMediaPreviewUrls] = useState<Record<string, string>>({});
  const mediaPreviewUrlsRef = useRef(new Map<string, string>());
  const pendingMediaFilesRef = useRef(new Map<string, File>());
  const mediaUploadsInFlightRef = useRef(new Set<string>());
  const uploadQueueRef = useRef(uploadQueue);
  uploadQueueRef.current = uploadQueue;
  const [persistenceWarning, setPersistenceWarning] = useState(false);
  const [aiEntityPolicy, setAiEntityPolicy] = useState<AiEntityPolicy>(readAiEntityPolicy);
  const [deleteAction, setDeleteAction] = useState<DeleteAction>(readDeleteAction);
  const [negativeBalancePolicy, setNegativeBalancePolicy] = useState<NegativeBalancePolicy>(readNegativeBalancePolicy);
  const [customCategories, setCustomCategories] = useState<string[]>(readStoredCategories);
  const [drafts, setDrafts] = useState<TransactionDraft[]>(readStoredDrafts);
  const [draftToEdit, setDraftToEdit] = useState<TransactionDraft | null>(null);
  // Which capture mode the 新增 header switch shows; shared with the panel.
  // 新增 defaults to 逐欄口說: the approved wireframe flow fills fields one at
  // a time and degrades to raw input when AI is unreachable, while 整段口說
  // needs the AI proxy for its free-text parse.
  const [voiceCaptureMode, setVoiceCaptureMode] = useState<"a" | "b">("b");
  const [records, setRecords] = useState<LocalLedgerRecord[]>(readStoredRecords);
  const [auditEvents, setAuditEvents] = useState<LocalAuditEvent[]>(readStoredAuditEvents);
  const [cloudSyncQueue, setCloudSyncQueue] = useState<CloudSyncQueueItem[]>(readStoredCloudSyncQueue);
  const [localDataOwner, setLocalDataOwner] = useState(readLocalDataOwner);
  const cloudSyncInFlight = useRef(false);
  const route = location.route;
  const draftCount = drafts.length;
  const reviewCount = draftCount + scans.filter((scan) => scan.state === "temporary" || scan.state === "retained").length;
  const recordCount = records.length;

  useEffect(() => {
    try {
      window.localStorage.setItem(draftsStorageKey, JSON.stringify(drafts));
    } catch {
      setPersistenceWarning(true);
    }
  }, [drafts]);

  useEffect(() => {
    writeAiEntityPolicy(aiEntityPolicy);
  }, [aiEntityPolicy]);

  useEffect(() => {
    writeDeleteAction(deleteAction);
  }, [deleteAction]);

  useEffect(() => {
    writeNegativeBalancePolicy(negativeBalancePolicy);
  }, [negativeBalancePolicy]);

  useEffect(() => {
    try {
      window.localStorage.setItem(categoriesStorageKey, JSON.stringify(customCategories));
    } catch {
      // Category persistence is best effort while the account and record stores remain local-first.
    }
  }, [customCategories]);

  useEffect(() => {
    try {
      window.localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
      window.localStorage.setItem(recordsStorageKey, JSON.stringify(records));
      window.localStorage.setItem(auditEventsStorageKey, JSON.stringify(auditEvents));
      window.localStorage.setItem(onboardingStorageKey, String(onboardingCompleted));
      window.localStorage.setItem(mealsStorageKey, JSON.stringify(meals));
      window.localStorage.setItem(scansStorageKey, JSON.stringify(scans));
      window.localStorage.setItem(uploadQueueStorageKey, JSON.stringify(uploadQueue));
      window.localStorage.setItem(cloudSyncQueueStorageKey, JSON.stringify(cloudSyncQueue));
    } catch {
      setPersistenceWarning(true);
    }
  }, [accounts, auditEvents, cloudSyncQueue, meals, onboardingCompleted, records, scans, uploadQueue]);

  useEffect(() => {
    const hasLocalData = accounts.length > 0 || records.length > 0 || drafts.length > 0 || meals.length > 0 || scans.length > 0 || uploadQueue.length > 0;
    const localWorkspace = authState !== "signed-in";
    const ownerForEmptyWorkspace = localWorkspace ? "local-user" : userId;
    if (!localDataOwner && (hasLocalData ? localWorkspace : Boolean(ownerForEmptyWorkspace))) {
      try {
        window.localStorage.setItem(localDataOwnerStorageKey, ownerForEmptyWorkspace);
      } catch {
        setPersistenceWarning(true);
      }
      setLocalDataOwner(ownerForEmptyWorkspace);
    }
  }, [accounts.length, authState, drafts.length, localDataOwner, meals.length, records.length, scans.length, uploadQueue.length, userId]);

  const cloudDataOwnerMatches = localDataOwner === userId;

  useEffect(() => () => {
    const revokeObjectUrl = window.URL.revokeObjectURL?.bind(window.URL);
    if (revokeObjectUrl) mediaPreviewUrlsRef.current.forEach((url) => revokeObjectUrl(url));
    mediaPreviewUrlsRef.current.clear();
    pendingMediaFilesRef.current.clear();
    mediaUploadsInFlightRef.current.clear();
  }, []);

  const clearMediaPreviews = useCallback((ids: Iterable<string>) => {
    const idsToClear = new Set(ids);
    if (idsToClear.size === 0) return;
    const revokeObjectUrl = window.URL.revokeObjectURL?.bind(window.URL);
    idsToClear.forEach((id) => {
      const url = mediaPreviewUrlsRef.current.get(id);
      if (url && revokeObjectUrl) revokeObjectUrl(url);
      mediaPreviewUrlsRef.current.delete(id);
    });
    setMediaPreviewUrls((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !idsToClear.has(id)),
    ));
  }, []);

  const uploadPendingFiles = useCallback((items: UploadQueueItem[]) => {
    if (!supabase || !isSupabaseConfigured || authState !== "signed-in" || !userId || userId === "local-user" || !cloudDataOwnerMatches || !isOnline) {
      return;
    }

    const candidates = items.flatMap((item) => {
      const file = pendingMediaFilesRef.current.get(item.id);
      if (!file || item.status === "uploaded" || mediaUploadsInFlightRef.current.has(item.id)) return [];
      mediaUploadsInFlightRef.current.add(item.id);
      return [{ item, file }];
    });
    if (candidates.length === 0) return;

    const uploadClient = supabase as unknown as SignedUploadClient;
    const now = new Date().toISOString();
    Promise.all(candidates.map(({ item, file }) => uploadMediaFile(uploadClient, file, item, now)))
      .then((uploadedItems) => {
        removeUploadedFileReferences(pendingMediaFilesRef.current, uploadedItems);
        setUploadQueue((current) => mergeUploadedQueueItems(current, uploadedItems));
      })
      .finally(() => {
        releaseUploadCandidates(mediaUploadsInFlightRef.current, candidates);
      });
  }, [authState, cloudDataOwnerMatches, isOnline, userId]);

  const queueUploads = (items: UploadQueueItem[], files: File[] = []) => {
    const replacementKeys = new Set(items.map((item) => `${item.kind}:${item.name}`));
    const replacementNames = new Set(items.map((item) => item.name));
    const replacedIds = uploadQueue.filter((item) => (
      item.status !== "uploaded"
        && (item.bytesStatus === "metadata-only"
          ? replacementNames.has(item.name)
          : replacementKeys.has(`${item.kind}:${item.name}`))
    )).map((item) => item.id);
    clearMediaPreviews(replacedIds);
    replacedIds.forEach((id) => {
      pendingMediaFilesRef.current.delete(id);
      mediaUploadsInFlightRef.current.delete(id);
    });

    const createObjectUrl = window.URL.createObjectURL?.bind(window.URL);
    items.forEach((item, index) => {
      const file = files[index];
      if (file) pendingMediaFilesRef.current.set(item.id, file);
    });
    if (createObjectUrl) {
      const nextPreviews: Record<string, string> = {};
      items.forEach((item, index) => {
        const file = files[index];
        if (!file) return;
        const url = createObjectUrl(file);
        mediaPreviewUrlsRef.current.set(item.id, url);
        nextPreviews[item.id] = url;
      });
      if (Object.keys(nextPreviews).length > 0) {
        setMediaPreviewUrls((current) => ({ ...current, ...nextPreviews }));
      }
    }

    setUploadQueue((current) => [
      ...current.filter((item) => (
        item.status === "uploaded"
          || (item.bytesStatus === "metadata-only"
            ? !replacementNames.has(item.name)
            : !replacementKeys.has(`${item.kind}:${item.name}`))
      )),
      ...items,
    ]);
    uploadPendingFiles(items);
  };

  useEffect(() => {
    uploadPendingFiles(uploadQueueRef.current);
  }, [uploadPendingFiles]);

  const clearUploads = useCallback((ids: string[]) => {
    const idsToClear = new Set(ids);
    if (idsToClear.size === 0) return;
    clearMediaPreviews(idsToClear);
    idsToClear.forEach((id) => {
      pendingMediaFilesRef.current.delete(id);
      mediaUploadsInFlightRef.current.delete(id);
    });
    setUploadQueue((current) => current.filter((item) => !idsToClear.has(item.id)));
    setCloudSyncQueue((current) => current.filter((item) => item.target !== "media" || !idsToClear.has(item.targetId)));
  }, [clearMediaPreviews]);

  useEffect(() => {
    const activeScanIds = new Set(scans
      .filter((scan) => scan.state === "temporary" || scan.state === "retained")
      .map((scan) => scan.id));
    const orphanedIds = uploadQueue
      .filter((item) => (item.kind === "invoice-scan" || item.kind === "receipt-scan") && !activeScanIds.has(item.id))
      .map((item) => item.id);
    if (orphanedIds.length > 0) clearUploads(orphanedIds);
  }, [clearUploads, scans, uploadQueue]);

  useEffect(() => {
    if (authState !== "signed-in" || !userId || userId === "local-user" || !cloudDataOwnerMatches) return;
    const hasForeignOwnedState = records.some((record) => record.userId !== userId)
      || auditEvents.some((event) => event.userId !== userId);
    if (!hasForeignOwnedState) return;

    const now = new Date().toISOString();
    const rebound = rebindLocalWorkspace(records, auditEvents, userId);
    setRecords(rebound.records);
    setAuditEvents(rebound.auditEvents);
    setCloudSyncQueue((current) => current.map((item) => item.state === "retryable-error" || item.state === "failed"
      ? { ...item, state: "pending", attempts: 0, nextAttemptAt: now, lastError: "", updatedAt: now }
      : item));
  }, [auditEvents, authState, cloudDataOwnerMatches, records, userId]);

  const claimLocalWorkspace = useCallback(() => {
    if (authState !== "signed-in" || !userId || userId === "local-user") return;
    const now = new Date().toISOString();
    const rebound = rebindLocalWorkspace(records, auditEvents, userId);
    try {
      window.localStorage.setItem(localDataOwnerStorageKey, userId);
    } catch {
      setPersistenceWarning(true);
      return;
    }
    setRecords(rebound.records);
    setAuditEvents(rebound.auditEvents);
    setCloudSyncQueue((current) => current.map((item) => item.state === "retryable-error" || item.state === "failed"
      ? { ...item, state: "pending", attempts: 0, nextAttemptAt: now, lastError: "", updatedAt: now }
      : item));
    setLocalDataOwner(userId);
  }, [auditEvents, authState, records, userId]);

  useEffect(() => {
    if (!isSupabaseConfigured || authState !== "signed-in" || !userId || userId === "local-user" || !cloudDataOwnerMatches) return;
    const now = new Date().toISOString();
    setCloudSyncQueue((current) => enqueueLocalChanges({
      queue: current,
      accounts,
      records,
      drafts,
      meals,
      media: uploadQueue,
      scans,
      now,
    }));
  }, [accounts, authState, cloudDataOwnerMatches, drafts, meals, records, scans, uploadQueue, userId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || authState !== "signed-in" || !userId || userId === "local-user" || !cloudDataOwnerMatches || !isOnline || cloudSyncInFlight.current) {
      return;
    }

    if (cloudSyncQueue.every((item) => item.state === "synced")) return;

    cloudSyncInFlight.current = true;
    const rawClient = supabase as unknown as RawSupabaseClient;
    const client = createSupabasePersistenceClient(rawClient);
    const referenceClient = createSupabaseReferenceBootstrapClient(rawClient);
    const now = new Date().toISOString();
    const queueSnapshot = cloudSyncQueue;

    const categories = [...new Set([...readStoredCategories(), ...records.map((record) => record.category)].map((value) => value.trim()).filter(Boolean))];
    const merchantKinds = new Set(["expense", "refund", "unresolved-expense"]);
    const merchants = [...new Set(records.filter((record) => merchantKinds.has(record.kind)).map((record) => record.counterparty.trim()).filter(Boolean))];
    const tags = [...new Set(records.flatMap((record) => record.tags ?? []).map((value) => value.trim()).filter(Boolean))];
    const events = [...new Set(records.map((record) => record.event ?? "").map((value) => value.trim()).filter(Boolean))];
    syncLocalChanges({
      client,
      referenceClient,
      userId,
      accounts,
      categories,
      aliases: readStoredAliases(),
      merchants,
      tags,
      events,
      auditEvents,
      records,
      drafts,
      meals,
      media: uploadQueue,
      scans,
      queue: queueSnapshot,
      now,
    }).then((result) => {
      setRecords(result.records);
      setMeals(result.meals);
      setUploadQueue((current) => mergeSyncedItems(current, result.media));
      setScans((current) => mergeSyncedScans(current, result.scans));
      setCloudSyncQueue((current) => mergeSyncedQueue(current, result.queue, queueSnapshot));
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "雲端同步失敗。";
      setCloudSyncQueue((current) => markCloudSyncRetryable(current, message));
    }).finally(() => {
      cloudSyncInFlight.current = false;
    });
  }, [accounts, authState, cloudDataOwnerMatches, cloudSyncQueue, drafts, isOnline, meals, records, scans, uploadQueue, userId]);

  useEffect(() => {
    const handlePopState = () => setLocation(routeFromLocation());
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 });
  }, [location]);

  const queueRecordBundle = (bundleRecords: LocalLedgerRecord[]) => {
    const now = new Date().toISOString();
    setCloudSyncQueue((current) => bundleRecords.reduce(
      (next, record) => enqueueRecordSync(next, record, now),
      current,
    ));
  };

  const { t } = useI18n();
  const statusItems = useMemo(() => buildStatusItems({
    authState,
    userId,
    cloudDataOwnerMatches,
    cloudSyncQueue,
    isOnline,
    draftCount,
    persistenceWarning,
    uploadCount: uploadQueue.filter((item) => item.status !== "uploaded" && item.status !== "failed" && item.bytesStatus !== "metadata-only").length,
    unavailableUploadCount: uploadQueue.filter((item) => item.status !== "uploaded" && item.bytesStatus === "metadata-only").length,
    uploadErrorCount: uploadQueue.filter((item) => item.status === "failed").length,
    firstUploadError: uploadQueue.find((item) => item.status === "failed" && item.error)?.error,
    recordCount,
  }), [authState, cloudDataOwnerMatches, cloudSyncQueue, draftCount, isOnline, persistenceWarning, recordCount, t, uploadQueue, userId]);

  const navigate = (item: NavItem) => {
    window.history.pushState(null, "", item.path);
    setLocation({ route: item.route, params: {} });
  };

  if (onboardingOpen) {
    return (
      <OnboardingPage
        onComplete={() => { setOnboardingCompleted(true); setOnboardingOpen(false); }}
        onAddAccount={(account) => setAccounts((current) => [...current, account])}
        onApplyDefaultTaxonomy={() => {
          const next = applyDefaultTaxonomy({
            categories: readStoredCategories(),
            tags: readStoredLabels(tagsStorageKey),
            aliases: readStoredAliases(),
          });

          setCustomCategories(next.categories);
          try {
            window.localStorage.setItem(tagsStorageKey, JSON.stringify(next.tags));
            window.localStorage.setItem(aliasesStorageKey, JSON.stringify(next.aliases));
          } catch {
            // Taxonomy seed is best effort in local development.
          }
        }}
          onSaveInitialFunding={(account, draft) => {
            const now = new Date().toISOString();
            const bundle = createOfficialRecordBundle(draft, [account, ...accounts], {
              userId: authState === "signed-in" && cloudDataOwnerMatches && userId !== "local-user" ? userId : "local-user",
            recordId: `record-${draft.id}`,
            idempotencyKey: `onboarding:${draft.id}`,
            createdAt: now,
          });

          if (!bundle) {
            return false;
          }

          setRecords((current) => appendIdempotentRecords(current, bundle));
          setAuditEvents((current) => [...current, ...bundle.auditEvents]);
          queueRecordBundle(bundle.records);
          return true;
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <BottomNav
        route={route}
        reviewCount={reviewCount}
        navigate={navigate}
      />

      <section className={`workspace${route === "capture" ? " workspace-voice" : ""}`}>
        <WorkspaceHeader
          route={route}
          statusItems={route !== "settings" && route !== "capture" ? shellStatusItems(statusItems) : []}
          headerAction={route === "capture" ? <AiModeSwitch mode={voiceCaptureMode} onModeChange={setVoiceCaptureMode} /> : undefined}
        />
        {renderRoute({
          route,
          authState,
          userId,
          authMessage,
          cloudDataOwnerMatches,
          storageStatus: statusItems[0],
          handoffCounts: {
            accounts: accounts.length,
            records: records.length,
            drafts: drafts.length,
            meals: meals.length,
            media: uploadQueue.length,
          },
          drafts,
          setDrafts,
          draftToEdit,
          setDraftToEdit,
          records,
          setRecords,
          setAuditEvents,
          queueRecordBundle,
          cloudSyncIssues: cloudSyncQueue.filter((item) => item.state === "retryable-error" || item.state === "failed" || item.state === "conflict"),
          onRetryCloudSyncItem: (id) => setCloudSyncQueue((current) => retryCloudSyncItem(current, id, new Date().toISOString())),
          accounts,
          setAccounts,
          aiEntityPolicy,
          setAiEntityPolicy,
          deleteAction,
          setDeleteAction,
          negativeBalancePolicy,
          setNegativeBalancePolicy,
          customCategories,
          setCustomCategories,
          themeMode,
          onThemeModeChange: setThemeMode,
          navigate,
          onReopenOnboarding: () => setOnboardingOpen(true),
          onSignIn: signIn,
          onSignUp: signUp,
          onRequestPasswordReset: requestPasswordReset,
          onRecoverPasswordFromLink: recoverPasswordFromLink,
          onUpdatePassword: updatePassword,
          onSignInWithOAuth: signInWithOAuth,
          identities,
          onLinkIdentity: linkIdentity,
          onUnlinkIdentity: unlinkIdentity,
          onClaimLocalWorkspace: claimLocalWorkspace,
          onSignOut: signOut,
          onSaveMeal: (meal) => setMeals((current) => [...current, meal]),
          scans,
          onSaveScans: (nextScans) => setScans((current) => [...current, ...nextScans]),
          onUpdateScan: (scan) => setScans((current) => current.map((item) => item.id === scan.id ? scan : item)),
          uploadQueue,
          mediaPreviewUrls,
          onQueueUploads: queueUploads,
          onClearUploads: clearUploads,
          voiceCaptureMode,
          setVoiceCaptureMode,
        })}
      </section>
    </main>
  );
}

function OnboardingPage({ onComplete, onAddAccount, onApplyDefaultTaxonomy, onSaveInitialFunding }: Readonly<{
  onComplete: () => void;
  onAddAccount: (account: LocalAccount) => void;
  onApplyDefaultTaxonomy: () => void;
  onSaveInitialFunding: (account: LocalAccount, draft: TransactionDraft) => boolean;
}>) {
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("cash");
  const [currency, setCurrency] = useState("TWD");
  const [allowNegativeBalance, setAllowNegativeBalance] = useState(true);
  const [balanceMode, setBalanceMode] = useState<"zero" | "current">("zero");
  const [balance, setBalance] = useState("");
  const [balanceDate, setBalanceDate] = useState(localDate());
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const account = createLocalAccount(accountName, currency, crypto.randomUUID(), accountType, allowNegativeBalance);

    if (!account) {
      setError(t("capture.quickAccountNameCurrencyRequired"));
      return;
    }

    if (balanceMode === "current") {
      const draft = createInitialFundingDraft({ account: account.name, amount: balance, currency: account.currency, date: balanceDate }, `fund-${account.id}`);
      if (!draft || !onSaveInitialFunding(account, draft)) {
        setError(t("settings.currentBalanceInvalid"));
        return;
      }
    }

    onAddAccount(account);
    onApplyDefaultTaxonomy();
    onComplete();
  };

  return (
    <main className="signed-out-shell">
      <section className="signed-out-panel onboarding-panel">
        <Brand caption={t("settings.onboardingCaption")} large />
        <div>
          <p className="eyebrow">{t("settings.onboardingEyebrow")}</p>
          <h1>{t("settings.onboardingTitle")}</h1>
          <p className="lede">{t("settings.onboardingLede")}</p>
        </div>
        <form className="onboarding-form" noValidate onSubmit={submit}>
          <OnboardingFields
            accountName={accountName}
            accountType={accountType}
            currency={currency}
            allowNegativeBalance={allowNegativeBalance}
            balanceMode={balanceMode}
            balance={balance}
            balanceDate={balanceDate}
            onAccountNameChange={setAccountName}
            onAccountTypeChange={setAccountType}
            onCurrencyChange={setCurrency}
            onAllowNegativeBalanceChange={setAllowNegativeBalance}
            onBalanceModeChange={setBalanceMode}
            onBalanceChange={setBalance}
            onBalanceDateChange={setBalanceDate}
          />
          <OnboardingActions onComplete={onComplete} />
          {error ? <p className="quick-account-error" role="alert">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}

function OnboardingFields({
  accountName,
  accountType,
  currency,
  allowNegativeBalance,
  balanceMode,
  balance,
  balanceDate,
  onAccountNameChange,
  onAccountTypeChange,
  onCurrencyChange,
  onAllowNegativeBalanceChange,
  onBalanceModeChange,
  onBalanceChange,
  onBalanceDateChange,
}: Readonly<{
  accountName: string;
  accountType: string;
  currency: string;
  allowNegativeBalance: boolean;
  balanceMode: "zero" | "current";
  balance: string;
  balanceDate: string;
  onAccountNameChange: (value: string) => void;
  onAccountTypeChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onAllowNegativeBalanceChange: (value: boolean) => void;
  onBalanceModeChange: (value: "zero" | "current") => void;
  onBalanceChange: (value: string) => void;
  onBalanceDateChange: (value: string) => void;
}>) {
  const { t } = useI18n();
  return (
    <>
      <label>
        <span>{t("field.accountName")}</span>
        <input required value={accountName} onChange={(event) => onAccountNameChange(event.target.value)} placeholder={t("capture.dailyWalletPlaceholder")} />
      </label>
      <label>
        <span>{t("field.accountType")}</span>
        <select value={accountType} onChange={(event) => onAccountTypeChange(event.target.value)}>
          <option value="cash">{t("field.accountTypeCash")}</option>
          <option value="bank">{t("field.accountTypeBank")}</option>
          <option value="card">{t("field.accountTypeCard")}</option>
          <option value="wallet">{t("field.accountTypeWallet")}</option>
          <option value="other">{t("field.accountTypeOther")}</option>
        </select>
      </label>
      <label>
        <span>{t("field.currency")}</span>
        <select value={currency} onChange={(event) => onCurrencyChange(event.target.value)}>
          <option value="TWD">TWD</option>
          <option value="JPY">JPY</option>
          <option value="USD">USD</option>
        </select>
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={allowNegativeBalance} onChange={(event) => onAllowNegativeBalanceChange(event.target.checked)} />
        <span>{t("capture.allowNegativeBalance")}</span>
      </label>
      <fieldset>
        <legend>{t("field.initialBalance")}</legend>
        <label className="radio-row"><input type="radio" checked={balanceMode === "zero"} onChange={() => onBalanceModeChange("zero")} /> <span>{t("capture.startFromZero")}</span></label>
        <label className="radio-row"><input type="radio" checked={balanceMode === "current"} onChange={() => onBalanceModeChange("current")} /> <span>{t("capture.enterCurrentBalance")}</span></label>
      </fieldset>
      {balanceMode === "current" ? <div className="onboarding-balance-fields">
        <AmountField id="onboarding-current-balance" label={t("field.currentBalance")} required value={balance} onChange={onBalanceChange} placeholder={t("capture.balancePlaceholder")} />
        <label>
          <span>{t("field.asOfDate")}</span>
          <input required type="date" value={balanceDate} onChange={(event) => onBalanceDateChange(event.target.value)} />
        </label>
      </div> : null}
    </>
  );
}

function OnboardingActions({ onComplete }: Readonly<{ onComplete: () => void }>) {
  const { t } = useI18n();
  return (
    <div className="onboarding-actions">
      <button className="primary-action" type="submit">{t("settings.createAccount")}</button>
      <button className="quiet-action" type="button" onClick={onComplete}>{t("settings.browseWorkspace")}</button>
    </div>
  );
}

type RouteRenderContext = {
  route: AppRoute;
  authState: AuthState;
  userId: string;
  authMessage: string;
  cloudDataOwnerMatches: boolean;
  storageStatus: Pick<StatusItem, "label" | "detail" | "tone">;
  handoffCounts: HandoffCounts;
  drafts: TransactionDraft[];
  setDrafts: Dispatch<SetStateAction<TransactionDraft[]>>;
  draftToEdit: TransactionDraft | null;
  setDraftToEdit: Dispatch<SetStateAction<TransactionDraft | null>>;
  records: LocalLedgerRecord[];
  setRecords: Dispatch<SetStateAction<LocalLedgerRecord[]>>;
  setAuditEvents: Dispatch<SetStateAction<LocalAuditEvent[]>>;
  queueRecordBundle: (records: LocalLedgerRecord[]) => void;
  cloudSyncIssues: CloudSyncQueueItem[];
  onRetryCloudSyncItem: (id: string) => void;
  accounts: LocalAccount[];
  setAccounts: Dispatch<SetStateAction<LocalAccount[]>>;
  aiEntityPolicy: AiEntityPolicy;
  setAiEntityPolicy: Dispatch<SetStateAction<AiEntityPolicy>>;
  deleteAction: DeleteAction;
  setDeleteAction: Dispatch<SetStateAction<DeleteAction>>;
  negativeBalancePolicy: NegativeBalancePolicy;
  setNegativeBalancePolicy: Dispatch<SetStateAction<NegativeBalancePolicy>>;
  customCategories: string[];
  setCustomCategories: Dispatch<SetStateAction<string[]>>;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  navigate: (item: NavItem) => void;
  onReopenOnboarding: () => void;
  onSignIn: (email?: string, password?: string) => Promise<void>;
  onSignUp: (email?: string, password?: string) => Promise<void>;
  onRequestPasswordReset: (email?: string) => Promise<void>;
  onRecoverPasswordFromLink: (link?: string) => Promise<void>;
  onUpdatePassword: (password?: string) => Promise<void>;
  onSignInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  identities: LinkedIdentity[];
  onLinkIdentity: (provider: OAuthProvider) => Promise<void>;
  onUnlinkIdentity: (identity: LinkedIdentity) => Promise<void>;
  onClaimLocalWorkspace: () => void;
  onSignOut: () => Promise<void>;
  onSaveMeal: (meal: MealEntry) => void;
  scans: TemporaryScan[];
  onSaveScans: (scans: TemporaryScan[]) => void;
  onUpdateScan: (scan: TemporaryScan) => void;
  uploadQueue: UploadQueueItem[];
  mediaPreviewUrls: Record<string, string>;
  onQueueUploads: (items: UploadQueueItem[], files?: File[]) => void;
  onClearUploads: (ids: string[]) => void;
  voiceCaptureMode: "a" | "b";
  setVoiceCaptureMode: Dispatch<SetStateAction<"a" | "b">>;
};

function renderRoute({
  route,
  authState,
  userId,
  authMessage,
  cloudDataOwnerMatches,
  storageStatus,
  handoffCounts,
  drafts,
  setDrafts,
  draftToEdit,
  setDraftToEdit,
  records,
  setRecords,
  setAuditEvents,
  queueRecordBundle,
  cloudSyncIssues,
  onRetryCloudSyncItem,
  accounts,
  setAccounts,
  aiEntityPolicy,
  setAiEntityPolicy,
  deleteAction,
  setDeleteAction,
  negativeBalancePolicy,
  setNegativeBalancePolicy,
  customCategories,
  setCustomCategories,
  themeMode,
  onThemeModeChange,
  navigate,
  onReopenOnboarding,
  onSignIn,
  onSignUp,
  onRequestPasswordReset,
  onRecoverPasswordFromLink,
  onUpdatePassword,
  onSignInWithOAuth,
  identities,
  onLinkIdentity,
  onUnlinkIdentity,
  onClaimLocalWorkspace,
  onSignOut,
  onSaveMeal,
  scans,
  onSaveScans,
  onUpdateScan,
  uploadQueue,
  mediaPreviewUrls,
  onQueueUploads,
  onClearUploads,
  voiceCaptureMode,
  setVoiceCaptureMode,
}: Readonly<RouteRenderContext>) {
  const draftCount = drafts.length;
  const recordCount = records.length;
  const recordOwner = authState === "signed-in" && cloudDataOwnerMatches && userId !== "local-user" ? userId : "local-user";

  const saveOfficialRecord = (
    draft: TransactionDraft,
    recordAccounts: LocalAccount[],
    idempotencyKey: string,
    recordId = `record-${draft.id}`,
    feeRecordId?: string,
  ): string | null => {
    const bundle = createOfficialRecordBundle(draft, recordAccounts, {
      userId: recordOwner,
      recordId,
      idempotencyKey,
      createdAt: new Date().toISOString(),
      ...(feeRecordId ? { feeRecordId } : {}),
    });

    if (!bundle) {
      return t("ledger.cannotSave");
    }

    if (negativeBalancePolicy === "reject") {
      const reason = negativeBalanceRejectionReason(draft, recordAccounts, records);
      if (reason) {
        return reason;
      }
    }

    setRecords((current) => appendIdempotentRecords(current, bundle));
    setAuditEvents((current) => [...current, ...bundle.auditEvents]);
    queueRecordBundle(bundle.records);
    return null;
  };

  switch (route) {
    case "overview":
      return <OverviewPage draftCount={draftCount} recordCount={recordCount} accountBalances={calculateAccountBalances(accounts, records)} accountReports={calculateAccountReports(accounts, records)} syncIssues={cloudSyncIssues} onRetrySyncItem={onRetryCloudSyncItem} navigate={navigate} />;
    case "ledger":
      return (
        <LedgerPage
          records={records}
          drafts={drafts}
          accounts={accounts}
          navigate={navigate}
          deleteAction={deleteAction}
          onDiscardDraft={(id) => setDrafts((current) => current.filter((draft) => draft.id !== id))}
          onEditDraft={(draft) => {
            // Draft completion needs the manual ledger form, which now lives
            // on the Zone page; 新增 is the voice-capture flow.
            setDraftToEdit(draft);
            navigate(navItemFor("zone"));
          }}
          onConfirmDraft={(draft) => {
            if (saveOfficialRecord(draft, accounts, `draft:${draft.id}`) !== null) {
              return false;
            }

            setDrafts((current) => current.filter((item) => item.id !== draft.id));
            return true;
          }}
          onUpdateRecord={(id, patch) => {
            const record = records.find((item) => item.id === id);
            if (!record || record.recordState === "voided") {
              return;
            }

            const result = updateOfficialRecord(record, patch, new Date().toISOString());
            setRecords((current) => current.map((item) => item.id === id ? result.record : item));
            setAuditEvents((current) => [...current, result.auditEvent]);
          }}
          onConvertUnresolved={(id, fields) => {
            const record = records.find((item) => item.id === id);
            if (!record) {
              return false;
            }

            const result = convertUnresolvedExpense(record, fields, accounts, new Date().toISOString());
            if (!result) {
              return false;
            }

            setRecords((current) => current.map((item) => item.id === id ? result.record : item));
            setAuditEvents((current) => [...current, result.auditEvent]);
            return true;
          }}
          onDeleteRecord={(id) => {
            const record = records.find((item) => item.id === id);
            if (!record || record.recordState === "voided") {
              return;
            }

            if (deleteAction === "hard-delete") {
              // 真正刪除 removes the record and its bundle children (ADR 0007).
              const deletedIds = new Set(records.filter((item) => item.id === id || item.linkedRecordId === id).map((item) => item.id));
              setRecords((current) => current.filter((item) => !deletedIds.has(item.id)));
              setAuditEvents((current) => current.filter((event) => !deletedIds.has(event.targetId)));
              return;
            }

            const result = voidOfficialRecord(record, new Date().toISOString());
            setRecords((current) => current.map((item) => item.id === id ? result.record : item));
            setAuditEvents((current) => [...current, result.auditEvent]);
          }}
          onAddAccount={(account) => setAccounts((current) => [...current, account])}
          onSaveInitialFunding={(account, draft) => saveOfficialRecord(draft, [account, ...accounts], `ledger:${draft.id}`) === null}
          onReopenOnboarding={onReopenOnboarding}
        />
      );
    case "capture":
      // 新增 is the voice-capture flow (mode A / mode B); the manual, scan,
      // meal, and attachment tools live on the Zone page.
      return (
        <VoiceCapturePage
          accounts={accounts}
          entityPolicy={aiEntityPolicy}
          mode={voiceCaptureMode}
          onModeChange={setVoiceCaptureMode}
          customCategories={customCategories}
          setCustomCategories={setCustomCategories}
          onAddAccount={(account) => setAccounts((current) => [...current, account])}
          onSaveRecord={(draft, extraAccounts = []) => saveOfficialRecord(draft, [...accounts, ...extraAccounts], `manual:${draft.id}`)}
          onSaveDraft={(draft) => setDrafts((current) => [...current, draft])}
        />
      );
    case "zone":
      return (
        <CapturePage
          records={records}
          accounts={accounts}
          aiEntityPolicy={aiEntityPolicy}
          navigate={navigate}
          draftToEdit={draftToEdit}
          customCategories={customCategories}
          setCustomCategories={setCustomCategories}
          onDiscardDraft={(id) => setDrafts((current) => current.filter((draft) => draft.id !== id))}
          onFinishDraftEdit={() => setDraftToEdit(null)}
          onAddAccount={(account) => setAccounts((current) => [...current, account])}
          onSaveInitialFunding={(account, draft) => saveOfficialRecord(draft, [account, ...accounts], `capture:${draft.id}`) === null}
          onSaveRecord={(draft, extraAccounts = []) => saveOfficialRecord(draft, [...accounts, ...extraAccounts], `manual:${draft.id}`)}
          onSaveDraft={(draft) => setDrafts((current) => [...current, draft])}
          onSaveMeal={onSaveMeal}
          scans={scans}
          onSaveScans={onSaveScans}
          onUpdateScan={onUpdateScan}
          uploadQueue={uploadQueue}
          mediaPreviewUrls={mediaPreviewUrls}
          onQueueUploads={onQueueUploads}
          onClearUploads={onClearUploads}
        />
      );
    case "settings":
      return (
        <SettingsPage
          accounts={accounts}
          records={records}
          entityPolicy={aiEntityPolicy}
          onEntityPolicyChange={setAiEntityPolicy}
          themeMode={themeMode}
          onThemeModeChange={onThemeModeChange}
          deleteAction={deleteAction}
          onDeleteActionChange={setDeleteAction}
          negativeBalancePolicy={negativeBalancePolicy}
          onNegativeBalancePolicyChange={setNegativeBalancePolicy}
          customCategories={customCategories}
          setCustomCategories={setCustomCategories}
          authState={authState}
          authMessage={authMessage}
          cloudDataOwnerMatches={cloudDataOwnerMatches}
          handoffCounts={handoffCounts}
          storageStatus={storageStatus}
          identities={identities}
          onSignIn={onSignIn}
          onSignUp={onSignUp}
          onRequestPasswordReset={onRequestPasswordReset}
          onRecoverPasswordFromLink={onRecoverPasswordFromLink}
          onUpdatePassword={onUpdatePassword}
          onSignInWithOAuth={onSignInWithOAuth}
          onLinkIdentity={onLinkIdentity}
          onUnlinkIdentity={onUnlinkIdentity}
          onClaimLocalWorkspace={onClaimLocalWorkspace}
          onSignOut={onSignOut}
          onAddAccount={(account) => setAccounts((current) => [...current, account])}
          onSaveInitialFunding={(account, draft) => saveOfficialRecord(draft, [account, ...accounts], `settings:${draft.id}`) === null}
          onReopenOnboarding={onReopenOnboarding}
          onImportRecord={(row, importId) => {
            const draft = toImportedTransactionDraft(row, importId);
            if (!draft) {
              return false;
            }

            return saveOfficialRecord(draft, accounts, `import:${importId}`, `record-${importId}`, `record-${importId}-fee`) === null;
          }}
          onMergeImportDraft={(row, importId) => {
            const draft = toImportedTransactionDraft(row, importId);
            if (!draft) {
              return false;
            }

            setDrafts((current) => current.some((item) => item.id === draft.id) ? current : [...current, draft]);
            return true;
          }}
        />
      );
    default:
      return <NotFoundPage navigate={navigate} />;
  }
}

function OverviewPage({ draftCount, recordCount, accountBalances, accountReports, syncIssues, onRetrySyncItem, navigate }: Readonly<{
  draftCount: number;
  recordCount: number;
  accountBalances: ReturnType<typeof calculateAccountBalances>;
  accountReports: AccountReport[];
  syncIssues: CloudSyncQueueItem[];
  onRetrySyncItem: (id: string) => void;
  navigate: (item: NavItem) => void;
}>) {
  const { t } = useI18n();
  const accountDetail = accountBalances.length === 0
    ? t("overview.createAccountFirst")
    : accountBalances.slice(0, 3).map((account) => `${account.name}: ${formatAccountBalance(account.balance, account.currency)}`).join(" · ");

  return (
    <div className="route-stack">
      <section className="summary-grid">
        <EmptyMetric label={t("overview.accountSummary")} value={accountBalances.length > 0 ? t("overview.accountCount", { count: accountBalances.length }) : t("status.noBalance")} detail={accountDetail} />
        <EmptyMetric label={t("overview.ledgerRecords")} value={recordCount > 0 ? t("status.recordsSyncedSummary", { count: recordCount }) : t("ledger.emptyRecords")} detail={metricDetail(recordCount, t("overview.metricsReady"), t("overview.metricsEmpty"))} />
        <EmptyMetric
          label={t("overview.draftsPending")}
          value={draftCount > 0 ? t("status.recordsPendingSummary", { count: draftCount }) : t("status.noPending")}
          detail={metricDetail(draftCount, t("overview.draftMetricsReady"), t("overview.draftMetricsEmpty"))}
        />
      </section>
      {syncIssues.length > 0 ? (
        <Panel title={t("overview.syncAlerts")} eyebrow={t("overview.needsAction")}>
          <div className="sync-issues" aria-label={t("overview.cloudSyncIssues")}>
            {syncIssues.map((item) => {
              const targetLabel = syncTargetLabel(item.target);

              return (
                <article className="sync-issue" key={item.id}>
                  <div>
                    <strong>{targetLabel}</strong>
                    <span>{item.state === "conflict" ? t("status.conflictReview") : item.lastError || t("status.waitingRetry")}</span>
                  </div>
                  {item.state === "conflict" ? (
                    <span className="record-state-label">{t("status.needsReviewLabel")}</span>
                  ) : (
                    <button className="text-action" type="button" onClick={() => onRetrySyncItem(item.id)}>{t("status.retrySync")}</button>
                  )}
                </article>
              );
            })}
          </div>
        </Panel>
      ) : null}
      <Panel title={t("overview.accountReports")} eyebrow={t("overview.accountingView")}>
        {accountReports.length === 0 ? (
          <p className="panel-copy">{t("overview.accountReportsEmpty")}</p>
        ) : (
          <div className="report-list" aria-label={t("overview.accountReportsAria")}>
            {accountReports.map((report) => (
              <div className="report-row" key={report.id}>
                <div>
                  <strong>{report.name}</strong>
                  <span>{report.currency} · {t("overview.recordCount", { count: report.recordCount })}</span>
                </div>
                <dl>
                  <div><dt>{t("overview.balance")}</dt><dd>{formatAccountBalance(report.closingBalance, report.currency)}</dd></div>
                  <div><dt>{t("overview.netSpending")}</dt><dd>{formatAccountBalance(report.netSpendingTotal, report.currency)}</dd></div>
                  <div><dt>{t("overview.cashFlow")}</dt><dd>{formatAccountBalance(report.cashFlowTotal, report.currency)}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <section className="content-grid">
        <Panel title={t("overview.startNewRecord")} eyebrow={t("overview.firstStep")}>
          <p className="panel-copy">
            {t("overview.startCopy")}
          </p>
          <button className="secondary-action align-start" type="button" onClick={() => navigate(navItemFor("capture"))}>
            {t("overview.startRecord")}
          </button>
        </Panel>
        <Panel title={t("overview.confirmCounts")} eyebrow={t("overview.dataSafety")}>
          <p className="panel-copy">
            {t("overview.confirmCopy")}
          </p>
        </Panel>
      </section>
    </div>
  );
}

function ConfirmActionButton({ label, message, onConfirm }: Readonly<{
  label: string;
  message: string;
  onConfirm: () => void;
}>) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return <button className="text-action danger-action" type="button" onClick={() => setConfirming(true)}>{label}</button>;
  }

  return (
    <div className="confirm-action" aria-label={message}>
      <span>{message}</span>
      <button className="text-action danger-action" type="button" onClick={() => { onConfirm(); setConfirming(false); }}>{t("common.confirm")}</button>
      <button className="text-action" type="button" onClick={() => setConfirming(false)}>{t("common.cancel")}</button>
    </div>
  );
}

type LedgerRecordCardProps = {
  record: LocalLedgerRecord;
  isEditing: boolean;
  isEditingUnresolved: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (patch: Partial<EditableRecordFields>) => void;
  onCompleteDetails: () => void;
  onCancelDetails: () => void;
  onConvertDetails: (fields: UnresolvedExpenseConversion) => boolean;
  onUpdate: (patch: Partial<EditableRecordFields>) => void;
  onDelete: () => void;
  deleteAction: DeleteAction;
};

function LedgerRecordState({ record, isVoided, onCompleteDetails, onEdit, onUpdate, onDelete, deleteAction }: Readonly<Pick<LedgerRecordCardProps, "record" | "onCompleteDetails" | "onEdit" | "onUpdate" | "onDelete" | "deleteAction"> & { isVoided: boolean }>) {
  const { t } = useI18n();
  if (isVoided) return <span className="record-state-label">{t("ledger.voided")}</span>;

  const isRecurring = record.recurrenceStatus === "active" || record.recurrenceStatus === "paused";
  const hardDelete = deleteAction === "hard-delete";
  return (
    <div className="record-actions">
      {record.kind === "unresolved-expense" ? <button className="text-action" type="button" onClick={onCompleteDetails}>{t("ledger.completeDetails")}</button> : null}
      {isRecurring ? <button className="text-action" type="button" onClick={() => onUpdate({ recurrenceStatus: record.recurrenceStatus === "active" ? "paused" : "active" })}>{record.recurrenceStatus === "active" ? t("ledger.pauseCycle") : t("ledger.resumeCycle")}</button> : null}
      {isRecurring ? <ConfirmActionButton label={t("ledger.cancelCycle")} message={t("ledger.cancelCycleConfirm")} onConfirm={() => onUpdate({ recurrenceStatus: "cancelled" })} /> : null}
      <button className="text-action" type="button" onClick={onEdit}>{t("ledger.edit")}</button>
      {hardDelete ? (
        <ConfirmActionButton label={t("ledger.delete")} message={t("ledger.deleteConfirm")} onConfirm={onDelete} />
      ) : (
        <ConfirmActionButton label={t("ledger.void")} message={t("ledger.voidConfirm")} onConfirm={onDelete} />
      )}
    </div>
  );
}

function LedgerRecordCard({
  record,
  isEditing,
  isEditingUnresolved,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onCompleteDetails,
  onCancelDetails,
  onConvertDetails,
  onUpdate,
  onDelete,
  deleteAction,
}: Readonly<LedgerRecordCardProps>) {
  if (isEditingUnresolved && record.recordState !== "voided") {
    return <UnresolvedExpenseEditor record={record} onCancel={onCancelDetails} onConvert={onConvertDetails} />;
  }

  if (isEditing && record.recordState !== "voided") {
    return <RecordEditor record={record} onCancel={onCancelEdit} onSave={onSaveEdit} />;
  }

  const isVoided = record.recordState === "voided";
  const statusLabel = ledgerRecordStatusLabel(record, isVoided);
  return (
    <article className={`draft-card ledger-record-card ${isVoided ? "voided-record" : ""}`}>
      <div className="record-summary">
        <strong>{recordDisplayName(record)}</strong>
        <span className="record-detail">{recordDetailLine(record)}</span>
      </div>
      <div className="draft-amount record-amount">
        <strong>{record.currency} {record.amount}</strong>
        <span>{kindLabel(record.kind)} · {statusLabel}</span>
      </div>
      <LedgerRecordState record={record} isVoided={isVoided} onCompleteDetails={onCompleteDetails} onEdit={onEdit} onUpdate={onUpdate} onDelete={onDelete} deleteAction={deleteAction} />
    </article>
  );
}

function ledgerRecordStatusLabel(record: LocalLedgerRecord, isVoided: boolean): string {
  if (isVoided) return t("ledger.voided");
  return record.status === "synced" ? t("ledger.synced") : t("ledger.localOnly");
}

function LedgerPage({
  records,
  drafts,
  accounts,
  navigate,
  onDiscardDraft,
  onEditDraft,
  onConfirmDraft,
  onUpdateRecord,
  onConvertUnresolved,
  onDeleteRecord,
  deleteAction,
  onAddAccount,
  onSaveInitialFunding,
  onReopenOnboarding,
}: Readonly<{
  records: LocalLedgerRecord[];
  drafts: TransactionDraft[];
  accounts: LocalAccount[];
  navigate: (item: NavItem) => void;
  onDiscardDraft: (id: string) => void;
  onEditDraft: (draft: TransactionDraft) => void;
  onConfirmDraft: (draft: TransactionDraft) => boolean;
  onUpdateRecord: (id: string, patch: Partial<EditableRecordFields>) => void;
  onConvertUnresolved: (id: string, fields: UnresolvedExpenseConversion) => boolean;
  onDeleteRecord: (id: string) => void;
  deleteAction: DeleteAction;
  onAddAccount: (account: LocalAccount) => void;
  onSaveInitialFunding: (account: LocalAccount, draft: TransactionDraft) => boolean;
  onReopenOnboarding: () => void;
}>) {
  const { t } = useI18n();
  const draftCount = drafts.length;
  const [section, setSection] = useState<"records" | "accounts">("records");
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editingUnresolvedId, setEditingUnresolvedId] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  return (
    <div className="route-stack">
      <div className="settings-tabs ledger-tabs" role="tablist" aria-label={t("ledger.sectionsAria")}>
        <button className={`settings-tab ${section === "records" ? "active" : ""}`} type="button" role="tab" aria-selected={section === "records"} onClick={() => setSection("records")}>{t("ledger.recordsTab")}</button>
        <button className={`settings-tab ${section === "accounts" ? "active" : ""}`} type="button" role="tab" aria-selected={section === "accounts"} onClick={() => setSection("accounts")}>{t("ledger.accountsTab")}</button>
      </div>
      {section === "accounts" ? (
        <LedgerAccountsPanel accounts={accounts} onAddAccount={onAddAccount} onSaveInitialFunding={onSaveInitialFunding} onReopenOnboarding={onReopenOnboarding} />
      ) : (
        <LedgerRecordsView
          records={records}
          drafts={drafts}
          draftCount={draftCount}
          draftMessage={draftMessage}
          editingRecordId={editingRecordId}
          editingUnresolvedId={editingUnresolvedId}
          navigate={navigate}
          onEditDraft={onEditDraft}
          onConfirmDraft={onConfirmDraft}
          onDiscardDraft={onDiscardDraft}
          onUpdateRecord={onUpdateRecord}
          onConvertUnresolved={onConvertUnresolved}
          onDeleteRecord={onDeleteRecord}
          deleteAction={deleteAction}
          onBeginEditRecord={setEditingRecordId}
          onEndEditRecord={() => setEditingRecordId(null)}
          onBeginUnresolved={setEditingUnresolvedId}
          onEndUnresolved={() => setEditingUnresolvedId(null)}
          onReportDraftMessage={setDraftMessage}
        />
      )}
    </div>
  );
}

function LedgerRecordsView({
  records,
  drafts,
  draftCount,
  draftMessage,
  editingRecordId,
  editingUnresolvedId,
  navigate,
  onEditDraft,
  onConfirmDraft,
  onDiscardDraft,
  onUpdateRecord,
  onConvertUnresolved,
  onDeleteRecord,
  deleteAction,
  onBeginEditRecord,
  onEndEditRecord,
  onBeginUnresolved,
  onEndUnresolved,
  onReportDraftMessage,
}: Readonly<{
  records: LocalLedgerRecord[];
  drafts: TransactionDraft[];
  draftCount: number;
  draftMessage: string;
  editingRecordId: string | null;
  editingUnresolvedId: string | null;
  navigate: (item: NavItem) => void;
  onEditDraft: (draft: TransactionDraft) => void;
  onConfirmDraft: (draft: TransactionDraft) => boolean;
  onDiscardDraft: (id: string) => void;
  onUpdateRecord: (id: string, patch: Partial<EditableRecordFields>) => void;
  onConvertUnresolved: (id: string, fields: UnresolvedExpenseConversion) => boolean;
  onDeleteRecord: (id: string) => void;
  deleteAction: DeleteAction;
  onBeginEditRecord: (id: string) => void;
  onEndEditRecord: () => void;
  onBeginUnresolved: (id: string) => void;
  onEndUnresolved: () => void;
  onReportDraftMessage: (message: string) => void;
}>) {
  const { t } = useI18n();
  return (
    <>
      <section className="content-grid">
        <Panel title={t("ledger.confirmedPanel")} eyebrow={t("ledger.confirmedEyebrow")}>
          <p className="panel-copy">{t("ledger.confirmedCopy")}</p>
          <button className="secondary-action align-start" type="button" onClick={() => navigate(navItemFor("capture"))}>
            {t("ledger.startRecord")}
          </button>
        </Panel>
        <Panel title={draftCount > 0 ? t("ledger.pendingPanel") : t("ledger.queuePanel")} eyebrow={t("ledger.nextStep")}>
          <p className="panel-copy">
            {draftCount > 0 ? draftReviewCopy(draftCount) : t("draft.noPendingQueue")}
          </p>
        </Panel>
      </section>
      {records.length > 0 ? (
        <section className="draft-list" aria-label={t("draft.confirmedListAria")}>
          <div className="draft-list-heading">
            <div>
              <p className="eyebrow">{t("draft.confirmedEyebrow")}</p>
              <h2>{t("draft.historyTitle")}</h2>
            </div>
            <span>{t("draft.recordCount", { count: records.length })}</span>
          </div>
          {records.map((record) => (
            <LedgerRecordCard
              key={record.id}
              record={record}
              isEditing={editingRecordId === record.id}
              isEditingUnresolved={editingUnresolvedId === record.id}
              onEdit={() => onBeginEditRecord(record.id)}
              onCancelEdit={onEndEditRecord}
              onSaveEdit={(patch) => { onUpdateRecord(record.id, patch); onEndEditRecord(); }}
              onCompleteDetails={() => onBeginUnresolved(record.id)}
              onCancelDetails={onEndUnresolved}
              onConvertDetails={(fields) => {
                const converted = onConvertUnresolved(record.id, fields);
                if (converted) onEndUnresolved();
                return converted;
              }}
              onUpdate={(patch) => onUpdateRecord(record.id, patch)}
              onDelete={() => onDeleteRecord(record.id)}
              deleteAction={deleteAction}
            />
          ))}
        </section>
      ) : null}
      {draftCount > 0 ? (
        <section className="draft-list" aria-label={t("draft.pendingListAria")}>
          <div className="draft-list-heading">
            <div>
              <p className="eyebrow">{t("draft.queueEyebrow")}</p>
              <h2>{t("draft.pendingHeading")}</h2>
            </div>
            <span>{t("draft.localDraftCount", { count: draftCount })}</span>
          </div>
          {drafts.map((draft) => (
            <LedgerDraftCard
              key={draft.id}
              draft={draft}
              onEditDraft={onEditDraft}
              onConfirmDraft={onConfirmDraft}
              onDiscardDraft={onDiscardDraft}
              onReportDraftMessage={onReportDraftMessage}
            />
          ))}
        </section>
      ) : null}
      {draftMessage ? <p className="inline-message" aria-live="polite">{draftMessage}</p> : null}
      {records.length === 0 ? <p className="table-empty">{t("draft.emptyConfirmed")}</p> : null}
    </>
  );
}

function LedgerDraftCard({ draft, onEditDraft, onConfirmDraft, onDiscardDraft, onReportDraftMessage }: Readonly<{
  draft: TransactionDraft;
  onEditDraft: (draft: TransactionDraft) => void;
  onConfirmDraft: (draft: TransactionDraft) => boolean;
  onDiscardDraft: (id: string) => void;
  onReportDraftMessage: (message: string) => void;
}>) {
  const { t } = useI18n();
  return (
    <article className="draft-card">
      <div>
        <strong>{draftDisplayName(draft)}</strong>
        <span>
          {draft.date} · {draft.account}
          {draft.kind === "transfer" ? ` · ${t("draft.transferSuffix", { target: draft.transferAccount })}` : ` · ${draft.category}`}
        </span>
      </div>
      <div className="draft-amount">
        <strong>
          {draft.currency} {draft.amount}
        </strong>
        <span>{kindLabel(draft.kind)}</span>
      </div>
      <div className="record-actions">
        <button className="secondary-action" type="button" onClick={() => onEditDraft(draft)}>
          {t("draft.editOnAddPage")}
        </button>
        <button
          className="primary-action"
          type="button"
          onClick={() => onReportDraftMessage(onConfirmDraft(draft) ? t("draft.confirmedMessage") : t("draft.incompleteMessage"))}
        >
          {t("draft.confirmWrite")}
        </button>
        <button className="text-action danger-action" type="button" onClick={() => onDiscardDraft(draft.id)}>
          {t("draft.discard")}
        </button>
      </div>
    </article>
  );
}

function UnresolvedExpenseEditor({
  record,
  onCancel,
  onConvert,
}: Readonly<{
  record: LocalLedgerRecord;
  onCancel: () => void;
  onConvert: (fields: UnresolvedExpenseConversion) => boolean;
}>) {
  const [localDate, setLocalDate] = useState(record.localDate || record.periodStart);
  const [category, setCategory] = useState(record.category);
  const [counterparty, setCounterparty] = useState(record.counterparty);
  const [counterpartyMissing, setCounterpartyMissing] = useState(record.counterpartyMissing);
  const [itemName, setItemName] = useState(record.itemName);
  const [itemNameMissing, setItemNameMissing] = useState(record.itemNameMissing);
  const [error, setError] = useState("");
  const { t } = useI18n();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const converted = onConvert({
      localDate,
      category,
      counterparty,
      counterpartyMissing,
      itemName,
      itemNameMissing,
    });

    if (!converted) {
      setError(t("ledger.convertError"));
    }
  };

  return (
    <form className="record-editor" aria-label={t("ledger.completeEditorTitle", { name: recordDisplayName(record) })} onSubmit={handleSubmit}>
      <label>
        <span>{t("field.date")}</span>
        <input required type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} />
      </label>
      <label>
        <span>{t("field.category")}</span>
        <input required value={category} onChange={(event) => setCategory(event.target.value)} />
      </label>
      <div className="form-field">
        <label htmlFor={`unresolved-merchant-${record.id}`}>{t("field.merchant")}</label>
        <input id={`unresolved-merchant-${record.id}`} required pattern=".*\S.*" disabled={counterpartyMissing} value={counterparty} onChange={(event) => setCounterparty(event.target.value)} />
        <label className="checkbox-field inline-checkbox">
          <input type="checkbox" checked={counterpartyMissing} onChange={(event) => {
            const missing = event.target.checked;
            setCounterpartyMissing(missing);
            setCounterparty(missing ? missingCounterpartyLabel : "");
          }} />
          <span>{t("field.merchantMissing")}</span>
        </label>
      </div>
      <div className="form-field">
        <label htmlFor={`unresolved-item-${record.id}`}>{t("field.itemName")}</label>
        <input id={`unresolved-item-${record.id}`} required pattern=".*\S.*" disabled={itemNameMissing} value={itemName} onChange={(event) => setItemName(event.target.value)} />
        <label className="checkbox-field inline-checkbox">
          <input type="checkbox" checked={itemNameMissing} onChange={(event) => {
            const missing = event.target.checked;
            setItemNameMissing(missing);
            setItemName(missing ? missingItemNameLabel : "");
          }} />
          <span>{t("field.itemNameMissing")}</span>
        </label>
      </div>
      {error ? <p className="form-error full-span" role="alert">{error}</p> : null}
      <div className="record-editor-actions full-span">
        <button className="primary-action" type="submit">{t("ledger.convertToExpense")}</button>
        <button className="quiet-action" type="button" onClick={onCancel}>{t("ledger.cancel")}</button>
      </div>
    </form>
  );
}

function RecordEditor({
  record,
  onSave,
  onCancel,
}: Readonly<{
  record: LocalLedgerRecord;
  onSave: (patch: Partial<EditableRecordFields>) => void;
  onCancel: () => void;
}>) {
  const [amount, setAmount] = useState(record.amount);
  const [category, setCategory] = useState(record.category);
  const [counterparty, setCounterparty] = useState(record.counterparty);
  const [itemName, setItemName] = useState(record.itemName);
  const [reason, setReason] = useState(record.reason);
  const [note, setNote] = useState(record.note);
  const { t } = useI18n();

  return (
    <form className="record-editor" aria-label={t("ledger.editRecordTitle", { name: recordDisplayName(record) })} onSubmit={(event) => {
      event.preventDefault();
      onSave({ amount, category, counterparty, itemName, reason, note });
    }}>
      <AmountField id="record-editor-amount" label={t("field.amount")} required value={amount} allowNegative={record.kind === "adjustment"} onChange={setAmount} />
      <label>
        <span>{t("field.category")}</span>
        <input value={category} onChange={(event) => setCategory(event.target.value)} />
      </label>
      <label>
        <span>{t("ledger.merchantOrSource")}</span>
        <input value={counterparty} onChange={(event) => setCounterparty(event.target.value)} />
      </label>
      <label>
        <span>{t("field.itemName")}</span>
        <input value={itemName} onChange={(event) => setItemName(event.target.value)} />
      </label>
      <label>
        <span>{t("field.reason")}</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <label className="full-span">
        <span>{t("field.note")}</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="record-editor-actions full-span">
        <button className="primary-action" type="submit">{t("ledger.saveChanges")}</button>
        <button className="quiet-action" type="button" onClick={onCancel}>{t("ledger.cancel")}</button>
      </div>
    </form>
  );
}

function HistorySuggestions({
  records,
  source,
  onApply,
}: Readonly<{
  records: LocalLedgerRecord[];
  source: "merchant" | "item";
  onApply: (field: "counterparty" | "itemName" | "amount" | "account" | "category" | "currency", value: string) => void;
}>) {
  const { t } = useI18n();
  return (
    <section className="history-suggestions" aria-label={source === "merchant" ? t("ledger.merchantSuggestionsAria") : t("ledger.itemSuggestionsAria")}>
      <span className="suggestion-label">{t("ledger.historyLabel")}</span>
      {records.map((record) => (
        <div className="suggestion-row" key={record.id}>
          <strong>{source === "merchant" ? record.counterparty : record.itemName}</strong>
          <div className="suggestion-actions">
            {source === "item" ? (
              <SuggestionButton label={t("ledger.useMerchant", { value: record.counterparty })} onClick={() => onApply("counterparty", record.counterparty)} />
            ) : null}
            {source === "merchant" ? (
              <SuggestionButton label={t("ledger.useItem", { value: record.itemName })} onClick={() => onApply("itemName", record.itemName)} />
            ) : null}
            <SuggestionButton label={t("ledger.useAmount", { value: `${record.currency} ${record.amount}` })} onClick={() => onApply("amount", record.amount)} />
            <SuggestionButton label={t("ledger.useAccount", { value: record.accountName })} onClick={() => onApply("account", record.accountName)} />
            <SuggestionButton label={t("ledger.useCategory", { value: record.category })} onClick={() => onApply("category", record.category)} />
            <button className="suggestion-clear" type="button" onClick={() => onApply(source === "merchant" ? "counterparty" : "itemName", "")}>
              {source === "merchant" ? t("ledger.clearMerchant") : t("ledger.clearItem")}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function SuggestionButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return <button className="suggestion-button" type="button" onClick={onClick}>{label}</button>;
}

function adjustAmount(value: string, delta: number, allowNegative: boolean): string {
  const current = Number(value);

  if (!Number.isFinite(current)) {
    return delta > 0 || allowNegative ? String(delta) : "";
  }

  return String(allowNegative ? current + delta : Math.max(0, current + delta));
}

function AmountField({
  id,
  label,
  value,
  required = false,
  allowNegative = false,
  placeholder = "100",
  onChange,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  required?: boolean;
  allowNegative?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}>) {
  const { t } = useI18n();
  const steps = [-1000, -100, -10, 10, 100, 1000];
  const visibleSteps = allowNegative || value.trim() ? steps : steps.filter((step) => step > 0);
  const currentAmount = Number(value);

  return (
    <div className="form-field amount-field">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="amount-control">
        <input
          id={id}
          required={required}
          inputMode="decimal"
          min={allowNegative ? undefined : "0"}
          step="1"
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        <div className={`amount-steps ${visibleSteps.length === 3 ? "positive-only" : ""}`} aria-label={t("ledger.quickAdjustAria", { label })}>
          {visibleSteps.map((step) => (
            <button
              key={step}
              className="amount-step"
              type="button"
              aria-label={`${step > 0 ? t("ledger.increase") : t("ledger.decrease")}${label} ${Math.abs(step)}`}
              disabled={!allowNegative && step < 0 && (!Number.isFinite(currentAmount) || currentAmount <= 0)}
              onClick={() => onChange(adjustAmount(value, step, allowNegative))}
            >
              {formatAmountStep(step)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuickAccountSetup({
  accountName,
  currency,
  accountType = "cash",
  allowNegativeBalance = true,
  initialBalance,
  initialBalanceDate,
  error,
  onAccountNameChange,
  onCurrencyChange,
  onAccountTypeChange,
  onAllowNegativeBalanceChange,
  onInitialBalanceChange,
  onInitialBalanceDateChange,
  onConfirm,
  onCancel,
}: Readonly<{
  accountName: string;
  currency: string;
  accountType?: string;
  allowNegativeBalance?: boolean;
  initialBalance: string;
  initialBalanceDate: string;
  error: string;
  onAccountNameChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onAccountTypeChange?: (value: string) => void;
  onAllowNegativeBalanceChange?: (value: boolean) => void;
  onInitialBalanceChange: (value: string) => void;
  onInitialBalanceDateChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const { t } = useI18n();
  return (
    <div className="quick-account-backdrop">
    <dialog className="quick-account" aria-label={t("capture.quickAccountAria")} open>
      <QuickAccountHeading />
      <QuickAccountFields
        accountName={accountName}
        currency={currency}
        accountType={accountType}
        allowNegativeBalance={allowNegativeBalance}
        initialBalance={initialBalance}
        initialBalanceDate={initialBalanceDate}
        onAccountNameChange={onAccountNameChange}
        onCurrencyChange={onCurrencyChange}
        onAccountTypeChange={onAccountTypeChange}
        onAllowNegativeBalanceChange={onAllowNegativeBalanceChange}
        onInitialBalanceChange={onInitialBalanceChange}
        onInitialBalanceDateChange={onInitialBalanceDateChange}
      />
      <QuickAccountActions onConfirm={onConfirm} onCancel={onCancel} />
      {error ? <p className="quick-account-error" role="alert">{error}</p> : null}
    </dialog>
    </div>
  );
}

function QuickAccountHeading() {
  const { t } = useI18n();
  return (
    <header className="quick-account-heading">
      <div>
        <span className="eyebrow">{t("capture.quickAccountEyebrow")}</span>
        <h3>{t("capture.quickAccountTitle")}</h3>
      </div>
      <p>{t("capture.quickAccountCopy")}</p>
    </header>
  );
}

function QuickAccountFields({
  accountName,
  currency,
  accountType,
  allowNegativeBalance,
  initialBalance,
  initialBalanceDate,
  onAccountNameChange,
  onCurrencyChange,
  onAccountTypeChange,
  onAllowNegativeBalanceChange,
  onInitialBalanceChange,
  onInitialBalanceDateChange,
}: Readonly<{
  accountName: string;
  currency: string;
  accountType: string;
  allowNegativeBalance: boolean;
  initialBalance: string;
  initialBalanceDate: string;
  onAccountNameChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onAccountTypeChange?: (value: string) => void;
  onAllowNegativeBalanceChange?: (value: boolean) => void;
  onInitialBalanceChange: (value: string) => void;
  onInitialBalanceDateChange: (value: string) => void;
}>) {
  const { t } = useI18n();
  return (
    <>
      <label>
        <span>{t("field.accountName")}</span>
        <input required value={accountName} onChange={(event) => onAccountNameChange(event.target.value)} placeholder={t("capture.dailyWalletPlaceholder")} />
      </label>
      <label>
        <span>{t("field.currency")}</span>
        <select value={currency} onChange={(event) => onCurrencyChange(event.target.value)}>
          <option value="TWD">TWD</option>
          <option value="JPY">JPY</option>
          <option value="USD">USD</option>
        </select>
      </label>
      <label>
        <span>{t("field.accountType")}</span>
        <select value={accountType} onChange={(event) => onAccountTypeChange?.(event.target.value)}>
          <option value="cash">{t("field.accountTypeCash")}</option>
          <option value="bank">{t("field.accountTypeBank")}</option>
          <option value="card">{t("field.accountTypeCard")}</option>
          <option value="wallet">{t("field.accountTypeWallet")}</option>
          <option value="other">{t("field.accountTypeOther")}</option>
        </select>
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={allowNegativeBalance} onChange={(event) => onAllowNegativeBalanceChange?.(event.target.checked)} />
        <span>{t("capture.allowNegativeBalance")}</span>
      </label>
      <AmountField id="quick-account-initial-balance" label={t("capture.initialBalanceOptional")} value={initialBalance} onChange={onInitialBalanceChange} placeholder={t("capture.balanceEmptyStartsZero")} />
      {hasPositiveInitialBalance(initialBalance) ? <label>
        <span>{t("field.balanceAsOf")}</span>
        <input type="date" required value={initialBalanceDate} onChange={(event) => onInitialBalanceDateChange(event.target.value)} />
      </label> : null}
    </>
  );
}

function hasPositiveInitialBalance(value: string): boolean {
  const amount = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(amount) && amount > 0;
}

function QuickAccountActions({ onConfirm, onCancel }: Readonly<{ onConfirm: () => void; onCancel: () => void }>) {
  const { t } = useI18n();
  return (
    <div className="quick-account-actions">
      <button className="primary-action" type="button" onClick={onConfirm}>{t("capture.addAndUse")}</button>
      <button className="quiet-action" type="button" onClick={onCancel}>{t("capture.cancel")}</button>
    </div>
  );
}

function useMealCapture(
  onSaveMeal: (meal: MealEntry) => void,
  onQueueUploads: (items: UploadQueueItem[], files?: File[]) => void,
) {
  const [mealOccurredAt, setMealOccurredAt] = useState(localDateTime);
  const [mealNote, setMealNote] = useState("");
  const [mealPhotoFiles, setMealPhotoFiles] = useState<File[]>([]);
  const [mealError, setMealError] = useState("");
  const [mealSavedMessage, setMealSavedMessage] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);

  const appendMealPhotos = (files: PhotoInput) => {
    const incoming = Array.from(files ?? []);
    if (incoming.length === 0) return;
    setMealPhotoFiles((current) => {
      const existing = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...incoming.filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
    setMealError("");
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    setIsCameraOpen(false);
  };

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!isCameraOpen || !cameraStreamRef.current || !cameraVideoRef.current) return;
    try {
      cameraVideoRef.current.srcObject = cameraStreamRef.current;
    } catch {
      setCameraError(t("meal.cameraPreviewFailed"));
      return;
    }
    const playResult = cameraVideoRef.current.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => setCameraError(t("meal.cameraPreviewFailed")));
    }
  }, [isCameraOpen]);

  const openCamera = async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t("meal.cameraUnsupported"));
      return;
    }
    try {
      cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
      setIsCameraOpen(true);
    } catch {
      cameraStreamRef.current = null;
      setCameraError(t("meal.cameraDenied"));
    }
  };

  const captureCameraPhoto = () => {
    const video = cameraVideoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError(t("meal.cameraNotReady"));
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError(t("meal.photoCreateFailed"));
        return;
      }
      appendMealPhotos([new File([blob], `meal-${Date.now()}.jpg`, { type: "image/jpeg" })]);
      stopCamera();
    }, "image/jpeg", 0.92);
  };

  const handleMealSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const mediaValidation = validateMediaBatch(mealPhotoFiles);
    if (!mediaValidation.ok) {
      setMealError(mediaValidation.error ?? t("meal.photosOverLimit"));
      return;
    }
    const mealId = `meal-${crypto.randomUUID()}`;
    const queuedMedia = queueUploadFiles(mealPhotoFiles, mealId, "meal-photo");
    const meal = createMealEntry({ occurredAt: mealOccurredAt, note: mealNote, mediaAssetIds: queuedMedia.map((item) => item.id) }, mealId);
    if (!meal) {
      setMealError(t("meal.selectTimeError"));
      return;
    }
    onSaveMeal(meal);
    onQueueUploads(queuedMedia, mealPhotoFiles);
    setMealError("");
    setMealSavedMessage(t("meal.savedWithPhotos", { count: meal.mediaAssetIds.length }));
    setMealNote("");
    setMealPhotoFiles([]);
  };

  return {
    mealOccurredAt,
    setMealOccurredAt,
    mealNote,
    setMealNote,
    mealPhotoFiles,
    mealError,
    setMealError,
    mealSavedMessage,
    isCameraOpen,
    cameraError,
    cameraVideoRef,
    appendMealPhotos,
    stopCamera,
    openCamera,
    captureCameraPhoto,
    handleMealSubmit,
  };
}

function useScanCapture(
  captureIntent: CaptureIntent,
  onSaveScans: (scans: TemporaryScan[]) => void,
  onQueueUploads: (items: UploadQueueItem[], files?: File[]) => void,
) {
  const [scanFiles, setScanFiles] = useState<File[]>([]);
  const [scanError, setScanError] = useState("");
  const [scanSavedMessage, setScanSavedMessage] = useState("");

  const handleScanSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setScanError("");
    setScanSavedMessage("");
    if (scanFiles.length === 0 || (captureIntent !== "scan-invoice" && captureIntent !== "scan-receipt")) {
      setScanError(t("scan.needImageError"));
      return;
    }
    const mediaValidation = validateMediaBatch(scanFiles);
    if (!mediaValidation.ok) {
      setScanError(mediaValidation.error ?? t("scan.overLimit"));
      return;
    }
    const queuedMedia = queueUploadFiles(scanFiles, `scan-${crypto.randomUUID()}`, captureIntent === "scan-invoice" ? "invoice-scan" : "receipt-scan");
    const nextScans = scanFiles
      .map((file, index) => createTemporaryScan({ intent: captureIntent, fileName: file.name, mimeType: file.type, byteSize: file.size }, queuedMedia[index].id))
      .filter((scan): scan is TemporaryScan => Boolean(scan));
    onSaveScans(nextScans);
    onQueueUploads(queuedMedia, scanFiles);
    event.currentTarget.reset();
    setScanFiles([]);
    setScanSavedMessage(t("scan.savedMessage", { count: nextScans.length }));
  };

  return { scanFiles, setScanFiles, scanError, setScanError, scanSavedMessage, handleScanSubmit };
}

function CaptureStartPanel({
  captureIntent,
  selectedCaptureAction,
  actionIcons,
  onSelectIntent,
}: Readonly<{
  captureIntent: CaptureIntent;
  selectedCaptureAction: (typeof captureIntents)[number];
  actionIcons: Record<CaptureIntent, LucideIcon>;
  onSelectIntent: (intent: CaptureIntent) => void;
}>) {
  const { t } = useI18n();
  return (
    <section className="capture-start" aria-labelledby="capture-start-title">
      <div className="capture-start-heading">
        <div>
          <p className="eyebrow">{t("capture.quickEyebrow")}</p>
          <h2 id="capture-start-title">{t("capture.whatToRecord")}</h2>
        </div>
      </div>
      <div className="capture-intent-picker" role="toolbar" aria-label={t("capture.intentPickerAria")}>
        {captureIntents.map((action) => {
          const Icon = actionIcons[action.id];
          const selected = captureIntent === action.id;
          return (
            <button
              aria-pressed={selected}
              className={`capture-intent-button ${selected ? "selected" : ""}`}
              type="button"
              key={action.id}
              onClick={() => onSelectIntent(action.id)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{t(action.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

type ManualLedgerFormProps = {
  form: DraftForm;
  accounts: LocalAccount[];
  hasSelectedAccount: boolean;
  isUnresolvedExpense: boolean;
  isTransfer: boolean;
  needsCategory: boolean;
  categoryOptions: string[];
  needsCounterparty: boolean;
  counterpartyLabel: string;
  sourceOptions: string[];
  refundableRecords: LocalLedgerRecord[];
  selectedRefundIds: string[];
  selectedRefundHasDifferentCurrency: boolean;
  refundDifferenceNeedsClassification: boolean;
  refundDifferenceLabel: string;
  merchantSuggestions: LocalLedgerRecord[];
  itemSuggestions: LocalLedgerRecord[];
  supportsRecurrence: boolean;
  autoRecordAllowed: boolean;
  hasUnsavedChanges: boolean;
  showCancelChoices: boolean;
  formError: string | null;
  savedMessage: string;
  quickAccountField: QuickAccountField | null;
  quickAccountProps: React.ComponentProps<typeof QuickAccountSetup>;
  isAddingCategory: boolean;
  quickCategoryName: string;
  quickCategoryError: string;
  isAddingSource: boolean;
  quickSourceName: string;
  quickSourceError: string;
  setForm: Dispatch<SetStateAction<DraftForm>>;
  setFormError: Dispatch<SetStateAction<string | null>>;
  setSavedMessage: Dispatch<SetStateAction<string>>;
  updateForm: (field: keyof DraftForm, value: string) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  beginQuickAccountSetup: (field: QuickAccountField) => void;
  setTimePrecision: (precision: DraftForm["timePrecision"]) => void;
  setMonthRange: (month: string) => void;
  selectSourceAccount: (name: string) => void;
  selectDestinationAccount: (name: string) => void;
  selectFeeAccount: (name: string) => void;
  setTransferMode: (mode: DraftForm["transferMode"]) => void;
  setRecordKind: (kind: DraftForm["kind"]) => void;
  setMissingExpenseField: (field: "counterparty" | "itemName", missing: boolean) => void;
  applySuggestion: (field: "counterparty" | "itemName" | "amount" | "account" | "category" | "currency", value: string) => void;
  setIsAddingCategory: Dispatch<SetStateAction<boolean>>;
  setQuickCategoryName: Dispatch<SetStateAction<string>>;
  setQuickCategoryError: Dispatch<SetStateAction<string>>;
  addQuickCategory: () => void;
  setIsAddingSource: Dispatch<SetStateAction<boolean>>;
  setQuickSourceName: Dispatch<SetStateAction<string>>;
  setQuickSourceError: Dispatch<SetStateAction<string>>;
  addQuickSource: () => void;
  resetEntry: () => void;
  keepEntryAsDraft: () => void;
  setShowCancelChoices: Dispatch<SetStateAction<boolean>>;
};

type ManualLedgerDetailsProps = Pick<ManualLedgerFormProps,
  | "form"
  | "accounts"
  | "isTransfer"
  | "needsCategory"
  | "categoryOptions"
  | "needsCounterparty"
  | "counterpartyLabel"
  | "sourceOptions"
  | "refundableRecords"
  | "selectedRefundIds"
  | "selectedRefundHasDifferentCurrency"
  | "refundDifferenceNeedsClassification"
  | "refundDifferenceLabel"
  | "merchantSuggestions"
  | "itemSuggestions"
  | "quickAccountField"
  | "quickAccountProps"
  | "isAddingCategory"
  | "quickCategoryName"
  | "quickCategoryError"
  | "isAddingSource"
  | "quickSourceName"
  | "quickSourceError"
  | "setForm"
  | "updateForm"
  | "beginQuickAccountSetup"
  | "selectDestinationAccount"
  | "selectFeeAccount"
  | "setTransferMode"
  | "setMissingExpenseField"
  | "applySuggestion"
  | "setIsAddingCategory"
  | "setQuickCategoryName"
  | "setQuickCategoryError"
  | "addQuickCategory"
  | "setIsAddingSource"
  | "setQuickSourceName"
  | "setQuickSourceError"
  | "addQuickSource"
>;

type ManualLedgerPartyFieldsProps = Pick<ManualLedgerDetailsProps,
  | "form" | "needsCategory" | "categoryOptions" | "needsCounterparty" | "counterpartyLabel" | "sourceOptions"
  | "refundableRecords" | "selectedRefundIds" | "merchantSuggestions" | "itemSuggestions" | "isAddingCategory"
  | "quickCategoryName" | "quickCategoryError" | "isAddingSource" | "quickSourceName" | "quickSourceError"
  | "setForm" | "updateForm" | "setMissingExpenseField" | "applySuggestion" | "setIsAddingCategory"
  | "setQuickCategoryName" | "setQuickCategoryError" | "addQuickCategory" | "setIsAddingSource"
  | "setQuickSourceName" | "setQuickSourceError" | "addQuickSource"
>;

function ManualLedgerPartyFields({
  form, needsCategory, categoryOptions, needsCounterparty, counterpartyLabel, sourceOptions, refundableRecords,
  selectedRefundIds, merchantSuggestions, itemSuggestions, isAddingCategory, quickCategoryName, quickCategoryError,
  isAddingSource, quickSourceName, quickSourceError, setForm, updateForm, setMissingExpenseField, applySuggestion,
  setIsAddingCategory, setQuickCategoryName, setQuickCategoryError, addQuickCategory, setIsAddingSource,
  setQuickSourceName, setQuickSourceError, addQuickSource,
}: Readonly<ManualLedgerPartyFieldsProps>) {
  const { t } = useI18n();
  return (
    <>
      {needsCategory ? (
        <div className="form-field">
          <label htmlFor="entry-category"><span>{t("field.category")}</span></label>
          <div className="field-control-row">
            <select id="entry-category" required value={form.category} onChange={(event) => updateForm("category", event.target.value)}>
              <option value="">{t("capture.selectCategory")}</option>
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <button className="icon-button" type="button" aria-label={t("capture.addCategory")} title={t("capture.addCategory")} onClick={() => { setIsAddingCategory(true); setQuickCategoryError(""); }}>
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
          {isAddingCategory ? (
            <section className="quick-category" aria-label={t("capture.quickCategoryAria")}>
              <label><span>{t("field.newCategoryName")}</span><input value={quickCategoryName} onChange={(event) => { setQuickCategoryName(event.target.value); setQuickCategoryError(""); }} placeholder={t("capture.homePlaceholder")} /></label>
              <div className="quick-account-actions">
                <button className="primary-action" type="button" onClick={addQuickCategory}>{t("capture.addAndUse")}</button>
                <button className="quiet-action" type="button" onClick={() => { setIsAddingCategory(false); setQuickCategoryError(""); }}>{t("capture.cancel")}</button>
              </div>
              {quickCategoryError ? <p className="quick-account-error" role="alert">{quickCategoryError}</p> : null}
            </section>
          ) : null}
        </div>
      ) : null}
      {needsCounterparty ? (
        <ManualLedgerCounterpartyField
          form={form}
          counterpartyLabel={counterpartyLabel}
          sourceOptions={sourceOptions}
          merchantSuggestions={merchantSuggestions}
          isAddingSource={isAddingSource}
          quickSourceName={quickSourceName}
          quickSourceError={quickSourceError}
          updateForm={updateForm}
          setMissingExpenseField={setMissingExpenseField}
          applySuggestion={applySuggestion}
          setIsAddingSource={setIsAddingSource}
          setQuickSourceName={setQuickSourceName}
          setQuickSourceError={setQuickSourceError}
          addQuickSource={addQuickSource}
        />
      ) : null}
      {form.kind === "refund" ? (
        <>
          <label><span>{t("field.refundType")}</span><select value={form.refundSubtype} onChange={(event) => updateForm("refundSubtype", event.target.value as DraftForm["refundSubtype"])}><option value="refund">{t("capture.storeRefund")}</option><option value="payback">{t("capture.friendPayback")}</option></select></label>
          {form.refundSubtype === "payback" ? (
            <label htmlFor="entry-refund-links"><span>{t("field.originalExpense")}</span><select id="entry-refund-links" aria-label={t("field.originalExpense")} required multiple value={selectedRefundIds} onChange={(event) => { const ids = [...event.target.selectedOptions].map((option) => option.value).filter(Boolean); setForm((current) => ({ ...current, refundLinkedRecordId: ids[0] ?? "", refundLinkedRecordIds: ids })); }}><option value="">{t("capture.selectLinkedExpense")}</option>{refundableRecords.map((record) => <option key={record.id} value={record.id}>{record.localDate} · {record.counterparty} · {record.currency} {record.amount}</option>)}</select><small>{t("capture.linkedExpenseHint")}</small></label>
          ) : null}
        </>
      ) : null}
      {form.kind === "expense" ? (
        <div className="form-field">
          <label htmlFor="entry-item-name"><span>{t("field.itemName")}</span></label>
          <input id="entry-item-name" required pattern=".*\S.*" disabled={form.itemNameMissing} value={form.itemName} onChange={(event) => updateForm("itemName", event.target.value)} />
          <label className="checkbox-field inline-checkbox"><input type="checkbox" checked={form.itemNameMissing} onChange={(event) => setMissingExpenseField("itemName", event.target.checked)} /><span>{t("field.itemNameMissing")}</span></label>
          {itemSuggestions.length > 0 && !form.itemNameMissing ? <HistorySuggestions records={itemSuggestions} source="item" onApply={applySuggestion} /> : null}
        </div>
      ) : null}
    </>
  );
}

type ManualLedgerCounterpartyFieldProps = Pick<ManualLedgerPartyFieldsProps,
  | "form" | "counterpartyLabel" | "sourceOptions" | "merchantSuggestions" | "isAddingSource"
  | "quickSourceName" | "quickSourceError" | "updateForm" | "setMissingExpenseField" | "applySuggestion"
  | "setIsAddingSource" | "setQuickSourceName" | "setQuickSourceError" | "addQuickSource"
>;

function ManualLedgerCounterpartyField({
  form, counterpartyLabel, sourceOptions, merchantSuggestions, isAddingSource, quickSourceName, quickSourceError,
  updateForm, setMissingExpenseField, applySuggestion, setIsAddingSource, setQuickSourceName, setQuickSourceError,
  addQuickSource,
}: Readonly<ManualLedgerCounterpartyFieldProps>) {
  const { t } = useI18n();
  const isIncomeSource = form.kind === "income" || form.kind === "fund-addition";
  if (isIncomeSource) {
    return (
      <div className="form-field">
        <label htmlFor="entry-source">{t("field.source")}</label>
        <div className="field-control-row">
          <select id="entry-source" required value={form.counterparty} onChange={(event) => updateForm("counterparty", event.target.value)}>
            <option value="">{t("capture.selectSource")}</option>
            {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
          <button className="icon-button" type="button" aria-label={t("capture.addSource")} title={t("capture.addSource")} onClick={() => { setIsAddingSource(true); setQuickSourceError(""); }}>
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        {isAddingSource ? (
          <section className="quick-category" aria-label={t("capture.quickSourceAria")}>
            <label htmlFor="quick-source-name">{t("field.newSource")}</label>
            <input id="quick-source-name" required value={quickSourceName} onChange={(event) => { setQuickSourceName(event.target.value); setQuickSourceError(""); }} placeholder={t("capture.parentsPlaceholder")} />
            <div className="quick-account-actions">
              <button className="primary-action" type="button" onClick={addQuickSource}>{t("capture.addAndUse")}</button>
              <button className="quiet-action" type="button" onClick={() => { setIsAddingSource(false); setQuickSourceError(""); }}>{t("capture.cancel")}</button>
            </div>
            {quickSourceError ? <p className="quick-account-error" role="alert">{quickSourceError}</p> : null}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="form-field">
      <label htmlFor="entry-counterparty"><span>{counterpartyLabel}</span></label>
      <input id="entry-counterparty" required pattern=".*\S.*" title={t("capture.enterMerchantTitle", { label: counterpartyLabel })} value={form.counterparty} disabled={form.kind === "expense" && form.counterpartyMissing} onChange={(event) => updateForm("counterparty", event.target.value)} />
      {form.kind === "expense" ? <label className="checkbox-field inline-checkbox"><input type="checkbox" checked={form.counterpartyMissing} onChange={(event) => setMissingExpenseField("counterparty", event.target.checked)} /><span>{t("field.merchantMissing")}</span></label> : null}
      {form.kind === "expense" && merchantSuggestions.length > 0 && !form.counterpartyMissing ? <HistorySuggestions records={merchantSuggestions} source="merchant" onApply={applySuggestion} /> : null}
    </div>
  );
}

type ManualLedgerMoneyFieldsProps = Pick<ManualLedgerDetailsProps,
  | "form" | "accounts" | "isTransfer" | "quickAccountField" | "quickAccountProps" | "selectedRefundHasDifferentCurrency"
  | "refundDifferenceNeedsClassification" | "refundDifferenceLabel" | "setForm" | "updateForm" | "beginQuickAccountSetup"
  | "selectDestinationAccount" | "selectFeeAccount" | "setTransferMode"
>;

function ManualLedgerMoneyFields({
  form, accounts, isTransfer, quickAccountField, quickAccountProps, selectedRefundHasDifferentCurrency,
  refundDifferenceNeedsClassification, refundDifferenceLabel, setForm, updateForm, beginQuickAccountSetup,
  selectDestinationAccount, selectFeeAccount, setTransferMode,
}: Readonly<ManualLedgerMoneyFieldsProps>) {
  const { t } = useI18n();
  return (
    <>
      {isTransfer ? <TransferFields form={form} accounts={accounts} quickAccountField={quickAccountField} quickAccountProps={quickAccountProps} onBeginQuickAccountSetup={beginQuickAccountSetup} onSelectDestinationAccount={selectDestinationAccount} onSetTransferMode={setTransferMode} /> : null}
      <AmountField id="entry-amount" label={isTransfer && form.transferMode === "cross-currency" ? t("field.sourceAmount") : t("field.amount")} required value={form.amount} allowNegative={form.kind === "adjustment"} onChange={(value) => updateForm("amount", value)} />
      <div className="form-field"><span>{isTransfer && form.transferMode === "cross-currency" ? t("field.sourceCurrency") : t("field.currency")}</span><output className="derived-value">{form.currency}</output></div>
      {isTransfer && form.transferMode === "cross-currency" ? <><AmountField id="entry-destination-amount" label={t("field.destinationAmount")} required value={form.destinationAmount} onChange={(value) => updateForm("destinationAmount", value)} /><div className="form-field"><span>{t("field.destinationCurrency")}</span><output className="derived-value">{form.destinationCurrency}</output></div></> : null}
      {isTransfer ? <label className="full-span checkbox-field"><input type="checkbox" checked={form.feeEnabled} onChange={(event) => setForm((current) => ({ ...current, feeEnabled: event.target.checked }))} /><span>{t("capture.addTransferFee")}</span></label> : null}
      {isTransfer && form.feeEnabled ? <FeeFields form={form} accounts={accounts} quickAccountField={quickAccountField} quickAccountProps={quickAccountProps} onBeginQuickAccountSetup={beginQuickAccountSetup} onSelectFeeAccount={selectFeeAccount} onUpdateForm={updateForm} /> : null}
      {form.kind === "refund" ? <RefundFields form={form} selectedRefundHasDifferentCurrency={selectedRefundHasDifferentCurrency} refundDifferenceNeedsClassification={refundDifferenceNeedsClassification} refundDifferenceLabel={refundDifferenceLabel} updateForm={updateForm} /> : null}
      {form.kind === "adjustment" ? <label className="full-span"><span>{t("field.adjustmentReason")}</span><textarea required value={form.reason} onChange={(event) => updateForm("reason", event.target.value)} /></label> : null}
    </>
  );
}

function RefundFields({ form, selectedRefundHasDifferentCurrency, refundDifferenceNeedsClassification, refundDifferenceLabel, updateForm }: Readonly<Pick<ManualLedgerMoneyFieldsProps, "form" | "selectedRefundHasDifferentCurrency" | "refundDifferenceNeedsClassification" | "refundDifferenceLabel" | "updateForm">>) {
  const { t } = useI18n();
  const differenceDescription = selectedRefundHasDifferentCurrency
    ? t("capture.differenceCurrency")
    : t("capture.differenceExcess");
  return (
    <>
      <label className="full-span"><span>{t("field.refundReason")}</span><textarea required value={form.refundReason} onChange={(event) => updateForm("refundReason", event.target.value)} /></label>
      {refundDifferenceNeedsClassification ? (
        <label className="full-span warning-field">
          <span>{refundDifferenceLabel}</span>
          <select aria-label={refundDifferenceLabel} value={form.refundExcessHandling} onChange={(event) => updateForm("refundExcessHandling", event.target.value as DraftForm["refundExcessHandling"])}>
            <option value="unclassified">{t("capture.selectClassification")}</option>
            <option value="income">{t("capture.excessIncome")}</option>
            <option value="negative-expense">{t("capture.excessNegativeExpense")}</option>
            <option value="exchange_difference">{t("capture.excessExchangeDifference")}</option>
          </select>
          <small>{differenceDescription}</small>
        </label>
      ) : null}
    </>
  );
}

function ManualLedgerDetails(props: Readonly<ManualLedgerDetailsProps>) {
  return (
    <fieldset className="entry-details">
      <ManualLedgerPartyFields {...props} />
      <ManualLedgerMoneyFields {...props} />
    </fieldset>
  );
}

type ManualLedgerTimingFieldsProps = Pick<ManualLedgerFormProps, "form" | "isUnresolvedExpense" | "setTimePrecision" | "setMonthRange" | "updateForm"> & {
  hasSelectedAccount: boolean;
};

type ManualLedgerAccountFieldProps = Pick<ManualLedgerFormProps, "form" | "accounts" | "isTransfer" | "quickAccountField" | "quickAccountProps" | "beginQuickAccountSetup" | "selectSourceAccount">;

function ManualLedgerAccountField({
  form, accounts, isTransfer, quickAccountField, quickAccountProps, beginQuickAccountSetup, selectSourceAccount,
}: Readonly<ManualLedgerAccountFieldProps>) {
  const { t } = useI18n();
  return (
    <div className={`form-field entry-account-field ${isTransfer ? "" : "entry-account-last"}`}>
      <label htmlFor="entry-account"><span>{isTransfer ? t("capture.sourceAccount") : t("field.account")}</span></label>
      <div className="field-control-row">
        <select id="entry-account" required disabled={accounts.length === 0} value={form.account} onChange={(event) => selectSourceAccount(event.target.value)}>
          <option value="">{accounts.length === 0 ? t("capture.addAccount") : t("capture.selectAccount")}</option>
          {accounts.map((account) => <option key={account.id} value={account.name}>{account.name} ({account.currency})</option>)}
        </select>
        <button className="icon-button" type="button" aria-label={t("capture.addAccount")} title={t("capture.addAccount")} onClick={() => beginQuickAccountSetup("account")}><Plus size={18} aria-hidden="true" /></button>
      </div>
      {accounts.length === 0 ? <p className="field-help">{t("capture.needAccountFirst")}</p> : null}
      {quickAccountField === "account" ? <QuickAccountSetup {...quickAccountProps} /> : null}
    </div>
  );
}

function ManualLedgerTimingFields({
  form, hasSelectedAccount, isUnresolvedExpense, setTimePrecision, setMonthRange, updateForm,
}: Readonly<ManualLedgerTimingFieldsProps>) {
  const { t } = useI18n();
  return (
    <>
      {hasSelectedAccount && !isUnresolvedExpense ? <label className="entry-date-field"><span>{t("field.date")}</span><input required type="date" value={form.date} onChange={(event) => updateForm("date", event.target.value)} /></label> : null}
      {hasSelectedAccount && isUnresolvedExpense ? (
        <section className="full-span time-precision-fields" aria-label={t("capture.unresolvedTimeAria")}>
          <fieldset className="segmented-fieldset">
            <legend>{t("field.timePrecision")}</legend>
            <div className="segmented-control">
              {(["day", "month", "period"] as const).map((precision) => (
                <label className={form.timePrecision === precision ? "active" : ""} key={precision}>
                  <input checked={form.timePrecision === precision} name="time-precision" type="radio" value={precision} onChange={() => setTimePrecision(precision)} />
                  <span>{timePrecisionLabel(precision)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {form.timePrecision === "day" ? <label><span>{t("field.date")}</span><input required type="date" value={form.date} onChange={(event) => updateForm("date", event.target.value)} /></label> : null}
          {form.timePrecision === "month" ? <label><span>{t("field.recordMonth")}</span><input required type="month" value={form.periodStart.slice(0, 7)} onChange={(event) => setMonthRange(event.target.value)} /></label> : null}
          {form.timePrecision === "period" ? <div className="period-range"><label><span>{t("field.periodStart")}</span><input required type="date" value={form.periodStart} onChange={(event) => updateForm("periodStart", event.target.value)} /></label><label><span>{t("field.periodEnd")}</span><input required type="date" value={form.periodEnd} onChange={(event) => updateForm("periodEnd", event.target.value)} /></label></div> : null}
        </section>
      ) : null}
    </>
  );
}


function ManualLedgerForm(props: Readonly<ManualLedgerFormProps>) {
  const {
    form, accounts, hasSelectedAccount, isUnresolvedExpense, isTransfer, needsCategory, categoryOptions,
    needsCounterparty, counterpartyLabel, sourceOptions, refundableRecords, selectedRefundIds,
    selectedRefundHasDifferentCurrency, refundDifferenceNeedsClassification, refundDifferenceLabel,
    merchantSuggestions, itemSuggestions, supportsRecurrence, autoRecordAllowed, hasUnsavedChanges,
    showCancelChoices, formError, savedMessage, quickAccountField, quickAccountProps, isAddingCategory, quickCategoryName,
    quickCategoryError, isAddingSource, quickSourceName,
     quickSourceError, setForm, setFormError, setSavedMessage, updateForm, handleSubmit, beginQuickAccountSetup, setTimePrecision, setMonthRange,
    selectSourceAccount, selectDestinationAccount, selectFeeAccount, setTransferMode, setRecordKind,
    setMissingExpenseField, applySuggestion, setIsAddingCategory, setQuickCategoryName, setQuickCategoryError,
    addQuickCategory, setIsAddingSource, setQuickSourceName, setQuickSourceError, addQuickSource, resetEntry,
    keepEntryAsDraft, setShowCancelChoices,
  } = props;
  const { t } = useI18n();
  return (
    <form className={`draft-form ${hasSelectedAccount ? "has-selected-account" : "needs-account"}`} id="manual-draft-form" onSubmit={handleSubmit}>
              <ManualLedgerTimingFields form={form} hasSelectedAccount={hasSelectedAccount} isUnresolvedExpense={isUnresolvedExpense} setTimePrecision={setTimePrecision} setMonthRange={setMonthRange} updateForm={updateForm} />
              <ManualLedgerAccountField form={form} accounts={accounts} isTransfer={isTransfer} quickAccountField={quickAccountField} quickAccountProps={quickAccountProps} beginQuickAccountSetup={beginQuickAccountSetup} selectSourceAccount={selectSourceAccount} />
              {hasSelectedAccount ? (
                <label className="entry-kind-field">
                  <span>{t("field.kind")}</span>
                  <select value={form.kind} onChange={(event) => setRecordKind(event.target.value as DraftForm["kind"])}>
                    {draftKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabel(kind)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {hasSelectedAccount ? (
                <ManualLedgerDetails
                  form={form}
                  accounts={accounts}
                  isTransfer={isTransfer}
                  needsCategory={needsCategory}
                  categoryOptions={categoryOptions}
                  needsCounterparty={needsCounterparty}
                  counterpartyLabel={counterpartyLabel}
                  sourceOptions={sourceOptions}
                  refundableRecords={refundableRecords}
                  selectedRefundIds={selectedRefundIds}
                  selectedRefundHasDifferentCurrency={selectedRefundHasDifferentCurrency}
                  refundDifferenceNeedsClassification={refundDifferenceNeedsClassification}
                  refundDifferenceLabel={refundDifferenceLabel}
                  merchantSuggestions={merchantSuggestions}
                  itemSuggestions={itemSuggestions}
                  quickAccountField={quickAccountField}
                  quickAccountProps={quickAccountProps}
                  isAddingCategory={isAddingCategory}
                  quickCategoryName={quickCategoryName}
                  quickCategoryError={quickCategoryError}
                  isAddingSource={isAddingSource}
                  quickSourceName={quickSourceName}
                  quickSourceError={quickSourceError}
                  setForm={setForm}
                  updateForm={updateForm}
                  beginQuickAccountSetup={beginQuickAccountSetup}
                  selectDestinationAccount={selectDestinationAccount}
                  selectFeeAccount={selectFeeAccount}
                  setTransferMode={setTransferMode}
                  setMissingExpenseField={setMissingExpenseField}
                  applySuggestion={applySuggestion}
                  setIsAddingCategory={setIsAddingCategory}
                  setQuickCategoryName={setQuickCategoryName}
                  setQuickCategoryError={setQuickCategoryError}
                  addQuickCategory={addQuickCategory}
                  setIsAddingSource={setIsAddingSource}
                  setQuickSourceName={setQuickSourceName}
                  setQuickSourceError={setQuickSourceError}
                  addQuickSource={addQuickSource}
                />
              ) : (
                <div className="entry-details-locked full-span" aria-live="polite">
                  <strong>{t("capture.selectAccountFirst")}</strong>
                  <span>{t("capture.selectAccountFirstDetail")}</span>
                </div>
              )}
              {supportsRecurrence && hasSelectedAccount ? (
                <fieldset className="recurrence-control full-span" aria-label={t("capture.nextCycleLegend")}>
                  <legend>{t("capture.nextCycleLegend")}</legend>
                  <label htmlFor="entry-recurrence-choice">
                    <span>{t("capture.recordBehavior")}</span>
                  </label>
                  <select
                    id="entry-recurrence-choice"
                    disabled={!hasSelectedAccount}
                    value={form.recurrenceChoice}
                    onChange={(event) => updateForm("recurrenceChoice", event.target.value as DraftForm["recurrenceChoice"])}
                  >
                    <option value="current-cycle-only">{t("capture.currentCycleOnly")}</option>
                    <option value="prompt-next-cycle">{t("capture.promptNextCycle")}</option>
                    <option value="auto-record-next-cycle" disabled={!autoRecordAllowed}>{t("capture.autoRecordNextCycle")}</option>
                  </select>
                  <label className="checkbox-field inline-checkbox">
                    <input
                      type="checkbox"
                      checked={form.recurrenceAmountMode === "variable"}
                      disabled={!hasSelectedAccount}
                      onChange={(event) => {
                        const variable = event.target.checked;
                        setFormError(null);
                        setSavedMessage("");
                        setForm((current) => ({
                          ...current,
                          recurrenceAmountMode: variable ? "variable" : "fixed",
                          recurrenceChoice: variable && current.recurrenceChoice === "auto-record-next-cycle" ? "prompt-next-cycle" : current.recurrenceChoice,
                        }));
                      }}
                    />
                    <span>{t("capture.amountMayVary")}</span>
                  </label>
                  {form.recurrenceChoice === "auto-record-next-cycle" && !autoRecordAllowed ? (
                    <p className="field-help">{t("capture.autoRecordHint")}</p>
                  ) : null}
                </fieldset>
              ) : null}
              {formError ? <p className="form-error full-span" role="alert">{formError}</p> : null}
              {savedMessage ? <p className="form-success full-span" aria-live="polite">{savedMessage}</p> : null}
              {hasSelectedAccount ? (
                <>
                  {showCancelChoices ? (
                    <dialog className="cancel-choice full-span" aria-label={t("capture.cancelEntryAria")} open>
                      <strong>{t("capture.cancelEntryQuestion")}</strong>
                      <div className="quick-account-actions">
                        <button className="danger-action" type="button" onClick={resetEntry}>{t("capture.discardChanges")}</button>
                        <button className="secondary-action" type="button" onClick={keepEntryAsDraft}>{t("capture.keepAsDraft")}</button>
                        <button className="quiet-action" type="button" onClick={() => setShowCancelChoices(false)}>{t("capture.continueEditing")}</button>
                      </div>
                    </dialog>
                  ) : null}
                  <div className="quick-account-actions full-span">
                    <button className="quiet-action" type="button" onClick={() => hasUnsavedChanges ? setShowCancelChoices(true) : resetEntry()}>{t("capture.cancelEntry")}</button>
                    <button className="primary-action" type="submit">{t("capture.saveRecord")}</button>
                  </div>
                </>
              ) : null}
            </form>
  );
}

function ManualLedgerPanel(props: Readonly<ManualLedgerFormProps>) {
  const { accounts, beginQuickAccountSetup, quickAccountField, quickAccountProps } = props;
  const { t } = useI18n();
  return (
    <Panel key="manual-ledger" title={t("capture.manualPanelTitle")} eyebrow={t("capture.manualPanelEyebrow")}>
      {accounts.length === 0 ? (
        <section className="manual-empty-state" aria-label={t("capture.needAccountAria")} aria-live="polite">
          <span className="eyebrow">{t("capture.needAccountEyebrow")}</span>
          <h3>{t("capture.createFirstAccount")}</h3>
          <p>{t("capture.needAccountCopy")}</p>
          <button className="primary-action align-start" type="button" onClick={() => beginQuickAccountSetup("account")}>{t("capture.createFirstAccountAction")}</button>
        </section>
      ) : (
        <ManualLedgerForm {...props} />
      )}
      {accounts.length === 0 && quickAccountField === "account" ? (
        <QuickAccountSetup {...quickAccountProps} />
      ) : null}
    </Panel>
  );
}


// 新增 route: the voice-capture flow only (mode A 整段口說 / mode B 逐欄口說).
// Owns the custom-category list so the spoken entity policy can create a
// not-yet-existing category right before the confirmed write, mirroring the
// tools page (ADR 0012).
// Creates the not-yet-existing accounts/categories an AI suggestion carries,
// right before the confirmed write (see ADR 0012). New accounts follow the
// default-wallet convention (name as spoken, currency TWD), categories join
// the custom categories; the user can edit or delete either later in
// account/category management. Shared by the voice capture page and the
// manual capture page so both mode A and mode B flows resolve entities the
// same way.
function resolveNewEntitiesFor(
  suggestion: NewEntityCarrier,
  accounts: LocalAccount[],
  customCategories: string[],
  setCustomCategories: Dispatch<SetStateAction<string[]>>,
  onAddAccount: (account: LocalAccount) => void,
): LocalAccount[] | false {
  const created: LocalAccount[] = [];
  const newAccountNames = [suggestion.newAccount, suggestion.newTransferAccount].filter((name): name is string => Boolean(name));
  for (const name of newAccountNames) {
    if (accounts.some((account) => account.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      continue;
    }
    const account = createLocalAccount(name, "TWD", crypto.randomUUID());
    if (!account) {
      return false;
    }
    created.push(account);
    onAddAccount(account);
  }
  const newCategory = suggestion.newCategory;
  if (newCategory && !customCategories.some((category) => category.toLocaleLowerCase() === newCategory.toLocaleLowerCase())) {
    setCustomCategories((current) => [...current, newCategory]);
  }
  return created;
}

function VoiceCapturePage({
  accounts,
  entityPolicy,
  mode,
  onModeChange,
  customCategories,
  setCustomCategories,
  onAddAccount,
  onSaveRecord,
  onSaveDraft,
}: Readonly<{
  accounts: LocalAccount[];
  entityPolicy: AiEntityPolicy;
  mode: "a" | "b";
  onModeChange: (mode: "a" | "b") => void;
  customCategories: string[];
  setCustomCategories: Dispatch<SetStateAction<string[]>>;
  onAddAccount: (account: LocalAccount) => void;
  onSaveRecord: (draft: TransactionDraft, extraAccounts?: LocalAccount[]) => string | null;
  onSaveDraft: (draft: TransactionDraft) => void;
}>) {
  const categories = useMemo(
    () => [...new Set([...expenseCategories, ...incomeCategories, ...customCategories])],
    [customCategories],
  );

  const resolveNewEntities = (suggestion: NewEntityCarrier): LocalAccount[] | false =>
    resolveNewEntitiesFor(suggestion, accounts, customCategories, setCustomCategories, onAddAccount);

  return (
    <section className="capture-layout">
      <AiLedgerPanel
        accounts={accounts}
        categories={categories}
        entityPolicy={entityPolicy}
        mode={mode}
        onModeChange={onModeChange}
        onResolveNewEntities={resolveNewEntities}
        onSaveRecord={onSaveRecord}
        onSaveDraft={onSaveDraft}
      />
    </section>
  );
}

function CapturePage({
  records,
  accounts,
  aiEntityPolicy,
  navigate,
  draftToEdit,
  onDiscardDraft,
  onFinishDraftEdit,
  customCategories,
  setCustomCategories,
  onAddAccount,
  onSaveInitialFunding,
  onSaveRecord,
  onSaveDraft,
  onSaveMeal,
  scans,
  onSaveScans,
  onUpdateScan,
  uploadQueue,
  mediaPreviewUrls,
  onQueueUploads,
  onClearUploads,
}: Readonly<{
  records: LocalLedgerRecord[];
  accounts: LocalAccount[];
  aiEntityPolicy: AiEntityPolicy;
  navigate: (item: NavItem) => void;
  draftToEdit: TransactionDraft | null;
  onDiscardDraft: (id: string) => void;
  onFinishDraftEdit: () => void;
  customCategories: string[];
  setCustomCategories: Dispatch<SetStateAction<string[]>>;
  onAddAccount: (account: LocalAccount) => void;
  onSaveInitialFunding: (account: LocalAccount, draft: TransactionDraft) => boolean;
  onSaveRecord: (draft: TransactionDraft, extraAccounts?: LocalAccount[]) => string | null;
  onSaveDraft: (draft: TransactionDraft) => void;
  onSaveMeal: (meal: MealEntry) => void;
  scans: TemporaryScan[];
  onSaveScans: (scans: TemporaryScan[]) => void;
  onUpdateScan: (scan: TemporaryScan) => void;
  uploadQueue: UploadQueueItem[];
  mediaPreviewUrls: Record<string, string>;
  onQueueUploads: (items: UploadQueueItem[], files?: File[]) => void;
  onClearUploads: (ids: string[]) => void;
}>) {
  const initialForm: DraftForm = draftToEdit ? { ...draftToEdit } : createEmptyDraftForm();
  const [form, setForm] = useState<DraftForm>(initialForm);
  const [cleanForm, setCleanForm] = useState<DraftForm>(initialForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [showCancelChoices, setShowCancelChoices] = useState(false);
  const [quickAccountField, setQuickAccountField] = useState<QuickAccountField | null>(null);
  const [quickAccountName, setQuickAccountName] = useState("");
  const [quickAccountCurrency, setQuickAccountCurrency] = useState("TWD");
  const [quickAccountType, setQuickAccountType] = useState("cash");
  const [quickAccountAllowNegative, setQuickAccountAllowNegative] = useState(true);
  const [quickAccountBalance, setQuickAccountBalance] = useState("");
  const [quickAccountBalanceDate, setQuickAccountBalanceDate] = useState(localDate());
  const [quickAccountError, setQuickAccountError] = useState("");
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [quickCategoryName, setQuickCategoryName] = useState("");
  const [quickCategoryError, setQuickCategoryError] = useState("");
  const [customSources, setCustomSources] = useState<string[]>(readStoredSources);
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [quickSourceName, setQuickSourceName] = useState("");
  const [quickSourceError, setQuickSourceError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [captureIntent, setCaptureIntent] = useState<CaptureIntent>("manual-ledger");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentSavedMessage, setAttachmentSavedMessage] = useState("");
  const {
    mealOccurredAt,
    setMealOccurredAt,
    mealNote,
    setMealNote,
    mealPhotoFiles,
    mealError,
    setMealError,
    mealSavedMessage,
    isCameraOpen,
    cameraError,
    cameraVideoRef,
    appendMealPhotos,
    stopCamera,
    openCamera,
    captureCameraPhoto,
    handleMealSubmit,
  } = useMealCapture(onSaveMeal, onQueueUploads);
  const {
    scanFiles,
    setScanFiles,
    scanError,
    setScanError,
    scanSavedMessage,
    handleScanSubmit,
  } = useScanCapture(captureIntent, onSaveScans, onQueueUploads);
  const hasUnsavedChanges = JSON.stringify(form) !== JSON.stringify(cleanForm);

  const handleAttachmentSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttachmentError("");
    setAttachmentSavedMessage("");
    if (attachmentFiles.length === 0) {
      setAttachmentError(t("attach.needPhoto"));
      return;
    }
    const mediaValidation = validateMediaBatch(attachmentFiles);
    if (!mediaValidation.ok) {
      setAttachmentError(mediaValidation.error ?? t("attach.overLimit"));
      return;
    }
    const queuedMedia = queueUploadFiles(attachmentFiles, `attachment-${crypto.randomUUID()}`, "attachment");
    onQueueUploads(queuedMedia, attachmentFiles);
    setAttachmentFiles([]);
    setAttachmentSavedMessage(t("attach.saved", { count: queuedMedia.length }));
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(sourcesStorageKey, JSON.stringify(customSources));
    } catch {
      // Source persistence is best effort while the account and record stores remain local-first.
    }
  }, [customSources]);

  const actionIcons = {
    "manual-ledger": Banknote,
    "ai-ledger": Sparkles,
    "scan-invoice": ReceiptText,
    "scan-receipt": ReceiptText,
    "record-meal": ImagePlus,
    "attach-photo": Upload,
  } satisfies Record<CaptureIntent, LucideIcon>;
  const selectedCaptureAction = captureIntents.find((action) => action.id === captureIntent) ?? captureIntents[0];

  const updateForm = (field: keyof DraftForm, value: string) => {
    setFormError(null);
    setSavedMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  };

  const isTransfer = form.kind === "transfer";
  const needsCategory = form.kind === "expense" || form.kind === "income" || form.kind === "refund";
  const counterpartyLabel = counterpartyLabelForKind(form.kind);
  const needsCounterparty = form.kind === "expense" || form.kind === "income" || form.kind === "refund" || form.kind === "fund-addition";
  const isUnresolvedExpense = form.kind === "unresolved-expense";
  const hasSelectedAccount = accounts.some((account) => account.name === form.account);
  const categoryOptions = (form.kind === "income" ? incomeCategories : expenseCategories).concat(customCategories);
  const aiCategories = [...new Set([...expenseCategories, ...incomeCategories, ...customCategories])];

  // Creates the not-yet-existing accounts/categories an AI suggestion carries,
  // right before the confirmed write (see ADR 0012). New accounts follow the
  // default-wallet convention (name as spoken, currency TWD), categories join
  // the custom categories; the user can edit or delete either later in
  // account/category management.
  const resolveNewEntities = (suggestion: NewEntityCarrier): LocalAccount[] | false =>
    resolveNewEntitiesFor(suggestion, accounts, customCategories, setCustomCategories, onAddAccount);
  const sourceOptions = useMemo(
    () => [...new Set([...customSources, ...records.filter((record) => record.kind === "income" || record.kind === "fund-addition").map((record) => record.counterparty).filter(Boolean)])],
    [customSources, records],
  );
  const refundableRecords = records.filter((record) => record.kind === "expense" && record.recordState !== "voided");
  const merchantSuggestions = form.counterparty.trim()
    ? records.filter((record) => record.recordState !== "voided" && record.counterparty.toLocaleLowerCase().includes(form.counterparty.trim().toLocaleLowerCase())).slice(0, 5)
    : [];
  const itemSuggestions = form.itemName.trim()
    ? records.filter((record) => record.recordState !== "voided" && record.itemName?.toLocaleLowerCase().includes(form.itemName.trim().toLocaleLowerCase())).slice(0, 5)
    : [];
  const selectedRefundIds = selectedRefundIdsFor(form);
  const selectedRefundRecords = refundableRecords.filter((record) => selectedRefundIds.includes(record.id));
  const selectedRefundHasDifferentCurrency = selectedRefundRecords.some((record) => record.currency !== form.currency);
  const linkedRefundAmount = selectedRefundRecords
    .filter((record) => record.currency === form.currency)
    .reduce((total, record) => total + Number(record.amount), 0);
  const refundDifferenceNeedsClassification = Boolean(
    form.kind === "refund"
      && form.refundSubtype === "payback"
      && selectedRefundRecords.length > 0
      && (selectedRefundHasDifferentCurrency || Number(form.amount) > linkedRefundAmount),
  );
  const refundDifferenceLabel = selectedRefundHasDifferentCurrency ? t("capture.exchangeDifference") : t("capture.excessHandling");
  const supportsRecurrence = form.kind === "expense" || form.kind === "income" || form.kind === "transfer";
  const autoRecordAllowed = canAutoRecordNextCycle(form, accounts);

  const selectSourceAccount = (name: string) => {
    const account = accounts.find((item) => item.name === name);
    setForm((current) => {
      const currentDestination = accounts.find((item) => item.name === current.transferAccount);
      const shouldClearDestination = current.transferMode === "same-currency"
        && Boolean(account && currentDestination && account.currency !== currentDestination.currency);

      return {
        ...current,
        account: name,
        currency: account?.currency ?? current.currency,
        transferAccount: shouldClearDestination ? "" : current.transferAccount,
      };
    });
  };

  const selectDestinationAccount = (name: string) => {
    const account = accounts.find((item) => item.name === name);
    setForm((current) => ({
      ...current,
      transferAccount: name,
      destinationCurrency: account?.currency ?? current.destinationCurrency,
    }));
  };

  const selectFeeAccount = (name: string) => {
    const account = accounts.find((item) => item.name === name);
    setForm((current) => ({ ...current, feeAccount: name, feeCurrency: account?.currency ?? current.feeCurrency }));
  };

  const setTransferMode = (transferMode: DraftForm["transferMode"]) => {
    setForm((current) => {
      const sourceAccount = accounts.find((account) => account.name === current.account);
      const destinationAccount = accounts.find((account) => account.name === current.transferAccount);
      const shouldClearDestination = transferMode === "same-currency"
        && Boolean(sourceAccount && destinationAccount && sourceAccount.currency !== destinationAccount.currency);

      return {
        ...current,
        transferMode,
        transferAccount: shouldClearDestination ? "" : current.transferAccount,
      };
    });
  };

  const beginQuickAccountSetup = (field: QuickAccountField) => {
    setQuickAccountField(field);
    setQuickAccountName("");
    setQuickAccountType("cash");
    setQuickAccountAllowNegative(true);
    setQuickAccountBalance("");
    setQuickAccountBalanceDate(localDate());
    setQuickAccountError("");
  };

  const setRecordKind = (kind: DraftForm["kind"]) => {
    setForm((current) => ({ ...current, kind, category: "" }));
    setIsAddingCategory(false);
  };

  const addQuickCategory = () => {
    const category = quickCategoryName.trim();

    if (!category) {
      setQuickCategoryError(t("settings.categoryNameRequired"));
      return;
    }

    if (categoryOptions.some((item) => item.toLocaleLowerCase() === category.toLocaleLowerCase())) {
      setQuickCategoryError(t("settings.categoryExists"));
      return;
    }

    setCustomCategories((current) => [...current, category]);
    setForm((current) => ({ ...current, category }));
    setQuickCategoryName("");
    setQuickCategoryError("");
    setIsAddingCategory(false);
  };

  const addQuickSource = () => {
    const source = quickSourceName.trim();

    if (!source) {
      setQuickSourceError(t("settings.sourceNameRequired"));
      return;
    }

    if (sourceOptions.some((item) => item.toLocaleLowerCase() === source.toLocaleLowerCase())) {
      setQuickSourceError(t("settings.sourceExists"));
      return;
    }

    setCustomSources((current) => [...current, source]);
    setForm((current) => ({ ...current, counterparty: source }));
    setQuickSourceName("");
    setQuickSourceError("");
    setIsAddingSource(false);
  };

  const applySuggestion = (field: "counterparty" | "itemName" | "amount" | "account" | "category" | "currency", value: string) => {
    if (field === "account") {
      selectSourceAccount(value);
      return;
    }

    updateForm(field, value);
  };

  const setMissingExpenseField = (field: "counterparty" | "itemName", missing: boolean) => {
    setFormError(null);
    setSavedMessage("");
    setForm((current) => ({
      ...current,
      ...missingExpenseFieldPatch(field, missing),
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const nextDraft = createTransactionDraft(form, draftId(), accounts);

    if (!nextDraft) {
      setFormError(t("ledger.fillRequired"));
      return;
    }

    if (refundDifferenceNeedsClassification && form.refundExcessHandling === "unclassified") {
      setFormError(t("ledger.classifyRefundFirst"));
      return;
    }

    const saveReason = onSaveRecord(nextDraft);
    if (saveReason !== null) {
      setFormError(saveReason);
      return;
    }

    const nextCleanForm: DraftForm = {
      ...form,
      counterparty: "",
      counterpartyMissing: false,
      itemName: "",
      itemNameMissing: false,
      transferAccount: "",
      amount: "",
      destinationAmount: "",
      feeEnabled: false,
      feeAccount: "",
      feeAmount: "",
      feeCategory: "",
      refundReason: "",
      refundSubtype: "refund",
      refundLinkedRecordId: "",
      refundLinkedRecordIds: [],
      refundExcessHandling: "unclassified",
      recurrenceChoice: "current-cycle-only",
      recurrenceAmountMode: "fixed",
      reason: "",
      periodStart: "",
      periodEnd: "",
    };
    setSavedMessage(t("ledger.savedMessage"));
    setForm(nextCleanForm);
    setCleanForm(nextCleanForm);
    if (draftToEdit) {
      onDiscardDraft(draftToEdit.id);
      onFinishDraftEdit();
    }
    setShowCancelChoices(false);
  };

  const resetEntry = () => {
    const nextForm = createEmptyDraftForm();
    setForm(nextForm);
    setCleanForm(nextForm);
    setFormError(null);
    setSavedMessage(t("ledger.cancelledMessage"));
    setShowCancelChoices(false);
  };

  const keepEntryAsDraft = () => {
    onSaveDraft({ ...normalizeDraftForm(form), id: draftId() });
    resetEntry();
  };

  const addQuickAccount = () => {
    if (!quickAccountField) {
      return;
    }

    const account = createLocalAccount(quickAccountName, quickAccountCurrency, crypto.randomUUID(), quickAccountType, quickAccountAllowNegative);

    if (!account) {
      setQuickAccountError(t("capture.quickAccountNameRequired"));
      return;
    }

    if (accounts.some((item) => item.name.toLocaleLowerCase() === account.name.toLocaleLowerCase())) {
      setQuickAccountError(t("capture.quickAccountDuplicate"));
      return;
    }

    const initialBalance = quickAccountBalance.trim();
    const initialBalanceAmount = Number(initialBalance);
    if (initialBalance && (!Number.isFinite(initialBalanceAmount) || initialBalanceAmount < 0)) {
      setQuickAccountError(t("capture.quickAccountBalanceInvalid"));
      return;
    }

    if (hasPositiveInitialBalance(initialBalance)) {
      const draft = createInitialFundingDraft({
        account: account.name,
        amount: initialBalance,
        currency: account.currency,
        date: quickAccountBalanceDate,
      }, `fund-${account.id}`);

      if (!draft || !onSaveInitialFunding(account, draft)) {
        setQuickAccountError(t("capture.quickAccountFundingInvalid"));
        return;
      }
    }

    onAddAccount(account);
    if (quickAccountField === "account") {
      setForm((current) => ({ ...current, account: account.name, currency: account.currency }));
    } else if (quickAccountField === "transferAccount") {
      setForm((current) => ({ ...current, transferAccount: account.name, destinationCurrency: account.currency }));
    } else {
      setForm((current) => ({ ...current, feeAccount: account.name, feeCurrency: account.currency }));
    }
    setQuickAccountField(null);
    setQuickAccountName("");
    setQuickAccountType("cash");
    setQuickAccountAllowNegative(true);
    setQuickAccountBalance("");
    setQuickAccountBalanceDate(localDate());
    setQuickAccountError("");
  };

  const setTimePrecision = (timePrecision: DraftForm["timePrecision"]) => {
    setForm((current) => ({
      ...current,
      timePrecision,
      date: timePrecision === "day" ? current.date : "",
      periodStart: timePrecision === "day" ? "" : current.periodStart,
      periodEnd: timePrecision === "day" ? "" : current.periodEnd,
    }));
  };

  const setMonthRange = (month: string) => {
    const range = monthToPeriodRange(month);
    if (!range) {
      setForm((current) => ({ ...current, periodStart: "", periodEnd: "" }));
      return;
    }

    setForm((current) => ({
      ...current,
      ...range,
    }));
  };

  const quickAccountProps: React.ComponentProps<typeof QuickAccountSetup> = {
    accountName: quickAccountName,
    currency: quickAccountCurrency,
    accountType: quickAccountType,
    allowNegativeBalance: quickAccountAllowNegative,
    initialBalance: quickAccountBalance,
    initialBalanceDate: quickAccountBalanceDate,
    error: quickAccountError,
    onAccountNameChange: (value) => { setQuickAccountName(value); setQuickAccountError(""); },
    onCurrencyChange: setQuickAccountCurrency,
    onAccountTypeChange: setQuickAccountType,
    onAllowNegativeBalanceChange: setQuickAccountAllowNegative,
    onInitialBalanceChange: (value) => { setQuickAccountBalance(value); setQuickAccountError(""); },
    onInitialBalanceDateChange: (value) => { setQuickAccountBalanceDate(value); setQuickAccountError(""); },
    onConfirm: addQuickAccount,
    onCancel: () => { setQuickAccountField(null); setQuickAccountBalance(""); setQuickAccountBalanceDate(localDate()); setQuickAccountError(""); },
  };

  const manualLedgerProps: ManualLedgerFormProps = {
    form,
    accounts,
    hasSelectedAccount,
    isUnresolvedExpense,
    isTransfer,
    needsCategory,
    categoryOptions,
    needsCounterparty,
    counterpartyLabel,
    sourceOptions,
    refundableRecords,
    selectedRefundIds,
    selectedRefundHasDifferentCurrency,
    refundDifferenceNeedsClassification,
    refundDifferenceLabel,
    merchantSuggestions,
    itemSuggestions,
    supportsRecurrence,
    autoRecordAllowed,
    hasUnsavedChanges,
    showCancelChoices,
    formError,
    savedMessage,
    quickAccountField,
    quickAccountProps,
    isAddingCategory,
    quickCategoryName,
    quickCategoryError,
    isAddingSource,
    quickSourceName,
    quickSourceError,
    setForm,
    setFormError,
    setSavedMessage,
    updateForm,
    handleSubmit,
    beginQuickAccountSetup,
    setTimePrecision,
    setMonthRange,
    selectSourceAccount,
    selectDestinationAccount,
    selectFeeAccount,
    setTransferMode,
    setRecordKind,
    setMissingExpenseField,
    applySuggestion,
    setIsAddingCategory,
    setQuickCategoryName,
    setQuickCategoryError,
    addQuickCategory,
    setIsAddingSource,
    setQuickSourceName,
    setQuickSourceError,
    addQuickSource,
    resetEntry,
    keepEntryAsDraft,
    setShowCancelChoices,
  };

  return (
    <section className="capture-layout">
      <CaptureStartPanel
        captureIntent={captureIntent}
        selectedCaptureAction={selectedCaptureAction}
        actionIcons={actionIcons}
        onSelectIntent={setCaptureIntent}
      />
      <CaptureIntentPanel
        captureIntent={captureIntent}
        manualLedgerProps={manualLedgerProps}
        mealProps={{
          mealOccurredAt,
          mealNote,
          mealPhotoFiles,
          mealError,
          mealSavedMessage,
          isCameraOpen,
          cameraError,
          cameraVideoRef,
          uploadQueue,
          onMealTimeChange: (value) => { setMealOccurredAt(value); setMealError(""); },
          onMealNoteChange: setMealNote,
          onAppendPhotos: appendMealPhotos,
          onOpenCamera: openCamera,
          onCapturePhoto: captureCameraPhoto,
          onStopCamera: stopCamera,
          onSubmit: handleMealSubmit,
        }}
        scanProps={{
          captureIntent: captureIntent === "scan-invoice" || captureIntent === "scan-receipt" ? captureIntent : "scan-receipt",
          scanFiles,
          scanError,
          scanSavedMessage,
          scans,
          uploadQueue,
          mediaPreviewUrls,
          onScanFilesChange: (files) => { setScanFiles(files); setScanError(""); },
          onSubmit: handleScanSubmit,
           onUpdateScan,
           onClearUploads,
         }}
        attachmentProps={{
          attachmentFiles,
          attachmentError,
          attachmentSavedMessage,
          uploadQueue,
           onFilesChange: (files) => { setAttachmentFiles(files); setAttachmentError(""); setAttachmentSavedMessage(""); },
           onSubmit: handleAttachmentSubmit,
           onClearUploads,
         }}
        aiProps={{
          accounts,
          categories: aiCategories,
          entityPolicy: aiEntityPolicy,
          onResolveNewEntities: resolveNewEntities,
          onSaveRecord,
          onSaveDraft,
          onApplyToForm: (suggestion) => {
            const form = buildPrefillForm(suggestion.input, accounts, aiCategories, localDate());
            setForm(form);
            setCleanForm(form);
            setFormError(null);
            setSavedMessage("");
            setCaptureIntent("manual-ledger");
          },
        }}
       />
      {captureIntent === "manual-ledger" ? <SavedRecordPanel recordCount={records.length} navigate={navigate} /> : null}
    </section>
  );
}

type CaptureIntentPanelProps = {
  captureIntent: CaptureIntent;
  manualLedgerProps: React.ComponentProps<typeof ManualLedgerPanel>;
  mealProps: React.ComponentProps<typeof MealCapturePanel>;
  scanProps: React.ComponentProps<typeof ScanCapturePanel>;
  attachmentProps: React.ComponentProps<typeof AttachmentCapturePanel>;
  aiProps: React.ComponentProps<typeof AiLedgerPanel>;
};

function CaptureIntentPanel({ captureIntent, manualLedgerProps, mealProps, scanProps, attachmentProps, aiProps }: Readonly<CaptureIntentPanelProps>) {
  if (captureIntent === "manual-ledger") {
    return <ManualLedgerPanel {...manualLedgerProps} />;
  }
  if (captureIntent === "ai-ledger") {
    return <AiLedgerPanel {...aiProps} />;
  }
  if (captureIntent === "record-meal") {
    return <MealCapturePanel {...mealProps} />;
  }
  if (captureIntent === "scan-invoice" || captureIntent === "scan-receipt") {
    return <ScanCapturePanel {...scanProps} />;
  }
  return <AttachmentCapturePanel {...attachmentProps} />;
}

function MealCaptureForm({
  mealOccurredAt,
  mealNote,
  mealPhotoFiles,
  mealError,
  mealSavedMessage,
  isCameraOpen,
  cameraError,
  cameraVideoRef,
  uploadQueue,
  onMealTimeChange,
  onMealNoteChange,
  onAppendPhotos,
  onOpenCamera,
  onCapturePhoto,
  onStopCamera,
  onSubmit,
}: Readonly<{
  mealOccurredAt: string;
  mealNote: string;
  mealPhotoFiles: File[];
  mealError: string;
  mealSavedMessage: string;
  isCameraOpen: boolean;
  cameraError: string;
  cameraVideoRef: React.RefObject<HTMLVideoElement>;
  uploadQueue: UploadQueueItem[];
  onMealTimeChange: (value: string) => void;
  onMealNoteChange: (value: string) => void;
   onAppendPhotos: (files: PhotoInput) => void;
  onOpenCamera: () => Promise<void>;
  onCapturePhoto: () => void;
  onStopCamera: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  const { t } = useI18n();
  return (
    <form className="meal-form" onSubmit={onSubmit}>
      <label>
        <span>{t("meal.time")}</span>
        <input required type="datetime-local" value={mealOccurredAt} onChange={(event) => onMealTimeChange(event.target.value)} />
      </label>
      <label>
        <span>{t("meal.note")}</span>
        <textarea value={mealNote} onChange={(event) => onMealNoteChange(event.target.value)} placeholder={t("meal.optionalPlaceholder")} />
      </label>
      <MealPhotoPicker onOpenCamera={onOpenCamera} onAppendPhotos={onAppendPhotos} />
      {isCameraOpen ? <MealCameraDialog cameraVideoRef={cameraVideoRef} onCapturePhoto={onCapturePhoto} onStopCamera={onStopCamera} /> : null}
      {cameraError ? <p className="quick-account-error" role="alert">{cameraError}</p> : null}
      {mealPhotoFiles.length > 0 ? <p className="field-help">{t("meal.photosReady", { count: mealPhotoFiles.length })}</p> : null}
      <button className="primary-action align-start" type="submit">{t("meal.save")}</button>
      {mealError ? <p className="quick-account-error" role="alert">{mealError}</p> : null}
      {mealSavedMessage ? <p className="auth-message" aria-live="polite">{mealSavedMessage}</p> : null}
      {uploadQueue.length > 0 ? <p className="field-help">{t("meal.queueCount", { count: uploadQueue.length })}</p> : null}
    </form>
  );
}

function MealPhotoPicker({ onOpenCamera, onAppendPhotos }: Readonly<{ onOpenCamera: () => Promise<void>; onAppendPhotos: (files: PhotoInput) => void }>) {
  const { t } = useI18n();
  return (
    <div className="meal-photo-picker">
      <span className="meal-field-label">{t("meal.photos")}</span>
      <div className="meal-photo-actions">
        <button className="meal-file-action" type="button" onClick={() => { onOpenCamera().catch(() => undefined); }}><Camera size={18} aria-hidden="true" /><span>{t("meal.takePhoto")}</span></button>
        <label className="meal-file-action" htmlFor="meal-photos"><ImagePlus size={18} aria-hidden="true" /><span>{t("meal.choosePhoto")}</span><input id="meal-photos" aria-label={t("meal.photos")} accept="image/*" multiple type="file" onChange={(event) => onAppendPhotos(event.target.files)} /></label>
      </div>
    </div>
  );
}

function MealCameraDialog({ cameraVideoRef, onCapturePhoto, onStopCamera }: Readonly<{ cameraVideoRef: React.RefObject<HTMLVideoElement>; onCapturePhoto: () => void; onStopCamera: () => void }>) {
  const { t } = useI18n();
  return (
    <dialog className="camera-capture-dialog" aria-label={t("meal.dialogTitle")} open>
      <video className="camera-preview" ref={cameraVideoRef} autoPlay playsInline muted aria-label={t("meal.cameraAria")} />
      <div className="camera-capture-actions"><button className="primary-action" type="button" onClick={onCapturePhoto}>{t("meal.takePhoto")}</button><button className="secondary-action" type="button" onClick={onStopCamera}>{t("common.cancel")}</button></div>
    </dialog>
  );
}

function MealCapturePanel(props: Readonly<React.ComponentProps<typeof MealCaptureForm>>) {
  const { t } = useI18n();
  return (
    <Panel key="record-meal" title={t("meal.panelTitle")} eyebrow={t("meal.panelEyebrow")}>
      <p className="panel-copy">{t("meal.panelCopy")}</p>
      <MealCaptureForm {...props} />
    </Panel>
  );
}

function TransferFields({
  form,
  accounts,
  quickAccountField,
  quickAccountProps,
  onBeginQuickAccountSetup,
  onSelectDestinationAccount,
  onSetTransferMode,
}: Readonly<{
  form: DraftForm;
  accounts: LocalAccount[];
  quickAccountField: QuickAccountField | null;
  quickAccountProps: React.ComponentProps<typeof QuickAccountSetup>;
  onBeginQuickAccountSetup: (field: QuickAccountField) => void;
  onSelectDestinationAccount: (name: string) => void;
  onSetTransferMode: (mode: DraftForm["transferMode"]) => void;
}>) {
  return (
    <>
      <TransferModeField transferMode={form.transferMode} onSetTransferMode={onSetTransferMode} />
      <TransferDestinationField form={form} accounts={accounts} quickAccountField={quickAccountField} quickAccountProps={quickAccountProps} onBeginQuickAccountSetup={onBeginQuickAccountSetup} onSelectDestinationAccount={onSelectDestinationAccount} />
    </>
  );
}

function TransferModeField({ transferMode, onSetTransferMode }: Readonly<{ transferMode: DraftForm["transferMode"]; onSetTransferMode: (mode: DraftForm["transferMode"]) => void }>) {
  const { t } = useI18n();
  return <section className="transfer-mode full-span" aria-label={t("capture.transferTypeAria")}><fieldset className="segmented-fieldset"><legend>{t("capture.transferTypeLegend")}</legend><div className="segmented-control">{(["same-currency", "cross-currency"] as const).map((mode) => <label className={transferMode === mode ? "active" : ""} key={mode}><input checked={transferMode === mode} name="transfer-mode" type="radio" value={mode} onChange={() => onSetTransferMode(mode)} /><span>{mode === "same-currency" ? t("capture.sameCurrency") : t("capture.crossCurrency")}</span></label>)}</div></fieldset></section>;
}

function TransferDestinationField({ form, accounts, quickAccountField, quickAccountProps, onBeginQuickAccountSetup, onSelectDestinationAccount }: Readonly<{ form: DraftForm; accounts: LocalAccount[]; quickAccountField: QuickAccountField | null; quickAccountProps: React.ComponentProps<typeof QuickAccountSetup>; onBeginQuickAccountSetup: (field: QuickAccountField) => void; onSelectDestinationAccount: (name: string) => void }>) {
  const { t } = useI18n();
  return <div className="form-field"><label htmlFor="entry-destination-account"><span>{t("capture.destinationAccount")}</span></label><div className="field-control-row"><select id="entry-destination-account" required disabled={accounts.length < 2} value={form.transferAccount} onChange={(event) => onSelectDestinationAccount(event.target.value)}><option value="">{accounts.length < 2 ? t("capture.addAnotherAccount") : t("capture.selectDestinationAccount")}</option>{accounts.filter((account) => account.name !== form.account && (form.transferMode !== "same-currency" || account.currency === form.currency)).map((account) => <option key={account.id} value={account.name}>{account.name} ({account.currency})</option>)}</select><button className="icon-button" type="button" aria-label={t("capture.addDestinationAccount")} title={t("capture.addDestinationAccount")} onClick={() => onBeginQuickAccountSetup("transferAccount")}><Plus size={18} aria-hidden="true" /></button></div>{accounts.length < 2 ? <p className="field-help">{t("capture.transferNeedsTwo")}</p> : null}{quickAccountField === "transferAccount" ? <QuickAccountSetup {...quickAccountProps} /> : null}</div>;
}

function FeeFields({
  form,
  accounts,
  quickAccountField,
  quickAccountProps,
  onBeginQuickAccountSetup,
  onSelectFeeAccount,
  onUpdateForm,
}: Readonly<{
  form: DraftForm;
  accounts: LocalAccount[];
  quickAccountField: QuickAccountField | null;
  quickAccountProps: React.ComponentProps<typeof QuickAccountSetup>;
  onBeginQuickAccountSetup: (field: QuickAccountField) => void;
  onSelectFeeAccount: (name: string) => void;
  onUpdateForm: (field: keyof DraftForm, value: string) => void;
}>) {
  const { t } = useI18n();
  return (
    <>
      <FeeAccountField form={form} accounts={accounts} quickAccountField={quickAccountField} quickAccountProps={quickAccountProps} onBeginQuickAccountSetup={onBeginQuickAccountSetup} onSelectFeeAccount={onSelectFeeAccount} />
      <AmountField id="entry-fee-amount" label={t("field.feeAmount")} value={form.feeAmount} onChange={(value) => onUpdateForm("feeAmount", value)} />
      <div className="form-field"><span>{t("field.feeCurrency")}</span><output className="derived-value">{form.feeCurrency}</output></div>
      <label><span>{t("field.feeCategory")}</span><input value={form.feeCategory} onChange={(event) => onUpdateForm("feeCategory", event.target.value)} placeholder={t("capture.merchantPlaceholder")} /></label>
    </>
  );
}

function FeeAccountField({ form, accounts, quickAccountField, quickAccountProps, onBeginQuickAccountSetup, onSelectFeeAccount }: Readonly<{ form: DraftForm; accounts: LocalAccount[]; quickAccountField: QuickAccountField | null; quickAccountProps: React.ComponentProps<typeof QuickAccountSetup>; onBeginQuickAccountSetup: (field: QuickAccountField) => void; onSelectFeeAccount: (name: string) => void }>) {
  const { t } = useI18n();
  return <div className="form-field"><label htmlFor="entry-fee-account"><span>{t("field.feeAccount")}</span></label><div className="field-control-row"><select id="entry-fee-account" value={form.feeAccount} onChange={(event) => onSelectFeeAccount(event.target.value)}><option value="">{t("capture.selectFeeAccount")}</option>{accounts.map((account) => <option key={account.id} value={account.name}>{account.name} ({account.currency})</option>)}</select><button className="icon-button" type="button" aria-label={t("capture.addFeeAccount")} title={t("capture.addFeeAccount")} onClick={() => onBeginQuickAccountSetup("feeAccount")}><Plus size={18} aria-hidden="true" /></button></div>{quickAccountField === "feeAccount" ? <QuickAccountSetup {...quickAccountProps} /> : null}</div>;
}

function ScanCapturePanel({
  captureIntent,
  scanFiles,
  scanError,
  scanSavedMessage,
  scans,
  uploadQueue,
  mediaPreviewUrls,
  onScanFilesChange,
  onSubmit,
  onUpdateScan,
  onClearUploads,
}: Readonly<{
  captureIntent: "scan-invoice" | "scan-receipt";
  scanFiles: File[];
  scanError: string;
  scanSavedMessage: string;
  scans: TemporaryScan[];
  uploadQueue: UploadQueueItem[];
  mediaPreviewUrls: Record<string, string>;
  onScanFilesChange: (files: File[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateScan: (scan: TemporaryScan) => void;
  onClearUploads: (ids: string[]) => void;
}>) {
  const scanKind = captureIntent === "scan-invoice" ? "invoice-scan" : "receipt-scan";
  const scanQueue = uploadQueue.filter((item) => item.kind === scanKind);
  const queuedScanCount = scanQueue.filter((item) => item.status !== "uploaded" && item.bytesStatus !== "metadata-only").length;
  const unavailableScanCount = scanQueue.filter((item) => item.status !== "uploaded" && item.bytesStatus === "metadata-only").length;

  const removeScan = (scan: TemporaryScan) => {
    onUpdateScan(discardTemporaryScan(scan));
    const media = scanQueue.find((item) => item.id === scan.id);
    if (media && media.status !== "uploaded") onClearUploads([media.id]);
  };

  const { t } = useI18n();
  return (
    <Panel key={captureIntent} title={captureIntentLabel(captureIntent)} eyebrow={t("scan.temporarySource")}>
      <p className="panel-copy">{t("scan.panelCopy")}</p>
      <form className="meal-form" onSubmit={onSubmit}>
        <label>
          <span>{t("scan.images")}</span>
          <input accept="image/*" multiple type="file" onChange={(event) => onScanFilesChange(Array.from(event.target.files ?? []))} />
        </label>
        {scanFiles.length > 0 ? <p className="field-help">{t("scan.selectedCount", { count: scanFiles.length })}</p> : null}
        <div className="capture-actions">
          <button className="primary-action" type="submit" disabled={scanFiles.length === 0}>{t("scan.keepDraft")}</button>
          {scanFiles.length > 0 ? <button className="quiet-action" type="button" onClick={(event) => { event.currentTarget.form?.reset(); onScanFilesChange([]); }}>{t("scan.clearSelected")}</button> : null}
        </div>
        {scanError ? <p className="quick-account-error" role="alert">{scanError}</p> : null}
        {scanSavedMessage ? <p className="auth-message" aria-live="polite">{scanSavedMessage}</p> : null}
        {queuedScanCount > 0 ? <p className="field-help">{t("scan.queueCount", { count: queuedScanCount })}</p> : null}
        {unavailableScanCount > 0 ? <p className="field-help">{t("scan.needsReselect", { count: unavailableScanCount })}</p> : null}
      </form>
      <div className="source-list" aria-label={t("scan.tempListAria")}>
        {scans.filter((scan) => scan.intent === captureIntent && ["temporary", "retained"].includes(scan.state)).map((scan) => {
          const media = scanQueue.find((item) => item.id === scan.id);
          const previewUrl = mediaPreviewUrls[scan.id];
          const storageStatus = scanStorageStatus(media);

          return (
            <article className="source-list-row" key={scan.id}>
              <div className="source-preview-frame">
                {previewUrl
                  ? <img src={previewUrl} alt={t("scan.previewAlt", { name: scan.fileName })} />
                  : <span>{t("scan.noPreview")}</span>}
              </div>
              <div className="source-list-copy">
                <strong>{scan.fileName}</strong>
                <small>{scan.state === "temporary" ? t("scan.tempStatus") : t("scan.retainedStatus")}</small>
                <small>{storageStatus}</small>
              </div>
              {scan.state === "temporary" ? (
                <div className="source-list-actions">
                  <button className="quiet-action" type="button" onClick={() => onUpdateScan(retainTemporaryScan(scan))}>{t("scan.keepSource")}</button>
                  <button className="quiet-action" type="button" onClick={() => removeScan(scan)}>{t("scan.discard")}</button>
                </div>
              ) : <button className="quiet-action source-remove-action" type="button" onClick={() => removeScan(scan)}>{t("scan.removeSource")}</button>}
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function scanStorageStatus(media?: UploadQueueItem): string {
  if (media?.status === "uploaded") return t("scan.uploadedCloud");
  if (!media || media.bytesStatus === "metadata-only") return t("scan.reselectOriginal");
  return t("scan.storedOnDevice");
}

type AttachmentQueueSummary = {
  synced: number;
  metadataPending: number;
  failed: number;
  needsReselect: number;
  local: number;
  pendingIds: string[];
};

function summarizeAttachmentQueue(queue: UploadQueueItem[]): AttachmentQueueSummary {
  const summary: AttachmentQueueSummary = {
    synced: 0,
    metadataPending: 0,
    failed: 0,
    needsReselect: 0,
    local: 0,
    pendingIds: [],
  };
  for (const item of queue) {
    if (item.status !== "uploaded") summary.pendingIds.push(item.id);
    if (item.status === "uploaded" && item.metadataStatus === "synced") summary.synced += 1;
    else if (item.status === "uploaded") summary.metadataPending += 1;
    else if (item.status === "failed") summary.failed += 1;
    else if (item.bytesStatus === "metadata-only") summary.needsReselect += 1;
    else summary.local += 1;
  }
  return summary;
}

function AttachmentUploadSummary({ queue, onClearUploads }: Readonly<{
  queue: UploadQueueItem[];
  onClearUploads: (ids: string[]) => void;
}>) {
  const { t } = useI18n();
  if (queue.length === 0) return null;
  const summary = summarizeAttachmentQueue(queue);
  return (
    <div className="field-help upload-queue-summary" aria-live="polite">
      {summary.synced > 0 ? <p>{t("attach.synced", { count: summary.synced })}</p> : null}
      {summary.metadataPending > 0 ? <p>{t("attach.metadataPending", { count: summary.metadataPending })}</p> : null}
      {summary.failed > 0 ? <p>{t("attach.failed", { count: summary.failed })}</p> : null}
      {summary.needsReselect > 0 ? <p>{t("attach.needsReselect", { count: summary.needsReselect })}</p> : null}
      {summary.local > 0 ? <p>{t("attach.local", { count: summary.local })}</p> : null}
      {summary.pendingIds.length > 0 ? <button className="quiet-action" type="button" onClick={() => onClearUploads(summary.pendingIds)}>{t("attach.clearPending")}</button> : null}
    </div>
  );
}

function AttachmentCapturePanel({ attachmentFiles, attachmentError, attachmentSavedMessage, uploadQueue, onFilesChange, onSubmit, onClearUploads }: Readonly<{
  attachmentFiles: File[];
  attachmentError: string;
  attachmentSavedMessage: string;
  uploadQueue: UploadQueueItem[];
  onFilesChange: (files: File[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClearUploads: (ids: string[]) => void;
}>) {
  const attachmentQueue = uploadQueue.filter((item) => item.kind === "attachment");

  const { t } = useI18n();
  return (
    <Panel key="attach-photo" title={t("attach.panelTitle")} eyebrow={t("attach.eyebrow")}>
      <p className="panel-copy">{t("attach.panelCopy")}</p>
      <form className="meal-form" onSubmit={onSubmit}>
        <label>
          <span>{t("attach.photoLabel")}</span>
          <input aria-label={t("attach.photoAria")} accept="image/*" multiple type="file" onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))} />
        </label>
        {attachmentFiles.length > 0 ? <p className="field-help">{t("attach.ready", { count: attachmentFiles.length })}</p> : null}
        <div className="capture-actions">
          <button className="primary-action" type="submit" disabled={attachmentFiles.length === 0}>{t("attach.keep")}</button>
          {attachmentFiles.length > 0 ? <button className="quiet-action" type="button" onClick={() => onFilesChange([])}>{t("attach.clearSelected")}</button> : null}
        </div>
        {attachmentError ? <p className="quick-account-error" role="alert">{attachmentError}</p> : null}
        {attachmentSavedMessage ? <p className="auth-message" aria-live="polite">{attachmentSavedMessage}</p> : null}
        <AttachmentUploadSummary queue={attachmentQueue} onClearUploads={onClearUploads} />
      </form>
    </Panel>
  );
}

function SavedRecordPanel({ recordCount, navigate }: Readonly<{ recordCount: number; navigate: (item: NavItem) => void }>) {
  const { t } = useI18n();
  if (recordCount === 0) return null;
  return (
    <Panel title={t("capture.savedRecordsPanel")} eyebrow={t("capture.savedRecordsEyebrow")}>
      <p className="panel-copy">{t("capture.savedRecordsCopy", { count: recordCount })}</p>
      <button className="secondary-action align-start" type="button" onClick={() => navigate(navItemFor("ledger"))}>
        {t("capture.openLedger")}
      </button>
    </Panel>
  );
}

type AccountSetupPanelProps = {
  accounts: LocalAccount[];
  accountName: string;
  accountCurrency: string;
  accountType: string;
  allowNegativeBalance: boolean;
  balanceMode: "zero" | "current";
  balance: string;
  balanceDate: string;
  accountError: string;
  onAccountNameChange: (value: string) => void;
  onAccountCurrencyChange: (value: string) => void;
  onAccountTypeChange: (value: string) => void;
  onAllowNegativeBalanceChange: (value: boolean) => void;
  onBalanceModeChange: (value: "zero" | "current") => void;
  onBalanceChange: (value: string) => void;
  onBalanceDateChange: (value: string) => void;
  onReopenOnboarding: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

type AccountSetupFormProps = Omit<AccountSetupPanelProps, "accounts" | "onReopenOnboarding">;

function AccountSetupForm({
  accountName, accountCurrency, accountType, allowNegativeBalance, balanceMode, balance, balanceDate, accountError,
  onAccountNameChange, onAccountCurrencyChange, onAccountTypeChange, onAllowNegativeBalanceChange, onBalanceModeChange,
  onBalanceChange, onBalanceDateChange, onSubmit,
}: Readonly<AccountSetupFormProps>) {
  const { t } = useI18n();
  return (
    <form className="draft-form account-setup-form" noValidate onSubmit={onSubmit}>
      <label><span>{t("field.accountName")}</span><input required pattern=".*\S.*" value={accountName} onChange={(event) => onAccountNameChange(event.target.value)} placeholder={t("capture.dailyWalletPlaceholder")} /></label>
      <label><span>{t("field.currency")}</span><select value={accountCurrency} onChange={(event) => onAccountCurrencyChange(event.target.value)}><option value="TWD">TWD</option><option value="JPY">JPY</option><option value="USD">USD</option></select></label>
      <label><span>{t("field.accountType")}</span><select value={accountType} onChange={(event) => onAccountTypeChange(event.target.value)}><option value="cash">{t("field.accountTypeCash")}</option><option value="bank">{t("field.accountTypeBank")}</option><option value="card">{t("field.accountTypeCard")}</option><option value="wallet">{t("field.accountTypeWallet")}</option><option value="other">{t("field.accountTypeOther")}</option></select></label>
      <label className="checkbox-row"><input type="checkbox" checked={allowNegativeBalance} onChange={(event) => onAllowNegativeBalanceChange(event.target.checked)} /><span>{t("capture.allowNegativeBalance")}</span></label>
      <fieldset className="starting-balance-fieldset">
        <legend>{t("field.initialBalance")}</legend>
        <label className="radio-row"><input type="radio" checked={balanceMode === "zero"} onChange={() => onBalanceModeChange("zero")} /> <span>{t("capture.startFromZero")}</span></label>
        <label className="radio-row"><input type="radio" checked={balanceMode === "current"} onChange={() => onBalanceModeChange("current")} /> <span>{t("capture.enterCurrentBalance")}</span></label>
      </fieldset>
      {balanceMode === "current" ? <div className="onboarding-balance-fields"><AmountField id="settings-current-balance" label={t("field.currentBalance")} required value={balance} onChange={onBalanceChange} placeholder={t("capture.balancePlaceholder")} /><label><span>{t("field.asOfDate")}</span><input required type="date" value={balanceDate} onChange={(event) => onBalanceDateChange(event.target.value)} /></label></div> : null}
      <button className="primary-action align-start" type="submit">{t("settings.addAccount")}</button>
      {accountError ? <p className="quick-account-error" role="alert">{accountError}</p> : null}
    </form>
  );
}

function AccountSetupPanel({
  accounts, accountName, accountCurrency, accountType, allowNegativeBalance, balanceMode, balance, balanceDate, accountError,
  onAccountNameChange, onAccountCurrencyChange, onAccountTypeChange, onAllowNegativeBalanceChange, onBalanceModeChange,
  onBalanceChange, onBalanceDateChange, onReopenOnboarding, onSubmit,
}: Readonly<AccountSetupPanelProps>) {
  const { t } = useI18n();
  return (
    <Panel title={t("settings.accountPanelTitle")} eyebrow={t("settings.accountPanelEyebrow")}>
      <p className="panel-copy">{t("settings.accountPanelCopy")}</p>
      <div className="account-setup-actions">
        <button className="secondary-action align-start" type="button" onClick={onReopenOnboarding}>{t("settings.openOnboarding")}</button>
      </div>
      <AccountSetupForm
        accountName={accountName}
        accountCurrency={accountCurrency}
        accountType={accountType}
        allowNegativeBalance={allowNegativeBalance}
        balanceMode={balanceMode}
        balance={balance}
        balanceDate={balanceDate}
        accountError={accountError}
        onAccountNameChange={onAccountNameChange}
        onAccountCurrencyChange={onAccountCurrencyChange}
        onAccountTypeChange={onAccountTypeChange}
        onAllowNegativeBalanceChange={onAllowNegativeBalanceChange}
        onBalanceModeChange={onBalanceModeChange}
        onBalanceChange={onBalanceChange}
        onBalanceDateChange={onBalanceDateChange}
        onSubmit={onSubmit}
      />
      {accounts.length === 0 ? <p className="panel-copy">{t("settings.noAccountsYet")}</p> : null}
      {accounts.length > 0 ? <ul className="account-list" aria-label={t("settings.availableAccountsAria")}>{accounts.map((account) => <li key={account.id}><strong>{account.name}</strong><span>{account.currency}</span></li>)}</ul> : null}
    </Panel>
  );
}

function LedgerAccountsPanel({ accounts, onAddAccount, onSaveInitialFunding, onReopenOnboarding }: Readonly<{
  accounts: LocalAccount[];
  onAddAccount: (account: LocalAccount) => void;
  onSaveInitialFunding: (account: LocalAccount, draft: TransactionDraft) => boolean;
  onReopenOnboarding: () => void;
}>) {
  const [accountName, setAccountName] = useState("");
  const [accountCurrency, setAccountCurrency] = useState("TWD");
  const [accountType, setAccountType] = useState("cash");
  const [allowNegativeBalance, setAllowNegativeBalance] = useState(false);
  const [balanceMode, setBalanceMode] = useState<"zero" | "current">("zero");
  const [balance, setBalance] = useState("");
  const [balanceDate, setBalanceDate] = useState(localDate());
  const [accountError, setAccountError] = useState("");
  const handleAccountSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccountError("");
    const account = createLocalAccount(accountName, accountCurrency, draftId(), accountType, allowNegativeBalance);

    if (!account || accounts.some((item) => item.name.toLocaleLowerCase() === account.name.toLocaleLowerCase())) {
      setAccountError(account ? t("capture.quickAccountDuplicate") : t("capture.quickAccountNameCurrencyRequired"));
      return;
    }

    if (balanceMode === "current") {
      const draft = createInitialFundingDraft({ account: account.name, amount: balance, currency: account.currency, date: balanceDate }, `fund-${account.id}`);
      if (!draft || !onSaveInitialFunding(account, draft)) {
        setAccountError(t("settings.currentBalanceInvalid"));
        return;
      }
    }

    onAddAccount(account);
    setAccountName("");
    setBalance("");
    setBalanceMode("zero");
  };

  return (
    <AccountSetupPanel
      accounts={accounts}
      accountName={accountName}
      accountCurrency={accountCurrency}
      accountType={accountType}
      allowNegativeBalance={allowNegativeBalance}
      balanceMode={balanceMode}
      balance={balance}
      balanceDate={balanceDate}
      accountError={accountError}
      onAccountNameChange={setAccountName}
      onAccountCurrencyChange={setAccountCurrency}
      onAccountTypeChange={setAccountType}
      onAllowNegativeBalanceChange={setAllowNegativeBalance}
      onBalanceModeChange={setBalanceMode}
      onBalanceChange={setBalance}
      onBalanceDateChange={setBalanceDate}
      onReopenOnboarding={onReopenOnboarding}
      onSubmit={handleAccountSubmit}
    />
  );
}

type SettingsSection = "login" | "portability" | "categories" | "preferences";

type SettingsPageProps = AccountPageProps & {
  accounts: LocalAccount[];
  records: LocalLedgerRecord[];
  entityPolicy: AiEntityPolicy;
  onEntityPolicyChange: (policy: AiEntityPolicy) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  deleteAction: DeleteAction;
  onDeleteActionChange: (action: DeleteAction) => void;
  negativeBalancePolicy: NegativeBalancePolicy;
  onNegativeBalancePolicyChange: (policy: NegativeBalancePolicy) => void;
  customCategories: string[];
  setCustomCategories: Dispatch<SetStateAction<string[]>>;
  onAddAccount: (account: LocalAccount) => void;
  onSaveInitialFunding: (account: LocalAccount, draft: TransactionDraft) => boolean;
  onReopenOnboarding: () => void;
  onImportRecord: (row: NormalizedImportRow, importId: string) => boolean;
  onMergeImportDraft: (row: NormalizedImportRow, importId: string) => boolean;
};

function SettingsPage({
  accounts,
  records,
  entityPolicy,
  onEntityPolicyChange,
  themeMode,
  onThemeModeChange,
  deleteAction,
  onDeleteActionChange,
  negativeBalancePolicy,
  onNegativeBalancePolicyChange,
  customCategories,
  setCustomCategories,
  onAddAccount,
  onSaveInitialFunding,
  onReopenOnboarding,
  onImportRecord,
  onMergeImportDraft,
  ...accountProps
}: Readonly<SettingsPageProps>) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>("login");

  const renderSection = () => {
    if (section === "login") {
      return <AccountPage {...accountProps} />;
    }
    if (section === "portability") {
      return <ImportExportPanel accounts={accounts} records={records} onImportRecord={onImportRecord} onMergeImportDraft={onMergeImportDraft} />;
    }
    if (section === "categories") {
      return (
        <CategoriesPanel
          records={records}
          customCategories={customCategories}
          setCustomCategories={setCustomCategories}
        />
      );
    }
    return (
      <div className="route-stack">
        <section className="settings-preferences-block" aria-labelledby="preferences-accounts-title">
          <p className="eyebrow">{t("settings.accountsEyebrow")}</p>
          <h2 id="preferences-accounts-title">{t("settings.accountsTitle")}</h2>
          <LedgerAccountsPanel
            accounts={accounts}
            onAddAccount={onAddAccount}
            onSaveInitialFunding={onSaveInitialFunding}
            onReopenOnboarding={onReopenOnboarding}
          />
        </section>
        <section className="settings-preferences-block" aria-labelledby="preferences-theme-title">
          <p className="eyebrow">{t("settings.appearanceEyebrow")}</p>
          <h2 id="preferences-theme-title">{t("settings.themeTitle")}</h2>
          <p className="panel-copy">{t("settings.themeCopy")}</p>
          <ThemeControl value={themeMode} onChange={onThemeModeChange} />
        </section>
        <section className="settings-preferences-block" aria-labelledby="preferences-delete-title">
          <p className="eyebrow">{t("settings.ledgerEyebrow")}</p>
          <h2 id="preferences-delete-title">{t("settings.deleteBehaviorTitle")}</h2>
          <p className="panel-copy">
            {t("settings.deleteBehaviorCopy")}
          </p>
          <DeleteActionControl value={deleteAction} onChange={onDeleteActionChange} />
        </section>
        <section className="settings-preferences-block" aria-labelledby="preferences-negative-title">
          <p className="eyebrow">{t("settings.accountingEyebrow")}</p>
          <h2 id="preferences-negative-title">{t("settings.negativePolicyTitle")}</h2>
          <p className="panel-copy">
            {t("settings.negativePolicyCopy")}
          </p>
          <NegativeBalancePolicyControl value={negativeBalancePolicy} onChange={onNegativeBalancePolicyChange} />
        </section>
        <section className="settings-preferences-block" aria-labelledby="preferences-localization-title">
          <p className="eyebrow">{t("settings.localeEyebrow")}</p>
          <h2 id="preferences-localization-title">{t("settings.localeTitle")}</h2>
          <p className="panel-copy">
            {t("settings.localeCopy")}
          </p>
          <LanguageControl />
        </section>
        <section className="settings-preferences-block" aria-labelledby="preferences-ai-title">
          <p className="eyebrow">{t("settings.voiceEyebrow")}</p>
          <h2 id="preferences-ai-title">{t("settings.aiPreferenceTitle")}</h2>
          <p className="panel-copy">
            {t("settings.aiPreferenceCopy")}
          </p>
          <EntityPolicyRow
            label={t("settings.entityAccount")}
            value={entityPolicy.account}
            onChange={(value) => onEntityPolicyChange({ ...entityPolicy, account: value })}
          />
          <EntityPolicyRow
            label={t("settings.entityCategory")}
            value={entityPolicy.category}
            onChange={(value) => onEntityPolicyChange({ ...entityPolicy, category: value })}
          />
        </section>
      </div>
    );
  };

  return (
    <section className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label={t("settings.sectionsAria")}>
        <button className={`settings-tab ${section === "login" ? "active" : ""}`} type="button" role="tab" aria-selected={section === "login"} onClick={() => setSection("login")}>{t("settings.loginTab")}</button>
        <button className={`settings-tab ${section === "portability" ? "active" : ""}`} type="button" role="tab" aria-selected={section === "portability"} onClick={() => setSection("portability")}>{t("settings.portabilityTab")}</button>
        <button className={`settings-tab ${section === "categories" ? "active" : ""}`} type="button" role="tab" aria-selected={section === "categories"} onClick={() => setSection("categories")}>{t("settings.categoriesTab")}</button>
        <button className={`settings-tab ${section === "preferences" ? "active" : ""}`} type="button" role="tab" aria-selected={section === "preferences"} onClick={() => setSection("preferences")}>{t("settings.preferencesTab")}</button>
      </div>
      {renderSection()}
    </section>
  );
}

const THEME_OPTIONS: Array<{ value: ThemeMode; labelKey: string }> = [
  { value: "dark", labelKey: "settings.themeDark" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "system", labelKey: "settings.themeSystem" },
];

const DELETE_ACTION_OPTIONS: Array<{ value: DeleteAction; labelKey: string; hintKey: string }> = [
  { value: "void", labelKey: "settings.deleteVoid", hintKey: "settings.deleteVoidHint" },
  { value: "hard-delete", labelKey: "settings.deleteHard", hintKey: "settings.deleteHardHint" },
];

const NEGATIVE_BALANCE_OPTIONS: Array<{ value: NegativeBalancePolicy; labelKey: string; hintKey: string }> = [
  { value: "allow", labelKey: "settings.negativeAllow", hintKey: "settings.negativeAllowHint" },
  { value: "reject", labelKey: "settings.negativeReject", hintKey: "settings.negativeRejectHint" },
];

function NegativeBalancePolicyControl({ value, onChange }: Readonly<{ value: NegativeBalancePolicy; onChange: (policy: NegativeBalancePolicy) => void }>) {
  const { t } = useI18n();
  return (
    <fieldset className="entity-policy-row">
      <legend>{t("settings.negativeLegend")}</legend>
      {NEGATIVE_BALANCE_OPTIONS.map((option) => (
        <label key={option.value} className="entity-policy-option" title={t(option.hintKey)}>
          <input type="radio" name="negative-balance" value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span>{t(option.labelKey)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function DeleteActionControl({ value, onChange }: Readonly<{ value: DeleteAction; onChange: (action: DeleteAction) => void }>) {
  const { t } = useI18n();
  return (
    <fieldset className="entity-policy-row">
      <legend>{t("settings.deleteActionLegend")}</legend>
      {DELETE_ACTION_OPTIONS.map((option) => (
        <label key={option.value} className="entity-policy-option" title={t(option.hintKey)}>
          <input type="radio" name="delete-action" value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span>{t(option.labelKey)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function ThemeControl({ value, onChange }: Readonly<{ value: ThemeMode; onChange: (mode: ThemeMode) => void }>) {
  const { t } = useI18n();
  return (
    <fieldset className="entity-policy-row">
      <legend>{t("settings.themeLegend")}</legend>
      {THEME_OPTIONS.map((option) => (
        <label key={option.value} className="entity-policy-option">
          <input type="radio" name="theme" value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span>{t(option.labelKey)}</span>
        </label>
      ))}
    </fieldset>
  );
}

// Language switcher for the 本地化 preferences block. Changing the locale
// persists it, updates <html lang>, and re-renders every subscribed component
// through the i18n context (see src/i18n).
function LanguageControl() {
  const { locale, setLocale } = useI18n();
  return (
    <fieldset className="entity-policy-row">
      <legend>{t("settings.localeTitle")}</legend>
      {["zh-TW", "en-US"].map((code) => (
        <label key={code} className="entity-policy-option">
          <input
            type="radio"
            name="locale"
            value={code}
            checked={locale === code}
            onChange={() => setLocale(code as "zh-TW" | "en-US")}
          />
          <span>{code === "zh-TW" ? t("settings.localeZhTW") : t("settings.localeEnUS")}</span>
        </label>
      ))}
    </fieldset>
  );
}

function CategoriesPanel({ records, customCategories, setCustomCategories }: Readonly<{
  records: LocalLedgerRecord[];
  customCategories: string[];
  setCustomCategories: Dispatch<SetStateAction<string[]>>;
}>) {
  const { t } = useI18n();
  const used = new Set(records.map((record) => record.category).filter((value): value is string => Boolean(value)));
  const all = [...new Set([...expenseCategories, ...incomeCategories, ...customCategories, ...used])].sort((a, b) => a.localeCompare(b));
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!record.category) continue;
    counts.set(record.category, (counts.get(record.category) ?? 0) + 1);
  }
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");

  const isCustom = (name: string) => customCategories.some((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
  const normalized = (name: string) => name.trim().replace(/\s+/g, " ");

  const addCategory = () => {
    const name = normalized(newName);
    if (!name) {
      setError(t("settings.categoryNameRequired"));
      return;
    }
    if (all.some((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError(t("settings.categoryExists"));
      return;
    }
    setCustomCategories((current) => [...current, name]);
    setNewName("");
    setAdding(false);
    setError("");
  };

  const renameCategory = (previous: string) => {
    const name = normalized(editName);
    if (!name) {
      setError(t("settings.categoryRenameRequired"));
      return;
    }
    if (name.toLocaleLowerCase() !== previous.toLocaleLowerCase() && all.some((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError(t("settings.categoryExists"));
      return;
    }
    setCustomCategories((current) => current.map((item) => item.toLocaleLowerCase() === previous.toLocaleLowerCase() ? name : item));
    setEditing(null);
    setError("");
  };

  const removeCategory = (name: string) => {
    setCustomCategories((current) => current.filter((item) => item.toLocaleLowerCase() !== name.toLocaleLowerCase()));
    setError("");
  };

  return (
    <section className="settings-preferences-block" aria-labelledby="categories-title">
      <p className="eyebrow">{t("settings.categoriesEyebrow")}</p>
      <h2 id="categories-title">{t("settings.categoriesTitle")}</h2>
      <p className="panel-copy">
        {t("settings.categoriesCopy")}
      </p>
      {adding ? (
        <div className="category-add-form">
          <label htmlFor="new-category-name">{t("settings.categoryNew")}</label>
          <input id="new-category-name" type="text" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t("settings.categoryNewPlaceholder")} />
          <button className="secondary-action" type="button" onClick={addCategory}>{t("settings.categoryAddThis")}</button>
          <button className="quiet-action" type="button" onClick={() => { setAdding(false); setError(""); }}>{t("settings.categoryCancel")}</button>
        </div>
      ) : (
        <button className="secondary-action align-start" type="button" onClick={() => setAdding(true)}>{t("settings.categoryAdd")}</button>
      )}
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {all.length > 0 ? (
        <ul className="category-list">
          {all.map((category) => {
            const count = counts.get(category);
            return (
              <li key={category}>
                {editing === category ? (
                  <span className="category-edit-row">
                    <input type="text" value={editName} onChange={(event) => setEditName(event.target.value)} aria-label={t("settings.categoryRenameAria", { name: category })} />
                    <button className="text-action" type="button" onClick={() => renameCategory(category)}>{t("settings.categorySave")}</button>
                    <button className="quiet-action" type="button" onClick={() => { setEditing(null); setError(""); }}>{t("settings.categoryCancel")}</button>
                  </span>
                ) : (
                  <>
                    <span className="category-list-name">{category}</span>
                    {count ? <span className="category-list-count">{t("settings.categoryCount", { count })}</span> : null}
                    {isCustom(category) ? (
                      <span className="category-row-actions">
                        <button className="text-action" type="button" onClick={() => { setEditing(category); setEditName(category); setError(""); }}>{t("settings.categoryRename")}</button>
                        <button className="text-action danger-action" type="button" onClick={() => removeCategory(category)}>{t("settings.categoryDelete")}</button>
                      </span>
                    ) : (
                      <span className="category-list-builtin">{t("settings.categoryBuiltin")}</span>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="panel-copy">{t("settings.categoryEmpty")}</p>
      )}
    </section>
  );
}

const ENTITY_POLICY_OPTIONS: Array<{ value: AiEntityPolicyOption; labelKey: string; hintKey: string }> = [
  { value: "existing", labelKey: "settings.entityPolicyExisting", hintKey: "settings.entityPolicyExistingHint" },
  { value: "ask", labelKey: "settings.entityPolicyAsk", hintKey: "settings.entityPolicyAskHint" },
  { value: "auto", labelKey: "settings.entityPolicyAuto", hintKey: "settings.entityPolicyAutoHint" },
];

function EntityPolicyRow({ label, value, onChange }: Readonly<{ label: string; value: AiEntityPolicyOption; onChange: (value: AiEntityPolicyOption) => void }>) {
  const { t } = useI18n();
  return (
    <fieldset className="entity-policy-row">
      <legend>{label}</legend>
      {ENTITY_POLICY_OPTIONS.map((option) => (
        <label key={option.value} className="entity-policy-option" title={t(option.hintKey)}>
          <input type="radio" name={label} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span>{t(option.labelKey)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function PasswordInput({ id, value, autoComplete, visible, onValueChange, onToggleVisible }: Readonly<{
  id: string;
  value: string;
  autoComplete: string;
  visible: boolean;
  onValueChange: (value: string) => void;
  onToggleVisible: () => void;
}>) {
  const { t } = useI18n();
  return (
    <div className="password-field">
      <input
        id={id}
        type={visible ? "text" : "password"}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
        onClick={onToggleVisible}
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}

function AccountPage({ authState, authMessage, cloudDataOwnerMatches, handoffCounts, storageStatus, identities, onSignIn, onSignUp, onRequestPasswordReset, onRecoverPasswordFromLink, onUpdatePassword, onSignInWithOAuth, onLinkIdentity, onUnlinkIdentity, onClaimLocalWorkspace, onSignOut }: AccountPageProps) {
  const isSignedIn = authState === "signed-in";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryLink, setRecoveryLink] = useState("");
  // The paste-a-reset-link rescue (webviews) stays collapsed by default so it
  // does not compete with the primary forgot-password action; reveal on demand.
  const [showRecoveryLink, setShowRecoveryLink] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const { t } = useI18n();
  const [authView, setAuthView] = useState<"sign-in" | "sign-up" | "forgot-password">("sign-in");
  const [signUpError, setSignUpError] = useState("");

  const switchAuthView = (view: "sign-in" | "sign-up" | "forgot-password") => {
    setAuthView(view);
    setSignUpError("");
    setConfirmPassword("");
    setPasswordVisible(false);
    setConfirmPasswordVisible(false);
    setShowRecoveryLink(false);
  };

  const previousAuthMessage = useRef(authMessage);
  useEffect(() => {
    const alreadyRegistered = alreadyRegisteredMessage();
    if (authView === "sign-up" && authMessage === alreadyRegistered && previousAuthMessage.current !== alreadyRegistered) {
      switchAuthView("sign-in");
    }
    previousAuthMessage.current = authMessage;
  }, [authMessage, authView]);

  const handleSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSignIn(email, password).catch(() => undefined);
  };

  const handleSignUp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setSignUpError(t("auth.passwordMismatch"));
      return;
    }
    onSignUp(email, password).catch(() => undefined);
  };

  const handlePasswordReset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRequestPasswordReset(email).catch(() => undefined);
  };

  const handleRecoveryLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRecoverPasswordFromLink(recoveryLink).catch(() => undefined);
  };

  const handlePasswordUpdate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onUpdatePassword(newPassword).catch(() => undefined);
  };

  const renderAuthModeSwitch = () => (
    <fieldset className="segmented-fieldset">
      <legend className="visually-hidden">{t("auth.signInOrSignUp")}</legend>
      <div className="segmented-control">
        {(["sign-in", "sign-up"] as const).map((view) => (
          <label className={authView === view ? "active" : ""} key={view}>
            <input checked={authView === view} name="auth-view" type="radio" value={view} onChange={() => switchAuthView(view)} />
            <span>{view === "sign-in" ? t("auth.signIn") : t("auth.signUp")}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  const renderProviderActions = () => (
    <>
      <p className="auth-divider">{t("auth.orUse")}</p>
      <div className="auth-provider-actions">
        <button className="auth-provider-action" type="button" onClick={() => onSignInWithOAuth("google").catch(() => undefined)}>
          <img className="auth-provider-mark" src={googleG} alt="" /> {t("auth.continueWithGoogle")}
        </button>
        <button className="auth-provider-action" type="button" onClick={() => onSignInWithOAuth("facebook").catch(() => undefined)}>
          <img className="auth-provider-mark" src={facebookF} alt="" /> {t("auth.continueWithFacebook")}
        </button>
      </div>
    </>
  );

  const accountSubmitLabel = (): string => {
    if (authView === "sign-up") {
      return authState === "loading" ? t("auth.creatingAccount") : t("auth.signUp");
    }
    return authState === "loading" ? t("auth.signingIn") : t("auth.continue");
  };

  const renderRecoveryForm = () => (
    <form className="auth-form account-page-form" onSubmit={handlePasswordUpdate}>
      <p className="field-help">{t("auth.recoveryIntro")}</p>
      <label htmlFor="account-new-password">{t("auth.newPassword")}</label>
      <PasswordInput id="account-new-password" value={newPassword} autoComplete="new-password" visible={newPasswordVisible} onValueChange={setNewPassword} onToggleVisible={() => setNewPasswordVisible((current) => !current)} />
      <button className="primary-action auth-submit" type="submit">
        <KeyRound size={18} aria-hidden="true" />
        {t("auth.setNewPassword")}
      </button>
      {authMessage ? <p className="auth-message" role="alert">{authMessage}</p> : null}
    </form>
  );

  const renderForgotPasswordForm = () => (
    <>
      <form className="auth-form account-page-form" onSubmit={handlePasswordReset}>
        <p className="field-help">{t("auth.forgotIntro")}</p>
        <label htmlFor="account-reset-email">{t("auth.email")}</label>
        <input id="account-reset-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <button className="primary-action auth-submit" type="submit" disabled={authState === "loading"}>
          <KeyRound size={18} aria-hidden="true" />
          {authState === "loading" ? t("auth.sendingLink") : t("auth.sendResetLink")}
        </button>
        <button className="quiet-action" type="button" onClick={() => switchAuthView("sign-in")}>{t("auth.backToSignIn")}</button>
      </form>
      {showRecoveryLink ? (
        <form className="auth-form account-page-form" onSubmit={handleRecoveryLink}>
          <p className="field-help">{t("auth.recoveryLinkIntro")}</p>
          <label htmlFor="account-reset-link">{t("auth.resetLink")}</label>
          <input id="account-reset-link" type="url" inputMode="url" autoComplete="url" required value={recoveryLink} onChange={(event) => setRecoveryLink(event.target.value)} placeholder="https://.../account#access_token=..." />
          <button className="primary-action auth-submit" type="submit" disabled={authState === "loading"}>
            <KeyRound size={18} aria-hidden="true" />
            {authState === "loading" ? t("auth.checkingLink") : t("auth.useResetLink")}
          </button>
        </form>
      ) : (
        <button className="quiet-action auth-forgot-action" type="button" onClick={() => setShowRecoveryLink(true)}>
          {t("auth.pasteRecoveryLink")}
        </button>
      )}
      {authMessage ? <p className="auth-message" role="alert">{authMessage}</p> : null}
    </>
  );

  const renderAuthForm = () => (
    <form className="auth-form account-page-form" onSubmit={authView === "sign-up" ? handleSignUp : handleSignIn}>
      {renderAuthModeSwitch()}
      <label htmlFor="account-email">{t("auth.email")}</label>
      <input id="account-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <div className="auth-password-row">
        <label htmlFor="account-password">{t("auth.password")}</label>
        {authView === "sign-in" ? (
          <button className="quiet-action auth-forgot-action" type="button" onClick={() => switchAuthView("forgot-password")}>{t("auth.forgotPassword")}</button>
        ) : null}
      </div>
      <PasswordInput id="account-password" value={password} autoComplete={authView === "sign-up" ? "new-password" : "current-password"} visible={passwordVisible} onValueChange={setPassword} onToggleVisible={() => setPasswordVisible((current) => !current)} />
      {authView === "sign-up" ? (
        <>
          <label htmlFor="account-confirm-password">{t("auth.confirmPassword")}</label>
          <PasswordInput id="account-confirm-password" value={confirmPassword} autoComplete="new-password" visible={confirmPasswordVisible} onValueChange={setConfirmPassword} onToggleVisible={() => setConfirmPasswordVisible((current) => !current)} />
          {signUpError ? <p className="auth-message" role="alert">{signUpError}</p> : null}
        </>
      ) : null}
      <button className="primary-action auth-submit" type="submit" disabled={authState === "loading"}>
        {authView === "sign-up" ? <UserPlus size={18} aria-hidden="true" /> : <LogIn size={18} aria-hidden="true" />}
        {accountSubmitLabel()}
      </button>
      {authMessage ? <p className="auth-message" role="alert">{authMessage}</p> : null}
      {renderProviderActions()}
    </form>
  );

  const renderHandoffForm = () => (
    <div className="auth-form account-page-form">
      <p className="field-help">{t("auth.handoffIntro")}</p>
      <dl className="handoff-list" aria-label={t("auth.handoffSummaryAria")}>
        <div><dt>{t("auth.handoffAccounts")}</dt><dd>{handoffCounts.accounts}</dd></div>
        <div><dt>{t("auth.handoffRecords")}</dt><dd>{handoffCounts.records}</dd></div>
        <div><dt>{t("auth.handoffDrafts")}</dt><dd>{handoffCounts.drafts}</dd></div>
        <div><dt>{t("auth.handoffMeals")}</dt><dd>{handoffCounts.meals}</dd></div>
        <div><dt>{t("auth.handoffMedia")}</dt><dd>{handoffCounts.media}</dd></div>
      </dl>
      <button className="primary-action" type="button" onClick={onClaimLocalWorkspace}>
        <Cloud size={18} aria-hidden="true" />
        {t("auth.confirmCloudHandoff")}
      </button>
      <button className="secondary-action" type="button" onClick={() => onSignOut().catch(() => undefined)}>
        <LogOut size={18} aria-hidden="true" />
        {t("auth.signOut")}
      </button>
    </div>
  );

  const renderSignedInAccount = () => {
    const hasEmailIdentity = identities.some((identity) => identity.provider === "email");
    return (
      <div className="auth-form account-page-form">
        <p className="field-help">{t("auth.cloudEnabled")}</p>
        <output className={`account-storage-status ${storageStatus.tone}`} aria-live="polite">
          <strong>{storageStatus.label}</strong>
          <span>{storageStatus.detail}</span>
        </output>
        <fieldset className="linked-identities">
          <legend>{t("auth.signInMethods")}</legend>
          <ul>
            {hasEmailIdentity ? (
              <li className="identity-row">
                <span className="identity-name">{t("auth.emailPassword")}</span>
                <span className="identity-badge">{t("auth.primary")}</span>
              </li>
            ) : null}
            {(["google", "facebook"] as const).map((provider) => {
              const identity = identities.find((entry) => entry.provider === provider);
              return (
                <li className="identity-row" key={provider}>
                  <span className="identity-name">
                    <img className="auth-provider-mark" src={provider === "google" ? googleG : facebookF} alt="" />
                    {provider === "google" ? "Google" : "Facebook"}
                  </span>
                  {identity ? (
                    <button className="quiet-action" type="button" onClick={() => onUnlinkIdentity(identity).catch(() => undefined)}>{t("auth.unlink")}</button>
                  ) : (
                    <button className="quiet-action" type="button" onClick={() => onLinkIdentity(provider).catch(() => undefined)}>{provider === "google" ? t("auth.linkGoogle") : t("auth.linkFacebook")}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
        <button className="secondary-action" type="button" onClick={() => onSignOut().catch(() => undefined)}>
          <LogOut size={18} aria-hidden="true" />
          {t("auth.signOut")}
        </button>
        {authMessage ? <p className="auth-message" role="alert">{authMessage}</p> : null}
      </div>
    );
  };

  const renderAccountContent = () => {
    if (authState === "password-recovery") {
      return renderRecoveryForm();
    }
    if (!isSignedIn) {
      if (isLocalDevelopmentMode) {
        return <p className="field-help">{t("auth.localPreviewNoAuth")}</p>;
      }
      if (authView === "forgot-password") {
        return renderForgotPasswordForm();
      }
      return renderAuthForm();
    }
    if (!cloudDataOwnerMatches) {
      return renderHandoffForm();
    }
    return renderSignedInAccount();
  };

  return (
    <div className="account-page">
      <Panel title={t("auth.optionalCloudSync")}>
        {renderAccountContent()}
      </Panel>
    </div>
  );
}

function ImportExportPanel({ accounts, records, onImportRecord, onMergeImportDraft }: Readonly<{
  accounts: LocalAccount[];
  records: LocalLedgerRecord[];
  onImportRecord: (row: NormalizedImportRow, importId: string) => boolean;
  onMergeImportDraft: (row: NormalizedImportRow, importId: string) => boolean;
}>) {
  const { t } = useI18n();
  const [importMessage, setImportMessage] = useState(t("import.initialMessage"));
  const [selectedFileName, setSelectedFileName] = useState("");
  const [importItems, setImportItems] = useState<ImportReviewItem[]>([]);
  const [exportMessage, setExportMessage] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const [exporting, setExporting] = useState(false);

  const handleCsvSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSelectedFileName(file.name);

    const result = validateCsvBytes(new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) {
      setImportMessage(t("import.rejected", { errors: result.errors.join(" ") }));
      setImportItems([]);
      return;
    }

    const headerMapping = mapImportHeaders(result.headers);
    const mappedFields = Object.keys(headerMapping.mapping).join(", ");
    const unmapped = headerMapping.unmappedHeaders.length > 0 ? t("import.unmapped", { fields: headerMapping.unmappedHeaders.join(", ") }) : "";
    const conflicts = headerMapping.conflicts.length > 0 ? t("import.conflicts", { fields: headerMapping.conflicts.join(" ") }) : "";
    const rowResults = validateImportRows(result.rows.map((row) => mapImportRow(result.headers, row, headerMapping)), accounts);
    const duplicateReviews = detectImportDuplicates(rowResults.map((row) => ({ rowNumber: row.rowNumber, normalized: row.normalized })), records);
    const aliasReviews = rowResults.flatMap((row) => {
      if (!(["expense", "income", "refund"] as string[]).includes(row.normalized.kind ?? "")) {
        return [];
      }
      const summary = categoryReviewSummary(row.normalized.category ?? "");
      return summary ? [{ rowNumber: row.rowNumber, summary }] : [];
    });
    const reviewRows = rowResults.filter((row) => !row.ok).map((row) => row.rowNumber);
    const reviewedRowNumbers = new Set([...reviewRows, ...aliasReviews.map((item) => item.rowNumber)]);
    duplicateReviews.forEach((_, rowNumber) => reviewedRowNumbers.add(rowNumber));
    const reviewCount = reviewedRowNumbers.size;
    const aliasMessage = formatAliasReviewMessage(aliasReviews);
    const duplicateMessage = formatDuplicateReviewMessage([...duplicateReviews.keys()]);
    setImportItems(rowResults.map((row) => ({
      ...row,
      reviewId: `import-row-${Date.now()}-${row.rowNumber}`,
      aliasReview: aliasReviews.find((item) => item.rowNumber === row.rowNumber)?.summary ?? null,
      duplicates: duplicateReviews.get(row.rowNumber) ?? [],
      status: "pending",
    })));
    setImportMessage(t("import.ready", {
      rows: result.rowCount,
      columns: result.headers.length,
      mapped: mappedFields || t("import.noMapped"),
      ready: result.rowCount - reviewCount,
      review: reviewCount,
      unmapped,
      conflicts,
      aliases: aliasMessage,
      duplicates: duplicateMessage,
    }));
  };

  const confirmImport = (item: ImportReviewItem) => {
    if (!item.ok || item.aliasReview || item.duplicates.length > 0 || item.status !== "pending") {
      return;
    }

    const imported = onImportRecord(item.normalized, item.reviewId);
    setImportItems((current) => current.map((candidate) => candidate.reviewId === item.reviewId ? { ...candidate, status: importStatus("confirmed", imported) } : candidate));
    setImportMessage(imported ? t("import.rowImported", { row: item.rowNumber }) : t("import.rowImportFailed", { row: item.rowNumber }));
  };

  const keepSeparate = (item: ImportReviewItem) => {
    if (!item.ok || item.status !== "pending" || item.duplicates.length === 0) {
      return;
    }

    const imported = onImportRecord(item.normalized, item.reviewId);
    setImportItems((current) => current.map((candidate) => candidate.reviewId === item.reviewId ? { ...candidate, status: importStatus("kept-separate", imported) } : candidate));
    setImportMessage(imported ? t("import.rowKeptSeparate", { row: item.rowNumber }) : t("import.rowKeepFailed", { row: item.rowNumber }));
  };

  const linkExisting = (item: ImportReviewItem) => {
    const candidate = item.duplicates[0];
    if (!candidate || item.status !== "pending") {
      return;
    }

    setImportItems((current) => current.map((reviewItem) => reviewItem.reviewId === item.reviewId ? { ...reviewItem, status: "linked" } : reviewItem));
    setImportMessage(t("import.rowLinked", { row: item.rowNumber, candidate: duplicateCandidateName(candidate) }));
  };

  const mergeIntoDraft = (item: ImportReviewItem) => {
    if (!item.ok || item.status !== "pending" || item.duplicates.length === 0) {
      return;
    }

    const merged = onMergeImportDraft(item.normalized, item.reviewId);
    setImportItems((current) => current.map((candidate) => candidate.reviewId === item.reviewId ? { ...candidate, status: importStatus("merged", merged) } : candidate));
    setImportMessage(merged ? t("import.rowMerged", { row: item.rowNumber }) : t("import.rowMergeFailed", { row: item.rowNumber }));
  };

  const skipImport = (item: ImportReviewItem) => {
    setImportItems((current) => current.map((candidate) => candidate.reviewId === item.reviewId ? { ...candidate, status: "skipped" } : candidate));
    setImportMessage(t("import.rowSkipped", { row: item.rowNumber }));
  };

  const exportZip = async () => {
    if (exporting) {
      return;
    }

    setExporting(true);
    setExportProgress(0);
    setExportMessage(t("export.zipPreparing"));
    try {
      const bundle = await createMultiTableExportWithProgress(accounts, records, (percentage, stage) => {
        setExportProgress(percentage);
        setExportMessage(exportStageMessage(stage));
      });
      downloadBinaryFile(bundle.zip, "mealledger-export.zip", "application/zip");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Panel title={t("import.panelTitle")} eyebrow={t("import.panelEyebrow")}>
      <p className="panel-copy">
        {t("import.panelCopy")}
      </p>
      <section className="portability-section" aria-labelledby="ledger-export-heading">
        <h3 id="ledger-export-heading">{t("import.exportHeading")}</h3>
        <p className="panel-copy">{t("import.exportCopy")}</p>
        <div className="export-actions">
          <button className="primary-action" type="button" onClick={() => { downloadTextFile(serializeCleanCsv(records), "mealledger-ledger.csv", "text/csv;charset=utf-8"); setExportMessage(t("import.csvDownloaded")); }}>{t("import.exportCsv")}</button>
          <button className="secondary-action" type="button" onClick={() => { downloadTextFile(serializeCleanJson(records), "mealledger-ledger.json", "application/json;charset=utf-8"); setExportMessage(t("import.jsonDownloaded")); }}>{t("import.exportJson")}</button>
          <button className="secondary-action" type="button" disabled={exporting} onClick={() => { exportZip().catch(() => undefined); }}>{exporting ? t("import.exportZipProgress", { percent: exportProgress }) : t("import.exportZip")}</button>
        </div>
        {exportMessage ? <p className="panel-copy" aria-live="polite">{exportMessage}</p> : null}
      </section>
      <section className="portability-section" aria-labelledby="csv-import-heading">
        <h3 id="csv-import-heading">{t("import.importCsvHeading")}</h3>
        <div className="file-picker">
          <input id="csv-import-file" className="file-picker-input" aria-label={t("import.csvFileAria")} accept=".csv,text/csv" type="file" onChange={handleCsvSelection} />
          <label className="secondary-action file-picker-button" htmlFor="csv-import-file">{t("import.chooseCsv")}</label>
          <span className="file-picker-name" aria-live="polite">{selectedFileName || t("import.noFileSelected")}</span>
        </div>
        <p className="panel-copy" aria-live="polite">{importMessage}</p>
      </section>
      {importItems.length > 0 ? (
        <section className="draft-list" aria-label={t("import.reviewEyebrow")}>
          <div className="draft-list-heading">
            <div>
              <p className="eyebrow">{t("import.reviewEyebrow")}</p>
              <h3>{t("import.pendingRows")}</h3>
            </div>
            <span>{t("import.pendingCount", { count: importItems.filter((item) => item.status === "pending").length })}</span>
          </div>
          {importItems.map((item) => (
            <article className="draft-card" key={item.reviewId}>
              <div>
                <strong>{t("import.rowTitle", { row: item.rowNumber, kind: item.normalized.kind || t("import.unknownKind") })}</strong>
                <span>{item.normalized.date || item.normalized.period_start || t("import.noDate")} · {item.normalized.account || t("import.noAccount")} · {item.normalized.amount || t("import.noAmount")}</span>
                {item.errors.length > 0 ? <span>{item.errors.join(" ")}</span> : null}
                {item.aliasReview ? <span>{item.aliasReview}</span> : null}
                {item.duplicates.length > 0 ? <span>{t("import.duplicates", { items: item.duplicates.map(duplicateCandidateLabel).join("; ") })}</span> : null}
                {item.status !== "pending" ? <span>{t("import.status", { status: item.status })}</span> : null}
              </div>
                <div className="record-actions">
                <button className="text-action" type="button" disabled={!item.ok || Boolean(item.aliasReview) || item.duplicates.length > 0 || item.status !== "pending"} onClick={() => confirmImport(item)}>{t("import.confirmRow", { row: item.rowNumber })}</button>
                {item.duplicates.length > 0 ? <>
                  <button className="text-action" type="button" disabled={!item.ok || Boolean(item.aliasReview) || item.status !== "pending"} onClick={() => keepSeparate(item)}>{t("import.keepSeparateRow", { row: item.rowNumber })}</button>
                  <button className="text-action" type="button" disabled={item.status !== "pending"} onClick={() => linkExisting(item)}>{t("import.linkExistingRow", { row: item.rowNumber })}</button>
                  <button className="text-action" type="button" disabled={!item.ok || Boolean(item.aliasReview) || item.status !== "pending"} onClick={() => mergeIntoDraft(item)}>{t("import.mergeDraftRow", { row: item.rowNumber })}</button>
                </> : null}
                <button className="text-action danger-action" type="button" disabled={item.status !== "pending"} onClick={() => skipImport(item)}>{t("import.skipRow", { row: item.rowNumber })}</button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </Panel>
  );
}

function NotFoundPage({ navigate }: Readonly<{ navigate: (item: NavItem) => void }>) {
  const { t } = useI18n();
  return (
    <Panel title={t("notFound.title")} eyebrow={t("notFound.eyebrow")}>
      <p className="panel-copy">{t("notFound.copy")}</p>
      <button className="secondary-action align-start" type="button" onClick={() => navigate(navItemFor("overview"))}>
        <Home size={18} aria-hidden="true" />
        {t("notFound.goOverview")}
      </button>
    </Panel>
  );
}

function Panel({ title, eyebrow, children }: Readonly<{ title: string; eyebrow?: string; children: React.ReactNode }>) {
  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </article>
  );
}

function EmptyMetric({ label, value, detail }: Readonly<{ label: string; value: string; detail: string }>) {
  return (
    <article className="summary-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

const kindLabelKeys: Record<DraftForm["kind"], string> = {
  expense: "kind.expense",
  income: "kind.income",
  transfer: "kind.transfer",
  refund: "kind.refund",
  "fund-addition": "kind.fundAddition",
  adjustment: "kind.adjustment",
  "unresolved-expense": "kind.unresolvedExpense",
};

function kindLabel(kind: DraftForm["kind"]): string {
  return t(kindLabelKeys[kind]);
}

function routeTitle(route: AppRoute) {
  switch (route) {
    case "overview":
      return t("route.overview");
    case "ledger":
      return t("route.ledger");
    case "capture":
      return t("route.capture");
    case "zone":
      return t("route.zone");
    case "settings":
      return t("route.settings");
    default:
      return t("route.notFound");
  }
}
