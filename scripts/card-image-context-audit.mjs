#!/usr/bin/env node
/** Offline QA: a README loads SVG via HTML <img>, not inline document SVG. */
import { build } from "esbuild";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const IMAGE_THEMES=["pixel-card","terminal-card","rpg-card","mc-overworld","mc-nether","mc-end"];
export const IMAGE_COUNTS=[12_847,12_848,999_999_999_999];
export const IMAGE_SAMPLES=18;
export const IMAGE_REPORT_NAME="Six-Cards-External-Image-Review.html";

export function makeImageReview(samples){
  if(!Array.isArray(samples)||samples.length!==IMAGE_SAMPLES)throw Error("Wrong image sample count");
  const seen=new Set();
  const parts=samples.map(s=>{
    const approved=["pixel-card","terminal-card","rpg-card"].includes(s.theme);
    const images=typeof s.svg==="string" ? s.svg.match(/<image\b[^>]*>/g)||[] : [];
    if(!IMAGE_THEMES.includes(s.theme)||!IMAGE_COUNTS.includes(s.count)||
      typeof s.svg!=="string"||!s.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')||
      (approved ? images.length!==1 || !images[0].includes('href="data:image/avif;base64,') : images.length!==0)||
      /<script\b|<foreignObject\b|\shref="https?:|url\(https?:/i.test(s.svg)||
      seen.has(s.theme+":"+s.count))throw Error("Unapproved SVG image sample");
    seen.add(s.theme+":"+s.count);
    return '<section><header>'+s.theme+' · '+s.count.toLocaleString("en-US")+
      ' demo visits</header><img loading="eager" data-theme="'+s.theme+
      '" data-count="'+s.count+'" src="data:image/svg+xml;charset=utf-8,'+
      encodeURIComponent(s.svg)+'"></section>';
  }).join("\n");
  const code=[
    "(async()=>{",
    "const imgs=[...document.querySelectorAll('img[data-theme][data-count]')];",
    "const errors=[];let decoded=0;",
    "await Promise.all(imgs.map(async img=>{",
    "try{await img.decode()}catch{errors.push(img.dataset.theme+': SVG image decode failed');return}",
    "const approved=['pixel-card','terminal-card','rpg-card'].includes(img.dataset.theme);",
    "const width=img.dataset.theme==='pixel-card'?690:(approved?722:600);",
    "const height=approved?362:210;",
    "if(!img.complete||img.naturalWidth!==width||img.naturalHeight!==height){",
    "errors.push(img.dataset.theme+': unexpected dimensions '+img.naturalWidth+'x'+img.naturalHeight);return}",
    "try{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;",
    "const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);",
    "const pixels=ctx.getImageData(0,0,c.width,c.height).data;",
    "const colors=new Set();let visible=0;",
    "for(let y=12;y<c.height-12;y+=14)for(let x=12;x<c.width-12;x+=14){",
    "const i=(y*c.width+x)*4;",
    "if(pixels[i+3]>200){visible++;colors.add([pixels[i],pixels[i+1],pixels[i+2]].join(','))}}",
    "if(visible<150||colors.size<12)errors.push(img.dataset.theme+': blank or flat artwork');else decoded++;",
    "}catch(e){errors.push(img.dataset.theme+': pixel validation failed '+(e?.name||'error'))}",
    "}));",
    "document.getElementById('approved-image-audit').textContent=JSON.stringify({",
    "kind:'wvt-six-card-external-svg-image-audit',version:1,count:imgs.length,",
    "decoded,errors,githubReadmeProxy:'NOT_TESTED',cloudflareD1:'NOT_TESTED'});",
    "})();"
  ].join("\n");
  return '<!doctype html><html><head><meta charset="utf-8">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'">'+
    '<style>body{font:14px system-ui;background:#101928;color:white;padding:24px}.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}section{background:#263448;border-radius:14px;padding:12px}header{margin-bottom:8px}img{display:block;width:100%;height:auto;background:#061b2a}@media(max-width:760px){.tiles{grid-template-columns:1fr}}</style></head>'+
    '<body><h1>Six illustrated cards · real SVG image-loading mode</h1><p>Offline browser simulation, not live GitHub README</p><main class="tiles">'+parts+
    '</main><output id="approved-image-audit"></output><script>'+code+'</script></body></html>';
}
export async function buildImageReview({root=ROOT,outDir=join(ROOT,"dist")}={}){
  const result=await build({entryPoints:[join(root,"src/model.ts")],bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
  if(result.outputFiles?.length!==1)throw Error("Unexpected model bundle");
  const model=await import("data:text/javascript;base64,"+Buffer.from(result.outputFiles[0].text).toString("base64"));
  const samples=IMAGE_THEMES.flatMap(theme=>IMAGE_COUNTS.map(count=>({theme,count,svg:model.renderSvg(model.clonePreset(theme),count)})));
  await mkdir(outDir,{recursive:true});
  const path=join(outDir,IMAGE_REPORT_NAME);
  await writeFile(path,makeImageReview(samples),"utf8");
  return {path,count:samples.length};
}
export function readImageReport(html){
  if(typeof html!=="string"||html.length>7_000_000)throw Error("Invalid image report size");
  const m=html.match(/<output id="approved-image-audit"[^>]*>([^<]+)<\/output>/);
  if(!m)throw Error("Browser did not finish SVG external-image audit");
  let r;try{r=JSON.parse(m[1].replaceAll("&quot;",'"').replaceAll("&amp;","&"))}
  catch{throw Error("Malformed SVG external-image audit")}
  if(r?.kind!=="wvt-six-card-external-svg-image-audit"||r.version!==1||r.count!==IMAGE_SAMPLES||
    r.githubReadmeProxy!=="NOT_TESTED"||r.cloudflareD1!=="NOT_TESTED"||
    !Array.isArray(r.errors)||r.errors.some(e=>typeof e!=="string")||
    !Number.isInteger(r.decoded))throw Error("Incomplete SVG external-image audit");
  if(r.decoded!==IMAGE_SAMPLES||r.errors.length)throw Error("SVG external-image failure: "+r.errors.join(" | "));
  return r;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [cmd,path]=process.argv.slice(2);
    if(cmd==="build"&&!path){const x=await buildImageReview();console.log("Built "+x.count+" external SVG image cases: "+x.path)}
    else if(cmd==="check"&&path){const x=readImageReport(await readFile(path,"utf8"));console.log("PASS "+x.decoded+" SVG image loads across six cards, with visible artwork. GitHub proxy NOT TESTED.")}
    else throw Error("Usage: build | check BROWSER_DUMP.html");
  }catch(e){console.error(e instanceof Error?e.message:"SVG image audit failed");process.exitCode=1}
}
