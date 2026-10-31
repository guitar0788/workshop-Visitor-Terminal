import test from "node:test";
import assert from "node:assert/strict";
import { assertStagingDatabase } from "./verify-staging-d1.mjs";

const id = "3a52f952-852f-4b53-8cb0-8492d08d626c";
test("accepts only the exact database name and ID", () => {
  assert.equal(assertStagingDatabase([{ uuid: id, name: "workshop-visitor-terminal-staging" }], id), true);
  assert.throws(() => assertStagingDatabase([{ uuid: id, name: "workshop-visitor-terminal" }], id));
  assert.throws(() => assertStagingDatabase([{ uuid: "wrong", name: "workshop-visitor-terminal-staging" }], id));
  assert.throws(() => assertStagingDatabase([], id));
});
