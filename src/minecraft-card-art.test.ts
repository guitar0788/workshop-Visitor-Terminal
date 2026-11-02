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
      const bytes = Buffer.from(image!, "base64");
      expect(bytes.length).toBeGreaterThan(4000);
      expect(bytes.length).toBeLessThan(25000);
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      plates.add(image!);
    }
    expect(plates.size).toBe(3);
    expect(isMinecraftTheme("pixel-card")).toBe(false);
  });
});
