#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/assets/", import.meta.url).pathname;

const HELPER_NAMES = [
  "__extends",
  "__assign",
  "__rest",
  "__decorate",
  "__param",
  "__metadata",
  "__awaiter",
  "__generator",
  "__exportStar",
  "__createBinding",
  "__values",
  "__read",
  "__spread",
  "__spreadArrays",
  "__spreadArray",
  "__await",
  "__asyncGenerator",
  "__asyncValues",
  "__makeTemplateObject",
  "__importStar",
  "__importDefault",
];

if (!existsSync(DIST)) {
  console.error(`check-bundle-interop: no build output at ${DIST} — run vite build first`);
  process.exit(1);
}

const destructure = new RegExp(`\\{\\s*(${HELPER_NAMES.join("|")})\\s*:`);
const fallbackDefault = /\.default\s*\?\?/;

const failures = [];

for (const file of readdirSync(DIST)) {
  if (!file.endsWith(".js")) continue;
  const source = readFileSync(join(DIST, file), "utf8");
  const match = destructure.exec(source);
  if (match) {
    const at = match.index;
    const snippet = source.slice(Math.max(0, at - 120), at + 160).replace(/\s+/g, " ");
    failures.push({ file, helper: match[1], snippet });
  }
  if (fallbackDefault.test(source) && /tslib/.test(source)) {
    const at = source.search(fallbackDefault);
    const snippet = source.slice(Math.max(0, at - 120), at + 160).replace(/\s+/g, " ");
    failures.push({ file, helper: "default??", snippet });
  }
}

if (failures.length > 0) {
  console.error("check-bundle-interop: broken CommonJS-helper interop in the bundle\n");
  for (const failure of failures) {
    console.error(`  ${failure.file}  [${failure.helper}]`);
    console.error(`    ${failure.snippet}\n`);
  }
  console.error(
    "A `{ __extends: ... }` destructure means a TypeScript-helper package was\n" +
      "imported through its CommonJS build and the interop default came back\n" +
      "undefined. Check the `tslib` alias in vite.config.ts (echarts pins tslib\n" +
      "2.3.0, whose ESM shim destructures its own CJS build).",
  );
  process.exit(1);
}

console.log(`check-bundle-interop: ${readdirSync(DIST).filter((f) => f.endsWith(".js")).length} chunks clean`);
