/**
 * Pull every Horton gallery photo onto lots and floor-plan models.
 * Reads and writes src/data/new-homes/map-inventory.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || join(here, "../../src/data/new-homes/map-inventory.json");
const CONCURRENCY = 2;

function decode(url) {
  return url.replace(/&amp;/g, "&");
}

function galleryFrom(html) {
  const start = html.indexOf('class="PropertyGallery"');
  const end = start >= 0 ? html.indexOf("PropertyGallery-sec-buttons", start) : -1;
  const block = start >= 0 ? html.slice(start, end > start ? end : start + 40000) : "";
  if (!block) return [];
  const best = new Map();
  const order = [];
  const re = /(?:data-lazy|data-src|src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  for (const match of block.matchAll(re)) {
    const raw = decode(match[1]);
    if (/videodefaultimage|\/icons?\//i.test(raw)) continue;
    const abs = raw.startsWith("http") ? raw : `https://www.drhorton.com${raw.startsWith("/") ? "" : "/"}${raw}`;
    let path = abs;
    let width = 0;
    try {
      const url = new URL(abs);
      path = url.pathname;
      width = Number(url.searchParams.get("w") || 0);
    } catch {
      continue;
    }
    if (!/\/productcatalog\//i.test(path)) continue;
    const prev = best.get(path);
    if (!prev) {
      order.push(path);
      best.set(path, { width, url: abs });
    } else if (width > prev.width) {
      best.set(path, { width, url: abs });
    }
  }
  return order.map((path) => best.get(path).url);
}

async function fetchHtml(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") || 20) * 1000;
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    if (!res.ok) throw new Error(String(res.status));
    return res.text();
  }
  throw new Error("429");
}

async function pool(items, worker) {
  let index = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

const inventory = JSON.parse(readFileSync(file, "utf8"));
const targets = [];
for (const community of inventory.communities) {
  for (const lot of community.lots || []) {
    if (lot.sourceUrl && (lot.photos || []).length < 2) targets.push(lot);
  }
  for (const model of community.models || []) {
    if (model.sourceUrl && (model.photos || []).length < 2) targets.push(model);
  }
}

let done = 0;
let withGallery = 0;
let failed = 0;

await pool(targets, async (item) => {
  try {
    const html = await fetchHtml(item.sourceUrl);
    const photos = galleryFrom(html);
    if (photos.length) {
      item.photos = photos;
      item.photo = photos[0];
      withGallery += 1;
    }
  } catch {
    failed += 1;
  }
  done += 1;
  if (done % 40 === 0 || done === targets.length) {
    writeFileSync(file, JSON.stringify(inventory, null, 2) + "\n");
    console.log(`saved ${done}/${targets.length} galleries=${withGallery} failed=${failed}`);
  }
});

console.log("done", { total: targets.length, withGallery, failed });
