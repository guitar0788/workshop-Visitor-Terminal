/**
 * Exact illustration layer for the THREE explicitly approved card references.
 *
 * Important: the original art is supplied by the user-approved concept raster,
 * not re-drawn using guessed SVG primitives. The embedded AVIF is self-contained
 * and shared by editor preview, standalone SVG and the Worker endpoint. This
 * module intentionally does not affect the other six illustrated themes.
 *
 * Because the source art contains the demonstration value "12,847", the
 * baseline renders its original number region untouched. For any different
 * count we cover ONLY that region and draw the actual counter in an editable
 * text layer. Dynamic digits are a font reconstruction, not pixel-exact copies
 * of the concept artist's proprietary raster lettering.
 */
import { APPROVED_THREE_CARD_IMAGE, APPROVED_SOURCE_WIDTH, APPROVED_SOURCE_HEIGHT }
  from "./approved-three-card-image";
import { CLEANED_THREE_CARD_IMAGE } from "./approved-clean-card-image";

export const APPROVED_THEMES = ["pixel-card","terminal-card","rpg-card"] as const;
export type ApprovedTheme = typeof APPROVED_THEMES[number];
export const REFERENCE_WIDTH = 690;
export const REFERENCE_HEIGHT = 362;
export function approvedCanvasWidth(theme: ApprovedTheme): number { return REGION[theme].cropWidth; }
export const REFERENCE_DEMO_COUNT = "12,847";
export function isApprovedTheme(v: unknown): v is ApprovedTheme {
  return v === "pixel-card" || v === "terminal-card" || v === "rpg-card";
}

type CleanRegion = {
  cropX: number; cropWidth: number; x: number; y: number; width: number; height: number;
  textX: number; textY: number; fontSize: number; color: string;
};
const REGION: Record<ApprovedTheme, CleanRegion> = {
  "pixel-card": {
    cropX: 0, cropWidth: 690, x: 326, y: 180, width: 280, height: 88,
    textX: 334, textY: 179, fontSize: 68, color: "#122e61"
  },
  "terminal-card": {
    cropX: 705, cropWidth: 722, x: 154, y: 207, width: 270, height: 81,
    textX: 163, textY: 199, fontSize: 65, color: "#6bff9e"
  },
  "rpg-card": {
    cropX: 1450, cropWidth: 722, x: 315, y: 171, width: 331, height: 118,
    textX: 332, textY: 176, fontSize: 72, color: "#ffdf92"
  }
};

export function defaultApprovedCountLayer(theme: ApprovedTheme) {
  const region = REGION[theme];
  return {
    id: "visits", kind: "count" as const,
    x: region.textX, y: region.textY,
    width: region.width - 12, height: region.height - 10,
    text: "", fontSize: region.fontSize, color: region.color,
    visible: true
  };
}

/**
 * The reference is a single immutable image. Different crop windows are
 * positioned by translation: not redrawing, rasterizing or altering the
 * other six template artworks.
 */
export function approvedBackdrop(
  theme: ApprovedTheme, width: number, height: number, cleaned = false
): string {
  const c = REGION[theme];
  const sx = width / c.cropWidth;
  const sy = height / REFERENCE_HEIGHT;
  // A nested SVG viewport is mandatory: otherwise the full 2090px reference
  // image overflows neighboring inline gallery cards despite their viewBoxes.
  return '<g transform="scale(' + sx + ' ' + sy + ')">' +
    '<svg x="0" y="0" width="' + c.cropWidth + '" height="' +
    REFERENCE_HEIGHT + '" viewBox="0 0 ' + c.cropWidth + ' ' +
    REFERENCE_HEIGHT + '" overflow="hidden">' +
    '<image x="' + (-c.cropX) + '" y="0" width="' +
    APPROVED_SOURCE_WIDTH + '" height="' + APPROVED_SOURCE_HEIGHT +
    '" preserveAspectRatio="none" href="' +
    (cleaned ? CLEANED_THREE_CARD_IMAGE : APPROVED_THREE_CARD_IMAGE) + '"/>' +
    '</svg></g>';
}

export interface ApprovedCountLayer {
  x: number; y: number; width: number; height: number;
  fontSize: number; color: string; visible: boolean;
}
const isDefault = (theme: ApprovedTheme, layer: ApprovedCountLayer) => {
  const d = defaultApprovedCountLayer(theme);
  return layer.x===d.x && layer.y===d.y && layer.width===d.width &&
    layer.height===d.height && layer.fontSize===d.fontSize &&
    layer.color===d.color && layer.visible;
};

export function approvedReferenceIsPristine(
  theme: ApprovedTheme, counter: string, layer: ApprovedCountLayer | null
): boolean {
  return layer !== null && counter === REFERENCE_DEMO_COUNT &&
    isDefault(theme, layer);
}

export function approvedCountMarkup(theme: ApprovedTheme, counter: string,
  layer: ApprovedCountLayer | null, scope: string): string {
  const r = REGION[theme];
  const usePristineArt = approvedReferenceIsPristine(theme, counter, layer);
  const active = layer ?? defaultApprovedCountLayer(theme);
  const clipId = "clip-" + scope + "-visits";
  const clip = '<defs><clipPath id="' + clipId + '"><rect x="' + active.x +
    '" y="' + active.y + '" width="' + active.width + '" height="' +
    active.height + '"/></clipPath></defs>';
  // Keep the approved 12,847 pixels untouched when the exact demo is used.
  // Invisible text exposes the live number to DOM and automated QA.
  if (usePristineArt) {
    return clip + '<text clip-path="url(#' + clipId + ')" x="' +
      (active.x + 2) + '" y="' + (active.y + 2) +
      '" opacity="0" font-size="12" dominant-baseline="hanging"' +
      ' data-count-layer="true">' + counter + '</text>';
  }
  // Different live totals use the matching inpainted reference illustration,
  // which removes ONLY the original example numerals. No flat rectangles,
  // shadows over the shield, or original "47" ghost on the RPG frame.
  if (!layer?.visible) return "";
  const font = Math.max(8, Math.min(layer.fontSize,
    Math.floor((layer.width - 5) / (counter.length * 0.65)),
    Math.floor(layer.height * .78)));
  const x = layer.x;
  // Keep resized counts vertically centered at the approved numeral row.
  const y = layer.y + Math.ceil(layer.fontSize * .24) +
    Math.round((layer.fontSize - font) / 2);
  const shadow = theme === "rpg-card" ? ' stroke="#79401a" stroke-width="1.8" paint-order="stroke"' :
    theme === "terminal-card" ? ' stroke="#11522c" stroke-width="1" paint-order="stroke"' : "";
  return clip + '<text clip-path="url(#' + clipId + ')" x="' + x + '" y="' + y +
    '" fill="' + layer.color + '" font-size="' + font +
    '" font-family="ui-monospace, Consolas, Menlo, monospace"' +
    ' font-weight="800" dominant-baseline="hanging"' + shadow +
    ' data-count-layer="true">' + counter + '</text>';
}
