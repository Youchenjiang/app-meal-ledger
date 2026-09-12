import { describe, expect, test, vi } from "vitest";
import type { ReferenceBootstrapClient } from "./bootstrap";
import type { CloudPersistenceClient, CloudRow } from "./contracts";
import { enqueueLocalChanges, mergeSyncedItems, mergeSyncedQueue, mergeSyncedScans, syncLocalChanges } from "./syncService";
import { enqueueRecordSync, type CloudSyncQueueItem } from "./syncQueue";
import type { LocalAccount } from "../manualLedger/accounts";
import type { LocalLedgerRecord } from "../manualLedger/records";
import type { MealEntry } from "../captureMedia/meals";
import type { TemporaryScan } from "../captureMedia/media";
import type { UploadQueueItem } from "../captureMedia/upload";

const account: LocalAccount = { id: "account-1", name: "Cash", currency: "TWD" };
const syncNow = "2026-07-13T00:00:00.000Z";

function enqueue(overrides: Partial<Parameters<typeof enqueueLocalChanges>[0]> = {}) {
  return enqueueLocalChanges({
    queue: [],
    accounts: [],
    records: [],
    drafts: [],
    meals: [],
    media: [],
    scans: [],
    now: syncNow,
    ...overrides,
  });
}

test("does not restore a scan state changed while cloud sync was in flight", () => {
  const retained: TemporaryScan = {
    id: "scan-1",
    intent: "scan-receipt",
    fileName: "receipt.jpg",
    mimeType: "image/jpeg",
    byteSize: 100,
    state: "retained",
    cloudStatus: "synced",
    createdAt: "2026-07-13T00:00:00.000Z",
    expiresAt: null,
  };
  const discarded: TemporaryScan = { ...retained, state: "discarded", cloudStatus: "local-only" };

  expect(mergeSyncedScans([discarded], [retained])).toEqual([discarded]);
});

test("does not restore queue items removed while cloud sync was in flight", () => {
  const current = [{ id: "still-present", state: "pending" }];
  const staleSyncResult = [
    { id: "still-present", state: "synced" },
    { id: "removed-during-sync", state: "synced" },
  ];

  expect(mergeSyncedItems(current, staleSyncResult)).toEqual([{ id: "still-present", state: "synced" }]);
});

function queueItem(id: string, overrides: Partial<CloudSyncQueueItem> = {}): CloudSyncQueueItem {
  return {
    id,
    target: "record",
    targetId: id,
    actionType: "record-bundle",
    idempotencyKey: id,
    requestHash: id,
    state: "pending",
    attempts: 0,
    nextAttemptAt: null,
    lastError: "",
    createdAt: syncNow,
    updatedAt: syncNow,
    ...overrides,
  };
}

test("removes dropped queue items while keeping concurrent enqueues", () => {
  const snapshot = [queueItem("ghost-record"), queueItem("kept-record")];
  const synced = [queueItem("kept-record", { state: "synced" })];
  const current = [...snapshot, queueItem("record-added-during-sync")];

  expect(mergeSyncedQueue(current, synced, snapshot).map((item) => item.id)).toEqual(["kept-record", "record-added-during-sync"]);
  expect(mergeSyncedQueue(current, synced, snapshot)[0].state).toBe("synced");
});
const baseRecord = {
  id: "record-1", idempotencyKey: "action-1", userId: "local-user", kind: "expense", status: "local-only", recordState: "active", version: 1,
  localDate: "2026-07-13", accountId: "account-1", accountName: "Cash", amount: "100", currency: "TWD", category: "Daily", counterparty: "Store", counterpartyMissing: false, itemName: "Tea", itemNameMissing: false,
  transferAccountId: "", transferAccountName: "", transferMode: "same-currency", destinationAmount: "", destinationCurrency: "", feeAccountId: "", feeAccountName: "", feeAmount: "", feeCurrency: "", feeCategory: "", refundReason: "", refundSubtype: "refund", refundLinkedRecordId: "", refundExcessHandling: "unclassified", recurrenceChoice: "current-cycle-only", recurrenceAmountMode: "fixed", recurrenceStatus: "inactive", reason: "", timePrecision: "day", periodStart: "", periodEnd: "", note: "", createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z",
} as LocalLedgerRecord;

