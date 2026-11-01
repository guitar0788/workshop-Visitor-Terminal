import { CARD_THEMES, LEGACY_CARD_THEMES, isCardTheme, cardArtwork, type CardTheme } from "./card-art";
import { isApprovedTheme, approvedBackdrop, approvedCountMarkup,
  defaultApprovedCountLayer, approvedCanvasWidth, approvedReferenceIsPristine, REFERENCE_HEIGHT }
  from "./approved-reference-cards";
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
  labelX: number; labelY: number; captionSize: number; captionWidth: number;
}> = {
  "pixel-card": { accent:"#263b4f", background:"#84d4ff", heading:"WORKSHOP VISITORS", caption:"PIXEL GARDEN",
    titleX:246,titleY:48,titleWidth:276,titleSize:19,countX:258,countY:92,countWidth:258,countSize:50,labelX:258,labelY:162,captionSize:9,captionWidth:235 },
  "modern-card": { accent:"#223663", background:"#f4f8ff", heading:"WORKSHOP VISITORS", caption:"TOTAL VISITS",
    titleX:220,titleY:57,titleWidth:297,titleSize:21,countX:219,countY:99,countWidth:300,countSize:52,labelX:222,labelY:172,captionSize:9,captionWidth:235 },
  "terminal-card": { accent:"#42f99e", background:"#0b2420", heading:"WORKSHOP VISITORS", caption:"SYSTEM ONLINE",
    titleX:86,titleY:80,titleWidth:458,titleSize:22,countX:86,countY:122,countWidth:397,countSize:52,labelX:86,labelY:179,captionSize:9,captionWidth:285 },
  "cozy-card": { accent:"#72432e", background:"#fff1df", heading:"WORKSHOP VISITORS", caption:"THANK YOU FOR VISITING",
    titleX:248,titleY:65,titleWidth:263,titleSize:21,countX:244,countY:104,countWidth:266,countSize:52,labelX:253,labelY:171,captionSize:9,captionWidth:238 },
  "rpg-card": { accent:"#f9e7b6", background:"#1a3460", heading:"WORKSHOP VISITORS", caption:"LEVEL UP · THANK YOU",
    titleX:245,titleY:61,titleWidth:330,titleSize:20,countX:246,countY:102,countWidth:311,countSize:48,labelX:248,labelY:172,captionSize:9,captionWidth:320 },
  "space-card": { accent:"#fff7ff", background:"#171a50", heading:"WORKSHOP VISITORS", caption:"EXPLORING THE STARS",
    titleX:99,titleY:63,titleWidth:350,titleSize:22,countX:99,countY:105,countWidth:347,countSize:48,labelX:101,labelY:174,captionSize:9,captionWidth:300 },
  "notebook-card": { accent:"#67432d", background:"#fff8ec", heading:"WORKSHOP VISITORS", caption:"MY VISITOR NOTES",
    titleX:107,titleY:57,titleWidth:337,titleSize:23,countX:117,countY:100,countWidth:344,countSize:48,labelX:111,labelY:174,captionSize:9,captionWidth:260 },
  "neon-card": { accent:"#f4ecff", background:"#141336", heading:"WORKSHOP VISITORS", caption:"DIGITAL SIGNAL · ACTIVE",
    titleX:235,titleY:62,titleWidth:322,titleSize:23,countX:238,countY:102,countWidth:314,countSize:48,labelX:239,labelY:175,captionSize:9,captionWidth:302 },
  "minimal-card": { accent:"#1e583d", background:"#ecfff2", heading:"WORKSHOP", caption:"VISITORS",
    titleX:233,titleY:76,titleWidth:191,titleSize:22,countX:443,countY:89,countWidth:128,countSize:31,labelX:234,labelY:111,captionSize:22,captionWidth:180 },
  "mc-overworld": { accent:"#d4f8b1", background:"#123039", heading:"OVERWORLD VISITORS", caption:"BLOCKS EXPLORED  /  WORLD ONLINE",
    titleX:251,titleY:53,titleWidth:308,titleSize:20,countX:251,countY:96,countWidth:311,countSize:51,labelX:251,labelY:157,captionSize:11,captionWidth:310 },
  "mc-nether": { accent:"#ffe1a3", background:"#251323", heading:"NETHER TRAVELERS", caption:"PORTAL ACTIVE  /  KEEP EXPLORING",
    titleX:252,titleY:54,titleWidth:302,titleSize:20,countX:252,countY:98,countWidth:312,countSize:50,labelX:252,labelY:158,captionSize:10,captionWidth:310 },
  "mc-end": { accent:"#e8d6ff", background:"#1d1534", heading:"THE END EXPLORERS", caption:"BEYOND THE PORTAL  /  VOID SAFE",
    titleX:254,titleY:54,titleWidth:300,titleSize:20,countX:254,countY:99,countWidth:308,countSize:50,labelX:254,labelY:159,captionSize:10,captionWidth:300 }
};
function makeCardPreset(theme: CardTheme): TerminalDesign {
  if (isApprovedTheme(theme)) {
    const countLayer = defaultApprovedCountLayer(theme);
    const bg = theme === "pixel-card" ? "#112039" :
      theme === "terminal-card" ? "#051f1a" : "#072d67";
    return { schemaVersion:1, theme, width:approvedCanvasWidth(theme),
      height:REFERENCE_HEIGHT, background:bg, accent:countLayer.color,
      // Headings, characters and ornaments are fixed in the approved artwork.
      // Only the live visitor counter can be moved or edited independently.
      layers:[countLayer] };
  }
  const c = CARD_CONFIG[theme];
  const layers: Layer[] = [
    { id:"heading", kind:"text", x:c.titleX, y:c.titleY, width:c.titleWidth,
      height:30, text:c.heading, fontSize:c.titleSize, color:c.accent, visible:true },
    { id:"visits", kind:"count", x:c.countX, y:c.countY, width:c.countWidth,
      height:61, text:"", fontSize:c.countSize, color:c.accent, visible:true },
    { id:"caption", kind:"text", x:c.labelX, y:c.labelY, width:c.captionWidth,
      height:28, text:c.caption, fontSize:c.captionSize, color:c.accent, visible:theme === "minimal-card" || theme.startsWith("mc-") }
  ];
  return { schemaVersion:1, theme, width:600, height:210,
    background:c.background, accent:c.accent, layers };
}

