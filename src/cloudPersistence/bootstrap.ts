import { t } from "../i18n";
import type { LocalAccount } from "../manualLedger/accounts";
import type { TaxonomyAliasSeed } from "../taxonomy/defaults";
import { mapLocalAccount } from "./mappers";
import type { CloudMutationError, CloudReferenceMap, CloudRow } from "./contracts";

type ReferenceTable = {
  upsert(values: CloudRow | CloudRow[], options?: { onConflict?: string }): {
    select(columns: string): PromiseLike<{ data?: unknown; error: CloudMutationError | null }>;
  };
};

export type ReferenceBootstrapClient = {
  from(table: string): ReferenceTable;
};

export type ReferenceBootstrapInput = {
  userId: string;
  accounts: LocalAccount[];
  categories?: string[];
  aliases?: TaxonomyAliasSeed[];
  merchants?: string[];
  tags?: string[];
  events?: string[];
};

export type ReferenceBootstrapFailure = {
  ok: false;
  table: string;
  message: string;
};

export type ReferenceBootstrapResult =
  | { ok: true; references: CloudReferenceMap }
  | ReferenceBootstrapFailure;

function uniqueNames(names: string[] | undefined): string[] {
  return [...new Set((names ?? []).map((name) => name.trim()).filter(Boolean))];
}

function rowsForNames(userId: string, names: string[], includeRootParent = false): CloudRow[] {
  return names.map((name) => ({
    user_id: userId,
    ...(includeRootParent ? { parent_id: null } : {}),
    name,
    kind_scope: "both",
  }));
}

function rowsForMerchants(userId: string, names: string[] | undefined): CloudRow[] {
  const unique = new Map<string, string>();
  for (const name of names ?? []) {
    const trimmed = name.trim();
    if (trimmed && !unique.has(trimmed.toLowerCase())) unique.set(trimmed.toLowerCase(), trimmed);
  }
  return [...unique.entries()].map(([normalizedName, name]) => ({
    user_id: userId,
    name,
    normalized_name: normalizedName,
  }));
}

function rowsForAliases(
  userId: string,
  aliases: TaxonomyAliasSeed[] | undefined,
  categoryIds: Record<string, string>,
): CloudRow[] {
  const unique = new Map<string, TaxonomyAliasSeed>();
  for (const item of aliases ?? []) {
    const alias = item.alias.trim();
    const canonical = item.canonical.trim();
    if (alias && canonical && !unique.has(alias.toLocaleLowerCase())) {
      unique.set(alias.toLocaleLowerCase(), { alias, canonical });
    }
  }

  return [...unique.values()].map((item) => ({
    user_id: userId,
    ...(categoryIds[item.canonical] ? { category_id: categoryIds[item.canonical] } : {}),
    alias: item.alias,
    source: "legacy-import",
    review_required: true,
  }));
}

async function upsertAndMap(
  client: ReferenceBootstrapClient,
  table: string,
  rows: CloudRow[],
  onConflict = "user_id,name",
): Promise<{ ok: true; ids: Record<string, string> } | ReferenceBootstrapFailure> {
  if (rows.length === 0) return { ok: true, ids: {} };

  const result = await client.from(table).upsert(rows, { onConflict }).select("id,name");
  if (result.error) {
    return { ok: false, table, message: result.error.message };
  }

  const returnedRows = Array.isArray(result.data) ? result.data as CloudRow[] : [];
  const ids: Record<string, string> = {};
  for (const row of returnedRows) {
    if (typeof row.name === "string" && typeof row.id === "string") {
      ids[row.name] = row.id;
    }
  }

  const missing = rows
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string" && !ids[name]);
  if (missing.length > 0) {
    return { ok: false, table, message: t("cloud.bootstrapMissing", { names: missing.join(", ") }) };
  }

  return { ok: true, ids };
}

export async function bootstrapReferences(
  client: ReferenceBootstrapClient,
  input: ReferenceBootstrapInput,
): Promise<ReferenceBootstrapResult> {
  const accountRows = input.accounts.map((account) => mapLocalAccount(account, input.userId));
  const accounts = await upsertAndMap(client, "accounts", accountRows);
  if (!accounts.ok) return accounts;

  const merchants = await upsertAndMap(
    client,
    "merchants",
    rowsForMerchants(input.userId, input.merchants),
    "user_id,normalized_name",
  );
  if (!merchants.ok) return merchants;

  const categories = await upsertAndMap(
    client,
    "categories",
    rowsForNames(input.userId, uniqueNames(input.categories), true),
    "user_id,parent_key,name",
  );
  if (!categories.ok) return categories;

  const aliases = await upsertAndMap(
    client,
    "category_aliases",
    rowsForAliases(input.userId, input.aliases, categories.ids),
    "user_id,alias",
  );
  if (!aliases.ok) return aliases;

  const tags = await upsertAndMap(client, "tags", rowsForNames(input.userId, uniqueNames(input.tags)));
  if (!tags.ok) return tags;

  const events = await upsertAndMap(client, "events", rowsForNames(input.userId, uniqueNames(input.events)));
  if (!events.ok) return events;

  return {
    ok: true,
    references: {
      accountIds: Object.fromEntries(input.accounts.map((account) => [account.id, accounts.ids[account.name]])),
      categoryIds: categories.ids,
      merchantIds: merchants.ids,
      tagIds: tags.ids,
      eventIds: events.ids,
    },
  };
}
