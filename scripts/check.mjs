import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginName = "com.ulanzi.nanusage.ulanziPlugin";
const expectedAuthor = "Santiago Pérez";
const root = new URL("../", import.meta.url);
const pluginRoot = new URL(`../${pluginName}/`, import.meta.url);
let manifest;
try { manifest = JSON.parse(readFileSync(new URL("manifest.json", pluginRoot), "utf8")); }
catch (error) { throw new Error(`manifest.json must contain valid JSON: ${error.message}`); }
for (const field of ["Author", "Name", "Version", "CodePath", "Type", "UUID", "Actions"])
  if (!manifest[field]) throw new Error(`manifest.json is missing ${field}`);
if (manifest.Type !== "JavaScript" || manifest.CodePath !== "dist/main.js")
  throw new Error("Manifest must use the packaged JavaScript entry point");
if (manifest.UUID !== "com.ulanzi.ulanzistudio.nanusage")
  throw new Error("Manifest UUID is invalid");
if (manifest.Author !== expectedAuthor)
  throw new Error(`Manifest author must be exactly ${expectedAuthor}`);
const expectedOS = [
  { Platform: "windows", MinimumVersion: "10" },
  { Platform: "mac", MinimumVersion: "12" },
];
if (JSON.stringify(manifest.OS) !== JSON.stringify(expectedOS))
  throw new Error("Manifest OS support must be exactly Windows 10+ and macOS 12+");
if (!Array.isArray(manifest.Actions) || manifest.Actions.length !== 1)
  throw new Error("Plugin must expose exactly one action");
const action = manifest.Actions[0];
if (action.UUID !== `${manifest.UUID}.usage` || action.Devices?.[0] !== "D200" || action.States?.length !== 4)
  throw new Error("Usage action must be a D200 four-state action");
for (const asset of [
  "assets/plugin.svg", "assets/action.svg", "assets/loading.svg", "assets/available.svg",
  "assets/warning.svg", "assets/unavailable.svg", "property-inspector/usage/inspector.html",
  "property-inspector/usage/inspector.css", "property-inspector/usage/inspector.js",
  "property-inspector/lib/host-api.js",
]) if (!existsSync(new URL(asset, pluginRoot))) throw new Error(`Package file is missing: ${asset}`);
if (existsSync(new URL("assets/plugin.png", pluginRoot)) && readFileSync(new URL("assets/plugin.png", pluginRoot)).subarray(1, 4).toString("ascii") !== "PNG")
  throw new Error("Generated plugin.png is not a valid PNG signature");

const packageMetadata = parseJson(new URL("package.json", root), "package.json");
const packageLock = parseJson(new URL("package-lock.json", root), "package-lock.json");
if (packageMetadata.author !== expectedAuthor || packageLock.packages?.[""]?.author !== expectedAuthor)
  throw new Error(`Package author must be exactly ${expectedAuthor}`);
if (!readFileSync(new URL("README.md", root), "utf8").includes(`**Author:** ${expectedAuthor}`))
  throw new Error(`README author must be exactly ${expectedAuthor}`);
if (packageMetadata.license !== "MIT")
  throw new Error("Package license must be exactly MIT");
const licenseUrl = new URL("LICENSE", root);
if (!existsSync(licenseUrl)) throw new Error("Package file is missing: LICENSE");
if (!readFileSync(licenseUrl, "utf8").includes("MIT License"))
  throw new Error("LICENSE must contain the MIT License text");
if (!readFileSync(new URL("README.md", root), "utf8").includes("MIT License"))
  throw new Error("README must state the MIT License");

const store = parseJson(new URL("store.json", root), "store.json");
const storeFields = ["cover", "screenshots", "longDescription", "deviceTypes", "tags"];
if (JSON.stringify(Object.keys(store)) !== JSON.stringify(storeFields))
  throw new Error(`store.json must use exactly these fields in order: ${storeFields.join(", ")}`);
if (store.cover !== "assets/cover.png" || JSON.stringify(store.screenshots) !== JSON.stringify(["assets/banner.png"]))
  throw new Error("store.json must reference the provided cover and banner assets exactly");
if (typeof store.longDescription !== "string" || !store.longDescription.trim())
  throw new Error("store.json requires a longDescription");
if (JSON.stringify(store.deviceTypes) !== JSON.stringify(["deck"]) || !Array.isArray(store.tags) || store.tags.length === 0)
  throw new Error("store.json deviceTypes or tags are invalid");
for (const asset of [store.cover, ...store.screenshots]) {
  const path = new URL(asset, root);
  if (!existsSync(path)) throw new Error(`Store asset is missing: ${asset}`);
  if (readFileSync(path).subarray(1, 4).toString("ascii") !== "PNG")
    throw new Error(`Store asset is not a valid PNG: ${asset}`);
}

function parseJson(url, name) {
  try { return JSON.parse(readFileSync(url, "utf8")); }
  catch (error) { throw new Error(`${name} must contain valid JSON: ${error.message}`); }
}

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? javascriptFiles(join(directory, entry.name)) : entry.name.endsWith(".js") ? [join(directory, entry.name)] : []);
}
for (const directory of [fileURLToPath(new URL("../src/", import.meta.url)), fileURLToPath(new URL("property-inspector/", pluginRoot))])
  for (const file of javascriptFiles(directory)) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });

const forbiddenNames = ["flight", "airlabs", "GA100", "github", "copilot", "ghcopilot"];
for (const directory of [fileURLToPath(new URL("../src/", import.meta.url)), fileURLToPath(pluginRoot)]) {
  for (const file of javascriptFiles(directory)) {
    const content = readFileSync(file, "utf8").toLowerCase();
    for (const name of forbiddenNames)
      if (content.includes(name.toLowerCase())) throw new Error(`Template residue found in ${file}: ${name}`);
  }
}
console.log(`Validated ${manifest.UUID} and source/package syntax.`);
