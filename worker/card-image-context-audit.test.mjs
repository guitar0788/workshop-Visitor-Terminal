import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IMAGE_THEMES, IMAGE_COUNTS, IMAGE_SAMPLES, buildImageReview,
  makeImageReview, readImageReport
} from "../scripts/card-image-context-audit.mjs";

test("builds eighteen real <img> SVG previews from all six illustrations without remote requests",async()=>{
  const root=await mkdtemp(join(tmpdir(),"wvt-img-"));
  try{
    const output=await buildImageReview({outDir:root});
    assert.equal(output.count,18);
    const html=await readFile(output.path,"utf8");
    assert.equal((html.match(/<img loading=/g)||[]).length,18);
    assert.match(html,/data:image\/svg\+xml;charset=utf-8,/);
    assert(!html.includes('src="https://'));
    assert(!html.includes("WVT_ADMIN_TOKEN"));
    for(const theme of IMAGE_THEMES)assert(html.includes('data-theme="'+theme+'"'));
    assert(html.includes("Offline browser simulation, not live GitHub README"));
  }finally{await rm(root,{recursive:true,force:true})}
});

test("rejects duplicates, cross-network art, and unapproved Minecraft embedded images",()=>{
  const fake=IMAGE_THEMES.flatMap(theme=>IMAGE_COUNTS.map(count=>({
    theme,count,svg:theme.startsWith('mc-') ? '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10"/></svg>' :
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/avif;base64,AAAA"/></svg>'
  })));
  assert.match(makeImageReview(fake),/approved-image-audit/);
  assert.throws(()=>makeImageReview(fake.slice(1)),/Wrong/);
  assert.throws(()=>makeImageReview(fake.map((x,i)=>i===1?fake[0]:x)),/Unapproved/);
  assert.throws(()=>makeImageReview(fake.map((x,i)=>i===1?{...x,svg:x.svg.replace('data:image/avif;base64,AAAA','https://example.org/art.png')}:x)),/Unapproved/);
  assert.throws(()=>makeImageReview(fake.map((x,i)=>i===1?{...x,svg:x.svg.replace('</svg>','<script></script></svg>')}:x)),/Unapproved/);
  assert.throws(()=>makeImageReview(fake.map((x,i)=>i===9?{...x,svg:x.svg.replace('</svg>','<image href="data:image/avif;base64,AAAA"/></svg>')}:x)),/Unapproved/);
});

test("browser audit is fail-closed and never claims real GitHub proxy verification",()=>{
  const report={kind:"wvt-six-card-external-svg-image-audit",version:1,count:18,decoded:18,errors:[],
    githubReadmeProxy:"NOT_TESTED",cloudflareD1:"NOT_TESTED"};
  const html=x=>'<output id="approved-image-audit">'+JSON.stringify(x)+'</output>';
  assert.deepEqual(readImageReport(html(report)),report);
  for(const bad of [{decoded:17},{count:17},{githubReadmeProxy:"PASS"},
    {cloudflareD1:"PASS"},{errors:["blank artwork"]},{version:2}])
    assert.throws(()=>readImageReport(html({...report,...bad})));
  assert.throws(()=>readImageReport("<div/>"),/did not finish/);
});
