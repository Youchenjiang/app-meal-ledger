import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useI18n } from "../i18n/react";

// Marks a field value the model inferred rather than the user stated. The
// user confirms the corrected value before it is written (ADR 0003).
export function InferredSpan({ inferred, children }: Readonly<{ inferred: boolean; children: ReactNode }>): ReactNode {
  const { t } = useI18n();
  return inferred
    ? <span className="inferred-field" title={t("ai.inferredTitle")}>{children}</span>
    : children;
}

// Marks an account/category the user mentioned that does not exist yet; it is
// created only when the user confirms the write (see ADR 0012).
export function NewEntityTag({ label }: Readonly<{ label: string }>): ReactNode {
  return <span className="new-entity-badge" title={label}>{label}</span>;
}

export type FieldBlockItem = {
  field: string;
  label: string;
  value: string;
  state: "filled" | "current" | "pending";
  // When true, the value is underlined as AI-inferred (mode A).
  inferred?: boolean;
  // Rendered next to the value when the entity does not exist yet (mode A).
  badge?: string;
  // Replaces the default value display for fields with special formatting
  // (e.g. the date block that underlines only a derived year).
  valueContent?: ReactNode;
};

// The shared field-block list for both capture modes: one block per field
// with a filled / current / pending state. Mode B renders it as progress
// display; mode A additionally passes edit handlers for in-place per-field
// confirmation.
export function FieldBlocks({
  items,
  editingField,
  onEditField,
  onFieldChange,
  onFieldConfirm,
}: Readonly<{
  items: FieldBlockItem[];
  editingField?: string | null;
  onEditField?: (field: string) => void;
  onFieldChange?: (field: string, value: string) => void;
  onFieldConfirm?: (field: string) => void;
}>) {
  const { t } = useI18n();
  return (
    <ol className="field-blocks">
      {items.map((item) => {
        const editing = editingField === item.field && Boolean(onFieldChange);
        const content = (
          <>
            <span className="field-block-label">{item.label}</span>
            <FieldBlockValue item={item} editing={editing} onFieldChange={onFieldChange} onFieldConfirm={onFieldConfirm} />
          </>
        );
        return (
          <li
            key={item.field}
            className={`field-block ${item.state}${editing ? " editing" : ""}${onEditField ? " editable" : ""}`}
          >
            {editing || !onEditField ? content : (
              <button
                className="field-block-content"
                type="button"
                aria-label={t("ai.editFieldAria", { label: item.label })}
                onClick={() => onEditField(item.field)}
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function FieldBlockValue({
  item,
  editing,
  onFieldChange,
  onFieldConfirm,
}: Readonly<{
  item: FieldBlockItem;
  editing: boolean;
  onFieldChange?: (field: string, value: string) => void;
  onFieldConfirm?: (field: string) => void;
}>) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus the input when the block opens for editing (the autoFocus prop is
  // avoided so the focus behavior stays predictable under repeated edits).
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="field-block-input"
        value={item.value}
        onChange={(event) => onFieldChange?.(item.field, event.target.value)}
        onBlur={() => onFieldConfirm?.(item.field)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onFieldConfirm?.(item.field);
        }}
      />
    );
  }
  if (item.valueContent) return item.valueContent;
  if (item.value) {
    return (
      <span className="field-block-value">
        {item.inferred ? <InferredSpan inferred>{item.value}</InferredSpan> : item.value}
        {item.badge ? <NewEntityTag label={item.badge} /> : null}
      </span>
    );
  }
  return <span className="field-block-placeholder">{t("ai.pendingPlaceholder")}</span>;
}
