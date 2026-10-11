// Ledger delete action preference: 作廢 (default) or 真正刪除.
// See ADR 0007 and the settings spec (Delete Behavior). The ledger row delete
// action executes whichever behavior is configured at delete time.
export type DeleteAction = "void" | "hard-delete";

export const DEFAULT_DELETE_ACTION: DeleteAction = "void";

const DELETE_ACTION_KEY = "mealledger.settings.delete-action";

const ACTIONS: readonly DeleteAction[] = ["void", "hard-delete"];

export function isDeleteAction(value: unknown): value is DeleteAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

export function readDeleteAction(): DeleteAction {
  try {
    const stored = window.localStorage.getItem(DELETE_ACTION_KEY);
    return isDeleteAction(stored) ? stored : DEFAULT_DELETE_ACTION;
  } catch {
    return DEFAULT_DELETE_ACTION;
  }
}

export function writeDeleteAction(action: DeleteAction): void {
  try {
    window.localStorage.setItem(DELETE_ACTION_KEY, action);
  } catch {
    // Best-effort persistence; the current session still uses the action.
  }
}
