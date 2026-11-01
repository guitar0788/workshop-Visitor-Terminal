#!/usr/bin/env node
/** Real mobile Studio integration check. Runs entirely against local Vite preview. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const REPORT_NAME="WVT-Mobile-Studio-QA.html";
export const OUTPUT=join(ROOT,"dist",REPORT_NAME);
const THEMES=["pixel-card","terminal-card","rpg-card","mc-overworld","mc-nether","mc-end"];
const RETIRED=["modern-card","cozy-card","space-card","notebook-card","neon-card","minimal-card"];
export function createMobileQA(){
  const code=[
    "(async()=>{",
    "const report=document.getElementById('mobile-qa');",
    "const frame=document.getElementById('studio');",
    "const errors=[];",
    "const sleep=ms=>new Promise(r=>setTimeout(r,ms));",
    "const until=async(pred,timeout=9000)=>{const start=Date.now();",
    "while(Date.now()-start<timeout){const v=pred();if(v)return v;await sleep(90)}",
    "throw Error('UI did not reach expected state')};",
    "try{",
    "const doc=await until(()=>frame.contentDocument?.querySelector('nav.mobile-nav button'));",
    "let page=frame.contentDocument;",
    "let nav=page.querySelectorAll('nav.mobile-nav button');",
    "if(nav.length!==4)throw Error('mobile tab count');",
    "if(frame.contentWindow.innerWidth>450)throw Error('not a phone viewport');",
    "nav[1].click();",
    "await until(()=>page.querySelectorAll('.mobile-sheet .template-choice').length===6);",
    "const select=page.querySelector('.mobile-sheet .template-picker select');",
    "if(!select)throw Error('missing template selector');",
    "const offered=[...select.options].map(o=>o.value);",
    "for(const t of "+JSON.stringify(THEMES)+"){if(!offered.includes(t))errors.push('missing selectable '+t)}",
    "for(const t of "+JSON.stringify(RETIRED)+"){if(offered.includes(t))errors.push('retired selectable '+t)}",
    "const cards=[...page.querySelectorAll('.mobile-sheet .template-choice')];",
    "if(cards.length!==6)errors.push('wrong card count');",
    "const labels=cards.map(c=>c.getAttribute('aria-label'));",
    "if(new Set(labels).size!==6)errors.push('duplicate card accessible labels');",
    "const long=page.querySelector('.mobile-sheet .template-gallery.compact');",
    "if(!long)errors.push('missing swipe gallery');",
    "else if(long.scrollWidth<=long.clientWidth)errors.push('no horizontal swipe on phone');",
    "const card=cards.find(c=>c.textContent.includes('Nether')||c.textContent.includes('下界'));",
    "if(!card)throw Error('Nether card missing');",
    "card.click();",
    "await until(()=>!page.querySelector('.mobile-sheet'));",
    "const live=await until(()=>{const img=page.querySelector('.preview-panel .stage > img');",
    "return img?.src.includes('nsky') ? img : null});",
    "const markup=decodeURIComponent(live.src.split(',').slice(1).join(','));",
    "if(!markup.includes('nsky')||!markup.includes('>12,856</text>'))",
    "errors.push('Nether preview did not update to actual SVG');",
    "if(!page.querySelector('.preview-panel .stage .target.selected'))",
    "errors.push('no selected editable layer after theme change');",
    "nav[1].click();",
    "await until(()=>page.querySelector('.mobile-sheet .layer-list'));",
    "const headingRow=[...page.querySelectorAll('.mobile-sheet .layer-row')].find(b=>",
    "/(NETHER TRAVELERS|下界探索者)/.test(b.textContent));",
    "if(!headingRow)throw Error('Minecraft heading is not an editable layer');",
    "headingRow.click();",
    "const titleInput=await until(()=>page.querySelector('.mobile-sheet .properties input[maxlength]'));",
    "let setter=Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLInputElement.prototype,'value').set;",
    "setter.call(titleInput,'MY CUSTOM NETHER');",
    "titleInput.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));",
    "await until(()=>{const el=page.querySelector('.stage > img');",
    "return el&&decodeURIComponent(el.src.split(',').slice(1).join(',')).includes('MY CUSTOM NETHER')});",
    "const draft=await until(()=>{const value=frame.contentWindow.localStorage.getItem('workshop-studio-draft-v1');",
    "return value?.includes('MY CUSTOM NETHER')?value:null});",
    "if(draft.includes('accessToken')||draft.includes('adminToken'))errors.push('draft stores forbidden authentication fields');",
    "frame.contentWindow.location.reload();",
    "await until(()=>{const el=frame.contentDocument?.querySelector('.stage > img');",
    "return el&&decodeURIComponent(el.src.split(',').slice(1).join(',')).includes('MY CUSTOM NETHER')});",
    "page=frame.contentDocument;",
    "nav=page.querySelectorAll('nav.mobile-nav button');",
    "setter=Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLInputElement.prototype,'value').set;",
    "const restored=page.querySelector('.notice[role=status]');",
    "if(restored&&!/(restored|恢复)/i.test(restored.textContent))errors.push('restored draft not announced');",
    "nav[1].click();",
    "await until(()=>page.querySelectorAll('.mobile-sheet .template-choice').length===6);",
    "const approved=page.querySelector('.mobile-sheet .template-choice[title]');",
    "const px=[...page.querySelectorAll('.mobile-sheet .template-choice')].find(c=>",
    "c.getAttribute('aria-label')?.includes('Pixel')||c.getAttribute('aria-label')?.includes('像素'));",
    "if(!px)throw Error('Pixel cat card missing');",
    "px.click();",
    "await until(()=>!page.querySelector('.mobile-sheet'));",
    "const img2=page.querySelector('.preview-panel .stage > img');",
    "const v2=decodeURIComponent(img2.src.split(',').slice(1).join(','));",
    "if(!v2.includes('data:image/avif;base64,')||!v2.includes('>12,847</text>'))",
    "errors.push('approved pixel art changed or count not restored');",
    "nav[1].click();",
    "const artworkLimit=await until(()=>page.querySelector('.mobile-sheet .template-gallery-hint[role=note]'));",
    "if(!/(approved|已批准)/i.test(artworkLimit.textContent))",
    "errors.push('no approved raster editing limitation on phone');",
    "nav[3].click();",
    "const previewCount=await until(()=>page.querySelector('.mobile-sheet .demo-count input[type=number]'));",
    "if(previewCount.max!=='999999999999')errors.push('preview count still capped below 12 digits');",
    "setter.call(previewCount,'999999999999');",
    "previewCount.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));",
    "await until(()=>{const img=page.querySelector('.stage > img');",
    "return img&&decodeURIComponent(img.src.split(',').slice(1).join(',')).includes('>999,999,999,999</text>')});",
    "const note=await until(()=>page.querySelector('.mobile-sheet .publish-cache-caveat'));",
    "if(!/GitHub/.test(note.textContent)||!/Worker/.test(note.textContent)||",
    "!/(cached|缓存)/i.test(note.textContent))",
    "errors.push('missing GitHub proxy count caveat on phone export');",
    "}catch(e){errors.push(String(e?.message||e))}",
    "report.textContent=JSON.stringify({kind:'wvt-mobile-catalog-smoke',",
    "version:1,viewportWidth:frame.contentWindow?.innerWidth||0,",
    "themes:"+JSON.stringify(THEMES)+",errors,remoteWorker:'NOT_TESTED'});",
    "})();"
  ].join("\n");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<style>body{margin:0;background:#0e1520;color:white;font:13px system-ui;padding:12px}'+
    'iframe{display:block;width:390px;height:800px;border:1px solid #31514d;border-radius:15px;max-width:100%}'+
    'output{display:block;max-width:380px;overflow-wrap:anywhere;white-space:pre-wrap}'+
    '</style></head><body><iframe id="studio" src="./" title="Mobile Studio UI"></iframe>'+
    '<output id="mobile-qa">RUNNING</output><script>'+code+'</script></body></html>';
}
export function parseMobileAudit(html){
  if(typeof html!=="string"||html.length>1_000_000)throw Error("Bad mobile browser report size");
  const match=html.match(/<output id="mobile-qa"[^>]*>([^<]+)<\/output>/);
  if(!match)throw Error("No mobile browser report");
  let r;
  try{r=JSON.parse(match[1].replaceAll("&quot;",'"').replaceAll("&amp;","&"))}
  catch{throw Error("Incomplete mobile browser report")}
  if(r?.kind!=="wvt-mobile-catalog-smoke"||r.version!==1||r.viewportWidth!==390||
    r.remoteWorker!=="NOT_TESTED"||JSON.stringify(r.themes)!==JSON.stringify(THEMES)||
    !Array.isArray(r.errors)||r.errors.some(e=>typeof e!=="string"))
    throw Error("Invalid mobile browser report");
  if(r.errors.length)throw Error("Mobile Studio failures: "+r.errors.join(" | "));
  return r;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [cmd,p]=process.argv.slice(2);
    if(cmd==="build"&&!p){await mkdir(dirname(OUTPUT),{recursive:true});
      await writeFile(OUTPUT,createMobileQA(),"utf8");console.log("Built local mobile browser smoke page")}
    else if(cmd==="check"&&p){const r=parseMobileAudit(await readFile(p,"utf8"));
      console.log("PASS: "+r.themes.length+" selectable cards, phone swipe, phone tab navigation, active SVG, preserved approved art")}
    else throw Error("Use build | check BROWSER_DUMP.html");
  }catch(e){console.error(e.message);process.exitCode=1}
}