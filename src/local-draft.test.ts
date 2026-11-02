import { describe, expect, it } from "vitest";
import { addLayer, clonePreset, sanitizeDesign } from "./model";
import {
  DRAFT_STORAGE_KEY, MAX_DRAFT_LENGTH, restoreLocalDraft, saveLocalDraft,
  type DraftStorage
} from "./local-draft";

function fakeStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); }
  };
}

describe("local-only Studio draft persistence", () => {
  it("restores edited Minecraft art and all six selectable styles without changing defaults", () => {
    for (const theme of ["pixel-card", "terminal-card", "rpg-card",
      "mc-overworld", "mc-nether", "mc-end"] as const) {
      const storage = fakeStorage();
      const original = clonePreset(theme);
      const withText = addLayer(original, "text", "private_caption");
      const design = sanitizeDesign({
        ...withText, layers: withText.layers.map(layer =>
          layer.id === "private_caption" ? { ...layer, text: "My edited world" } : layer)
      });
      expect(saveLocalDraft(storage, design)).toBe(true);
      expect(restoreLocalDraft(storage)).toEqual(design);
      expect(clonePreset(theme)).toEqual(original);
    }
  });

  it("saves only sanitized design fields, never arbitrary authentication metadata", () => {
    const storage = fakeStorage();
    const raw = {
      ...clonePreset("mc-nether"),
      accessToken: "must-not-store-this-token",
      adminToken: "must-not-store-this-secret",
      account: { githubId: "123" },
      layers: [{...clonePreset("mc-nether").layers[0], text: "<img onerror=bad>"}]
    };
    expect(saveLocalDraft(storage, raw)).toBe(true);
    const saved = storage.data.get(DRAFT_STORAGE_KEY)!;
    expect(saved).not.toContain("must-not-store-this");
    expect(saved).not.toContain("githubId");
    expect(restoreLocalDraft(storage)?.layers[0].text).toBe("<img onerror=bad>");
  });

  it("rejects unsupported versions, unknown presets, invalid JSON and oversized payloads", () => {
    const storage = fakeStorage();
    expect(restoreLocalDraft(storage)).toBeNull();
    const sample = clonePreset("mc-overworld");
    for (const raw of [
      "{ invalid json", JSON.stringify({...sample, schemaVersion: 2}),
      JSON.stringify({...sample, theme: "other-theme"}),
      JSON.stringify({...sample, layers: "not an array"}),
      "x".repeat(MAX_DRAFT_LENGTH + 1)
    ]) {
      storage.data.set(DRAFT_STORAGE_KEY, raw);
      expect(restoreLocalDraft(storage)).toBeNull();
    }
  });

  it("continues editing when browser storage is disabled or throws", () => {
    const broken: DraftStorage = {
      getItem() { throw Error("Storage denied"); },
      setItem() { throw Error("Quota exceeded"); }
    };
    const design = clonePreset("mc-end");
    expect(restoreLocalDraft(broken)).toBeNull();
    expect(saveLocalDraft(broken, design)).toBe(false);
    expect(saveLocalDraft(null, design)).toBe(false);
    expect(restoreLocalDraft(null)).toBeNull();
  });
});