export const presets: Record<Theme, TerminalDesign> = {
  pixel: makePreset("pixel"), minimal: makePreset("minimal"), cyber: makePreset("cyber"),
  ...Object.fromEntries([...CARD_THEMES, ...LEGACY_CARD_THEMES].map(theme =>
    [theme, makeCardPreset(theme)])) as Record<CardTheme, TerminalDesign>
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
  if (isApprovedTheme(d.theme)) {
    // Exact user-approved raster illustration; no redraw or external URL.
    const countLayer = d.layers.find(layer => layer.kind === "count");
    const pristine = approvedReferenceIsPristine(d.theme, counter, countLayer ?? null);
    parts.push(approvedBackdrop(d.theme, d.width, d.height, !pristine));
    parts.push(approvedCountMarkup(d.theme, counter, countLayer ?? null, scope));
  } else if (isCardTheme(d.theme)) {
    // All other six illustrated cards retain their existing vector artwork.
    parts.push('<g transform="scale(', String(d.width / 600), ' ', String(d.height / 210),
      ')">', scopedCardArtwork(cardArtwork(d.theme), scope), '</g>');
  } else {
    parts.push('<rect x="2" y="2" width="', String(d.width - 4),
      '" height="', String(d.height - 4), '" rx="', d.theme === "pixel" ? "2" : "12",
      '" fill="', d.background, '" stroke="', d.accent,
      '" stroke-width="', d.theme === "minimal" ? "1" : "3", '"/>');
  }
  for (const layer of d.layers) {
    // Approved image card draws its one real count in the reference-specific
    // compositing pass. Do not duplicate it over the pristine raster digits.
    if (isApprovedTheme(d.theme) && layer.kind === "count") continue;
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
