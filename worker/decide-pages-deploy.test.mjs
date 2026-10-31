import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseChannel, shouldPublishPreview } from "./decide-pages-deploy.mjs";

test("pilot branch marker keeps ordinary main pushes from publishing preview", async () => {
  const file = await readFile(".github/pages-deploy-channel.txt", "utf8");
  const channel = parseChannel(file);
  assert.equal(channel, "pilot");
  assert.equal(shouldPublishPreview({
    channel, eventName: "push", ref: "refs/heads/main"
  }), false);
});

test("explicit manual preview rollback remains supported during pilot", () => {
  assert.equal(shouldPublishPreview({
    channel: "pilot", eventName: "workflow_dispatch", ref: "refs/heads/main"
  }), true);
});

test("normal automatic Pages publishing resumes only after reviewed channel switch", () => {
  assert.equal(shouldPublishPreview({
    channel: "preview", eventName: "push", ref: "refs/heads/main"
  }), true);
  assert.equal(shouldPublishPreview({
    channel: "preview", eventName: "workflow_dispatch", ref: "refs/heads/main"
  }), true);
});

test("unknown channel, event or non-main branches cannot publish", () => {
  for (const value of ["", "pilot\npreview", "release", "PILOT", "pilot # junk", "preview\npilot"]) {
    assert.throws(() => parseChannel(value));
  }
  assert.throws(() => shouldPublishPreview({
    channel: "unapproved", eventName: "push", ref: "refs/heads/main"
  }));
  assert.equal(shouldPublishPreview({
    channel: "preview", eventName: "pull_request", ref: "refs/heads/main"
  }), false);
  assert.equal(shouldPublishPreview({
    channel: "preview", eventName: "workflow_dispatch", ref: "refs/heads/test"
  }), false);
});

test("workflow checks channel before publishing or configuring the Pages artifact", async () => {
  const yaml = await readFile(".github/workflows/publish-pages.yml", "utf8");
  const pilotYaml = await readFile(".github/workflows/oauth-pilot.yml", "utf8");
  assert.match(yaml, /release_gate:/);
  assert.match(yaml, /node worker\/decide-pages-deploy\.mjs/);
  assert.match(yaml, /needs: release_gate/);
  assert.match(yaml, /if: needs\.release_gate\.outputs\.publish_preview == 'true'/);
  assert.match(yaml, /cancel-in-progress: false/);
  assert.match(pilotYaml, /VITE_PUBLISH_PILOT: "true"/);
  assert.doesNotMatch(yaml, /VITE_PUBLISH_ENABLED/);
});
