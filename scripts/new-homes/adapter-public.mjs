/**
 * Adapter B — public D.R. Horton community + QMI pages (no login, no paywall).
 * Selectors live only here. 401/403 → BLOCKED so the job keeps previous data.
 */
import { fetchText, log, sleep } from "./lib.mjs";

const DEFAULT_PAGES = [
  { slug: "tartan-farms-at-winding-oaks", url: "https://www.drhorton.com/florida/west-central-florida/ocala/tartan-farms-at-winding-oaks" },
  { slug: "mockingbird-reserve-at-winding-oaks", url: "https://www.drhorton.com/florida/west-central-florida/ocala/mockingbird-reserve-at-winding-oaks" },
  { slug: "derby-creek", url: "https://www.drhorton.com/florida/west-central-florida/ocala/derby-creek" },
  { slug: "the-towns-at-laurel-commons", url: "https://www.drhorton.com/florida/west-central-florida/ocala/the-towns-at-laurel-commons" },
  { slug: "ocala-crossings-south", url: "https://www.drhorton.com/florida/west-central-florida/ocala/ocala-crossings-south" },
  { slug: "mcginley-landing", url: "https://www.drhorton.com/florida/west-central-florida/ocala/mcginley-landing" },
  { slug: "ridge-at-heat-brook", url: "https://www.drhorton.com/florida/west-central-florida/ocala/ridge-at-heath-brook" },
  { slug: "emerson-pointe", url: "https://www.drhorton.com/florida/west-central-florida/ocala/emerson-pointe" },
  { slug: "ocala-preserve", url: "https://www.drhorton.com/florida/west-central-florida/ocala/ocala-preserve" },
  { slug: "autumn-glen", url: "https://www.drhorton.com/florida/west-central-florida/belleview/autumn-glen" },
  { slug: "marion-oaks-spot-lots", url: "https://www.drhorton.com/florida/west-central-florida/ocala/marion-spot-lots" },
  { slug: "citrus-springs", url: "https://www.drhorton.com/florida/west-central-florida/citrus-springs/citrus-county-spot-lots" },
];

/** Horton city hubs 200 with no cards. Try these if the primary page is empty. */
const URL_FALLBACKS = {
  "autumn-glen": [
    "https://www.drhorton.com/florida/west-central-florida/belleview/autumn-glen",
    "https://www.drhorton.com/florida/west-central-florida/ocala/autumn-glen",
  ],
  "marion-oaks-spot-lots": [
    "https://www.drhorton.com/florida/west-central-florida/ocala/marion-spot-lots",
    "https://www.drhorton.com/florida/west-central-florida/ocala/marion-oaks",
  ],
  "citrus-springs": [
    "https://www.drhorton.com/florida/west-central-florida/citrus-springs/citrus-county-spot-lots",
    "https://www.drhorton.com/florida/west-central-florida/citrus-springs/citrus-springs",
  ],
};

const ORIGIN = "https://www.drhorton.com";

const CENTRAL_FL_COUNTIES = new Set([
  "orange-county",
  "osceola-county",
  "seminole-county",
  "lake-county",
  "polk-county",
  "volusia-county",
  "sumter-county",
  "tampa",
  "hillsborough-county",
  "pasco-county",
  "pinellas-county",
  "manatee-county",
]);

/** Horton files Plant City under /florida/tampa/ even though it's Central Florida. */
const CENTRAL_FL_CITIES = new Set(["plant-city"]);

/** Keep Ocala / Marion turf off the Central Florida crawl (that's Christina). */
const EXCLUDE_CITIES = new Set(["ocala", "belleview", "citrus-springs"]);

