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

## Editing contract

- **Pixel Cat / Green Terminal / Blue-Gold RPG:** the owner-approved raster contains its original fixed title and ornaments. Only the dynamic count is an original editable slot. Additional text, shapes and count layers are **overlays**, not replacements for baked lettering. The original AVIF plate is preserved at 12,847; a cleaned version removes the baked digits when the value or main count layer changes. New count overlays must render independently of the main approved count.
- **Minecraft Overworld / Nether / End:** the scene is original built-in vector artwork; editable heading, caption and count layers are separate from that fixed backdrop. Changing text does not change the illustrated terrain or objects.
- **All illustrated cards:** the background is supplied by the artwork, so Studio hides the otherwise ineffective plain background picker. The accent setting controls the default color of newly added layers; existing layer colors remain individually editable. A 12-digit example count is supported in preview, standalone SVG and Worker rendering. Resizing through Studio now scales existing overlay positions and dimensions together with the illustrated background, instead of leaving text behind on the original canvas coordinates.
- **Touch-first editing:** On phones, adding an overlay opens its Properties sheet immediately. The preview offers a direct **Edit selected layer / 编辑当前图层** shortcut. **Duplicate layer / 复制图层** creates a copy immediately above the original, offset within the canvas, retaining text/style/visibility and treating the duplication as one undo/redo action. The 32-layer cap and approved background artwork do not change.
- **Cross-surface parity:** JSON export/import, browser-local draft restoration, live Studio preview, standalone SVG and D1 Worker SVG all use the same sanitized design/renderer. CI exercises actual local browser DOM/text/image decoding plus edited-design round trips; it does not demonstrate real independent Cloudflare billing or GitHub's live remote image-proxy cache.


## Retired from the new-template picker

`modern-card`, `cozy-card`, `space-card`, `notebook-card`, `neon-card`, and `minimal-card` are **not selectable for creating new designs**. Their prior designs remain readable/renderable so existing published counters and saved JSON do not silently revert to a different style. They are not included in the six-card visual gallery. The three preexisting v0.5 classic presets (`pixel`, `cyber`, `minimal`) are separate and remain available.

The draft's headless Chrome visual audit produces 12 actual SVG views (six styles × two count sizes) and verifies rendered text bounds, overlap and scoped SVG identifiers. All six illustrated styles are tested as external `<img>` SVGs (18 decoded examples); the three AVIF-backed illustrations are additionally checked against static GitHub Markdown; that does not verify a real remote Cloudflare counter's caching or independent-billing behavior.

The v0.6 release is still blocked by [Issue #22](https://github.com/guitar0788/workshop-Visitor-Terminal/issues/22). No production Worker, D1 database, GitHub Pages deployment or `main` changes are implied by this catalog.
