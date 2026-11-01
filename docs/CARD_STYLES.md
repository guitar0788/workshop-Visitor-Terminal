# Studio illustrated card catalog (v0.6 draft)

Workshop Studio now offers **six illustrated presets**. This is a source-only draft catalog, not a deployed release.

| Selectable card ID | Label | Artwork |
| --- | --- | --- |
| `pixel-card` | Pixel Cat | The owner's approved original illustration; embedded self-contained AVIF-backed SVG |
| `terminal-card` | Green Terminal | The owner's approved original illustration; embedded self-contained AVIF-backed SVG |
| `rpg-card` | Blue-Gold RPG | The owner's approved original illustration; embedded self-contained AVIF-backed SVG |
| `mc-overworld` | Minecraft · Overworld / 我的世界 · 主世界 | Original square-block landscape: grass cube, tree, pickaxe, blue sky |
| `mc-nether` | Minecraft · Nether / 我的世界 · 下界 | Original lava and portal illustration |
| `mc-end` | Minecraft · The End / 我的世界 · 末地 | Original violet void, floating island, crystal and dragon silhouette |

The three new voxel scenes are **original, Minecraft-inspired fan-style graphics**, not copied game textures, official logos or assets. Their count/heading/caption are editable layers and are dynamically updated by the same Worker SVG renderer. No external images or fonts are fetched for these three scenes.

## Retired from the new-template picker

`modern-card`, `cozy-card`, `space-card`, `notebook-card`, `neon-card`, and `minimal-card` are **not selectable for creating new designs**. Their prior designs remain readable/renderable so existing published counters and saved JSON do not silently revert to a different style. They are not included in the six-card visual gallery. The three preexisting v0.5 classic presets (`pixel`, `cyber`, `minimal`) are separate and remain available.

The draft's headless Chrome visual audit produces 12 actual SVG views (six styles × two count sizes) and verifies rendered text bounds, overlap and scoped SVG identifiers. The three previously approved AVIF-backed illustrations are separately tested as `<img>` and against static GitHub Markdown; that does not verify a real remote Cloudflare counter's caching or independent-billing behavior.

The v0.6 release is still blocked by [Issue #22](https://github.com/guitar0788/workshop-Visitor-Terminal/issues/22). No production Worker, D1 database, GitHub Pages deployment or `main` changes are implied by this catalog.
