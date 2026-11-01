import { describe, expect, it } from "vitest";
import {
  addLayer, CARD_THEMES, clonePreset, escapeXml, fittedCountSize, moveLayer,
  renderSvg, reorderLayer, sanitizeDesign
} from "./model";
import { isApprovedTheme, approvedCanvasWidth } from "./approved-reference-cards";

describe("visitor terminal SVG layer model", () => {
  it("starts with editable layers and isolated presets", () => {
    const a = clonePreset("pixel");
    const b = clonePreset("pixel");
    a.layers[0].text = "CHANGED";
    expect(b.layers[0].text).toBe("WORKSHOP TERMINAL");
    expect(a.layers.some(layer => layer.kind === "count")).toBe(true);
  });

  it("escapes all SVG text characters", () => {
    expect(escapeXml('<hello&"')).toBe("&lt;hello&amp;&quot;");
    const design = clonePreset("pixel");
    design.layers[0].text = '<script>alert("hello")</script>';
    const svg = renderSvg(design, 125);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain(">125</text>");
  });

  it("does not render hidden layers", () => {
    const design = clonePreset("minimal");
    const status = design.layers.find(layer => layer.id === "status")!;
    status.visible = false;
    expect(renderSvg(design, 3)).not.toContain("THANKS FOR VISITING");
  });

  it("clamps invalid dimensions, colors, positions and text", () => {
    const design = clonePreset("pixel");
    const bad = sanitizeDesign({
      ...design, width: 99999, background: "url(evil)", accent: "red",
      layers: [{ ...design.layers[0], x: -12, y: 5000, width: 10000, fontSize: 200, color: "javascript:foo" }]
    });
    expect(bad.width).toBe(800);
    expect(bad.background).toBe("#101820");
    expect(bad.accent).toBe("#7ee787");
    expect(bad.layers[0].width).toBe(800);
    expect(bad.layers[0].x).toBe(0);
    expect(bad.layers[0].y).toBe(196);
    expect(bad.layers[0].fontSize).toBe(80);
    expect(bad.layers[0].color).toBe("#7ee787");
  });

  it("ignores unknown kinds and unsafe IDs", () => {
    const original = clonePreset("pixel");
    const design = sanitizeDesign({
      ...original, layers: [
        { ...original.layers[0], id: '"><script>', kind: "text" },
        { ...original.layers[1], kind: "iframe" }
      ]
    });
    expect(design.layers).toHaveLength(1);
    expect(design.layers[0].id).toBe("layer_0");
  });

  it("keeps dragged layers inside the canvas", () => {
    const design = clonePreset("pixel");
    const moved = moveLayer(design, "heading", 10000, -1000);
    const heading = moved.layers.find(layer => layer.id === "heading")!;
    expect(heading.x).toBe(design.width - heading.width);
    expect(heading.y).toBe(0);
    expect(design.layers.find(layer => layer.id === "heading")!.x).toBe(24);
  });

  it("reorders and adds layers without mutating the input", () => {
    const design = clonePreset("pixel");
    const ordered = reorderLayer(design, "heading", 1);
    expect(ordered.layers[1].id).toBe("heading");
    expect(design.layers[0].id).toBe("heading");
    const added = addLayer(ordered, "panel", "custom_1");
    expect(added.layers.at(-1)?.kind).toBe("panel");
    expect(addLayer(added, "panel", "custom_1")).toBe(added);
  });

  it("handles invalid count and sanitizes arbitrary objects", () => {
    expect(renderSvg(clonePreset("pixel"), Number.NaN)).toContain(">0</text>");
    const svg = renderSvg({ theme: "cyber", layers: "bad", width: "wrong" }, 10);
    expect(svg).toContain("<svg");
    expect(svg).toContain("10 visits");
  });
});


