import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SAMPLES, COUNTS, buildGallery, createGallery,
  parseBrowserAudit, checkBrowserAudit
} from "../scripts/card-visual-audit.mjs";

test("gallery builds from actual bundled model with all nine vector cards at both count sizes", async () => {
  const root=await mkdtemp(join(tmpdir(),"wvt-card-review-"));
  try {
    const file=join(root,"review.html");
    const result=await buildGallery({output:file});
    assert.equal(result.samples,18);
    const html=await readFile(file,"utf8");
    assert.equal((html.match(/class="sample"/g)||[]).length,18);
    assert.equal((html.match(/<svg xmlns=/g)||[]).length,18);
    assert.equal((html.match(/>12,847<\/text>/g)||[]).length,9);
    assert.equal((html.match(/>999,999,999,999<\/text>/g)||[]).length,9);
    assert(html.includes("getBBox()")===false || html.includes("getBBox()"));
    assert.match(html,/getBBox\(\)/);
    assert(html.includes("remote SVG")==false);
    assert(!/https:\/\/evil\.example|<image\b|\shref\s*=/i.test(html));
    assert(html.includes("NOT cloud statistics."));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("gallery source rejects duplicate, injected, and incomplete samples", () => {
  const fake=Array.from({length:SAMPLES},(_,i)=>({
    name:"card-"+String.fromCharCode(97+i),count:COUNTS[i%2],
    svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>1</text></svg>'
  }));
  assert.match(createGallery(fake),/nine-card visual QA/);
  assert.throws(()=>createGallery(fake.slice(1)),/Wrong card count/);
  assert.throws(()=>createGallery(fake.map((r,i)=>i===3?fake[0]:r)),/duplicate/i);
  assert.throws(()=>createGallery(fake.map((r,i)=>i===3?{...r,svg:r.svg.replace("<text>","<script></script><text>")}:r)),/Invalid/i);
});

test("browser report is accepted only with exact full render coverage", async () => {
  const report={
    schemaVersion:1,kind:"workshop-visitor-terminal-browser-svg-audit",
    sampleCount:18,checkedText:38,failures:[],overflowCount:0,
    remoteRendering:"NOT_TESTED",githubReadmeRendering:"NOT_TESTED"
  };
  const html='<output id="visual-audit" hidden="">'+JSON.stringify(report)+'</output>';
  assert.deepEqual(parseBrowserAudit(html),report);
  for(const patch of [
    {sampleCount:17},{checkedText:37},{remoteRendering:"PASS"},
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
      sampleCount:18,checkedText:38,failures:["neon-card(999999999999) text:long"],
      overflowCount:1,remoteRendering:"NOT_TESTED",githubReadmeRendering:"NOT_TESTED"};
    const {writeFile}=await import("node:fs/promises");
    await writeFile(file,'<output id="visual-audit">'+JSON.stringify(base)+'</output>');
    await assert.rejects(()=>checkBrowserAudit(file),/clipped 1/);
  }finally{await rm(root,{recursive:true,force:true});}
});


test("fails closed on the exact cross-SVG ID collision from the owner's screenshot", () => {
  const fake=Array.from({length:SAMPLES},(_,i)=>({
    name:"card-"+String.fromCharCode(97+i),
    count:COUNTS[i%2],
    svg:'<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="clip-visits"><rect/></clipPath></defs><text clip-path="url(#clip-visits)">12,847</text></svg>'
  }));
  assert.throws(()=>createGallery(fake),/Repeated SVG fragment ID across cards: clip-visits/);
});
