import { describe, expect, it } from "vitest";
import { CARD_THEMES } from "./card-art";
import {
  clonePreset, renderSvg, sanitizeDesign, svgInstanceScope,
  type TerminalDesign
} from "./model";
import { parseDesignFile } from "./design-file";
import {
  legacyMinecraftArtwork
} from "./minecraft-card-legacy-art";
import {
  MINECRAFT_THEMES
} from "./minecraft-card-art";

/** An actual schema-v1 v0.6 saved card: no artworkVersion field exists. */
function originalSavedDesign(theme: typeof MINECRAFT_THEMES[number]): TerminalDesign {
  const design: TerminalDesign = JSON.parse(JSON.stringify(clonePreset(theme)));
  delete design.artworkVersion;
  return design;
}

describe("v0.6 Minecraft card visual compatibility", () => {
  it("preserves original saved Overworld, Nether and End card scenes indefinitely", () => {
    const oldSceneMarkers = ["ovsky", "lavaGlow", "eGlow"];
    for (const [index, theme] of MINECRAFT_THEMES.entries()) {
      const old = originalSavedDesign(theme);
      const newPreset = clonePreset(theme);
      expect(old.artworkVersion).toBeUndefined();
      expect(newPreset.artworkVersion).toBe("v061");
      const restored = sanitizeDesign(JSON.parse(JSON.stringify(old)));
      expect(restored).toEqual(old);
      expect(parseDesignFile(JSON.stringify(old))).toEqual(old);
      const oldSvg = renderSvg(restored, 12_847);
      const revisedSvg = renderSvg(newPreset, 12_847);
      expect(oldSvg).toContain(oldSceneMarkers[index]);
      expect(legacyMinecraftArtwork(theme)).toContain(oldSceneMarkers[index]);
      expect(oldSvg).not.toMatch(/<image\b/);
      expect(oldSvg).toContain(">12,847</text>");
      expect(revisedSvg).toContain('href="data:image/webp;base64,');
      expect(revisedSvg.match(/<image\b/g)).toHaveLength(1);
      expect(revisedSvg).not.toContain(oldSceneMarkers[index]);
      expect(parseDesignFile(JSON.stringify(newPreset))).toEqual(newPreset);
      expect(svgInstanceScope(old, "12,847"))
        .not.toBe(svgInstanceScope(newPreset, "12,847"));
      const newCount = renderSvg(restored, 12_848);
      expect(newCount).toContain(">12,848</text>");
      expect(newCount).not.toContain(">12,847</text>");
      expect(newCount).not.toMatch(/<image\b/);
    }
  });

  it("does not change approved or classic templates with the new artwork marker", () => {
    for (const theme of ["pixel", "cyber", "minimal", ...CARD_THEMES.filter(t => !t.startsWith("mc-"))] as const) {
      const preset = clonePreset(theme);
      expect(preset.artworkVersion).toBeUndefined();
      expect(sanitizeDesign({...preset, artworkVersion:"v061"})).toEqual(preset);
      expect(()=>parseDesignFile(JSON.stringify({...preset, artworkVersion:"v061"}))).toThrow();
    }
  });

  it("rejects invalid artwork versions on strict import and strips them on runtime restore", () => {
    const old = originalSavedDesign("mc-overworld");
    for (const wrong of ["v062", "legacy", "<script>", null, 1, true, {}]) {
      expect(()=>parseDesignFile(JSON.stringify({...old, artworkVersion:wrong}))).toThrow();
      expect(sanitizeDesign({...old, artworkVersion:wrong})).toEqual(old);
    }
    expect(sanitizeDesign({...old, artworkVersion:"v061"}).artworkVersion).toBe("v061");
  });

  it("keeps edition identity when editing text and changing count", () => {
    for (const theme of MINECRAFT_THEMES) {
      const newDesign = clonePreset(theme);
      const updated = sanitizeDesign({...newDesign,
        layers:newDesign.layers.map(layer => layer.id==="heading" ? {...layer, text:"MY WORLD"} : layer)});
      expect(updated.artworkVersion).toBe("v061");
      expect(renderSvg(updated, 0)).toContain("MY WORLD");
      expect(renderSvg(updated, 0)).toContain(">0</text>");
      expect(renderSvg(updated, 0)).toContain("data:image/webp;base64,");
    }
  });
});
