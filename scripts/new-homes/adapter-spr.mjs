/**
 * Adapter A — same pipeline as manuelcampo.com/map.
 * Reads the public SPR snapshot. Does not invent lots.
 */
import { fetchJson, filterSnapshot, isSnapshot, log } from "./lib.mjs";

export async function fetchSprSnapshot(client) {
  const url = client.sprUrl;
  if (!url) throw new Error("client.sprUrl is required for adapter spr");
  log("info", "adapter A: fetching SPR snapshot", { url });
  const { json } = await fetchJson(url, { tries: 3, timeoutMs: 25000 });
  if (!isSnapshot(json)) throw new Error("SPR payload is not a map-inventory snapshot");
  const filtered = filterSnapshot(json, client.communitySlugs);
  if (filtered.communities.length === 0) {
    throw new Error("SPR snapshot had zero communities after market filter — keeping previous data");
  }
  return {
    ...filtered,
    builder: "drhorton",
    adapter: "spr",
    source: "spr-latest.pdf",
  };
}
