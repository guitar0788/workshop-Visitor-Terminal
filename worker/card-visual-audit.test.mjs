import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SAMPLES, COUNTS, buildGallery, createGallery,
  parseBrowserAudit, checkBrowserAudit
} from "../scripts/card-visual-audit.mjs";

test("gallery builds from actual bundled model with all six selectable cards at both count sizes", async () => {
  const root=await mkdtemp(join(tmpdir(),"wvt-card-review-"));
  try {
    const file=join(root,"review.html");
    const result=await buildGallery({output:file});
    assert.equal(result.samples,12);
    const html=await readFile(file,"utf8");
    assert.equal((html.match(/class="sample"/g)||[]).length,12);
    assert.equal((html.match(/<svg xmlns=/g)||[]).length,12);
    assert.equal((html.match(/>12,847<\/text>/g)||[]).length,6);
    assert.equal((html.match(/>999,999,999,999<\/text>/g)||[]).length,6);
    assert(html.includes("getBBox()")===false || html.includes("getBBox()"));
    assert.match(html,/getBBox\(\)/);
    assert(html.includes("remote SVG")==false);
    assert.equal(html.split("data:image/avif;base64,").length-1,6);
    assert.equal(html.split("data:image/webp;base64,").length-1,6);
    assert(!html.includes('href="https://'));
    assert(!/https:\/\/evil\.example|<foreignObject\b/i.test(html));
    assert(html.includes("NOT cloud statistics."));
  } finally { await rm(root,{recursive:true,force:true}); }
});

const FIXTURE_THEMES = [
  "pixel-card", "terminal-card", "rpg-card",
  "mc-overworld", "mc-nether", "mc-end"
];
function fixtureSvg(theme, clipId = "unique") {
  const approved = ["pixel-card","terminal-card","rpg-card"].includes(theme);
  const image = approved
    ? '<image href="data:image/avif;base64,' + "A".repeat(93000) + '"/>'
    : '<image width="600" height="210" href="data:image/webp;base64,' + "A".repeat(7500) + '"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="' +
    clipId + '"><rect/></clipPath></defs>' + image +
    '<text clip-path="url(#' + clipId + ')">12,847</text></svg>';
}
function fakeSamples(reuseClip = false) {
  return Array.from({ length: SAMPLES }, (_, i) => {
    const theme = FIXTURE_THEMES[i % FIXTURE_THEMES.length];
    return {
      name: theme, count: COUNTS[Math.floor(i / FIXTURE_THEMES.length)],
      svg: fixtureSvg(theme, reuseClip ? "clip-visits" : "clip-" + i)
    };
  });
}

test("gallery source rejects duplicate, injected, and incomplete samples", () => {
  const fake = fakeSamples();
  assert.match(createGallery(fake), /six-card visual QA/);
  assert.throws(() => createGallery(fake.slice(1)), /Wrong card count/);
  assert.throws(() => createGallery(fake.map((r, i) => i === 3 ? fake[0] : r)), /duplicate/i);
  assert.throws(() => createGallery(fake.map((r, i) => i === 3 ?
    { ...r, svg: r.svg.replace("<text ", "<script></script><text ") } : r)), /markup/i);
  assert.throws(() => createGallery(fake.map((r, i) => i === 3 ?
    { ...r, svg: r.svg.replace("data:image/webp;", "data:image/png;") } : r)), /Unapproved/);
});

test("browser report is accepted only with exact full render coverage", async () => {
  const report={
    schemaVersion:1,kind:"workshop-visitor-terminal-browser-svg-audit",
    sampleCount:12,checkedText:24,failures:[],overflowCount:0,
    remoteRendering:"NOT_TESTED",githubReadmeRendering:"NOT_TESTED"
  };
  const html='<output id="visual-audit" hidden="">'+JSON.stringify(report)+'</output>';
  assert.deepEqual(parseBrowserAudit(html),report);
  for(const patch of [
    {sampleCount:11},{checkedText:23},{remoteRendering:"PASS"},
    {githubReadmeRendering:"PASS"},{overflowCount:2},{failures:["clipped"],overflowCount:1}
  ]) {
    const altered='<output id="visual-audit">'+JSON.stringify({...report,...patch})+'</output>';
    if(patch.overflowCount===1) {
      assert.equal(parseBrowserAudit(altered).overflowCount,1);
    } else assert.throws(()=>parseBrowserAudit(altered));
  }
  assert.throws(()=>parseBrowserAudit('<html></html>'),/did not execute/);
  assert.throws(()=>parseBrowserAudit('x'.repeat(2_000_001)),/size/);
});

test("the verifier flags actual browser-measured clipping, not just SVG string content", async () => {
  const root=await mkdtemp(join(tmpdir(),"wvt-card-audit-"));
  try {
    const file=join(root,"browser.html");
    const base={schemaVersion:1,kind:"workshop-visitor-terminal-browser-svg-audit",
      sampleCount:12,checkedText:24,failures:["mc-nether(999999999999) text:long"],
      overflowCount:1,remoteRendering:"NOT_TESTED",githubReadmeRendering:"NOT_TESTED"};
    const {writeFile}=await import("node:fs/promises");
    await writeFile(file,'<output id="visual-audit">'+JSON.stringify(base)+'</output>');
    await assert.rejects(()=>checkBrowserAudit(file),/clipped 1/);
  }finally{await rm(root,{recursive:true,force:true});}
});


test("fails closed on the exact cross-SVG ID collision from the owner's screenshot", () => {
  assert.throws(() => createGallery(fakeSamples(true)),
    /Repeated SVG fragment ID across cards: clip-visits/);
});
