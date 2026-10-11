import type { LocalAccount } from "./accounts";
import type { LocalLedgerRecord } from "./records";
import { formatAmount, minorUnitsToMajorNumber, parseMinorUnits } from "./money";

export type AccountBalance = LocalAccount & {
  balance: number;
};

function isActive(record: LocalLedgerRecord): boolean {
  return record.recordState !== "voided";
}

function applyRecordBalance(record: LocalLedgerRecord, balances: Map<string, bigint>, accountCurrencies: Map<string, string>): void {
  if (!isActive(record)) {
    return;
  }

  const sourceAmount = parseMinorUnits(record.amount, record.currency);
  if (sourceAmount === null) return;
  const sourceSign = record.kind === "expense" || record.kind === "unresolved-expense" ? -1n : 1n;

  if (record.kind === "transfer") {
    balances.set(record.accountId, (balances.get(record.accountId) ?? 0n) - sourceAmount);
    const destinationCurrency = record.destinationCurrency || accountCurrencies.get(record.transferAccountId) || record.currency;
    const destinationAmount = parseMinorUnits(record.destinationAmount || record.amount, destinationCurrency);
    if (destinationAmount === null) return;
    if (record.transferAccountId) {
      balances.set(record.transferAccountId, (balances.get(record.transferAccountId) ?? 0n) + destinationAmount);
    }
    return;
  }

  balances.set(record.accountId, (balances.get(record.accountId) ?? 0n) + sourceAmount * sourceSign);
}

export function calculateAccountBalances(
  accounts: LocalAccount[],
  records: LocalLedgerRecord[],
): AccountBalance[] {
  const balances = new Map(accounts.map((account) => [account.id, 0n] as const));
  const accountCurrencies = new Map(accounts.map((account) => [account.id, account.currency] as const));

  for (const record of records) {
    applyRecordBalance(record, balances, accountCurrencies);
  }

  return accounts.map((account) => ({
    ...account,
    balance: minorUnitsToMajorNumber(balances.get(account.id) ?? 0n, account.currency),
  }));
}

export function formatAccountBalance(balance: number, currency: string): string {
  return formatAmount(balance, currency);
}
