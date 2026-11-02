# v0.6 — Cards and Studio editor (web-only feature release)

## Included
- Six illustrated card templates: Pixel Cat, Green Terminal, Blue-Gold RPG, Minecraft-inspired Overworld, Nether and The End.
- Three original illustrated reference styles (1/3/5) with live counters; editable overlays do not modify baked reference captions.
- Bilingual desktop/mobile Studio upgrades: template gallery, direct layer editing, duplicate/reorder/resize, alignment, improved touch move mode, undo/redo, local drafts and strict JSON import/export.
- Original SVG scene rendering, image-in-SVG compatibility and mobile/browser regression checks.
- Published dynamic SVGs use the existing Worker renderer compiled with the updated shared card model.

## Explicitly excluded
- Account deletion, Cloudflare usage/spending policy helpers and all code from `feat/account-usage-safety` / Draft PR #26.
- Independent self-hosting functionality and its scripts from Draft PR #21.
- New OAuth permissions, D1 schema migrations, token/secrets changes, unrestricted user registration, and automatic modifications to any GitHub profile README.

## Release/operations
- Release source branch: `release/v0.6-cards-editor-only`, cut from the existing protected `main` (v0.5 baseline), using only selected frontend and visual QA file blobs from `feat/v06-independent-self-hosting`.
- Retain `.github/pages-deploy-channel.txt = pilot`. After an approved merge and a successful Verify on main, the existing owner-only OAuth staging pipeline can recompile its shared SVG renderer and deploy the updated Pages editor. The worker's authorization/security code and D1 schema are unchanged.
- The current v0.5 published counter URLs/counts remain unchanged. A browser cache or GitHub App WebView may require refresh before seeing new templates.
- Follow-up account-security work stays on its isolated Draft PR branch; do not merge it as part of this release.
