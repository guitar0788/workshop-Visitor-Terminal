import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = ".github/workflows/card-visual-audit.yml";

test("visual contact sheets survive the Vite mobile Studio build", async () => {
  const workflow = await readFile(path, "utf8");
  const preserve = workflow.indexOf("- name: Preserve illustrated-card preview before Vite build");
  const mobile = workflow.indexOf("- name: Exercise actual Studio six-card picker in phone viewport");
  const restore = workflow.indexOf("- name: Restore illustrated-card preview files for review");
  const upload = workflow.indexOf("- name: Upload browser preview image and self-contained HTML");
  assert(preserve > 0 && preserve < mobile, "preserve before npm run build");
  assert(mobile < restore && restore < upload, "restore after Vite clean and before upload");
  assert.match(workflow.slice(preserve, mobile), /\$RUNNER_TEMP\/wvt-illustrated-card-preview/);
  assert.match(workflow.slice(restore, upload), /if: always\(\)/);
  for (const name of [
    "WVT-Six-Cards-Visual-Review.png",
    "Card-Visual-Review.html",
    "Six-Cards-External-Image-Review.html",
    "WVT-Six-Cards-External-Image-Mode.png"
  ]) {
    assert(workflow.slice(preserve, mobile).includes("dist/" + name), "must stage " + name);
    assert(workflow.slice(upload).includes("dist/" + name), "must upload " + name);
  }
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\.|wrangler deploy|deploy-pages|pages:\s*write|id-token:\s*write/);
});
