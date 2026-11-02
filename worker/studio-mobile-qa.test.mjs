import test from "node:test";
import assert from "node:assert/strict";
import { createMobileQA, parseMobileAudit } from "../scripts/studio-mobile-qa.mjs";

test("mobile browser integration page exercises real app tabs and six current styles",()=>{
  const html=createMobileQA();
  assert.match(html,/<iframe id="studio" src="\.\/"/);
  for(const theme of ["pixel-card","terminal-card","rpg-card","mc-overworld","mc-nether","mc-end"])
    assert(html.includes(theme));
  assert(html.includes("scrollWidth<=long.clientWidth"));
  assert(html.includes("img2.src"));
  assert(html.includes("publish-cache-caveat"));
  assert(html.includes("missing GitHub proxy count caveat"));
  assert(html.includes("Minecraft heading is not an editable layer"));
  assert(html.includes("MY CUSTOM NETHER"));
  assert(html.includes("workshop-studio-draft-v1"));
  assert(html.includes("frame.contentWindow.location.reload()"));
  assert(html.includes("restored draft not announced"));
  assert(html.includes("preview count still capped below 12 digits"));
  assert(html.includes("no approved raster editing limitation on phone"));
  assert(html.includes("MOBILE EDIT DUPLICATE"));
  assert(html.includes("missing duplicate button in phone Properties"));
  assert(html.includes("selected-layer-shortcut.mobile-only"));
  assert(html.includes("no selected layer quick edit on phone preview"));
  assert(html.includes("page.querySelector('.mobile-sheet .template-choice"));
  assert(!html.includes("fetch("));
  assert(!html.includes("https://"));
});
test("a fail-closed mobile report must not silently pass missing or old cards",()=>{
  const report={kind:"wvt-mobile-catalog-smoke",version:1,viewportWidth:390,
    themes:["pixel-card","terminal-card","rpg-card","mc-overworld","mc-nether","mc-end"],
    errors:[],remoteWorker:"NOT_TESTED"};
  const html=x=>'<output id="mobile-qa">'+JSON.stringify(x)+'</output>';
  assert.deepEqual(parseMobileAudit(html(report)),report);
  assert.throws(()=>parseMobileAudit(html({...report,errors:["broken swipe"]})),/broken swipe/);
  assert.throws(()=>parseMobileAudit(html({...report,viewportWidth:900})),/Invalid/);
  assert.throws(()=>parseMobileAudit(html({...report,themes:report.themes.slice(0,5)})),/Invalid/);
  assert.throws(()=>parseMobileAudit(html({...report,remoteWorker:"PASS"})),/Invalid/);
  assert.throws(()=>parseMobileAudit("<html/>"),/No mobile/);
});
