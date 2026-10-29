// Fails if the database client is imported anywhere except src/shared/** and
// src/modules/<module>/data.ts (decision P3). Run with `npm run check:boundaries`.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "src");
const forbidden = [/from\s+["'](@\/shared\/db|\.{1,2}\/(?:\.\.\/)*shared\/db|\.\/db)["']/, /["']@neondatabase\/serverless["']/];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) yield full;
  }
}

function allowed(rel) {
  return rel.startsWith("src/shared/") || /^src\/modules\/[^/]+\/data\.ts$/.test(rel);
}

const problems = [];
for await (const file of walk(root)) {
  const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
  if (allowed(rel)) continue;
  const text = await readFile(file, "utf8");
  if (forbidden.some((re) => re.test(text))) problems.push(rel);
}

if (problems.length) {
  console.error("Database client imported outside the data-access layer:");
  for (const p of problems) console.error("  -", p);
  process.exit(1);
}
console.log("boundaries ok");
