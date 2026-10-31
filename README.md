# Workshop Visitor Terminal

A customizable visitor-counter SVG studio for GitHub profile READMEs.

> **Status: Editor alpha.** The counter shown in the editor uses example data. This repository does **not** currently provide hosted SVG URLs, tracking, or a deployed public editor.

## Workshop Studio

The visual editor is designed for people who want to customize a GitHub counter without writing SVG or CSS. It includes:

- **Pixel Terminal**, **Cyber HUD**, and **Minimal** starter templates
- Live SVG preview with drag-to-move layers
- Add, select, hide, delete, and reorder text, counter, status light, and panel layers
- Numerical position and size controls, editable text, colors, and font sizes
- Keyboard-accessible adjustments: focus a layer and use arrow keys (hold Shift for 10-pixel moves)
- Save/load a design JSON file locally, or export SVG artwork
- Mobile-friendly editor layout and basic renderer tests

The editor is intentionally usable without accounts or a database in this first milestone.

## Run locally

Node.js 20 or newer is required.

~~~sh
npm install
npm run dev
~~~

Open the local URL printed by Vite.

Run the checks:

~~~sh
npm test
npm run build
~~~

To try a design in your own profile now, export the SVG, upload it to a repository, and reference that file in your README. **That SVG is static** and will not automatically count visitors.

## Development plan

| Stage | Goal | Status |
| --- | --- | --- |
| 1 | Working SVG preview and templates | Complete |
| 2 | Visual layer editing, keyboard controls, JSON save/load | In review |
| 3 | Secure server-rendered SVG and hosted designs | Planned |
| 4 | Cloudflare Workers + D1 request counting and abuse controls | Planned |
| 5 | README embed link generator, legacy-count migration | Planned |

**Counting limitation:** GitHub caches and proxies README images. A self-hosted SVG endpoint will count requests reaching its service, not guaranteed unique visitors or every profile open. Our eventual UI will label this clearly. Legacy migration will only seed a verified count, with the source and capture time recorded; it cannot recover historical visits not exposed by the old provider.

No Cloudflare resources, secrets, accounts, or paid infrastructure are needed to run this editor alpha.

## License

MIT. See [LICENSE](LICENSE).