function persistenceClient(failTable?: string): CloudPersistenceClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rpc: vi.fn(() => {
      calls.push("persist_ledger_record_bundle_resolved");
      return Promise.resolve(failTable === "ledger_records"
        ? { data: null, error: { message: `${failTable} failed`, code: "network" } }
        : { data: { replayed: false }, error: null });
    }),
    from(table: string) {
      return {
        select() {
          const filter = { eq: () => filter, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
          return filter;
        },
        upsert: vi.fn(() => {
          calls.push(table);
          return Promise.resolve(failTable === table ? { data: null, error: { message: `${table} failed`, code: "network" } } : { data: null, error: null });
        }),
      };
    },
  } as CloudPersistenceClient & { calls: string[] };
}

function referenceClient(): ReferenceBootstrapClient {
  return {
    from(table: string) {
      return {
        upsert(rows) {
          const batch = Array.isArray(rows) ? rows : [rows];
          return {
            select: () => Promise.resolve({
              data: batch.map((row, index) => ({ id: `remote-${table}-${index}`, name: (row as CloudRow).name })),
              error: null,
            }),
          };
        },
      };
    },
  };
}

function input(overrides: Partial<Parameters<typeof syncLocalChanges>[0]> = {}) {
  return {
    client: persistenceClient(),
    referenceClient: referenceClient(),
    userId: "user-1",
    accounts: [account],
    categories: ["Daily"],
    aliases: [],
    merchants: ["Store"],
    tags: [],
    events: [],
    auditEvents: [],
    records: [baseRecord],
    drafts: [],
    meals: [] as MealEntry[],
    media: [] as UploadQueueItem[],
    scans: [] as TemporaryScan[],
    queue: enqueue({ records: [baseRecord] }),
    now: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("cloud sync service", () => {
  test("persists an account even when no ledger record exists", async () => {
    const result = await syncLocalChanges(input({
      records: [],
      queue: enqueue({ accounts: [account] }),
    }));

    expect(result.records).toEqual([]);
    expect(result.queue).toMatchObject([{
      target: "account",
      targetId: "account-1",
      state: "synced",
    }]);
  });

  test("keeps pending work retryable when profile persistence fails", async () => {
    const result = await syncLocalChanges(input({
      client: persistenceClient("profiles"),
      records: [],
      queue: enqueue({ accounts: [account] }),
    }));

    expect(result.queue).toMatchObject([{ state: "retryable-error", lastError: "profiles failed" }]);
  });

  test("bootstraps references and marks a successful record synced", async () => {
    const result = await syncLocalChanges(input());

    expect(result.records[0].status).toBe("synced");
    expect(result.queue[0].state).toBe("synced");
  });

  test("drops a queue item whose local record no longer exists instead of failing forever", async () => {
    const ghostQueue = enqueueRecordSync([], baseRecord, syncNow);
    const result = await syncLocalChanges(input({
      records: [],
      queue: ghostQueue,
    }));

    expect(result.records).toEqual([]);
    expect(result.queue).toEqual([]);
  });

  test("rebinds a stale local account id by its current account name", async () => {
    const staleRecord = { ...baseRecord, accountId: "old-user-account-uuid" };
    const result = await syncLocalChanges(input({
      records: [staleRecord],
      queue: enqueue({ records: [staleRecord] }),
    }));

    expect(result.records[0].status).toBe("synced");
    expect(result.queue[0].state).toBe("synced");
  });

  test("rebinds an existing but incorrect account mapping by the record name", async () => {
    const transfer: LocalLedgerRecord = {
      ...baseRecord,
      id: "transfer-1",
      kind: "transfer",
      transferAccountId: "account-2",
      transferAccountName: "Cash",
      destinationAmount: "100",
      destinationCurrency: "TWD",
    };
    const rpcArgs: Record<string, unknown>[] = [];
    const result = await syncLocalChanges(input({
      accounts: [account, { id: "account-2", name: "Bank", currency: "TWD" }],
      records: [transfer],
      queue: enqueue({ records: [transfer] }),
      client: Object.assign(persistenceClient(), {
        rpc: vi.fn((_name: string, args: Record<string, unknown>) => {
          rpcArgs.push(args);
          return Promise.resolve({ data: { replayed: false }, error: null });
        }),
      }),
    }));

    expect(result.records[0].status).toBe("synced");
    expect(result.queue[0].state).toBe("synced");
    expect((rpcArgs[0].p_transfer_details as Record<string, unknown>).destination_account_id).toBe("remote-accounts-0");
  });

  test("bootstraps account references discovered from ledger records", async () => {
    const remoteRecord: LocalLedgerRecord = {
      ...baseRecord,
      accountId: "stale-remote-account",
      accountName: "Remote wallet",
      kind: "transfer",
      transferAccountId: "account-1",
      transferAccountName: "Cash",
      destinationAmount: "100",
      destinationCurrency: "TWD",
    };
    const rpcArgs: Record<string, unknown>[] = [];
    const result = await syncLocalChanges(input({
      records: [remoteRecord],
      queue: enqueue({ records: [remoteRecord] }),
      client: Object.assign(persistenceClient(), {
        rpc: vi.fn((_name: string, args: Record<string, unknown>) => {
          rpcArgs.push(args);
          return Promise.resolve({ data: { replayed: false }, error: null });
        }),
      }),
    }));

    expect(result.records[0].status).toBe("synced");
    expect(result.queue[0].state).toBe("synced");
    expect(rpcArgs[0].p_ledger_record).toMatchObject({ account_id: "remote-accounts-1" });
    expect(rpcArgs[0].p_transfer_details).toMatchObject({ destination_account_id: "remote-accounts-0" });
  });

  test("defaults a malformed legacy account currency during bootstrap", async () => {
    const capturedAccounts: CloudRow[] = [];
    const legacyRecord = {
      ...baseRecord,
      accountId: "legacy-account",
      accountName: "Legacy wallet",
      currency: null as unknown as string,
    };
    const result = await syncLocalChanges(input({
      accounts: [],
      records: [legacyRecord],
      queue: enqueue({ records: [legacyRecord] }),
      referenceClient: {
        from: (table) => ({
          upsert: (rows) => ({
            select: () => {
              const batch = (Array.isArray(rows) ? rows : [rows]) as CloudRow[];
              if (table === "accounts") capturedAccounts.push(...batch);
              return Promise.resolve({
                data: batch.map((row, index) => ({ id: `remote-${table}-${index}`, name: row.name })),
                error: null,
              });
            },
          }),
        }),
      },
    }));

    expect(capturedAccounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Legacy wallet", currency: "TWD" }),
    ]));
    expect(result.records[0].status).toBe("synced");
  });

  test("reorders a persisted transfer queue behind its linked fee record", async () => {
    const transfer: LocalLedgerRecord = {
      ...baseRecord,
      id: "transfer-1",
      kind: "transfer",
      transferAccountId: "account-2",
      transferAccountName: "Bank",
      destinationAmount: "100",
      destinationCurrency: "TWD",
    };
    const fee: LocalLedgerRecord = {
      ...baseRecord,
      id: "fee-1",
      amount: "5",
      linkedRecordId: "transfer-1",
    };
    const rpcArgs: Record<string, unknown>[] = [];
    const client = persistenceClient();
    client.rpc = (_name: string, args: Record<string, unknown>) => {
      client.calls.push("persist_ledger_record_bundle_resolved");
      rpcArgs.push(args);
      return Promise.resolve({ data: { replayed: false }, error: null });
    };
    const transferFirstQueue = enqueueRecordSync([], transfer, "2026-07-13T00:00:00.000Z");
    const queue = enqueueRecordSync(transferFirstQueue, fee, "2026-07-13T00:00:00.000Z");
    const result = await syncLocalChanges(input({
      client,
      accounts: [account, { id: "account-2", name: "Bank", currency: "TWD" }],
      records: [transfer, fee],
      queue,
    }));

    expect(result.records.every((record) => record.status === "synced")).toBe(true);
    expect(rpcArgs).toHaveLength(2);
    expect(rpcArgs[0].p_ledger_record).toMatchObject({ kind: "expense" });
    expect(rpcArgs[0].p_transfer_details).toEqual({});
    expect(rpcArgs[1].p_ledger_record).toMatchObject({ kind: "transfer" });
    expect(rpcArgs[1].p_transfer_details).toMatchObject({ destination_account_id: "remote-accounts-1" });
  });

  test("resyncs an edited record with a version-scoped idempotency key", async () => {
    const first = await syncLocalChanges(input());
    const editedRecord: LocalLedgerRecord = {
      ...baseRecord,
      amount: "125",
      status: "local-only",
      version: 2,
      idempotencyKey: "record:record-1:v2",
      updatedAt: "2026-07-13T01:00:00.000Z",
    };
    const second = await syncLocalChanges(input({
      records: [editedRecord],
      queue: enqueue({ queue: first.queue, records: [editedRecord], now: "2026-07-13T01:00:00.000Z" }),
      now: "2026-07-13T01:00:00.000Z",
    }));

    expect(second.records[0]).toMatchObject({ status: "synced", amount: "125", version: 2 });
    expect(second.queue[0]).toMatchObject({
      state: "synced",
      idempotencyKey: "record:record-1:v2",
      requestHash: "record-1:2:2026-07-13T01:00:00.000Z",
    });
  });

  test("keeps the local record and retryable queue state on transport failure", async () => {
    const failedClient = persistenceClient("ledger_records");
    const result = await syncLocalChanges(input({ client: failedClient }));

    expect(result.records[0].status).toBe("local-only");
    expect(result.queue[0]).toMatchObject({ state: "retryable-error", lastError: "ledger_records failed" });
  });

  test("does not retry an incomplete reference bootstrap forever without changing local data", async () => {
    const result = await syncLocalChanges(input({
      referenceClient: {
        from: () => ({ upsert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
      },
    }));

    expect(result.records[0].status).toBe("local-only");
    expect(result.queue[0]).toMatchObject({ state: "retryable-error", lastError: expect.stringContaining("缺少") });
  });

  test("syncs meal, media metadata, and temporary scan source rows independently", async () => {
    const meal = {
      id: "meal-1",
      occurredAt: "2026-07-13T12:30",
      note: "Lunch",
      transactionIds: [baseRecord.id],
      mediaAssetIds: ["meal-1-0-lunch.jpg"],
      status: "local-only" as const,
    };
    const media = {
      id: "meal-1-0-lunch.jpg",
      name: "lunch.jpg",
      type: "image/jpeg",
      size: 2048,
      status: "uploaded" as const,
      kind: "meal-photo" as const,
      remoteMediaId: "00000000-0000-4000-8000-000000000003",
      objectKey: "meal/meal-1-0-lunch.jpg",
    };
    const scan = {
      id: "scan-1",
      intent: "scan-receipt" as const,
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
      byteSize: 1024,
      state: "temporary" as const,
      cloudStatus: "local-only" as const,
      createdAt: "2026-07-13T10:00:00.000Z",
      expiresAt: "2026-07-14T10:00:00.000Z",
    };
    const result = await syncLocalChanges(input({
      meals: [meal],
      media: [media],
      scans: [scan],
      queue: enqueue({ records: [baseRecord], meals: [meal], media: [media], scans: [scan] }),
    }));

    expect(result.meals[0].status).toBe("synced");
    expect(result.media[0].metadataStatus).toBe("synced");
    expect(result.scans[0].cloudStatus).toBe("synced");
    expect(result.queue.every((item) => item.state === "synced")).toBe(true);
  });
});
