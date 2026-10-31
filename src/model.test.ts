import { describe, expect, it } from "vitest";
import {
  addLayer, clonePreset, escapeXml, moveLayer,
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
