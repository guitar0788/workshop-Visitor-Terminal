import { describe, expect, it } from "vitest";
import {
  addLayer, CARD_THEMES, clonePreset, escapeXml, fittedCountSize, moveLayer,
  renderSvg, reorderLayer, sanitizeDesign
} from "./model";

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
  it("delivers nine independent original card templates with editable live counts", () => {
    expect(CARD_THEMES).toHaveLength(9);
    expect(new Set(CARD_THEMES).size).toBe(9);
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
      expect(first).not.toMatch(/<script|<foreignObject|<image|href=|url\(https?:/i);
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
      const hostile = sanitizeDesign({
        ...design,
        theme,
        accent: 'url("https://evil.example")',
        layers: [{ ...design.layers[0], text: '<image href="https://evil.example"/>' },
          design.layers[1]]
      });
      const output = renderSvg(hostile, 4);
      expect(output).not.toContain('<image');
      expect(output).not.toContain('href="https://evil.example"');
      expect(output).not.toContain('fill="url(&quot;https://evil.example&quot;)"');
      expect(output).toContain("&lt;image");
      expect(output).toContain(">4</text>");
      expect(hostile.layers).toHaveLength(2);
      expect(hostile.accent).toBe(design.accent);
    }
  });

  it("changes customizable text/count layers without losing the illustrated scene", () => {
    const design = clonePreset("pixel-card");
    design.layers[0].text = "My Workshop";
    design.layers[0].color = "#aabbcc";
    const svg = renderSvg(design, 25);
    expect(svg).toContain("My Workshop");
    expect(svg).toContain('fill="#aabbcc"');
    expect(svg).toContain("25 visits");
    expect(svg).toContain("rect");
    expect(renderSvg({ ...design, width: 600, height: 300 }, 25))
      .toContain("scale(1.4285714285714286 1.3636363636363635)");
  });
});


describe("formatted count fit and long-term visitor growth", () => {
  it("keeps 5-digit values at the intended template font size", () => {
    for (const theme of CARD_THEMES) {
      const design = clonePreset(theme);
      const layer = design.layers.find(layer => layer.kind === "count")!;
      expect(fittedCountSize(layer, "12,847")).toBe(layer.fontSize);
      const svg = renderSvg(design, 12_847);
      expect(svg).toContain('font-size="' + layer.fontSize + '"');
    }
  });

  it("shrinks 12-digit counts to fit all nine illustrated count boxes", () => {
    for (const theme of CARD_THEMES) {
      const d = clonePreset(theme);
      const counter = "999,999,999,999";
      const layer = d.layers.find(l => l.kind === "count")!;
      const sized = fittedCountSize(layer, counter);
      expect(sized).toBeLessThan(layer.fontSize);
      expect(sized).toBeGreaterThanOrEqual(8);
      expect(sized * counter.length * 0.63).toBeLessThanOrEqual(layer.width - 4);
      const svg = renderSvg(d, 999_999_999_999);
      expect(svg).toContain('font-size="' + sized + '"');
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
