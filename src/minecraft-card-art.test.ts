import { describe, expect, it } from "vitest";
import {
  isMinecraftTheme, minecraftArtwork, MINECRAFT_THEMES
} from "./minecraft-card-art";

describe("v0.6.1 image-authored Minecraft-inspired cards", () => {
  it("ships three distinct self-contained 600x210 WebP plates", () => {
    const plates = new Set<string>();
    for (const theme of MINECRAFT_THEMES) {
      expect(isMinecraftTheme(theme)).toBe(true);
      const markup = minecraftArtwork(theme);
      expect(markup).toContain('width="600" height="210"');
      expect(markup).not.toMatch(/<path|<rect|<polygon|<script|<foreignObject|https?:/i);
      const image = markup.match(/href="data:image\/webp;base64,([A-Za-z0-9+/=]+)"/)?.[1];
      expect(image).toBeTruthy();
      const decoded = atob(image!);
      expect(decoded.length).toBeGreaterThan(4000);
      expect(decoded.length).toBeLessThan(25000);
      expect(decoded.slice(0, 4)).toBe("RIFF");
      expect(decoded.slice(8, 12)).toBe("WEBP");
      plates.add(image!);
    }
    expect(plates.size).toBe(3);
    expect(isMinecraftTheme("pixel-card")).toBe(false);
  });
});
