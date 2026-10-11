import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enUS } from "./dictionaries/enUS";
import { zhTW } from "./dictionaries/zhTW";

// The app resolves a key through the requested locale, then the en-US fallback,
// and only then gives up — in dev as `[missing:key]`, in a build as the bare
// key. Either way the user reads something that is not a sentence. The ledger
// shipped exactly that: a transfer record asked for `app.recordTransfer`, which
// no dictionary defined, so the row title was `[missing:app.recordTransfer]`.
//
// Keys are collected from the source instead of from a hand-kept list, so a new
// call site is covered the moment it is written.

const SOURCE_ROOT = "src";
const DICTIONARY_DIR = join("src", "i18n", "dictionaries");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(path)) return [];
    // Tests assert on rendered text; they are not a source of user-facing keys,
    // and a spec is allowed to reference a key it is about to add.
    if (/\.test\.(ts|tsx)$/.test(path)) return [];
    if (path.startsWith(DICTIONARY_DIR)) return [];
    return [path];
  });
}

function literalKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\b(?:t|translate)\(\s*"([^"]+)"/g)) {
      if (!found.has(match[1])) found.set(match[1], file);
    }
  }
  return found;
}

const dictionaries: Array<[string, Record<string, string>]> = [
  ["zhTW", zhTW as Record<string, string>],
  ["enUS", enUS as Record<string, string>],
];

describe("i18n dictionaries", () => {
  it("define the same keys", () => {
    const zh = Object.keys(zhTW).sort();
    const en = Object.keys(enUS).sort();
    expect(zh.filter((key) => !(key in enUS)), "keys missing from enUS").toEqual([]);
    expect(en.filter((key) => !(key in zhTW)), "keys missing from zhTW").toEqual([]);
  });

  it("define every key the source uses", () => {
    const keys = literalKeys();
    expect(keys.size, "expected to find t(\"key\") calls in src").toBeGreaterThan(100);

    for (const [locale, dictionary] of dictionaries) {
      const missing = [...keys].filter(([key]) => !(key in dictionary));
      expect(
        missing.map(([key, file]) => `${key} (${file})`),
        `keys used in src but missing from ${locale}`,
      ).toEqual([]);
    }
  });

  it("has no empty values", () => {
    for (const [locale, dictionary] of dictionaries) {
      const empty = Object.entries(dictionary).filter(([, value]) => String(value).trim() === "");
      expect(empty.map(([key]) => key), `empty values in ${locale}`).toEqual([]);
    }
  });
});
