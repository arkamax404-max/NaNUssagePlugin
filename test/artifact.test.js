const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

// Every path is derived from __dirname so the suite is hermetic: it never reads
// the working directory, never writes and never touches the network.
const repoRoot = path.join(__dirname, "..");
const pluginRoot = path.join(repoRoot, "com.ulanzi.nanusage.ulanziPlugin");
const assetsRoot = path.join(pluginRoot, "assets");

const ICON_NAMES = ["plugin", "action", "loading", "available", "warning", "unavailable"];

// rx: background rect corner radius. fill: background rect fill. gradient: the
// mark is painted with a <linearGradient>; the two flat states carry a literal
// stroke colour instead.
const SVG_CONTRACT = [
  { name: "plugin.svg", rx: "44", fill: "#0d1117", gradient: true },
  { name: "action.svg", rx: "44", fill: "#0d1117", gradient: true },
  { name: "available.svg", rx: "12", fill: "#0d1117", gradient: true },
  { name: "loading.svg", rx: "12", fill: "#0d1117", gradient: false, stroke: "#8b949e" },
  { name: "warning.svg", rx: "12", fill: "#3b2600", gradient: true },
  { name: "unavailable.svg", rx: "12", fill: "#341216", gradient: false, stroke: "#f85149" },
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// Reads width, height and colour type straight out of the IHDR chunk, whose
// payload starts at byte 16 (after the 8-byte signature and the 8-byte length +
// "IHDR" header).
function readPngHeader(file) {
  const bytes = readFileSync(file);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

// PNG stores pixel data as zlib-compressed IDAT chunks, each scanline prefixed by
// a filter byte. For the FIRST pixel of the FIRST scanline every filter type
// (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth) reconstructs to the raw byte: Sub,
// Average and Paeth subtract the left neighbour, which is zero at x = 0, and Up
// and Paeth subtract the upper neighbour, which does not exist on row 0. So
// concatenating the IDAT payloads, inflating them, skipping the single leading
// filter byte and reading the next four bytes yields the RGBA of pixel (0, 0)
// without implementing a filter decoder.
function firstPixelAlpha(file) {
  const bytes = readFileSync(file);
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  // raw[0] is the filter byte, raw[1..3] are R, G, B and raw[4] is alpha.
  return raw[4];
}

test("the three English long descriptions are character-identical", () => {
  const details = [
    ["manifest.json Detail", readJson(path.join(pluginRoot, "manifest.json")).Detail],
    ["en.json Detail", readJson(path.join(pluginRoot, "en.json")).Detail],
    ["store.json longDescription", readJson(path.join(repoRoot, "store.json")).longDescription],
  ];
  for (const [name, text] of details)
    assert.equal(typeof text, "string", `${name} must be a string`);
  for (let i = 0; i < details.length; i += 1)
    for (let j = i + 1; j < details.length; j += 1) {
      const [aName, aText] = details[i];
      const [bName, bText] = details[j];
      assert.equal(
        aText,
        bText,
        `${aName} (${aText.length} chars) and ${bName} (${bText.length} chars) must be character-identical`,
      );
    }
});

test("zh_CN.json Detail is a non-empty translation, not the English text", () => {
  const manifest = readJson(path.join(pluginRoot, "manifest.json"));
  const zh = readJson(path.join(pluginRoot, "zh_CN.json"));
  assert.equal(typeof zh.Detail, "string", "zh_CN.json Detail must be a string");
  assert.ok(zh.Detail.length > 0, "zh_CN.json Detail must not be empty");
  assert.notEqual(
    zh.Detail,
    manifest.Detail,
    "zh_CN.json Detail must differ from the English text; identical means English was pasted into the Chinese file",
  );
});

test("en.json and zh_CN.json expose exactly Name, Description and Detail in order", () => {
  const expected = ["Name", "Description", "Detail"];
  for (const file of ["en.json", "zh_CN.json"])
    assert.deepEqual(
      Object.keys(readJson(path.join(pluginRoot, file))),
      expected,
      `${file} keys must be exactly ${expected.join(", ")} in order`,
    );
});

test("manifest.json Name and Description match en.json", () => {
  const manifest = readJson(path.join(pluginRoot, "manifest.json"));
  const en = readJson(path.join(pluginRoot, "en.json"));
  assert.equal(manifest.Name, en.Name, "manifest.json Name must equal en.json Name");
  assert.equal(
    manifest.Description,
    en.Description,
    "manifest.json Description must equal en.json Description",
  );
});

test("the six icon PNGs are 196x196 RGBA", () => {
  for (const name of ICON_NAMES) {
    const png = readPngHeader(path.join(assetsRoot, `${name}.png`));
    assert.equal(png.width, 196, `${name}.png width`);
    assert.equal(png.height, 196, `${name}.png height`);
    assert.equal(png.colorType, 6, `${name}.png colour type must be 6 (RGBA)`);
  }
});

test("the plugin-folder banner.png is a separate 1200x800 palette image", () => {
  const png = readPngHeader(path.join(assetsRoot, "banner.png"));
  assert.equal(png.width, 1200, "banner.png width");
  assert.equal(png.height, 800, "banner.png height");
  assert.equal(png.colorType, 3, "banner.png colour type must be 3 (indexed palette)");
});

test("each icon PNG has a fully transparent pixel at (0, 0)", () => {
  for (const name of ICON_NAMES)
    assert.equal(
      firstPixelAlpha(path.join(assetsRoot, `${name}.png`)),
      0,
      `${name}.png pixel (0, 0) alpha must be 0, the rounded corner falls outside the shape`,
    );
});

test("the six SVGs keep their brand geometry", () => {
  for (const spec of SVG_CONTRACT) {
    const svg = readFileSync(path.join(assetsRoot, spec.name), "utf8");
    assert.ok(svg.includes(`rx="${spec.rx}"`), `${spec.name} background rect rx must be ${spec.rx}`);
    assert.ok(svg.includes(`fill="${spec.fill}"`), `${spec.name} background fill must be ${spec.fill}`);
    assert.ok(svg.includes("<polygon"), `${spec.name} must contain the hexagon <polygon`);
    assert.ok(svg.includes("<path"), `${spec.name} must contain the infinity <path`);
    if (spec.gradient) {
      assert.ok(svg.includes("<linearGradient"), `${spec.name} must reference a <linearGradient`);
    } else {
      assert.ok(
        !svg.includes("<linearGradient"),
        `${spec.name} is flat on purpose and must not carry a gradient`,
      );
      assert.ok(
        svg.includes(`stroke="${spec.stroke}"`),
        `${spec.name} flat stroke must be ${spec.stroke}`,
      );
    }
  }
});