describe("v0.6 illustrated visitor cards", () => {
  it("offers six illustrated cards with live editable visitor counts", () => {
    expect(CARD_THEMES).toHaveLength(6);
    expect(new Set(CARD_THEMES).size).toBe(6);
    for (const theme of CARD_THEMES) {
      const design = clonePreset(theme);
      expect(design.theme).toBe(theme);
      expect(design.layers.find(layer => layer.kind === "count")?.visible).toBe(true);
      const first = renderSvg(design, 12_847);
      const updated = renderSvg(design, 12_848);
      expect(first).toContain("12,847 visits");
      expect(first).toContain(">12,847</text>");
      expect(updated).toContain(">12,848</text>");
      expect(updated).not.toContain(">12,847</text>");
      expect(first).toMatch(/<rect|<path|<circle/);
      expect(first).toContain("scale(1 1)");
      if (isApprovedTheme(theme)) {
        expect(first).toContain('href="data:image/avif;base64,');
        expect(first).not.toMatch(/<script|<foreignObject|href="https?:/i);
      } else {
        expect(first).not.toMatch(/<script|<foreignObject|<image|href=|url\(https?:/i);
      }
      expect(sanitizeDesign(JSON.parse(JSON.stringify(design)))).toEqual(design);
    }
  });

  it("keeps old pixel, minimal and cyber presets and SVG rendering unchanged", () => {
    for (const theme of ["pixel", "minimal", "cyber"] as const) {
      const design = clonePreset(theme);
      expect(design.layers).toHaveLength(5);
      expect(design.layers[0].id).toBe("heading");
      expect(renderSvg(design, 127)).toContain(">127</text>");
      expect(renderSvg(design, 127)).not.toContain("scale(1 1)");
    }
  });

  it("does not let imported designs inject SVG markup into card artwork or layers", () => {
    for (const theme of CARD_THEMES) {
      const design = clonePreset(theme);
      const injected = {
        ...design.layers[0],
        id: "hostile_label", kind: "text" as const,
        text: '<image href="https://evil.example"/>'
      };
      const live = design.layers.find(layer => layer.kind === "count")!;
      const hostile = sanitizeDesign({
        ...design, theme, accent: 'url("https://evil.example")',
        layers: [injected, live]
      });
      const output = renderSvg(hostile, 4);
      if (isApprovedTheme(theme)) {
        expect(output.match(/<image\b/g)).toHaveLength(1);
        expect(output).toContain('data:image/avif;base64,');
      } else {
        expect(output).not.toContain('<image');
      }
      expect(output).not.toContain('href="https://evil.example"');
      expect(output).not.toContain('fill="url(&quot;https://evil.example&quot;)"');
      expect(output).toContain("&lt;image");
      expect(output).toContain(">4</text>");
      expect(hostile.layers).toHaveLength(2);
      expect(hostile.accent).toBe(design.accent);
    }
  });

  it("changes customizable text/count layers without losing the illustrated scene", () => {
    const design = clonePreset("modern-card");
    design.layers[0].text = "My Workshop";
    design.layers[0].color = "#aabbcc";
    const svg = renderSvg(design, 25);
    expect(svg).toContain("My Workshop");
    expect(svg).toContain('fill="#aabbcc"');
    expect(svg).toContain("25 visits");
    expect(svg).toContain("rect");
    expect(renderSvg({ ...design, width: 600, height: 300 }, 25))
      .toContain("scale(1 1.4285714285714286)");
  });
});


describe("formatted count fit and long-term visitor growth", () => {
  it("keeps 5-digit values at the intended template font size", () => {
    for (const theme of CARD_THEMES) {
      const design = clonePreset(theme);
      const layer = design.layers.find(layer => layer.kind === "count")!;
      if (isApprovedTheme(theme)) continue;
      expect(fittedCountSize(layer, "12,847")).toBe(layer.fontSize);
      const svg = renderSvg(design, 12_847);
      expect(svg).toContain('font-size="' + layer.fontSize + '"');
    }
  });

  it("shrinks 12-digit counts to fit all selectable illustrated count boxes", () => {
    for (const theme of CARD_THEMES) {
      const d = clonePreset(theme);
      const counter = "999,999,999,999";
      const layer = d.layers.find(l => l.kind === "count")!;
      const sized = fittedCountSize(layer, counter);
      expect(sized).toBeLessThan(layer.fontSize);
      expect(sized).toBeGreaterThanOrEqual(8);
      expect(sized * counter.length * 0.63).toBeLessThanOrEqual(layer.width - 4);
      const svg = renderSvg(d, 999_999_999_999);
      if (!isApprovedTheme(theme)) expect(svg).toContain('font-size="' + sized + '"');
      expect(svg).toContain('>999,999,999,999</text>');
      expect(svg).toContain("999,999,999,999 visits");
    }
  });

  it("can render a complete count even in a user-customized very narrow layer", () => {
    const d = clonePreset("neon-card");
    const count = d.layers.find(l => l.kind === "count")!;
    count.width = 8;
    count.fontSize = 80;
    const output = renderSvg(d, 999_999_999_999);
    expect(output).toContain('textLength="4" lengthAdjust="spacingAndGlyphs"');
    expect(output).toContain('>999,999,999,999</text>');
    expect(output).not.toContain('href=');
  });

  it("does not change legacy exported markup for typical small values", () => {
    for (const theme of ["pixel","cyber","minimal"] as const) {
      const d = clonePreset(theme);
      const layer = d.layers.find(l => l.kind === "count")!;
      expect(fittedCountSize(layer, "125")).toBe(layer.fontSize);
      expect(renderSvg(d, 125)).toContain('>125</text>');
      expect(renderSvg(d, 125)).not.toContain('textLength=');
    }
  });
});


describe("inline gallery fragment isolation", () => {
  it("never shares a clip or gradient identifier across 12 rendered cards", () => {
    const ids = new Set<string>();
    let total = 0;
    for (const theme of CARD_THEMES) {
      for (const count of [12_847, 999_999_999_999]) {
        const svg = renderSvg(clonePreset(theme), count);
        const local = new Set<string>();
        for (const [, id] of svg.matchAll(/\bid="([^"]+)"/g)) {
          expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
          expect(ids.has(id)).toBe(false);
          expect(local.has(id)).toBe(false);
          ids.add(id);
          local.add(id);
          total++;
        }
        for (const [, refId] of svg.matchAll(/url\(#([a-zA-Z0-9_-]+)\)/g)) {
          expect(local.has(refId)).toBe(true);
        }
        expect(svg).not.toContain('id="clip-heading"');
        expect([...svg.matchAll(/<clipPath\b/g)]).toHaveLength(
          isApprovedTheme(theme) ? 1 : 3);
      }
    }
    expect(total).toBeGreaterThanOrEqual(24);
  });

  it("keeps SVG fragment targets distinct when a user moves a layer", () => {
    const initial = clonePreset("pixel-card");
    const moved = moveLayer(initial, "visits", 15, 0);
    const a = renderSvg(initial, 125);
    const b = renderSvg(moved, 125);
    const idsA = [...a.matchAll(/\bid="(clip-[^"]+)"/g)].map(v => v[1]);
    const idsB = [...b.matchAll(/\bid="(clip-[^"]+)"/g)].map(v => v[1]);
    expect(idsA).toHaveLength(1);
    expect(idsB).toHaveLength(1);
    expect(idsA.filter(x => idsB.includes(x))).toHaveLength(0);
  });
});


describe("visual fidelity — approved three plus three Minecraft-inspired voxel scenes", () => {
  it("uses the original wide-banner canvas instead of old tall placeholder proportions", () => {
    for (const theme of CARD_THEMES) {
      const card = clonePreset(theme);
      const isReference = isApprovedTheme(theme);
      expect(card.width).toBe(isReference ? approvedCanvasWidth(theme) : 600);
      expect(card.height).toBe(isReference ? 362 : 210);
      expect(card.layers.filter(l => l.kind === "count")).toHaveLength(1);
      expect(card.layers[0].visible).toBe(true);
      const actual = renderSvg(card, 12_847);
      expect(actual).toContain(isReference ?
        'width="' + approvedCanvasWidth(theme) + '" height="362" viewBox="0 0 ' + approvedCanvasWidth(theme) + ' 362"' :
        'width="600" height="210" viewBox="0 0 600 210"');
      if (!isReference) expect(actual).toContain('scale(1 1)');
      expect(actual).toContain('>12,847</text>');
      expect(actual).not.toContain('>999,999,999,999</text>');
    }
    const old = clonePreset("pixel");
    expect(old.width).toBe(420);
    expect(old.height).toBe(220);
  });

  it("renders distinct actual vector scenes rather than switching only colors or text", () => {
    const scenes = CARD_THEMES.map(theme => renderSvg(clonePreset(theme), 12_847));
    expect(new Set(scenes).size).toBe(6);
    for (const [i, svg] of scenes.entries()) {
      const theme = CARD_THEMES[i];
      if (isApprovedTheme(theme)) {
        expect(svg).toContain('data:image/avif;base64,');
        expect(svg.match(/<image\b/g)).toHaveLength(1);
      } else {
        expect(svg.match(/<(?:path|rect|circle|ellipse)\b/g)?.length ?? 0).toBeGreaterThan(8);
        expect(svg).not.toMatch(/<image\b|<script\b|<foreignObject\b|\shref\s*=/i);
      }
      expect(svg).toContain("<defs>");
    }
    expect(scenes[3]).toContain("ovsky");
    expect(scenes[4]).toContain("lavaGlow");
    expect(scenes[5]).toContain("eGlow");
  });
});

describe("exact approved raster cards, and nothing else", () => {
  it("bundles the approved three-card artwork without external URLs", () => {
    for (const theme of ["pixel-card","terminal-card","rpg-card"] as const) {
      const art=renderSvg(clonePreset(theme),12_847);
      expect(art.match(/<image\b/g)).toHaveLength(1);
      expect(art).toContain('href="data:image/avif;base64,');
      expect(art).not.toMatch(/href="https?:/i);
      expect(art).toContain('opacity="0"');
      expect(art).toContain('>12,847</text>');
      const updated=renderSvg(clonePreset(theme),12_848);
      expect(updated).toContain('>12,848</text>');
      expect(updated).not.toContain('>12,847</text>');
      expect(updated).not.toContain('opacity="0"');
    }
  });
  it("leaves all six other illustrated and three classic template widths unchanged", () => {
    for(const theme of CARD_THEMES.filter(t=>!isApprovedTheme(t))) {
      const card=clonePreset(theme);
      expect(card.width).toBe(600);
      expect(card.height).toBe(210);
      expect(renderSvg(card, 12_847)).not.toContain('data:image/avif');
    }
    for(const theme of ["pixel","minimal","cyber"] as const) {
      const card=clonePreset(theme);
      expect(card.width).toBe(420);
      expect(card.height).toBe(220);
    }
  });
});


describe("owner-approved 1 / 3 / 5 composition fidelity", () => {
  const visualFamilies = {
    "pixel-card": "Impact, Arial Black, sans-serif",
    "terminal-card": "Consolas, Menlo, monospace",
    "rpg-card": "Georgia, Times New Roman, serif"
  } as const;

  it("preserves exact source artwork at the approved 12,847 demo count", () => {
    for (const theme of Object.keys(visualFamilies) as Array<keyof typeof visualFamilies>) {
      const d = clonePreset(theme);
      const original = renderSvg(d, 12_847);
      const updated = renderSvg(d, 12_848);
      expect(original).toContain('data:image/avif;base64,');
      expect(original).toContain('data-count-layer="true"');
      expect(original).toContain('opacity="0"');
      expect(original).toContain('>12,847</text>');
      expect(updated).toContain('data-count-layer="true"');
      expect(updated).toContain('>12,848</text>');
      expect(updated).not.toContain('>12,847</text>');
      expect(updated).not.toContain('opacity="0"');
      // The clean plate is a separate source image; the original reference
      // pixels remain untouched at the approved demo count.
      const imageOf = (svg: string) =>
        svg.match(/<image\b[^>]*\shref="(data:image\/avif;base64,[^"]+)"/)?.[1];
      expect(imageOf(original)).toBeTruthy();
      expect(imageOf(updated)).toBeTruthy();
      expect(imageOf(original)).not.toBe(imageOf(updated));
      expect(updated).toContain('font-family="' + visualFamilies[theme] + '"');
    }
  });

  it("keeps other six illustrated cards free of embedded reference art", () => {
    for (const theme of CARD_THEMES.filter(theme => !isApprovedTheme(theme))) {
      const svg = renderSvg(clonePreset(theme), 12_848);
      expect(svg).not.toContain('data:image/avif;base64,');
      expect(svg).not.toMatch(/<image\b/);
    }
  });

  it("supports a real count of zero without ever displaying the original 12,847", () => {
    for (const theme of Object.keys(visualFamilies) as Array<keyof typeof visualFamilies>) {
      const svg = renderSvg(clonePreset(theme), 0);
      expect(svg).toContain('>0</text>');
      expect(svg).not.toContain('>12,847</text>');
      expect(svg).toContain('data-count-layer="true"');
      expect(svg).not.toContain('opacity="0"');
    }
  });
});


describe("selectable Minecraft styles and retired-card compatibility", () => {
  const active = ["pixel-card","terminal-card","rpg-card",
    "mc-overworld","mc-nether","mc-end"] as const;
  const retired = ["modern-card","cozy-card","space-card",
    "notebook-card","neon-card","minimal-card"] as const;

  it("only offers the approved three plus Overworld/Nether/End; all preserve real counts", () => {
    expect([...CARD_THEMES]).toEqual([...active]);
    for (const theme of active) {
      const svg = renderSvg(clonePreset(theme), 12_848);
      expect(svg).toContain(">12,848</text>");
      expect(svg).not.toContain("<script");
      expect(svg).not.toContain("https://");
      if (theme.startsWith("mc-")) {
        expect(svg).not.toMatch(/<image\b/);
        expect(svg).toContain('shape-rendering="crispEdges"');
      }
    }
  });

  it("can still reopen and render all six retired serialized designs", () => {
    for (const theme of retired) {
      expect(CARD_THEMES as readonly string[]).not.toContain(theme);
      const original=clonePreset(theme);
      const restored=sanitizeDesign(JSON.parse(JSON.stringify(original)));
      expect(restored.theme).toBe(theme);
      expect(restored).toEqual(original);
      expect(renderSvg(restored, 50)).toContain(">50</text>");
    }
  });

  it("keeps every approved illustrated card byte-for-byte consistent at demo count", () => {
    for (const theme of ["pixel-card","terminal-card","rpg-card"] as const) {
      const a=renderSvg(clonePreset(theme),12_847);
      expect(a).toContain('href="data:image/avif;base64,');
      expect(a).toContain('opacity="0"');
      expect(a).toContain('>12,847</text>');
    }
  });
});

describe("six illustrated-card editing and exported-design parity", () => {
  it("keeps custom labels and a live count through design JSON round trips", () => {
    for (const theme of CARD_THEMES) {
      const base = clonePreset(theme);
      const decorated = addLayer(base, "text", "personal_title");
      const edited = sanitizeDesign({
        ...decorated,
        layers: decorated.layers.map(layer => layer.id === "personal_title"
          ? { ...layer, text: "MY WORLD & WORKSHOP", color: "#abcd12", x: 12, y: 12 }
          : layer)
      });
      const restored = sanitizeDesign(JSON.parse(JSON.stringify(edited)));
      expect(restored).toEqual(edited);
      const original = renderSvg(base, 12_848);
      const rendered = renderSvg(restored, 12_848);
      expect(rendered).toContain("MY WORLD &amp; WORKSHOP");
      expect(rendered).toContain('fill="#abcd12"');
      expect(rendered).toContain(">12,848</text>");
      expect(rendered).not.toContain('<script');
      if (isApprovedTheme(theme)) {
        // Editing text overlays must preserve the approved raster plate.
        const image = (svg: string) =>
          svg.match(/<image\\b[^>]*href="(data:image\\/avif;base64,[^"]+)"/)?.[1];
        expect(image(rendered)).toBe(image(original));
      } else {
        expect(rendered).toContain('shape-rendering="crispEdges"');
      }
    }
  });

  it("does not silently discard extra count layers on approved raster cards", () => {
    for (const theme of ["pixel-card", "terminal-card", "rpg-card"] as const) {
      const original = clonePreset(theme);
      const withSecondCount = addLayer(original, "count", "custom_second_count");
      const restored = sanitizeDesign(JSON.parse(JSON.stringify(withSecondCount)));
      const rendered = renderSvg(restored, 12_848);
      expect([...rendered.matchAll(/>12,848<\\/text>/g)]).toHaveLength(2);
      expect([...rendered.matchAll(/<clipPath\\b/g)]).toHaveLength(2);

      // Hiding the original slot must not also hide the extra count.
      const hiddenMain = sanitizeDesign({
        ...restored, layers: restored.layers.map(layer =>
          layer.id === "visits" ? { ...layer, visible: false } : layer)
      });
      const hiddenSvg = renderSvg(hiddenMain, 12_848);
      expect([...hiddenSvg.matchAll(/>12,848<\\/text>/g)]).toHaveLength(1);
      expect(hiddenSvg).not.toContain('>12,847</text>');
      expect(hiddenSvg).not.toContain('href="https://');
    }
  });

  it("supports the same 12-digit visit count bound in all illustrated cards", () => {
    for (const theme of CARD_THEMES) {
      const design = clonePreset(theme);
      expect(renderSvg(design, 999_999_999_999)).toContain('>999,999,999,999</text>');
      expect(renderSvg(design, 1_000_000_000_000)).toContain('>999,999,999,999</text>');
    }
  });
});
