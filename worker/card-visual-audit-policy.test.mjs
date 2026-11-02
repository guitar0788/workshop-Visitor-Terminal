import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PATH = ".github/workflows/card-visual-audit.yml";

test("visual browser QA applies to future internal card/editor PRs", async () => {
  const workflow = await readFile(PATH, "utf8");
  assert.match(workflow, /^on:\n  pull_request:/m);
  assert.match(workflow, /if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(workflow, /github\.head_ref\s*==/);
  for (const path of [
    "src/main.tsx", "src/model.ts", "src/history.ts",
    "src/design-file.ts", "src/local-draft.ts",
    "src/style.css", "src/card-art.ts", "src/minecraft-card-art.ts",
    "src/minecraft-card-legacy-art.ts", "src/minecraft-art-compat.test.ts",
    "src/minecraft-card-art.test.ts", "src/model.test.ts"
  ]) assert(workflow.includes('      - "' + path + '"'), path + " must trigger QA");
});

test("visual browser QA cannot read publish credentials or deploy production", async () => {
  const workflow = await readFile(PATH, "utf8");
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\.|id-token:\s*write|pages:\s*write|contents:\s*write/);
  assert.doesNotMatch(workflow, /deploy-pages|wrangler deploy|workflow_dispatch|\n  push:/);
});
