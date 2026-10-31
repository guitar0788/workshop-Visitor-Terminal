#!/usr/bin/env node
/**
 * Build a SINGLE offline HTML file from a separately compiled, preview-only
 * Vite frontend. No CDN, OAuth client ID, Cloudflare origin or network fetch
 * is required to open the resulting file:// document.
 *
 * Never inline a pilot-enabled build: this script runs its own Vite build
 * with explicitly disabled publishing and a strict no-connect CSP.
 *
 * Usage (after npm install): node scripts/build-offline.mjs
 * Output: dist/Workshop-Studio-Offline.html
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_NAME = "Workshop-Studio-Offline.html";
const TAG = '<meta name="workshop-mode" content="offline">';
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join("; ");

export function offlineEnvironment(original = process.env) {
  return {
    ...original,
    VITE_OFFLINE_DEMO: "true",
    VITE_PUBLISH_ENABLED: "false",
    VITE_PUBLISH_PILOT: "false",
    VITE_PUBLISH_API_ORIGIN: ""
  };
}

function attribute(tag, key) {
  return tag.match(new RegExp("\\b" + key + '="([^"]+)"'))?.[1] ?? null;
}

function assertBundledAssetPath(path, suffix) {
  if (!path || !new RegExp("^\\./assets/[a-zA-Z0-9_.-]+\\." + suffix + "$").test(path)) {
    throw Error("Offline build contains an unexpected asset or URL");
  }
  return path.slice(2);
}

/** Return an internet-independent HTML file, never a copy of the pilot bundle. */
export function inlineOfflineBundle(html, scriptJs, stylesCss) {
  assert(typeof html === "string" && typeof scriptJs === "string" &&
    typeof stylesCss === "string", "Offline bundle inputs must be strings");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/g)];
  const links = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)];
  if (scripts.length !== 1 || links.length !== 1 ||
    !/type="module"/.test(scripts[0][0]) ||
    !/<div id="root"><\/div>/.test(html)) {
    throw Error("Unexpected Vite HTML asset layout; refusing an incomplete offline bundle");
  }
  const scriptUrl = attribute(scripts[0][0], "src");
  const cssUrl = attribute(links[0][0], "href");
  assertBundledAssetPath(scriptUrl, "js");
  assertBundledAssetPath(cssUrl, "css");
  if (html.includes(TAG) || scriptJs.length < 1000 || stylesCss.length < 100) {
    throw Error("Incomplete or already generated offline HTML");
  }

  // Escaping closing tags prevents generated strings from escaping their block.
  const safeScript = scriptJs.replace(/<\/script/gi, "<\\/script");
  const safeCss = stylesCss.replace(/<\/style/gi, "<\\/style");
  const csp = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">';
  const result = html
    .replace(scripts[0][0], "<script type=\"module\">" + safeScript + "</script>")
    .replace(links[0][0], "<style>" + safeCss + "</style>")
    .replace("<head>", "<head>\n    " + TAG + "\n    " + csp);

  // Check the original outer document AFTER removing exactly the vetted
  // Vite JS/CSS asset tags. The bundled React runtime may contain strings
  // such as "<script src=...>"; examining the entire generated JS as if it
  // were HTML produces false positives.
  const originalShell = html.replace(scripts[0][0], "").replace(links[0][0], "");
  const violations = [
    ...(!result.includes(TAG) ? ["missing-mode-marker"] : []),
    ...(!result.includes("connect-src 'none'") ? ["missing-network-deny"] : []),
    ...(/<script\b[^>]*\bsrc=/.test(originalShell) ? ["external-script-tag"] : []),
    ...(/<link\b[^>]*\bhref=/.test(originalShell) ? ["external-link-tag"] : []),
    ...(/<img\b[^>]*\bsrc=/.test(originalShell) ? ["external-image-tag"] : []),
    ...(!result.includes('<script type="module">') ? ["missing-inline-script"] : []),
    ...(!result.includes("<style>") ? ["missing-inline-style"] : [])
  ];
  if (violations.length) {
    throw Error("Offline HTML is not self-contained: " + violations.join(","));
  }
  return result;
}

async function build() {
  const temp = await mkdtemp(join(tmpdir(), "wvt-standalone-"));
  let stage = "vite-build";
  try {
    const viteBin = join(ROOT, "node_modules", "vite", "bin", "vite.js");
    execFileSync(process.execPath, [viteBin, "build", "--base=./", "--outDir", temp], {
      cwd: ROOT, env: offlineEnvironment(),
      stdio: ["ignore", "pipe", "pipe"], timeout: 90000
    });
    stage = "locate-static-assets";
    const html = await readFile(join(temp, "index.html"), "utf8");
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
    const links = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)];
    if (scripts.length !== 1 || links.length !== 1) {
      throw Error("Expected one local JavaScript and one local stylesheet");
    }
    const jsFile = assertBundledAssetPath(attribute(scripts[0][0], "src"), "js");
    const cssFile = assertBundledAssetPath(attribute(links[0][0], "href"), "css");
    const assets = await readdir(join(temp, "assets"));
    if (assets.length !== 2 ||
      !assets.includes(jsFile.split("/").at(-1)) ||
      !assets.includes(cssFile.split("/").at(-1))) {
      throw Error("Unexpected secondary asset would prevent complete offline usage");
    }
    stage = "read-static-assets";
    const [js, css] = await Promise.all([
      readFile(join(temp, jsFile), "utf8"),
      readFile(join(temp, cssFile), "utf8")
    ]);
    stage = "inline-and-validate";
    const selfContainedHtml = inlineOfflineBundle(html, js, css);
    const target = join(ROOT, "dist", OUT_NAME);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, selfContainedHtml, "utf8");
    const size = Buffer.byteLength(selfContainedHtml);
    if (size > 2_000_000) throw Error("Standalone HTML exceeds the reviewed 2 MB limit");
    console.log(
      "PASS: single-file offline editor produced (" + size +
      " bytes, OAuth disabled, CSP connect-src none, no external assets)."
    );
    console.log("Output: dist/" + OUT_NAME);
  } catch (err) {
    // Avoid printing subprocess output or build-time environment secrets.
    // A fixed-stage name is safe to expose; never print tool stderr or env.
    const reason = err instanceof Error ? err.message : "";
    const safeReason = /^(?:Unexpected|Expected|Incomplete|Offline HTML|Standalone HTML)/.test(reason)
      ? ": " + reason : "";
    console.error("Offline edition build failed at " + stage + safeReason +
      " (no artifact has been published).");
    process.exitCode = 1;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && /[/\\]build-offline\.mjs$/.test(process.argv[1])) {
  build().catch(() => { process.exitCode = 1; });
}
