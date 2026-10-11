// Negative-balance policy: whether editable accounts may hold a negative
// balance. Off by default (allows negative balances, matching the accounting
// rules); when enabled, the write path rejects expenses and balance
// adjustments that would push an editable account below zero. See ADR 0008.
import { t } from "../i18n";
import type { LocalAccount } from "./accounts";
import type { LocalLedgerRecord } from "./records";
import { createOfficialRecordBundle } from "./records";
import { calculateAccountBalances } from "./balances";
import type { TransactionDraft } from "../appShell/drafts";

export type NegativeBalancePolicy = "allow" | "reject";

export const DEFAULT_NEGATIVE_BALANCE_POLICY: NegativeBalancePolicy = "allow";

const NEGATIVE_BALANCE_KEY = "mealledger.settings.negative-balance-policy";

const POLICIES: readonly NegativeBalancePolicy[] = ["allow", "reject"];

export function isNegativeBalancePolicy(value: unknown): value is NegativeBalancePolicy {
  return typeof value === "string" && (POLICIES as readonly string[]).includes(value);
}

export function readNegativeBalancePolicy(): NegativeBalancePolicy {
  try {
    const stored = window.localStorage.getItem(NEGATIVE_BALANCE_KEY);
    return isNegativeBalancePolicy(stored) ? stored : DEFAULT_NEGATIVE_BALANCE_POLICY;
  } catch {
    return DEFAULT_NEGATIVE_BALANCE_POLICY;
  }
}

export function writeNegativeBalancePolicy(policy: NegativeBalancePolicy): void {
  try {
    window.localStorage.setItem(NEGATIVE_BALANCE_KEY, policy);
  } catch {
    // Best-effort persistence; the current session still applies the policy.
  }
}

/**
 * Returns a readable rejection reason when writing `draft` would push an
 * editable account below zero, or null when the write is allowed. Only writes
 * that cross from non-negative to negative are rejected; already-negative
 * balances are never rewritten (ADR 0008).
 */
export function negativeBalanceRejectionReason(
  draft: TransactionDraft,
  accounts: LocalAccount[],
  records: LocalLedgerRecord[],
): string | null {
  const bundle = createOfficialRecordBundle(draft, accounts, {
    userId: "policy-check",
    recordId: "policy-check",
    idempotencyKey: "policy-check",
    createdAt: new Date().toISOString(),
  });
  if (!bundle) {
    // Domain validation already happened upstream; nothing to guard here.
    return null;
  }

  const before = calculateAccountBalances(accounts, records);
  const after = calculateAccountBalances(accounts, [...records, ...bundle.records]);
  const beforeById = new Map(before.map((account) => [account.id, account.balance]));
  const below = after.find((account) => (beforeById.get(account.id) ?? 0) >= 0 && account.balance < 0);

  if (!below) {
    return null;
  }
  return t("validation.negativeBalance", { name: below.name });
}
