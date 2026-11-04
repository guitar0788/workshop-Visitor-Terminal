# Workshop Visitor Terminal — v0.6.1 web release

## Scope

This patch release upgrades the three original Minecraft-inspired illustrated
cards — Overworld, Nether, and End — with independently authored, self-contained
WebP art plates, rather than procedurally concatenated SVG geometry. User-edited
headings, captions, and actual visit counts remain independent SVG text layers.

The existing six illustrated choices and three classic presets remain available.
The other three previously approved raster illustrated cards are unchanged.

## Backward compatibility

The stored design schema remains v1. New Minecraft cards carry the optional
`artworkVersion: "v061"` selector. Older saved and published Minecraft cards
without this selector continue rendering their original v0.6 vector artwork.
Users may opt in to the new appearance by selecting the new template and
republishing it. No existing counter or visitor total is reset or rewritten.

## Security and deployment boundaries

Only browser editor/card resources, offline visual verification, client tests,
release notes, and the `package.json` version were changed. No Worker API,
OAuth implementation, D1 migrations, account security controls, secrets, or
Cloudflare billing configuration is included.

The existing main-only verified pilot deployment workflow is responsible for
updating the GitHub Pages editor at its established URL after Verify succeeds.
The deployment system may redeploy the existing staging Worker as a prerequisite,
but the Worker code itself is unchanged.

## Acceptance criteria

- Both Verify and Illustrated Card Visual Audit PASS for exact release SHA.
- SVG-as-image loading in Chrome, 12-card gallery, 24 text-layer measurements,
  mobile Studio smoke tests, and existing counter compatibility pass.
- Security and self-hosting Draft PRs #21 and #26 stay unmerged.
- After merge, main Verify and OAuth Pilot Auto jobs, including GitHub Pages
  deployment, must succeed before declaring the site updated.
