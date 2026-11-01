import { CARD_THEMES, isCardTheme, cardArtwork, type CardTheme } from "./card-art";
export { CARD_THEMES } from "./card-art";
export type { CardTheme } from "./card-art";
export type Theme = "pixel" | "minimal" | "cyber" | CardTheme;
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
const isTheme = (v: unknown): v is Theme => v === "pixel" || v === "minimal" || v === "cyber" || isCardTheme(v);
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

function makePreset(theme: "pixel" | "minimal" | "cyber"): TerminalDesign {
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


/* Nine new fully rendered cards, separate from original editable v0.5 presets.
 * The illustrations are built-in vectors; the same editable visitor-count
 * layer is used by offline exports and the Cloudflare SVG endpoint. */
const CARD_CONFIG: Record<CardTheme, {
  accent: string; background: string; heading: string; caption: string;
  titleX: number; titleY: number; titleWidth: number; titleSize: number;
  countX: number; countY: number; countWidth: number; countSize: number;
  labelX: number; labelY: number;
}> = {
  "pixel-card": { accent:"#243b4d", background:"#81cafa", heading:"WORKSHOP VISITORS", caption:"PIXEL GARDEN",
    titleX:158,titleY:54,titleWidth:236,titleSize:16,countX:172,countY:102,countWidth:220,countSize:44,labelX:175,labelY:153 },
  "modern-card": { accent:"#233665", background:"#ecf2ff", heading:"WORKSHOP VISITORS", caption:"TOTAL VISITS",
    titleX:168,titleY:56,titleWidth:238,titleSize:17,countX:168,countY:101,countWidth:231,countSize:47,labelX:170,labelY:157 },
  "terminal-card": { accent:"#5ef9ab", background:"#081e18", heading:"WORKSHOP VISITORS", caption:"SYSTEM ONLINE",
    titleX:57,titleY:82,titleWidth:337,titleSize:22,countX:57,countY:121,countWidth:234,countSize:46,labelX:58,labelY:184 },
  "cozy-card": { accent:"#754932", background:"#fff0de", heading:"WORKSHOP VISITORS", caption:"THANK YOU FOR VISITING",
    titleX:165,titleY:58,titleWidth:228,titleSize:17,countX:165,countY:105,countWidth:220,countSize:45,labelX:164,labelY:165 },
  "rpg-card": { accent:"#f6d78d", background:"#233968", heading:"WORKSHOP VISITORS", caption:"LEVEL UP · THANK YOU",
    titleX:173,titleY:54,titleWidth:213,titleSize:16,countX:173,countY:107,countWidth:215,countSize:45,labelX:174,labelY:165 },
  "space-card": { accent:"#f4eaff", background:"#1b1b56", heading:"WORKSHOP VISITORS", caption:"EXPLORING THE STARS",
    titleX:47,titleY:59,titleWidth:259,titleSize:18,countX:47,countY:106,countWidth:255,countSize:45,labelX:48,labelY:167 },
  "notebook-card": { accent:"#614432", background:"#fff5e4", heading:"WORKSHOP VISITORS", caption:"MY VISITOR NOTES",
    titleX:64,titleY:58,titleWidth:239,titleSize:19,countX:66,countY:101,countWidth:231,countSize:47,labelX:68,labelY:175 },
  "neon-card": { accent:"#e9e2ff", background:"#131737", heading:"WORKSHOP VISITORS", caption:"DIGITAL SIGNAL · ACTIVE",
    titleX:166,titleY:60,titleWidth:227,titleSize:17,countX:165,countY:109,countWidth:229,countSize:44,labelX:167,labelY:170 },
  "minimal-card": { accent:"#1a4a3d", background:"#f1fff6", heading:"WORKSHOP VISITORS", caption:"HELLO THERE",
    titleX:174,titleY:61,titleWidth:224,titleSize:16,countX:173,countY:104,countWidth:216,countSize:44,labelX:176,labelY:158 }
};

function makeCardPreset(theme: CardTheme): TerminalDesign {
  const c = CARD_CONFIG[theme];
  const layers: Layer[] = [
    { id:"heading", kind:"text", x:c.titleX, y:c.titleY, width:c.titleWidth,
      height:theme === "terminal-card" ? 30 : 26, text:c.heading, fontSize:c.titleSize, color:c.accent, visible:true },
    { id:"visits", kind:"count", x:c.countX, y:c.countY, width:c.countWidth,
      height:61, text:"", fontSize:c.countSize, color:c.accent, visible:true },
    { id:"caption", kind:"text", x:c.labelX, y:c.labelY, width:216,
      height:19, text:c.caption, fontSize:11, color:c.accent, visible:true }
  ];
  return { schemaVersion:1, theme, width:420, height:220,
    background:c.background, accent:c.accent, layers };
}

export const presets: Record<Theme, TerminalDesign> = {
  pixel: makePreset("pixel"), minimal: makePreset("minimal"), cyber: makePreset("cyber"),
  ...Object.fromEntries(CARD_THEMES.map(theme => [theme, makeCardPreset(theme)])) as
    Record<CardTheme, TerminalDesign>
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

/**
 * Fit the complete formatted visit count into its editable box. The original
 * font size is preserved for short values, but long counters (including the
 * 12-digit limit) shrink rather than disappearing under the clipPath.
 * A strict 8px floor is a user-editing readability guard; for extremely narrow
 * custom boxes the renderer also uses SVG textLength below.
 */
export function fittedCountSize(layer: Layer, value: string): number {
  if (!value.length) return Math.max(8, Math.min(layer.fontSize, layer.height - 4));
  const available = Math.max(1, layer.width - 4);
  // 0.63em conservatively bounds the width of the default monospace digits.
  const byWidth = Math.floor(available / (value.length * 0.63));
  return Math.max(8, Math.min(layer.fontSize, layer.height - 4, byWidth));
}

/** Prevent cross-card SVG fragment collisions in pages with many inline SVGs. */
export function svgInstanceScope(design: TerminalDesign, counter: string): string {
  const source = JSON.stringify([design.theme, design.width, design.height,
    design.layers, counter]);
  let a = 2166136261, b = 2166136261 ^ 0x9e3779b9;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619) >>> 0;
    b = Math.imul(b ^ (code + (i & 255)), 16777619) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

function scopedCardArtwork(artwork: string, scope: string): string {
  // Trusted built-in art only; namespace gradient/pattern IDs as well.
  const ids = new Set([...artwork.matchAll(/\bid="([a-zA-Z][a-zA-Z0-9_-]*)"/g)]
    .map(match => match[1]));
  let out = artwork;
  for (const id of ids) {
    out = out.replaceAll('id="' + id + '"', 'id="art-' + scope + '-' + id + '"');
    out = out.replaceAll('url(#' + id + ')', 'url(#art-' + scope + '-' + id + ')');
  }
  return out;
}

export function renderSvg(input: unknown, visits: number): string {
  const d = sanitizeDesign(input);
  const count = Number.isFinite(visits) ? Math.floor(Math.max(0, Math.min(999999999999, visits))) : 0;
  const counter = count.toLocaleString("en-US");
  const scope = svgInstanceScope(d, counter);
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Profile visit counter" width="',
    String(d.width), '" height="', String(d.height),
    '" viewBox="0 0 ', String(d.width), ' ', String(d.height), '">',
    '<title>Workshop visitor counter: ', counter, ' visits</title>',
  ];
  if (isCardTheme(d.theme)) {
    // Canonical vector art scales to any configured canvas dimensions.
    // These elements are bundled constants, not user-controlled SVG markup.
    parts.push('<g transform="scale(', String(d.width / 420), ' ', String(d.height / 220),
      ')">', scopedCardArtwork(cardArtwork(d.theme), scope), '</g>');
  } else {
    parts.push('<rect x="2" y="2" width="', String(d.width - 4),
      '" height="', String(d.height - 4), '" rx="', d.theme === "pixel" ? "2" : "12",
      '" fill="', d.background, '" stroke="', d.accent,
      '" stroke-width="', d.theme === "minimal" ? "1" : "3", '"/>');
  }
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
      const fittedSize = layer.kind === "count" ? fittedCountSize(layer, counter) : layer.fontSize;
      // Actual Chrome font metrics put hanging glyphs ABOVE their nominal
      // baseline. Offset illustrated-card labels by their actual font size;
      // otherwise the clipPath cuts off the top of the live count.
      // Keep classic SVG baselines byte-for-byte unchanged for v0.5 designs.
      const baselineY = layer.y + (isCardTheme(d.theme)
        ? Math.ceil(fittedSize * 0.20) : 2);
      // Distinct IDs even in a page with all nine SVGs embedded inline.
      const clipId = "clip-" + scope + "-" + layer.id;
      // Text is clipped to its designated box so user designs cannot overflow the exported SVG.
      parts.push('<defs><clipPath id="', clipId,
        '"><rect x="', String(layer.x), '" y="', String(layer.y),
        '" width="', String(layer.width), '" height="', String(layer.height),
        '"/></clipPath></defs><text clip-path="url(#', clipId,
        ')" x="', String(layer.x), '" y="', String(baselineY),
        '" dominant-baseline="hanging" fill="', layer.color,
        '" font-size="', String(fittedSize),
        '"', ...(layer.kind === "count" && fittedSize * counter.length * 0.63 > layer.width - 4
          ? [' textLength="', String(Math.max(1, layer.width - 4)), '" lengthAdjust="spacingAndGlyphs"']
          : []),
        ' font-family="ui-monospace, Menlo, Consolas, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, monospace" font-weight="',
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
