# Workshop Visitor Terminal

An open-source visual editor for GitHub profile visitor counters.

## Prototype features

- Pixel Terminal, Minimal, and Cyber HUD presets
- Live SVG preview; editable title, label, colors, and width
- Download SVG and copy its source
- Renderer tests with SVG text escaping

## Development

Requires Node.js 20+.

```sh
npm install
npm run dev
npm test
npm run build
```

The displayed count is demo data, **not a live visitor count**.

## Roadmap

1. Drag-and-drop layer editor with keyboard-accessible alternatives
2. Secure design schema and server-side SVG rendering
3. Cloudflare Workers + D1 counting with abuse protection
4. Hosted SVG links and README embed generator
5. Verifiable legacy-count migration

GitHub caches README images, so image requests cannot reliably measure unique visitors or every page view. Hosting and Cloudflare deployment are not included in this milestone.

MIT licensed.
