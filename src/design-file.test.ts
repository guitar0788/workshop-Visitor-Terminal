import { describe, expect, it } from "vitest";
import { CARD_THEMES, LEGACY_CARD_THEMES } from "./card-art";
import { clonePreset, type TerminalDesign } from "./model";
import { MAX_DESIGN_FILE_BYTES, parseDesignFile } from "./design-file";

function encode(design: unknown): string {
  return JSON.stringify(design);
}

function invalid(mutator: (design: TerminalDesign) => unknown): string {
  return encode(mutator(clonePreset("mc-nether")));
}

describe("strict, lossless Studio design-file import", () => {
  it("round-trips all current, retired and classic schema-v1 themes", () => {
    const themes = [
      ...CARD_THEMES, ...LEGACY_CARD_THEMES, "pixel", "minimal", "cyber"
    ] as const;
    for (const theme of themes) {
      const design = clonePreset(theme);
      expect(parseDesignFile(encode(design))).toEqual(design);
    }
  });

  it("imports older schema-v1 designs without alignment as left-aligned layers", () => {
    const current = clonePreset("mc-nether");
    const legacy = {
      ...current,
      layers: current.layers.map(({ textAlign: _textAlign, ...layer }) => layer)
    };
    const imported = parseDesignFile(encode(legacy));
    expect(imported).toEqual(current);
    expect(imported.layers.every(layer => layer.textAlign === "left")).toBe(true);
  });

  it("rejects malformed JSON, unsupported schema versions and unknown themes", () => {
    for (const json of [
      "", "{ broken", "null", "[]",
      invalid(d => ({ ...d, schemaVersion: 2 })),
      invalid(d => ({ ...d, theme: "unreleased-theme" }))
    ]) {
      expect(() => parseDesignFile(json)).toThrow();
    }
  });

  it("rejects invalid canvas dimensions and colors instead of silently clamping them", () => {
    for (const json of [
      invalid(d => ({ ...d, width: 99999 })),
      invalid(d => ({ ...d, height: 1 })),
      invalid(d => ({ ...d, width: "600" })),
      invalid(d => ({ ...d, background: "url(javascript:alert(1))" })),
      invalid(d => ({ ...d, accent: "#fff" }))
    ]) {
      expect(() => parseDesignFile(json)).toThrow();
    }
  });

  it("rejects malformed, unsupported, duplicated or excessive layers without dropping them", () => {
    const sample = clonePreset("mc-nether");
    const layer = sample.layers[0];
    const cases = [
      { ...sample, layers: "not-an-array" },
      { ...sample, layers: Array.from({ length: 33 }, (_, i) => ({ ...layer, id: "l" + i })) },
      { ...sample, layers: [null] },
      { ...sample, layers: [{ ...layer, id: "<script>" }] },
      { ...sample, layers: [layer, { ...layer }] },
      { ...sample, layers: [{ ...layer, kind: "iframe" }] },
      { ...sample, layers: [{ ...layer, x: sample.width }] },
      { ...sample, layers: [{ ...layer, width: sample.width + 1 }] },
      { ...sample, layers: [{ ...layer, fontSize: 1000 }] },
      { ...sample, layers: [{ ...layer, text: "x".repeat(121) }] },
      { ...sample, layers: [{ ...layer, text: "unsafe\u0001text" }] },
      { ...sample, layers: [{ ...layer, color: "red" }] },
      { ...sample, layers: [{ ...layer, visible: "yes" }] },
      { ...sample, layers: [{ ...layer, textAlign: "justify" }] }
    ];
    for (const value of cases) {
      expect(() => parseDesignFile(encode(value))).toThrow();
    }
  });

  it("enforces the UTF-8 byte limit, not only JavaScript character count", () => {
    const design = clonePreset("mc-nether");
    const json = encode({ ...design, harmlessNote: "界".repeat(22_000) });
    expect(json.length).toBeLessThan(MAX_DESIGN_FILE_BYTES);
    expect(new TextEncoder().encode(json).byteLength).toBeGreaterThan(MAX_DESIGN_FILE_BYTES);
    expect(() => parseDesignFile(json)).toThrow();
    expect(() => parseDesignFile("x".repeat(MAX_DESIGN_FILE_BYTES + 1))).toThrow();
  });

  it("discards unrelated metadata while preserving the exact supported design", () => {
    const design = clonePreset("mc-end");
    const imported = parseDesignFile(encode({
      ...design,
      accessToken: "must-not-enter-the-editor",
      adminToken: "must-not-enter-the-draft",
      account: { githubId: "private" },
      layers: design.layers.map(layer => ({ ...layer, unrelated: "metadata" }))
    }));
    expect(imported).toEqual(design);
    expect(JSON.stringify(imported)).not.toContain("must-not-enter");
    expect(JSON.stringify(imported)).not.toContain("githubId");
  });
});
