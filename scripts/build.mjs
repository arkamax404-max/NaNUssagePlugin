import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = new URL("../src/plugin/", import.meta.url);
const output = new URL(
  "../com.ulanzi.nanusage.ulanziPlugin/dist/",
  import.meta.url,
);
rmSync(output, { force: true, recursive: true });
mkdirSync(output, { recursive: true });
cpSync(source, output, { recursive: true });

console.log(
  `Copied plugin runtime from ${fileURLToPath(source)} to package dist/.`,
);
