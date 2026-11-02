# Studio illustrated card catalog (v0.6 web release)

Workshop Studio now offers **six illustrated presets**. These designs ship through the v0.6 web release path; the release remains subject to protected-main Verify and deployment acceptance.

| Selectable card ID | Label | Artwork |
| --- | --- | --- |
| `pixel-card` | Pixel Cat | The owner's approved original illustration; embedded self-contained AVIF-backed SVG |
| `terminal-card` | Green Terminal | The owner's approved original illustration; embedded self-contained AVIF-backed SVG |
| `rpg-card` | Blue-Gold RPG | The owner's approved original illustration; embedded self-contained AVIF-backed SVG |
| `mc-overworld` | Minecraft · Overworld / 我的世界 · 主世界 | New illustrated woodland, animals and waterfall pixel-world vignette |
| `mc-nether` | Minecraft · Nether / 我的世界 · 下界 | New illustrated fortress, magma falls, red fungus and cavern |
| `mc-end` | Minecraft · The End / 我的世界 · 末地 | New illustrated crystalline obsidian towers, purple void and End creatures |

The three Minecraft-inspired cards now use **new image-generated, artist-composited local WebP plates**, replacing the old procedurally constructed SVG shapes. They do not copy game textures, logos or original assets. The images contain no baked visitor count or editable text; heading, count and caption are independent SVG overlays rendered by the existing Worker. WebP is embedded directly into the standalone SVG, so no remote resource is fetched.

## Editing contract

- **Pixel Cat / Green Terminal / Blue-Gold RPG:** the owner-approved raster contains its original fixed title and ornaments. Only the dynamic count is an original editable slot. Additional text, shapes and count layers are **overlays**, not replacements for baked lettering. The original AVIF plate is preserved at 12,847; a cleaned version removes the baked digits when the value or main count layer changes. New count overlays must render independently of the main approved count.
- **Minecraft Overworld / Nether / End:** the backgrounds are image-authored 600 × 210 original raster scenes, not Python-generated SVG geometry. Heading, caption and count are separate editable overlays. Changing text cannot mutate the original image bytes.
- **All illustrated cards:** the background is supplied by the artwork, so Studio hides the otherwise ineffective plain background picker. The accent setting controls the default color of newly added layers; existing layer colors remain individually editable. A 12-digit example count is supported in preview, standalone SVG and Worker rendering. Resizing through Studio now scales existing overlay positions and dimensions together with the illustrated background, instead of leaving text behind on the original canvas coordinates.
- **Text layout:** text and visitor-count layers support left, center and right alignment. Alignment is stored in schema-v1 design JSON and rendered by the shared SVG model, including the editable count overlay on the three approved raster cards. Older schema-v1 backups without an alignment field remain valid and default to left alignment; unsupported alignment values are rejected during file import. The approved source illustrations themselves are not modified.
- **Gesture safety / 手机拖动安全：** On phones a normal tap selects a layer and retains vertical page scrolling; users must explicitly enable **Move layers / 移动图层** before touch dragging. A completed primary-pointer drag is one undoable action (including the final pointerup coordinates). A canceled touch, unexpected lost pointer capture, second finger, browser focus loss, or switching editing modes/tabs cannot commit an unintended move: the uncommitted preview is restored without consuming Undo or erasing Redo. Keyboard and precision controls remain separately undoable.
- **Touch-first editing:** On phones, adding an overlay opens its Properties sheet immediately. The preview offers a direct **Edit selected layer / 编辑当前图层** shortcut. **Duplicate layer / 复制图层** creates a copy immediately above the original, offset within the canvas, retaining text/style/visibility and treating the duplication as one undo/redo action. The 32-layer cap and approved background artwork do not change.
- **Cross-surface parity:** JSON export/import, browser-local draft restoration, live Studio preview, standalone SVG and D1 Worker SVG all use the same sanitized design/renderer. CI exercises actual local browser DOM/text/image decoding plus edited-design round trips; it does not demonstrate real independent Cloudflare billing or GitHub's live remote image-proxy cache.


## Retired from the new-template picker

`modern-card`, `cozy-card`, `space-card`, `notebook-card`, `neon-card`, and `minimal-card` are **not selectable for creating new designs**. Their prior designs remain readable/renderable so existing published counters and saved JSON do not silently revert to a different style. They are not included in the six-card visual gallery. The three preexisting v0.5 classic presets (`pixel`, `cyber`, `minimal`) are separate and remain available.

The headless Chrome visual audit produces 12 actual SVG views (six styles × two count sizes) and verifies rendered text bounds, overlap and scoped SVG identifiers. All six illustrated styles are tested as external `<img>` SVGs (18 decoded examples); the three AVIF-backed illustrations are additionally checked against static GitHub Markdown; that does not verify a real remote Cloudflare counter's caching or independent-billing behavior.

This v0.6.1 artwork candidate is source-only pending owner visual approval. The current v0.6 website is already deployed. Independent Cloudflare self-hosting is separately blocked by [Issue #22](https://github.com/guitar0788/workshop-Visitor-Terminal/issues/22). This art branch does not change production Worker, D1, Cloudflare secrets, GitHub Pages or `main`.
