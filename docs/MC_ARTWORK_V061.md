# Minecraft-inspired card artwork — v0.6.1 candidate

This is an artwork-only refresh for the three **existing** selectable card IDs:
`mc-overworld`, `mc-nether`, and `mc-end`. The other approved three cards,
the GitHub OAuth system, live counters, billing policy and stored designs are unchanged.

## Artwork method
- Original scene concept images were generated using an image model rather than drawn by Python-assembled SVG primitives. Each scene was manually selected and re-composed as a **wide 600×210 horizontal card plate**.
- Final image plates are locally encoded WebP, embedded in `src/minecraft-card-art.ts` as data URLs. No CDN, network image, remote font, official game texture, extracted game resource or Python-generated SVG scene is used.
- A graphic overlay leaves a low-noise, high-contrast right-hand information pane. The existing Studio model renders the title, live count and caption **on top as independently editable real SVG text layers**.
- Image plates are 600×210, and their WebP SHA256 hashes are:
  - Overworld: `caa4843e3c2a08e37c681c04cd99df55d63bafad230cbf31f98380d462b4f5f1`
  - Nether: `558cff503876b1990db69a5eebb64a2d6eee938902823249ac3f4bce1efd206f`
  - End: `b09fed6eeb555c5b4b7be1fa8e3279f89a5e4a0d333cbde618ccee131b96a56a`

## Safety and compatibility
- Existing serialized design schema, theme IDs and visitor number logic are unchanged. The old appearance of these three themes **will be replaced** on new renders, including pre-existing published designs with these theme IDs; do not merge before the owner accepts this visible change.
- Existing browser/Worker SVG previews and GitHub README output embed the same self-contained WebP image, not a remote reference. Chrome preview and external `<img>` decoding are tested by CI.
- No account security, D1 migrations, Cloudflare deploy, OAuth or Pages changes are included. No automatic merge or release.
