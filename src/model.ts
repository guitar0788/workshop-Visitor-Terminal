export type Theme = "pixel" | "minimal" | "cyber";
export type LayerKind = "text" | "count" | "dot" | "panel";

export interface Layer {
  id: string;
  kind: LayerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  color: string;
  visible: boolean;
}

export interface TerminalDesign {
  schemaVersion: 1;
  theme: Theme;
  width: number;
  height: number;
  background: string;
  accent: string;
  layers: Layer[];
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const isTheme = (v: unknown): v is Theme => v === "pixel" || v === "minimal" || v === "cyber";
const isKind = (v: unknown): v is LayerKind =>
  v === "text" || v === "count" || v === "dot" || v === "panel";
const number = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};
const color = (value: unknown, fallback: string): string =>
  typeof value === "string" && COLOR.test(value) ? value : fallback;
const text = (value: unknown, fallback: string, limit: number): string =>
  typeof value === "string" ? value.slice(0, limit) : fallback;

function makePreset(theme: Theme): TerminalDesign {
  const accent = theme === "cyber" ? "#22d3ee" : theme === "minimal" ? "#93c5fd" : "#7ee787";
  const background = theme === "cyber" ? "#0b1020" : theme === "minimal" ? "#111827" : "#101820";
  const minimal = theme === "minimal";
  const layers: Layer[] = [
    { id: "heading", kind: "text", x: 24, y: 22, width: 320, height: 24, text: theme === "pixel" ? "WORKSHOP TERMINAL" : theme === "cyber" ? "CYBER COUNTER" : "PROFILE VIEWS", fontSize: 16, color: accent, visible: true },
    { id: "signal", kind: "dot", x: 385, y: 23, width: 12, height: 12, text: "", fontSize: 12, color: accent, visible: !minimal },
    { id: "caption", kind: "text", x: 24, y: 77, width: 300, height: 25, text: "TOTAL VISITS", fontSize: 13, color: accent, visible: true },
    { id: "visits", kind: "count", x: 24, y: 106, width: 345, height: 52, text: "", fontSize: 44, color: accent, visible: true },
    { id: "status", kind: "text", x: 24, y: 175, width: 330, height: 20, text: minimal ? "THANKS FOR VISITING" : "SYSTEM READY", fontSize: 11, color: accent, visible: true }
  ];
  return { schemaVersion: 1, theme, width: 420, height: 220, background, accent, layers };
}

export const presets: Record<Theme, TerminalDesign> = {
  pixel: makePreset("pixel"), minimal: makePreset("minimal"), cyber: makePreset("cyber")
};

export function clonePreset(theme: Theme): TerminalDesign {
  const preset = presets[theme];
  return { ...preset, layers: preset.layers.map(layer => ({ ...layer })) };
}

export function sanitizeDesign(input: unknown): TerminalDesign {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const theme: Theme = isTheme(source.theme) ? source.theme : "pixel";
  const base = clonePreset(theme);
  const width = number(source.width, base.width, 280, 800);
  const height = number(source.height, base.height, 160, 480);
  const seen = new Set<string>();
  const layers = Array.isArray(source.layers) ? source.layers.slice(0, 32).flatMap((entry, index): Layer[] => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    if (!isKind(raw.kind)) return [];
    const id = typeof raw.id === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(raw.id) && !seen.has(raw.id)
      ? raw.id : "layer_" + index;
    if (seen.has(id)) return [];
    seen.add(id);
    const layerWidth = number(raw.width, 120, 8, width);
    const layerHeight = number(raw.height, 28, 8, height);
    return [{
      id, kind: raw.kind,
      x: number(raw.x, 0, 0, width - layerWidth),
      y: number(raw.y, 0, 0, height - layerHeight),
      width: layerWidth, height: layerHeight,
      text: text(raw.text, "", 120),
      fontSize: number(raw.fontSize, 16, 8, 80),
      color: color(raw.color, base.accent),
      visible: typeof raw.visible === "boolean" ? raw.visible : true
    }];
  }) : base.layers;
  return {
    schemaVersion: 1, theme, width, height,
    background: color(source.background, base.background),
    accent: color(source.accent, base.accent),
    layers
  };
}

