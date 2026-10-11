import { t } from "../i18n";

export const csvImportLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 5_000,
} as const;

const supportedHeaders = new Set([
  "date",
  "kind",
  "account",
  "amount",
  "currency",
  "merchant",
  "item_name",
  "category",
  "source",
  "target_account",
  "target_amount",
  "target_currency",
  "fee_account",
  "fee_amount",
  "fee_currency",
  "fee_category",
  "refund_reason",
  "refund_subtype",
  "refund_linked_record_id",
  "refund_linked_record_ids",
  "reason",
  "time_precision",
  "period_start",
  "period_end",
  "tags",
  "event",
  "source_label",
  "notes",
  "日期",
  "帳戶",
  "金額",
  "來源",
  "店家",
  "名稱",
  "種類",
  "原帳戶",
  "後帳戶",
]);

export type CsvValidationResult = {
  ok: boolean;
  headers: string[];
  rows: string[][];
  rowCount: number;
  errors: string[];
};

function blankResult(errors: string[]): CsvValidationResult {
  return { ok: false, headers: [], rows: [], rowCount: 0, errors };
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

type CsvParserState = {
  rows: string[][];
  errors: string[];
  row: string[];
  field: string;
  quoted: boolean;
  line: number;
};

function pushCsvField(state: CsvParserState): void {
  state.row.push(state.field);
  state.field = "";
}

function pushCsvRow(state: CsvParserState): void {
  pushCsvField(state);
  if (!isBlankRow(state.row)) state.rows.push(state.row);
  state.row = [];
}

function consumeQuotedCsvCharacter(text: string, index: number, state: CsvParserState): number {
  const character = text[index];
  if (character !== '"') {
    state.field += character;
    if (character === "\n") state.line += 1;
    return index;
  }

  if (text[index + 1] === '"') {
    state.field += '"';
    return index + 1;
  }

  state.quoted = false;
  return index;
}

function consumeUnquotedCsvCharacter(text: string, index: number, state: CsvParserState): number {
  const character = text[index];
  if (character === '"') {
    if (state.field.length === 0) state.quoted = true;
    else state.errors.push(t("import.unexpectedQuote", { line: state.line }));
    return index;
  }
  if (character === ",") {
    pushCsvField(state);
    return index;
  }
  if (character === "\r" || character === "\n") {
    pushCsvRow(state);
    state.line += 1;
    return character === "\r" && text[index + 1] === "\n" ? index + 1 : index;
  }
  state.field += character;
  return index;
}

function parseCsv(text: string): { rows: string[][]; errors: string[] } {
  const state: CsvParserState = { rows: [], errors: [], row: [], field: "", quoted: false, line: 1 };
  let skipNextCharacter = false;
  for (let index = 0; index < text.length; index += 1) {
    if (skipNextCharacter) {
      skipNextCharacter = false;
      continue;
    }
    const nextIndex = state.quoted
      ? consumeQuotedCsvCharacter(text, index, state)
      : consumeUnquotedCsvCharacter(text, index, state);
    skipNextCharacter = nextIndex !== index;
  }

  if (state.quoted) state.errors.push(t("import.unclosedQuote", { line: state.line }));
  else if (state.field.length > 0 || state.row.length > 0) pushCsvRow(state);
  return { rows: state.rows, errors: state.errors };
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function validateCsvBytes(bytes: Uint8Array): CsvValidationResult {
  if (bytes.byteLength > csvImportLimits.maxBytes) {
    return blankResult(t("import.csvTooLarge", { max: csvImportLimits.maxBytes / (1024 * 1024) }).split("\n"));
  }

  const decoded = decodeUtf8(bytes);
  if (decoded === null) {
    return blankResult([t("import.utf8Invalid")]);
  }

  const { rows, errors } = parseCsv(decoded.replace(/^\ufeff/u, ""));
  if (rows.length === 0) {
    return blankResult([t("import.needHeader"), ...errors]);
  }

  const headers = rows[0].map((header) => header.trim());
  const normalizedHeaders = headers.map((header) => header.toLocaleLowerCase());
  const duplicateHeaders = normalizedHeaders.filter((header, index) => normalizedHeaders.indexOf(header) !== index);
  const headerErrors = [
    ...errors,
    ...(headers.includes("") ? [t("import.emptyHeader")] : []),
    ...(duplicateHeaders.length > 0 ? [t("import.duplicateHeader")] : []),
    ...(headers.some((header) => supportedHeaders.has(header) || supportedHeaders.has(header.toLocaleLowerCase()))
      ? []
      : [t("import.unsupportedHeaders")]),
  ];

  const dataRows = rows.slice(1);
  if (dataRows.length > csvImportLimits.maxRows) {
    headerErrors.push(t("import.tooManyRows", { max: csvImportLimits.maxRows }));
  }

  for (const [index, dataRow] of dataRows.entries()) {
    if (dataRow.length !== headers.length) {
      headerErrors.push(t("import.columnMismatch", { row: index + 2, count: dataRow.length, expected: headers.length }));
    }
  }

  return {
    ok: headerErrors.length === 0,
    headers,
    rows: dataRows,
    rowCount: dataRows.length,
    errors: headerErrors,
  };
}

export function validateCsvText(text: string): CsvValidationResult {
  return validateCsvBytes(new TextEncoder().encode(text));
}
