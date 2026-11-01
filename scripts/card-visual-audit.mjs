#!/usr/bin/env node
/**
 * Produce a browser-reviewable HTML gallery from the actual shared SVG renderer.
 * The browser evaluates SVGGraphicsElement.getBBox() for nine styles at both
 * ordinary and maximum-length visit counts. No remote access, no D1 or secrets.
 */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT = resolve(ROOT, "dist", "Card-Visual-Review.html");
export const COUNTS = [12_847, 999_999_999_999];
export const SAMPLES = 18;
const browserScript = [
  "(function(){",
  "const failures=[];let checkedText=0;const usedIds=new Set();",
  "const samples=[...document.querySelectorAll('.sample')];",
  "for(const sample of samples){",
  "const svg=sample.querySelector('svg');",
  "if(!svg){failures.push('missing svg');continue;}",
  "for(const node of svg.querySelectorAll('[id]')){",
  "if(usedIds.has(node.id))failures.push('duplicate inline SVG id: '+node.id);",
  "usedIds.add(node.id);}",
  "const texts=[...svg.querySelectorAll('text')];",
  "const approved=['pixel-card','terminal-card','rpg-card'].includes(sample.dataset.theme);",
  "if(texts.length!==(approved?1:sample.dataset.theme==='minimal-card'?3:2))failures.push(sample.dataset.theme+': wrong text layer count');",
  "for(const t of texts){",
  "const clip=t.getAttribute('clip-path');",
  "if(!clip||!/^url\\(#clip-[A-Za-z0-9_-]{1,100}\\)$/.test(clip)){failures.push('unsafe/missing clip');continue;}",
  "const rect=svg.querySelector('clipPath#'+clip.slice(5,-1)+' rect');",
  "if(!rect){failures.push('no clip rect');continue;}",
  "const clipTarget=document.getElementById(clip.slice(5,-1));",
  "if(clipTarget!==rect.parentNode)failures.push('wrong cross-card clip target: '+clip);",
  "const b=t.getBBox();const x=+rect.getAttribute('x'),y=+rect.getAttribute('y');",
  "const w=+rect.getAttribute('width'),h=+rect.getAttribute('height');",
  "checkedText++;const q=1.5;",
  "if(![b.x,b.y,b.width,b.height,x,y,w,h].every(Number.isFinite)||",
  "b.width<=0||b.height<=0||b.x<x-q||b.y<y-q||",
  "b.x+b.width>x+w+q||b.y+b.height>y+h+q)",
  "failures.push(sample.dataset.theme+'('+sample.dataset.count+') '+t.textContent.slice(0,30)+",
  "' box '+[b.x,b.y,b.width,b.height].map(n=>n.toFixed(1)).join(',')+",
  "' clip '+[x,y,w,h].join(','));",
  "}",
  "for(let i=0;i<texts.length;i++){for(let j=i+1;j<texts.length;j++){",
  "const a=texts[i].getBBox(),b=texts[j].getBBox();",
  "const overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);",
  "const overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);",
  "if(overlapX>3&&overlapY>2)failures.push(sample.dataset.theme+",
  "' text overlap: '+texts[i].textContent.slice(0,16)+' / '+texts[j].textContent.slice(0,16));",
  "}}",
  "if(svg.querySelector('script,foreignObject'))failures.push('unsafe svg');",
  "const images=[...svg.querySelectorAll('image')];",
  "if(images.length!==(approved?1:0))failures.push('unexpected artwork images');",
  "for(const im of images){if(!/^data:image\\/avif;base64,[A-Za-z0-9+/=]+$/.test(im.getAttribute('href')||''))failures.push('external artwork image');}",
  "}",
  "document.getElementById('visual-audit').textContent=JSON.stringify({",
  "schemaVersion:1,kind:'workshop-visitor-terminal-browser-svg-audit',",
  "sampleCount:samples.length,checkedText,failures:failures.slice(0,50),",
  "overflowCount:failures.length,remoteRendering:'NOT_TESTED',",
  "githubReadmeRendering:'NOT_TESTED'});",
  "})();"
].join("\n");

