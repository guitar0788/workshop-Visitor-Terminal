import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const CASES = [
  { path: "docs/qa/approved-pixel-cat.svg", title: "1 Pixel Cat", width: 690, crop: 0 },
  { path: "docs/qa/approved-green-terminal.svg", title: "3 Green Terminal", width: 722, crop: 705 },
  { path: "docs/qa/approved-blue-gold-rpg.svg", title: "5 Blue Gold RPG", width: 722, crop: 1450 }
];

test("GitHub image proxy fixtures use the exact approved bundled raster bytes", async () => {
  const source = await readFile("src/approved-three-card-image.ts", "utf8");
  const data = source.match(/data:image\/avif;base64,[A-Za-z0-9+/=]+/)?.[0];
  assert(data, "Missing user-approved raster data URL");
  for (const fixture of CASES) {
    const svg = await readFile(fixture.path, "utf8");
    assert(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert(svg.includes('width="' + fixture.width + '" height="362"'));
    assert(svg.includes('viewBox="0 0 ' + fixture.width + ' 362"'));
    assert(svg.includes('x="-' + fixture.crop + '" y="0" width="2172" height="362"'));
    assert.equal(svg.split(data).length - 1, 1, "Exactly one unmodified source image");
    assert(!/<script\b|<foreignObject\b|\bhref="https?:/i.test(svg));
    assert(!/Bearer |token|secret|ADMIN_TOKEN/i.test(svg));
    assert(!svg.includes("data:image/png"), "Probe must match current live AVIF implementation");
    assert(svg.includes("static README display test (not live counter)"));
  }
});

test("GitHub Markdown embeds exactly the three diagnostic SVG files", async () => {
  const markdown = await readFile("docs/qa/README.md", "utf8");
  const images = [...markdown.matchAll(/!\[[^\]]+\]\(\.\/([^\s)]+\.svg)\)/g)].map(x => x[1]);
  assert.deepEqual(images, CASES.map(x => x.path.split("/").at(-1)));
  assert(markdown.includes("not a remote Cloudflare Worker response"));
  assert(markdown.includes("static diagnostic"));
  assert(!markdown.includes("![Visitor counter]("), "Do not suggest static test art for live counting");
});
