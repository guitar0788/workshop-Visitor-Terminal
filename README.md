# Workshop Visitor Terminal

A customizable visitor-counter SVG studio for GitHub profile READMEs.

> **Status: Editor alpha.** The counter shown in the editor uses example data. The hosted counter API and visit tracking are not implemented yet.

## Online editor (GitHub Pages)

The studio is designed to be published at:

**https://guitar0788.github.io/workshop-Visitor-Terminal/**

The repository includes a GitHub Actions workflow that runs tests, builds the Vite app, and publishes its static assets. **The URL is only active after Pages is enabled and the deployment succeeds.**

Repository owner setup (one time):

1. Open **Settings → Pages** for this repository.
2. Set **Build and deployment → Source** to **GitHub Actions**.
3. Run **Publish Workshop Studio** in the Actions tab, or merge an update to `main`.
4. Verify the green deployment result before sharing the URL.

The editor runs entirely in the browser. Your work stays local until you export it; no login or server-side design storage is required for this alpha. GitHub Pages is a static host and **does not implement live visit counting**.

## Workshop Studio

The visual editor is designed for people who want to customize a GitHub counter without writing SVG or CSS. It includes:

- **Pixel Terminal**, **Cyber HUD**, and **Minimal** starter templates
- Live SVG preview with drag-to-move layers
- Add, select, hide, delete, and reorder text, counter, status light, and panel layers
- Numerical position and size controls, editable text, colors, and font sizes
- Keyboard-accessible adjustments: focus a layer and use arrow keys (hold Shift for 10-pixel moves)
- Save/load a design JSON file locally, or export SVG artwork
- Mobile-first preview placement, tap-friendly move controls, and direct jump to selected-layer properties
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
| 2 | Visual layer editing, keyboard controls, JSON save/load | Complete |
| 3 | Free static editor on GitHub Pages | Deployment pending Pages configuration |\n| 4 | Secure server-rendered SVG and hosted designs | Planned |
| 5 | Cloudflare Workers + D1 request counting and abuse controls | Planned |
| 6 | README embed link generator, legacy-count migration | Planned |

**Counting limitation:** GitHub caches and proxies README images. A self-hosted SVG endpoint will count requests reaching its service, not guaranteed unique visitors or every profile open. Our eventual UI will label this clearly. Legacy migration will only seed a verified count, with the source and capture time recorded; it cannot recover historical visits not exposed by the old provider.

No Cloudflare resources, secrets, accounts, or paid infrastructure are needed to run this editor alpha.

## License

MIT. See [LICENSE](LICENSE).
