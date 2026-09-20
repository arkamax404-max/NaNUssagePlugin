import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const palettes = {
  available: { background: [13, 17, 23], bars: [88, 166, 255] },
  loading: { background: [13, 17, 23], bars: [139, 148, 158] },
  warning: { background: [59, 38, 0], bars: [210, 153, 34] },
  unavailable: { background: [52, 18, 22], bars: [248, 81, 73] },
};

let created = 0;
let skipped = 0;

for (const asset of [
  [
    "../com.ulanzi.nanusage.ulanziPlugin/assets/plugin.png",
    196,
    196,
    palettes.available,
  ],
  [
    "../com.ulanzi.nanusage.ulanziPlugin/assets/action.png",
    196,
    196,
    palettes.available,
  ],
  [
    "../com.ulanzi.nanusage.ulanziPlugin/assets/available.png",
    196,
    196,
    palettes.available,
  ],
  [
    "../com.ulanzi.nanusage.ulanziPlugin/assets/loading.png",
    196,
    196,
    palettes.loading,
  ],
  [
    "../com.ulanzi.nanusage.ulanziPlugin/assets/warning.png",
    196,
    196,
    palettes.warning,
  ],
  [
    "../com.ulanzi.nanusage.ulanziPlugin/assets/unavailable.png",
    196,
    196,
    palettes.unavailable,
  ],
  [
    "../com.ulanzi.nanusage.ulanziPlugin/assets/banner.png",
    1536,
    1024,
    palettes.available,
  ],
  ["../assets/cover.png", 1774, 887, palettes.available],
  ["../assets/banner.png", 1536, 1024, palettes.available],
]) {
  const [path, width, height, palette] = asset;
  const url = new URL(path, import.meta.url);
  const target = fileURLToPath(url);
  if (existsSync(url)) {
    skipped += 1;
    console.log(`Skipped existing ${target}`);
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    url,
    createPng(width, height, (x, y) => {
      const sourceX = Math.floor((x * 100) / width);
      const sourceY = Math.floor((y * 100) / height);
      const bar =
        (sourceX >= 18 && sourceX < 32 && sourceY >= 55 && sourceY < 78) ||
        (sourceX >= 43 && sourceX < 57 && sourceY >= 38 && sourceY < 78) ||
        (sourceX >= 68 && sourceX < 82 && sourceY >= 22 && sourceY < 78);
      return bar ? palette.bars : palette.background;
    }),
  );
  created += 1;
  console.log(`Created ${target}`);
}

console.log(`Assets: ${created} created, ${skipped} skipped.`);

function createPng(width, height, paint) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      row.set([...paint(x, y), 255], offset);
    }
    rows.push(row);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
