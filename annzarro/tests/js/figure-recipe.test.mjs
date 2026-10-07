// The recipe an exported figure carries, and the ids that made SVGs differ
// (static/js/utils/plot-export.js): a PNG tEXt chunk and an SVG <metadata>
// element round-trip the view, with sorted keys and ASCII-only text; Plotly's
// random ids are renamed where they are names, never inside image data.
//
// Run: `node --test annzarro/tests/js/figure-recipe.test.mjs`
import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pe = await import(pathToFileURL(path.resolve(__dirname, "../../../static/js/utils/plot-export.js")).href);

// A 1x1 PNG, made here so the test needs no file
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function tinyPng() {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]));
}
function chunks(png) {
  const out = [];
  let at = 8;
  const b = Buffer.from(png);
  while (at < b.length) {
    const len = b.readUInt32BE(at);
    const type = b.toString("latin1", at + 4, at + 8);
    const crcOk = b.readUInt32BE(at + 8 + len) === zlib.crc32(b.subarray(at + 4, at + 8 + len));
    out.push({ type, crcOk });
    at += 12 + len;
  }
  return out;
}

const RECIPE = { panel_set: { view: { z: 1, a: { y: [3, { d: 1, c: 2 }], x: "Gène α & <b>" } } }, annzarro_version: "0.4.1" };

test("asciiJson: sorted keys, ASCII only, and the same value back", () => {
  const text = pe.asciiJson(RECIPE);
  assert.ok(/^[\x20-\x7e]*$/.test(text), text);
  assert.ok(text.indexOf('"annzarro_version"') < text.indexOf('"panel_set"'));
  assert.ok(text.indexOf('"c"') < text.indexOf('"d"'));
  assert.deepEqual(JSON.parse(text), RECIPE);
  // the same view built in another key order gives the same text
  const reordered = { annzarro_version: "0.4.1", panel_set: { view: { a: { x: "Gène α & <b>", y: [3, { c: 2, d: 1 }] }, z: 1 } } };
  assert.equal(pe.asciiJson(reordered), text);
});

test("PNG: the recipe goes in a tEXt chunk after IHDR, with a valid CRC, and comes back", () => {
  const png = pe.pngWithText(tinyPng(), pe.RECIPE_KEY, pe.asciiJson(RECIPE));
  assert.deepEqual(chunks(png).map(c => c.type), ["IHDR", "tEXt", "IDAT", "IEND"]);
  assert.ok(chunks(png).every(c => c.crcOk));
  assert.deepEqual(JSON.parse(pe.pngText(png, pe.RECIPE_KEY)), RECIPE);
  // exported again: replaced, not added
  const again = pe.pngWithText(png, pe.RECIPE_KEY, pe.asciiJson({ v: 2 }));
  assert.equal(chunks(again).filter(c => c.type === "tEXt").length, 1);
  assert.deepEqual(JSON.parse(pe.pngText(again, pe.RECIPE_KEY)), { v: 2 });
  assert.equal(pe.pngText(tinyPng(), pe.RECIPE_KEY), null);
});

test("embedRecipe on a PNG data URL", () => {
  const url = "data:image/png;base64," + Buffer.from(tinyPng()).toString("base64");
  const out = pe.embedRecipe(url, "png", RECIPE);
  assert.ok(out.startsWith("data:image/png;base64,"));
  const bytes = new Uint8Array(Buffer.from(out.split(",")[1], "base64"));
  assert.deepEqual(JSON.parse(pe.pngText(bytes, pe.RECIPE_KEY)), RECIPE);
  assert.equal(pe.embedRecipe(url, "jpeg", RECIPE), url);
  assert.equal(pe.embedRecipe(url, "png", null), url);
});

test("SVG: the recipe is the first child, escaped, and comes back; exported again it is replaced", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g/></svg>';
  const out = pe.embedRecipe(svg, "svg", RECIPE);
  assert.match(out, /^<svg [^>]*><metadata id="annzarro-recipe"><annzarro:recipe /);
  assert.ok(!out.includes("<b>"), "markup in a value is escaped");
  assert.deepEqual(JSON.parse(pe.svgRecipe(out)), RECIPE);
  const again = pe.embedRecipe(out, "svg", { v: 2 });
  assert.equal(again.match(/annzarro-recipe/g).length, 1);
  assert.deepEqual(JSON.parse(pe.svgRecipe(again)), { v: 2 });
});

test("stableSvgIds: Plotly's random ids become fixed names, image data is untouched", () => {
  const svg = `<svg><defs id="defs-a1b2c3"><clipPath id="clipa1b2c3xyplot"/></defs>` +
    `<g clip-path="url(#clipa1b2c3xyplot)"/><use href="#legenda1b2c3"/>` +
    `<g class="trace tracef00d42"/><image xlink:href="data:image/png;base64,ZZa1b2c3ZZ"/></svg>`;
  const out = pe.stableSvgIds(svg, ["a1b2c3", "f00d42"]);
  assert.ok(out.includes('id="defs-az0"') && out.includes('id="clipaz0xyplot"'));
  assert.ok(out.includes("url(#clipaz0xyplot)") && out.includes('href="#legendaz0"'));
  assert.ok(out.includes("base64,ZZa1b2c3ZZ"), "the token inside image data is kept");
  assert.ok(out.includes('class="trace tracef00d42"'), "class names are not ids");
  assert.equal(pe.stableSvgIds(svg, []), svg);
});