function communityPathFromHref(href) {
  if (!href) return "";
  const path = String(href).trim().split("#")[0].split("?")[0].replace(ORIGIN, "").trim();
  if (!path.startsWith("/florida/")) return "";
  if (/\/qmis\/|\/floor-plans\//i.test(path)) return "";
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  // /florida/{county}/{city}/{community}
  if (parts.length !== 4) return "";
  return `/${parts.join("/")}`;
}

function slugFromCommunityPath(path) {
  const parts = path.split("/").filter(Boolean);
  return parts[3] || "";
}

function parseNearbyCommunityLinks(html, allowCounties) {
  const hrefs = [...String(html).matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
  const found = [];
  const seen = new Set();
  for (const href of hrefs) {
    const path = communityPathFromHref(href);
    if (!path || seen.has(path)) continue;
    const parts = path.split("/").filter(Boolean);
    const county = parts[1];
    const city = parts[2];
    if (EXCLUDE_CITIES.has(city)) continue;
    if (allowCounties?.size && !allowCounties.has(county) && !CENTRAL_FL_CITIES.has(city)) continue;
    seen.add(path);
    found.push({ slug: slugFromCommunityPath(path), url: `${ORIGIN}${path}` });
  }
  return found;
}

export async function discoverCommunityPages(seeds, { counties = CENTRAL_FL_COUNTIES, maxPages = 120 } = {}) {
  const allow = counties instanceof Set ? counties : new Set(counties || []);
  const queue = [];
  const seen = new Set();
  const pages = [];
  for (const seed of seeds || []) {
    const path = communityPathFromHref(seed) || communityPathFromHref(new URL(seed, ORIGIN).pathname);
    const url = path ? `${ORIGIN}${path}` : seed;
    const slug = slugFromCommunityPath(path) || slugify(url);
    if (seen.has(url)) continue;
    seen.add(url);
    queue.push({ slug, url });
  }
  while (queue.length && pages.length < maxPages) {
    const page = queue.shift();
    pages.push(page);
    log("info", "discover: community", { slug: page.slug, url: page.url, queued: queue.length });
    try {
      const { text } = await fetchText(page.url, { tries: 3, timeoutMs: 25000 });
      for (const next of parseNearbyCommunityLinks(text, allow)) {
        if (seen.has(next.url)) continue;
        seen.add(next.url);
        queue.push(next);
      }
    } catch (err) {
      if (err && err.code === "BLOCKED") throw err;
      log("warn", "discover: seed skipped", { url: page.url, err: String(err.message || err) });
    }
    await sleep(800);
  }
  return pages;
}

function decode(html) {
  return String(html || "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absolutize(url) {
  if (!url) return "";
  const clean = url.replace(/&amp;/g, "&").trim();
  if (clean.startsWith("http")) return clean;
  if (clean.startsWith("//")) return `https:${clean}`;
  if (clean.startsWith("/")) return `${ORIGIN}${clean}`;
  return `${ORIGIN}/${clean}`;
}

function mediaUrl(url) {
  const abs = absolutize(url);
  if (!abs.includes("/-/media/drhorton/productcatalog/")) return "";
  if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(abs)) return "";
  return abs;
}

function parseMoney(raw) {
  if (!raw) return null;
  const num = parseFloat(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function slugFromHref(href) {
  if (!href) return "";
  const qmi = href.match(/\/qmis\/([a-z0-9-]+)/i);
  if (qmi) return qmi[1].toLowerCase();
  const plan = href.match(/\/floor-plans\/([a-z0-9-]+)/i);
  if (plan) return plan[1].toLowerCase();
  return "";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isThinCommunityPage(html) {
  const cards = html.split(/available-home-card/i).length - 1;
  const plans = /id="floorplanItems"/i.test(html);
  return cards === 0 && !plans;
}

function parseCard(block) {
  const priceMatch = block.match(/\$([0-9]{2,3},[0-9]{3})/);
  const wasMatch = block.match(/was\s+\$([0-9]{2,3},[0-9]{3})/i);
  const addrMatch = block.match(/<h3>([^<]+)<\/h3>/i);
  const lotMatch = block.match(/Lot\s+(\d+)/i);
  const bedsMatch = block.match(/(\d+(?:\.\d+)?)\s*<span>\s*Bed/i);
  const bathsMatch = block.match(/(\d+(?:\.\d+)?)\s*<span>\s*Bath/i);
  const garageMatch = block.match(/(\d+(?:\.\d+)?)\s*<span>\s*Garage/i);
  const storyMatch = block.match(/(\d+(?:\.\d+)?)\s*<span>\s*Story/i);
  const sqftMatch = block.match(/([\d,]+)\s*<span>\s*Sq\.?\s*Ft/i);
  const hrefMatch = block.match(/href="([^"]+\/qmis\/[^"]+)"/i);
  const imgMatch =
    block.match(/background-image:\s*url\('([^']+)'\)/i) ||
    block.match(/background-image:\s*url\("([^"]+)"\)/i);
  const price = parseMoney(priceMatch?.[1]);
  const address = decode(addrMatch?.[1] || "");
  const photo = mediaUrl(imgMatch?.[1] || "");
  const sourceUrl = hrefMatch ? absolutize(hrefMatch[1]) : "";
  if (!address) return null;
  if (!price && !lotMatch && !sourceUrl) return null;
  if (!photo && !sourceUrl && !price) return null;
  const was = parseMoney(wasMatch?.[1]);
  const lot = {
    lot: lotMatch?.[1] || "",
    address,
    plan: "",
    price,
    priceLabel: priceMatch ? `$${priceMatch[1]}` : "",
    beds: bedsMatch ? Number(bedsMatch[1]) : null,
    homeSlug: slugFromHref(hrefMatch?.[1] || "") || slugify(address),
    sourceUrl,
  };
  if (bathsMatch) lot.baths = bathsMatch[1];
  if (sqftMatch) lot.sqft = sqftMatch[1];
  if (storyMatch) lot.story = storyMatch[1];
  if (garageMatch) lot.garage = garageMatch[1];
  if (photo) {
    lot.photo = photo;
    lot.photos = [photo];
  }
  if (price && was && was > price) {
    lot.incentive = Math.round(was - price);
    lot.incentiveLabel = `(${lot.incentive.toLocaleString()})`;
  }
  if (/move-?in ready/i.test(block)) lot.status = "ready";
  else if (/under construction/i.test(block)) lot.status = "building";
  return lot;
}

async function fetchCommunityHtml(page) {
  const seen = new Set();
  const queue = [page.url, ...(URL_FALLBACKS[page.slug] || [])].filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  let last = null;
  for (const url of queue) {
    log("info", "adapter B: fetching community", { slug: page.slug, url });
    const { text, url: finalUrl } = await fetchText(url, { tries: 3, timeoutMs: 25000 });
    last = { text, url: finalUrl || url };
    if (!isThinCommunityPage(text)) return last;
    log("warn", "adapter B: thin/hub page, trying fallback", { slug: page.slug, url: finalUrl || url });
  }
  return last;
}

function parseFloorPlan(block) {
  const hrefMatch = block.match(/href="([^"]+\/floor-plans\/[^"]+)"/i);
  const nameMatch = block.match(/<h2>([^<]+)<\/h2>/i);
  const startMatch = block.match(/<h3>([^<]+)<\/h3>/i);
  const bedsMatch = block.match(/(\d+(?:\.\d+)?)\s*<span>\s*Bed/i);
  const bathsMatch = block.match(/(\d+(?:\.\d+)?)\s*<span>\s*Bath/i);
  const garageMatch = block.match(/(\d+(?:\.\d+)?)\s*<span>\s*Garage/i);
  const storyMatch = block.match(/(\d+(?:\.\d+)?)\s*<span>\s*Story/i);
  const sqftMatch = block.match(/([\d,]+)\s*<span>\s*Sq\.?\s*Ft/i);
  const imgMatch =
    block.match(/background-image:\s*url\('([^']+)'\)/i) ||
    block.match(/background-image:\s*url\("([^"]+)"\)/i);
  const name = decode(nameMatch?.[1] || "");
  if (!name || !hrefMatch) return null;
  const model = {
    slug: slugFromHref(hrefMatch?.[1] || "") || slugify(name),
    name,
    startingLabel: decode(startMatch?.[1] || "") || undefined,
    sourceUrl: hrefMatch ? absolutize(hrefMatch[1]) : "",
  };
  if (bedsMatch) model.beds = Number(bedsMatch[1]);
  if (bathsMatch) model.baths = bathsMatch[1];
  if (sqftMatch) model.sqft = sqftMatch[1];
  if (storyMatch) model.story = storyMatch[1];
  if (garageMatch) model.garage = garageMatch[1];
  const photo = mediaUrl(imgMatch?.[1] || "");
  if (photo) model.photo = photo;
  return model;
}

function communityNameFromHtml(html, fallback) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const name = decode(h1[1]).replace(/^Homes for sale at/i, "").trim();
    if (name) return name;
  }
  return fallback;
}

function communityAddressFromHtml(html) {
  const match = html.match(/(\d{3,5}\s+[A-Za-z0-9 .]+),\s*([A-Za-z .]+),\s*FL\s+\d{5}/);
  return match ? match[0] : "";
}

function parseGallery(html) {
  const seen = new Set();
  const urls = [];
  const re = /(?:src|data-src)="([^"]*\/-\/media\/drhorton\/productcatalog\/[^"]+)"/gi;
  for (const match of html.matchAll(re)) {
    const url = mediaUrl(match[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= 16) break;
  }
  return urls;
}

function planFromCopy(html) {
  const match = html.match(/Welcome inside the\s+([A-Za-z0-9][A-Za-z0-9 ]{1,40}?)\s*,/i);
  return match ? match[1].trim() : "";
}

async function enrichLot(lot) {
  if (!lot.sourceUrl) return lot;
  try {
    const { text } = await fetchText(lot.sourceUrl, { tries: 2, timeoutMs: 20000 });
    const photos = parseGallery(text);
    const plan = planFromCopy(text);
    if (photos.length) {
      lot.photos = photos;
      lot.photo = photos[0];
    }
    if (plan && !lot.plan) lot.plan = plan;
  } catch (err) {
    if (err && err.code === "BLOCKED") throw err;
    log("warn", "adapter B: QMI page skipped", { url: lot.sourceUrl, err: String(err.message || err) });
  }
  return lot;
}

export async function fetchPublicSnapshot(client, { skipDetails = false } = {}) {
  let pages;
  if (client.discoverSeeds?.length) {
    const counties = new Set(client.discoverCounties || [...CENTRAL_FL_COUNTIES]);
    pages = await discoverCommunityPages(client.discoverSeeds, { counties, maxPages: client.discoverMax || 120 });
  } else {
    const allow = new Set(client.communitySlugs || []);
    pages = (client.communityUrls || DEFAULT_PAGES).filter((p) => allow.size === 0 || allow.has(p.slug));
  }
  if (pages.length === 0) throw new Error("adapter B: no community URLs for this market");

  const communities = [];
  for (const page of pages) {
    try {
      const fetched = await fetchCommunityHtml(page);
      if (!fetched) throw new Error("no HTML");
      const { text } = fetched;
      const homeChunks = text.split(/available-home-card/i).slice(1);
      const lots = homeChunks.map((chunk) => parseCard(chunk.slice(0, 5000))).filter(Boolean);
      const planSection = text.split(/id="floorplanItems"/i)[1] || text.split(/related-floorplans/i)[1] || "";
      const planChunks = planSection.split(/toggle-item/i).slice(1);
      const models = planChunks.map((chunk) => parseFloorPlan(chunk.slice(0, 3500))).filter(Boolean);
      const name = communityNameFromHtml(text, page.slug.replace(/-/g, " "));
      const address = communityAddressFromHtml(text) || name;
      const priced = lots.map((l) => l.price).filter((n) => typeof n === "number");
      const beds = [...new Set(lots.map((l) => l.beds).filter((n) => typeof n === "number"))].sort((a, b) => a - b);
      communities.push({
        slug: page.slug,
        name,
        address,
        availableCount: lots.length,
        lowestPrice: priced.length ? Math.min(...priced) : null,
        highestPrice: priced.length ? Math.max(...priced) : null,
        beds,
        lots,
        models,
      });
      log("info", "adapter B: community parsed", {
        slug: page.slug,
        lots: lots.length,
        models: models.length,
        photos: lots.filter((l) => l.photo).length,
      });
    } catch (err) {
      if (err && err.code === "BLOCKED") throw err;
      log("warn", "adapter B: community skipped", { slug: page.slug, err: String(err.message || err) });
    }
    await sleep(1200);
  }

  const withHomes = communities.filter((c) => c.lots.length > 0 || (c.models && c.models.length > 0));
  if (withHomes.length === 0) {
    throw new Error("adapter B parsed zero homes — Horton markup may have changed; keeping previous data");
  }

  if (!skipDetails) {
    for (const community of withHomes) {
      for (const lot of community.lots) {
        await enrichLot(lot);
        await sleep(600);
      }
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    source: "drhorton-public",
    builder: "drhorton",
    adapter: "drhorton-public",
    communities: withHomes.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
