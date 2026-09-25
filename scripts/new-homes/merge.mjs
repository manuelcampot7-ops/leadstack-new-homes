/**
 * Realtor inventory = public D.R. Horton pages only.
 * No SPR. GPS comes later from official community plat pins, not from this merge.
 * Never invent a lot, a price, or a coordinate.
 */

function lotNo(value) {
  return String(value || "").trim().replace(/^0+/, "") || "";
}

function findLot(needle, haystack) {
  const n = lotNo(needle.lot);
  const numbered = n ? haystack.filter((lot) => lotNo(lot.lot) === n) : [];
  if (numbered.length === 1) return numbered[0];
  return null;
}

function isForSale(lot) {
  return typeof lot.price === "number" && Number.isFinite(lot.price) && lot.price > 0;
}

function stripSprGeo(lot) {
  const next = { ...lot };
  delete next.lat;
  delete next.lng;
  return next;
}

function photoList(row) {
  const list = Array.isArray(row?.photos) ? row.photos.filter(Boolean) : [];
  if (list.length) return list;
  return row?.photo ? [row.photo] : [];
}

function keepMedia(hortonLot, prevLot) {
  const next = stripSprGeo(hortonLot);
  const fresh = photoList(next);
  const prev = photoList(prevLot);
  const photos = fresh.length >= prev.length ? fresh : prev;
  if (photos.length) {
    next.photos = photos;
    next.photo = photos[0];
  }
  if ((!next.plan || next.plan === "Not provided") && prevLot?.plan) next.plan = prevLot.plan;
  return next;
}

function mergeModels(fresh, prev) {
  if (!fresh?.length) return prev || [];
  const prevBy = new Map();
  for (const model of prev || []) {
    const key = model.sourceUrl || model.slug || model.name;
    if (key) prevBy.set(key, model);
  }
  return fresh.map((model) => keepMedia(model, prevBy.get(model.sourceUrl || model.slug || model.name)));
}

function summarize(lots) {
  const priced = lots.map((lot) => lot.price).filter((n) => typeof n === "number" && n > 0);
  const beds = [...new Set(lots.map((lot) => lot.beds).filter((n) => typeof n === "number"))].sort((a, b) => a - b);
  return {
    availableCount: lots.length,
    lowestPrice: priced.length ? Math.min(...priced) : null,
    highestPrice: priced.length ? Math.max(...priced) : null,
    beds,
  };
}

export function mergeSnapshots(_spr, pub, previous) {
  if (!pub?.communities?.length) {
    if (previous?.communities?.length) return previous;
    throw new Error("no Horton inventory and no previous snapshot");
  }

  const prevBySlug = new Map((previous?.communities || []).map((row) => [row.slug, row]));
  const communities = pub.communities.map((community) => {
    const prevCommunity = prevBySlug.get(community.slug);
    const listed = (community.lots || []).filter(isForSale);
    const lots = listed.map((lot) => keepMedia(lot, findLot(lot, prevCommunity?.lots || [])));
    const stats = summarize(lots);
    return {
      slug: community.slug,
      name: community.name,
      address: community.address || "",
      ...stats,
      lots,
      models: mergeModels(community.models, prevCommunity?.models),
    };
  });

  const photos = communities.reduce((n, c) => n + c.lots.filter((l) => l.photo).length, 0);
  return {
    updatedAt: pub.updatedAt,
    source: "drhorton-public",
    builder: "drhorton",
    adapter: "drhorton-public",
    publicUpdatedAt: pub.updatedAt,
    photoCount: photos,
    communities,
  };
}