export function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export function renderSvg(input: unknown, visits: number): string {
  const d = sanitizeDesign(input);
  const count = Number.isFinite(visits) ? Math.floor(Math.max(0, Math.min(999999999999, visits))) : 0;
  const counter = count.toLocaleString("en-US");
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Profile visit counter" width="',
    String(d.width), '" height="', String(d.height),
    '" viewBox="0 0 ', String(d.width), ' ', String(d.height), '">',
    '<title>Workshop visitor counter: ', counter, ' visits</title>',
    '<rect x="2" y="2" width="', String(d.width - 4),
    '" height="', String(d.height - 4), '" rx="', d.theme === "pixel" ? "2" : "12",
    '" fill="', d.background, '" stroke="', d.accent,
    '" stroke-width="', d.theme === "minimal" ? "1" : "3", '"/>'
  ];
  for (const layer of d.layers) {
    if (!layer.visible) continue;
    if (layer.kind === "dot") {
      parts.push('<circle cx="', String(layer.x + layer.width / 2),
        '" cy="', String(layer.y + layer.height / 2),
        '" r="', String(Math.max(2, Math.min(layer.width, layer.height) / 2)),
        '" fill="', layer.color, '"/>');
    } else if (layer.kind === "panel") {
      parts.push('<rect x="', String(layer.x), '" y="', String(layer.y),
        '" width="', String(layer.width), '" height="', String(layer.height),
        '" rx="3" fill="', layer.color, '" fill-opacity="0.13" stroke="', layer.color, '"/>');
    } else {
      const content = layer.kind === "count" ? counter : layer.text;
      // Text is clipped to its designated box so user designs cannot overflow the exported SVG.
      parts.push('<defs><clipPath id="clip-', layer.id,
        '"><rect x="', String(layer.x), '" y="', String(layer.y),
        '" width="', String(layer.width), '" height="', String(layer.height),
        '"/></clipPath></defs><text clip-path="url(#clip-', layer.id,
        ')" x="', String(layer.x), '" y="', String(layer.y + 2),
        '" dominant-baseline="hanging" fill="', layer.color,
        '" font-size="', String(layer.fontSize),
        '" font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="',
        layer.kind === "count" ? "700" : "600",
        '">', escapeXml(content), '</text>');
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

export function moveLayer(input: TerminalDesign, id: string, dx: number, dy: number): TerminalDesign {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return input;
  return { ...input, layers: input.layers.map(layer => layer.id === id ? {
    ...layer, x: Math.max(0, Math.min(input.width - layer.width, Math.round(layer.x + dx))),
    y: Math.max(0, Math.min(input.height - layer.height, Math.round(layer.y + dy)))
  } : layer) };
}

export function reorderLayer(input: TerminalDesign, id: string, direction: -1 | 1): TerminalDesign {
  const index = input.layers.findIndex(layer => layer.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= input.layers.length) return input;
  const layers = input.layers.slice();
  [layers[index], layers[target]] = [layers[target], layers[index]];
  return { ...input, layers };
}

export function addLayer(input: TerminalDesign, kind: LayerKind, id: string): TerminalDesign {
  if (input.layers.length >= 32 || input.layers.some(layer => layer.id === id)) return input;
  const offset = (input.layers.length * 19) % 110;
  const layer: Layer = {
    id, kind, x: 24 + offset, y: 48 + offset,
    width: kind === "dot" ? 20 : kind === "panel" ? 130 : 210,
    height: kind === "dot" ? 20 : kind === "panel" ? 64 : 36,
    text: kind === "text" ? "YOUR TEXT" : "", fontSize: 18,
    color: input.accent, visible: true
  };
  return { ...input, layers: [...input.layers, layer] };
}
