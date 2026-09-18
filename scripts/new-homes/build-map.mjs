#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const cwd = process.cwd();

async function load(name) {
  try {
    return JSON.parse(await readFile(resolve(cwd, name), "utf8"));
  } catch {
    return null;
  }
}

const ocala = await load("christina-martinez.json");
const central = await load("central-florida.json");
const tampa = await load("tampa.json");
const by = new Map();
for (const snap of [central, tampa, ocala]) {
  if (!snap?.communities) continue;
  for (const row of snap.communities) {
    const slug = String(row.slug || "").trim();
    if (!slug) continue;
    by.set(slug, { ...row, slug });
  }
}
const communities = [...by.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
const out = {
  updatedAt: new Date().toISOString(),
  source: "drhorton-public",
  builder: "drhorton",
  adapter: "drhorton-public",
  market: "central-florida-tampa",
  communities,
};
await writeFile(resolve(cwd, "map-inventory.json"), JSON.stringify(out, null, 2));
console.log(`[new-homes] map-inventory ${communities.length} communities`);