export function createGallery(samples) {
  if (!Array.isArray(samples) || samples.length!==SAMPLES) throw Error("Wrong card count");
  const seen=new Set();
  for(const s of samples){
    if(!s||typeof s.name!=="string"||!/^[a-z-]+$/.test(s.name)||
      !COUNTS.includes(s.count)||seen.has(s.name+":"+s.count)||
      typeof s.svg!=="string"||
      !s.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) {
      throw Error("Invalid or duplicate card SVG");
    }
    const approved = ["pixel-card","terminal-card","rpg-card"].includes(s.name);
    const embeddedImages = s.svg.match(/<image\b[^>]*>/g) || [];
    if(embeddedImages.length!==(approved?1:0))throw Error("Unexpected SVG image element");
    let checked = s.svg;
    if(approved) {
      const tag=embeddedImages[0];
      if(!/href="data:image\/avif;base64,[A-Za-z0-9+/=]{90000,120000}"/.test(tag) ||
        !/^<image\b/.test(tag))throw Error("Non-approved external image reference");
      checked=checked.replace(tag,"");
    }
    if(/<script\b|<foreignObject\b|<image\b|\shref\s*=/i.test(checked)) {
      throw Error("Active, extra or external image markup");
    }
    seen.add(s.name+":"+s.count);
  }
  // Static second barrier: a multi-card page MUST NOT reuse SVG fragment IDs
  // even though every individual SVG is correct when opened in isolation.
  const usedIds = new Set();
  for (const sample of samples) {
    for (const [, id] of sample.svg.matchAll(/\bid="([^"]+)"/g)) {
      if (usedIds.has(id)) throw Error("Repeated SVG fragment ID across cards: " + id);
      usedIds.add(id);
    }
  }
  const cells=samples.map(s=>'<section class="sample" data-theme="'+s.name+
    '" data-count="'+s.count+'"><div class="label"><strong>'+s.name+
    '</strong><span>'+s.count.toLocaleString("en-US")+
    ' demo visits</span></div>'+s.svg+'</section>').join("\n");
  const css=[
    ":root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif}",
    "*{box-sizing:border-box}body{margin:0;background:#121a27;color:#e8f2ff;padding:26px 30px}",
    "h1{font-size:26px;margin:0 0 6px}p{margin:0 0 25px;color:#abc0d9;font-size:13px}",
    ".grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}",
    ".sample{background:#1c293b;border:1px solid #38506b;border-radius:17px;padding:13px;min-width:0}",
    ".label{display:flex;justify-content:space-between;gap:7px;margin:1px 0 11px;font-size:12px}",
    ".label span{color:#b1c6da;font-size:11px}",
    "svg{width:100%;height:auto;display:block;border-radius:6px}",
    ".note{padding:20px 0 5px;font-size:12px;line-height:1.6;color:#c0cad5}",
    "@media(max-width:880px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}",
    "@media(max-width:560px){.grid{grid-template-columns:1fr}body{padding:16px}}"
  ].join("\n");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src '+
    "'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "+
    "connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'"+
    '"><title>WVT nine-card visual QA</title><style>'+css+'</style></head>'+
    '<body><h1>Workshop Visitor Terminal · Nine illustrated card styles</h1>'+
    '<p>Offline browser rendering at 12,847 and 999,999,999,999 visits. These are NOT cloud statistics.</p>'+
    '<main class="grid">'+cells+'</main>'+
    '<div class="note">This unsigned preview tests local SVG layout only. '+
    'Cloudflare billing, real D1 and GitHub README rendering remain unverified.</div>'+
    '<output id="visual-audit" hidden></output>'+
    '<script>'+browserScript+'</script></body></html>';
}

export async function buildGallery({root=ROOT,output=OUTPUT}={}) {
  const result=await build({entryPoints:[resolve(root,"src/model.ts")],
    bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
  if(result.outputFiles?.length!==1)throw Error("Unexpected model bundler output");
  const model=await import("data:text/javascript;base64,"+
    Buffer.from(result.outputFiles[0].text).toString("base64"));
  if(!Array.isArray(model.CARD_THEMES)||model.CARD_THEMES.length!==9||
    new Set(model.CARD_THEMES).size!==9)throw Error("Invalid nine-theme catalog");
  const samples=model.CARD_THEMES.flatMap(name=>COUNTS.map(count=>({
    name,count,svg:model.renderSvg(model.clonePreset(name),count)
  })));
  const html=createGallery(samples);
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,html,"utf8");
  return {output,samples:samples.length};
}

export function parseBrowserAudit(html) {
  if(typeof html!=="string"||html.length>2_000_000)throw Error("Bad browser output size");
  const match=html.match(/<output id="visual-audit"[^>]*>([^<]+)<\/output>/);
  if(!match)throw Error("Browser did not execute font layout audit");
  let r;
  try{r=JSON.parse(match[1].replaceAll("&quot;",'"').replaceAll("&amp;","&"));}
  catch{throw Error("Malformed browser font audit result");}
  if(!r||r.schemaVersion!==1||r.kind!=="workshop-visitor-terminal-browser-svg-audit"||
    r.sampleCount!==SAMPLES||r.checkedText!==32||
    r.remoteRendering!=="NOT_TESTED"||r.githubReadmeRendering!=="NOT_TESTED"||
    !Array.isArray(r.failures)||r.failures.some(x=>typeof x!=="string")||
    !Number.isSafeInteger(r.overflowCount)||r.overflowCount!==r.failures.length||
    r.overflowCount<0)throw Error("Incomplete browser visual audit");
  return r;
}

export async function checkBrowserAudit(path) {
  const r=parseBrowserAudit(await readFile(path,"utf8"));
  if(r.overflowCount)throw Error("Actual browser clipped "+r.overflowCount+
    " text layers: "+r.failures.slice(0,8).join(" | "));
  return r;
}

async function main(){
  const [command,arg]=process.argv.slice(2);
  try{
    if(command==="build"&&!arg){
      const r=await buildGallery();console.log("PASS: "+r.samples+" actual SVG previews in "+r.output);
    }else if(command==="check"&&arg){
      const r=await checkBrowserAudit(arg);
      console.log("PASS: "+r.checkedText+" browser-measured text boxes; zero clips.");
      console.log("Remote billing, GitHub README rendering: NOT TESTED.");
    }else if(command==="--help"&&!arg){
      console.log("build | check BROWSER_DUMP.html; all operations offline");
    }else throw Error("Expected build or check BROWSER_DUMP.html");
  }catch(e){console.error(e instanceof Error?e.message:"Browser QA failed");process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
