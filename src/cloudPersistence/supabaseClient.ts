import { t } from "../i18n";
import type { CloudFilter, CloudMutationError, CloudPersistenceClient, CloudReadResult, CloudRow } from "./contracts";
import type { ReferenceBootstrapClient } from "./bootstrap";

type RawError = { message?: string; code?: string; details?: string } | null;

type RawResult = {
  data?: unknown;
  error: RawError;
};

type RawFilterBuilder = {
  eq(column: string, value: unknown): RawFilterBuilder;
  maybeSingle(): PromiseLike<RawResult>;
};

type RawUpsertBuilder = {
  select(columns: string): PromiseLike<RawResult>;
} & PromiseLike<RawResult>;

type RawTable = {
  upsert(values: CloudRow | CloudRow[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): RawUpsertBuilder;
  select(columns: string): RawFilterBuilder;
};

export type RawSupabaseClient = {
  from(table: string): RawTable;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RawResult>;
};

function normalizeError(error: RawError): CloudMutationError | null {
  if (!error) return null;
  return {
    message: error.message ?? t("cloud.requestFailed"),
    ...(error.code ? { code: error.code } : {}),
    ...(error.details ? { details: error.details } : {}),
  };
}

function normalizeResult(result: RawResult) {
  return { data: result.data, error: normalizeError(result.error) };
}

function normalizeReadResult(result: RawResult): CloudReadResult {
  return { data: (result.data as CloudRow | null | undefined), error: normalizeError(result.error) };
}

export function createSupabasePersistenceClient(raw: RawSupabaseClient): CloudPersistenceClient {
  return {
    from(table: string) {
      return {
        upsert: async (values, options) => normalizeResult(await raw.from(table).upsert(values, options)),
        select(columns = "*") {
          let query = raw.from(table).select(columns);
          const filter: CloudFilter = {
            eq(column, value) {
              query = query.eq(column, value);
              return filter;
            },
            async maybeSingle() {
              return normalizeReadResult(await query.maybeSingle());
            },
          };
          return filter;
        },
      };
    },
    async rpc(name, args) {
      return normalizeResult(await raw.rpc(name, args));
    },
  };
}

export function createSupabaseReferenceBootstrapClient(raw: RawSupabaseClient): ReferenceBootstrapClient {
  return {
    from(table: string) {
      return {
        upsert(values, options) {
          return {
            async select(columns: string) {
              return normalizeResult(await raw.from(table).upsert(values, options).select(columns));
            },
          };
        },
      };
    },
  };
}
