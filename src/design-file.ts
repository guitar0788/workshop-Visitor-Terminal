import { isCardTheme } from "./card-art";
import { isMinecraftTheme } from "./minecraft-card-art";
import { sanitizeDesign, type LayerKind, type TerminalDesign, type Theme } from "./model";

/** Match the editor's existing import-size limit, measured in UTF-8 bytes. */
export const MAX_DESIGN_FILE_BYTES = 65_536;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-zA-Z0-9_-]{1,48}$/;
const KINDS = new Set<LayerKind>(["text", "count", "dot", "panel"]);
const CLASSIC_THEMES = new Set(["pixel", "minimal", "cyber"]);
const TEXT_ALIGNMENTS = new Set(["left", "center", "right"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= min && value <= max;
}

function isSupportedTheme(value: unknown): value is Theme {
  return typeof value === "string" &&
    (CLASSIC_THEMES.has(value) || isCardTheme(value));
}

/**
 * Import is intentionally stricter than sanitizeDesign().
 *
 * sanitizeDesign() is a forgiving runtime boundary for old/remote data: it
 * repairs IDs, clamps dimensions and skips unknown layers. Doing that to a
 * user-selected backup can silently destroy work. A file import must instead
 * reject malformed supported fields before replacing the current design.
 * Unknown metadata is still discarded by sanitizeDesign(), so tokens or
 * unrelated properties can never enter the editor or local draft.
 */
export function parseDesignFile(json: string): TerminalDesign {
  if (typeof json !== "string" ||
      new TextEncoder().encode(json).byteLength > MAX_DESIGN_FILE_BYTES) {
    throw new Error("Invalid design file");
  }

  let input: unknown;
  try {
    input = JSON.parse(json) as unknown;
  } catch {
    throw new Error("Invalid design file");
  }

  if (!isRecord(input) || input.schemaVersion !== 1 ||
      !isSupportedTheme(input.theme) ||
      !isIntegerBetween(input.width, 280, 800) ||
      !isIntegerBetween(input.height, 160, 480) ||
      typeof input.background !== "string" || !COLOR.test(input.background) ||
      typeof input.accent !== "string" || !COLOR.test(input.accent) ||
      !Array.isArray(input.layers) || input.layers.length > 32 ||
      (input.artworkVersion !== undefined &&
        (!isMinecraftTheme(input.theme) || input.artworkVersion !== "v061"))) {
    throw new Error("Invalid design file");
  }

  const ids = new Set<string>();
  for (const entry of input.layers) {
    if (!isRecord(entry) ||
        typeof entry.id !== "string" || !ID.test(entry.id) || ids.has(entry.id) ||
        typeof entry.kind !== "string" || !KINDS.has(entry.kind as LayerKind) ||
        !isIntegerBetween(entry.width, 8, input.width) ||
        !isIntegerBetween(entry.height, 8, input.height) ||
        !isIntegerBetween(entry.x, 0, input.width - entry.width) ||
        !isIntegerBetween(entry.y, 0, input.height - entry.height) ||
        !isIntegerBetween(entry.fontSize, 8, 80) ||
        typeof entry.text !== "string" || entry.text.length > 120 ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(entry.text) ||
        typeof entry.color !== "string" || !COLOR.test(entry.color) ||
        typeof entry.visible !== "boolean" ||
        (entry.textAlign !== undefined &&
          (typeof entry.textAlign !== "string" || !TEXT_ALIGNMENTS.has(entry.textAlign)))) {
      throw new Error("Invalid design file");
    }
    ids.add(entry.id);
  }

  return sanitizeDesign(input);
}
