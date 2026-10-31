import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { offlineEnvironment, inlineOfflineBundle } from "../scripts/build-offline.mjs";

const html = [
  "<!doctype html><html lang=\"zh-CN\"><head>",
  "<meta charset=\"UTF-8\">",
  '<script type="module" crossorigin src="./assets/index-abc123.js"></script>',
  '<link rel="stylesheet" crossorigin href="./assets/index-def456.css">',
  "</head><body><div id=\"root\"></div></body></html>"
].join("\n");

const javascript = "const offlineDemo = true;".padEnd(1200, " ");
const stylesheet = "body { display: block; }".padEnd(150, " ");

test("the standalone Vite build disables OAuth even with inherited pilot environment variables", () => {
  const vars = offlineEnvironment({
    VITE_PUBLISH_ENABLED: "true",
    VITE_PUBLISH_PILOT: "true",
    VITE_PUBLISH_API_ORIGIN:
      "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev",
    VITE_OFFLINE_DEMO: "false"
  });
  assert.equal(vars.VITE_OFFLINE_DEMO, "true");
  assert.equal(vars.VITE_PUBLISH_ENABLED, "false");
  assert.equal(vars.VITE_PUBLISH_PILOT, "false");
  assert.equal(vars.VITE_PUBLISH_API_ORIGIN, "");
});

test("bundles React JS and CSS into one local HTML file with a deny-network CSP", () => {
  const result = inlineOfflineBundle(html, javascript, stylesheet);
  assert.match(result, /<meta name="workshop-mode" content="offline">/);
  assert.match(result, /connect-src 'none'/);
  assert.match(result, /default-src 'none'/);
  assert.match(result, /script-src 'unsafe-inline'/);
  assert.match(result, /img-src data: blob:/);
  assert.match(result, /<script type="module">/);
  assert.match(result, /<style>/);
  assert.doesNotMatch(result, /<script\b[^>]+src=/);
  assert.doesNotMatch(result, /<link\b[^>]+href=/);
  assert.doesNotMatch(result, /assets\/index/);
  assert(!result.includes("workers.dev"));
});

test("rejects external script, unexpected asset paths or multiple bundles", () => {
  const candidates = [
    html.replace('./assets/index-abc123.js', 'https://cdn.example/bundle.js'),
    html.replace('./assets/index-abc123.js', '/assets/bundle.js'),
    html.replace('./assets/index-def456.css', '../private.css'),
    html.replace('</head>', '<script src="./assets/other.js"></script></head>'),
    html.replace('</head>', '<link rel="stylesheet" href="./assets/more.css"></head>'),
    html.replace('<div id="root"></div>', '<main>No mount target</main>')
  ];
  for (const candidate of candidates) {
    assert.throws(() => inlineOfflineBundle(candidate, javascript, stylesheet));
  }
});

test("the offline mode is a hard frontend gate, not merely a hidden login button", async () => {
  const client = await readFile("src/publish-client.ts", "utf8");
  const scripts = await readFile("scripts/build-offline.mjs", "utf8");
  const index = await readFile("index.html", "utf8");
  assert.match(client, /OFFLINE_DEMO_MODE = vars\.VITE_OFFLINE_DEMO === "true"/);
  assert.match(client, /!OFFLINE_DEMO_MODE && vars\.VITE_PUBLISH_ENABLED/);
  assert.match(scripts, /VITE_PUBLISH_API_ORIGIN: ""/);
  assert.match(scripts, /connect-src 'none'/);
  assert.doesNotMatch(index, /https?:\/\/.*(?:cdn|fonts\.googleapis)/);
});
