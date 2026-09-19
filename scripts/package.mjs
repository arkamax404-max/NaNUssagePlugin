import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pluginName = "com.ulanzi.nanusage.ulanziPlugin";
const pluginPath = fileURLToPath(new URL(`../${pluginName}/`, import.meta.url));
const outputPath = fileURLToPath(new URL(`../${pluginName}/package/${pluginName}.zip`, import.meta.url));
const files = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "package") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else files.push({ path, name: `${pluginName}/${relative(pluginPath, path).replaceAll("\\", "/")}` });
  }
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer; }
function u32(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; }
collect(pluginPath);
const local = [];
const central = [];
let offset = 0;
for (const file of files) {
  const data = readFileSync(file.path);
  const name = Buffer.from(file.name);
  const crc = crc32(data);
  const header = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
  local.push(header);
  central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
  offset += header.length;
}
const directory = Buffer.concat(central);
const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.length), u32(offset), u16(0)]);
mkdirSync(fileURLToPath(new URL(`../${pluginName}/package/`, import.meta.url)), { recursive: true });
writeFileSync(outputPath, Buffer.concat([...local, directory, end]));
console.log(`Created ${outputPath} with ${pluginName} at ZIP root.`);
