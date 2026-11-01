import { describe, expect, it } from "vitest";
import { clonePreset, renderSvg } from "./model";
import {
  createLocalizedPreset, resolveLanguage, translations, type Language
} from "./i18n";

describe("Studio bilingual UI", () => {
  it("uses the browser's first locale when no valid explicit preference exists", () => {
    expect(resolveLanguage(null, ["zh-CN", "en-US"])).toBe("zh-CN");
    expect(resolveLanguage(null, ["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveLanguage(null, ["zh-TW"])).toBe("zh-CN");
    expect(resolveLanguage(null, ["en-US", "zh-CN"])).toBe("en");
    expect(resolveLanguage(null, ["fr-FR", "zh-CN"])).toBe("en");
    expect(resolveLanguage(null, [])).toBe("en");
  });

  it("honors an explicit language choice even when the browser differs", () => {
    expect(resolveLanguage("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveLanguage("en", ["zh-CN"])).toBe("en");
    expect(resolveLanguage("invalid", ["zh-CN"])).toBe("zh-CN");
  });

  it("has nonempty matching keys in English and Simplified Chinese", () => {
    const english = Object.keys(translations.en).sort();
    const chinese = Object.keys(translations["zh-CN"]).sort();
    expect(chinese).toEqual(english);
    for (const language of ["en", "zh-CN"] as Language[]) {
      expect(Object.values(translations[language]).every(value => value.trim().length > 0)).toBe(true);
    }
  });

  it("builds locally translated starter text without altering reusable presets", () => {
    const original = clonePreset("pixel");
    const chinese = createLocalizedPreset("pixel", "zh-CN");
    const english = createLocalizedPreset("pixel", "en");
    expect(chinese.layers.find(layer => layer.id === "heading")?.text).toBe("工坊访客终端");
    expect(chinese.layers.find(layer => layer.id === "caption")?.text).toBe("累计访问量");
    expect(english.layers.find(layer => layer.id === "heading")?.text).toBe("WORKSHOP TERMINAL");
    expect(original).toEqual(clonePreset("pixel"));
    expect(renderSvg(chinese, 12856)).toContain("工坊访客终端");
  });

  it("never changes an existing design when switching interface language", () => {
    const design = createLocalizedPreset("pixel", "zh-CN");
    design.layers[0].text = "我自己的终端 / My terminal";
    const before = JSON.stringify(design);
    for (const language of ["en", "zh-CN"] as Language[]) {
      const ui = translations[language];
      expect(ui.heading).toBeTruthy();
      expect(JSON.stringify(design)).toBe(before);
    }
  });

  it("provides localized initial content for all preset themes", () => {
    for (const theme of ["pixel", "cyber", "minimal"] as const) {
      const zh = createLocalizedPreset(theme, "zh-CN");
      expect(zh.layers.find(layer => layer.id === "heading")?.text).toMatch(/[\u4e00-\u9fff]/);
      expect(zh.layers.find(layer => layer.id === "status")?.text).toMatch(/[\u4e00-\u9fff]/);
      expect(zh.theme).toBe(theme);
    }
  });
});

describe("Minecraft-style bilingual card labels", () => {
  it("localizes all three new voxel scenes without altering old presets", () => {
    const examples = [["mc-overworld","主世界访客"],["mc-nether","下界探索者"],
      ["mc-end","末地探索者"]] as const;
    for(const [theme,title] of examples) {
      const en=createLocalizedPreset(theme,"en");
      const zh=createLocalizedPreset(theme,"zh-CN");
      expect(en.theme).toBe(theme);
      expect(zh.layers.find(layer=>layer.id==="heading")?.text).toBe(title);
      expect(en.layers.find(layer=>layer.id==="heading")?.text).not.toBe(title);
      expect(renderSvg(zh,100)).toContain(title);
      expect(clonePreset(theme)).toEqual(en);
    }
    expect(translations.en.cardTemplates).toContain("6");
    expect(translations["zh-CN"].cardTemplates).toContain("6");
  });
});
