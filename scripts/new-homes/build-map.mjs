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
function photoList(row) {
  const list = Array.isArray(row?.photos) ? row.photos.filter(Boolean) : [];
  if (list.length) return list;
  return row?.photo ? [row.photo] : [];
}

function keepMedia(fresh, prev) {
  if (!prev) return fresh;
  const next = { ...fresh };
  const photos = photoList(fresh).length >= photoList(prev).length ? photoList(fresh) : photoList(prev);
  if (photos.length) {
    next.photos = photos;
    next.photo = photos[0];
  }
  if ((!next.plan || next.plan === "Not provided") && prev.plan) next.plan = prev.plan;
  return next;
}

function byKey(rows, keyOf) {
  const map = new Map();
  for (const row of rows || []) {
    const key = keyOf(row);
    if (key) map.set(key, row);
  }
  return map;
}

function mergeRows(fresh, prev, keyOf) {
  const prevBy = byKey(prev, keyOf);
  return (fresh || []).map((row) => keepMedia(row, prevBy.get(keyOf(row))));
}

const previous = await load("map-inventory.json");
const prevBySlug = byKey(previous?.communities, (row) => String(row.slug || "").trim());
const by = new Map();
for (const snap of [central, tampa, ocala]) {
  if (!snap?.communities) continue;
  for (const row of snap.communities) {
    const slug = String(row.slug || "").trim();
    if (!slug) continue;
    const prev = prevBySlug.get(slug);
    by.set(slug, {
      ...row,
      slug,
      lots: mergeRows(row.lots, prev?.lots, (lot) => lot.sourceUrl || `${lot.lot}|${lot.address}`),
      models: mergeRows(row.models, prev?.models, (model) => model.sourceUrl || model.slug || model.name),
    });
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
