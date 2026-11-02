import { sanitizeDesign, type TerminalDesign } from "./model";

/**
 * A versioned, local-only editor draft. Never store OAuth sessions, API keys,
 * visitor receipts, published account data, or remote counter metadata.
 * The JSON is exactly the sanitized design schema used for SVG export.
 */
export const DRAFT_STORAGE_KEY = "workshop-studio-draft-v1";
export const MAX_DRAFT_LENGTH = 65_536;

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function restoreLocalDraft(storage: DraftStorage | null | undefined): TerminalDesign | null {
  try {
    const raw = storage?.getItem(DRAFT_STORAGE_KEY);
    if (!raw || raw.length > MAX_DRAFT_LENGTH) return null;
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== "object") return null;
    const source = input as Record<string, unknown>;
    if (source.schemaVersion !== 1 || !Array.isArray(source.layers) ||
        typeof source.theme !== "string") return null;
    const restored = sanitizeDesign(source);
    // Unknown template names must not silently replace a saved design.
    return restored.theme === source.theme ? restored : null;
  } catch {
    // Browsers may block storage (especially file:// and private mode).
    return null;
  }
}

export function saveLocalDraft(
  storage: DraftStorage | null | undefined, design: TerminalDesign
): boolean {
  try {
    if (!storage) return false;
    // Whitelist schema fields through the same sanitizer used for publishing.
    const json = JSON.stringify(sanitizeDesign(design));
    if (json.length > MAX_DRAFT_LENGTH) return false;
    storage.setItem(DRAFT_STORAGE_KEY, json);
    return true;
  } catch {
    return false;
  }
}
