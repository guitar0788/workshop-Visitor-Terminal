import { describe, expect, it } from "vitest";
import { escapeXml, renderSvg, presets, sanitizeDesign } from "./model";
describe("SVG renderer", () => {
  it("escapes user text", () => { expect(escapeXml('<hello&"')).toBe("&lt;hello&amp;&quot;"); });
  it("prevents markup injection", () => { expect(renderSvg({ ...presets.pixel, title: '<script>alert(1)</script>' }, 12)).not.toContain("<script>"); });
  it("clamps width and invalid colors", () => { const d = sanitizeDesign({ ...presets.pixel, width: 99999, accent: "red" }); expect(d.width).toBe(800); expect(d.accent).toBe("#7ee787"); });
  it("handles invalid counts", () => { expect(renderSvg(presets.pixel, Number.NaN)).toContain(">0</text>"); });
});
