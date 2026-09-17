#!/usr/bin/env node
/**
 * Weekly new-homes inventory sync (realtor product).
 *
 *   node scripts/new-homes/sync.mjs --client=christina-martinez
 *
 * Scrapes public D.R. Horton community pages only. No SPR.
 * If Horton is blocked, previous inventory stays.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPublicSnapshot } from "./adapter-public.mjs";
import { appendLog, log, readPrevious, snapshotStats, writeSnapshot } from "./lib.mjs";
import { mergeSnapshots } from "./merge.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function args() {
  const out = { client: "", adapter: "", output: "", dry: false, skipDetails: false };
  for (const raw of process.argv.slice(2)) {
    if (raw === "--dry") out.dry = true;
    else if (raw === "--spr-only") out.adapter = "spr";
    else if (raw === "--cards-only") out.skipDetails = true;
    else if (raw.startsWith("--client=")) out.client = raw.slice(9);
    else if (raw.startsWith("--adapter=")) out.adapter = raw.slice(10);
    else if (raw.startsWith("--output=")) out.output = raw.slice(9);
  }
  return out;
}

async function loadClients() {
  const raw = await readFile(resolve(here, "clients.json"), "utf8");
  return JSON.parse(raw);
}

async function main() {
  const flags = args();
  if (!flags.client) {
    console.error("Usage: node scripts/new-homes/sync.mjs --client=<id> [--dry] [--cards-only]");
    process.exit(2);
  }
  const clients = await loadClients();
  const client = clients[flags.client];
  if (!client) {
    console.error(`Unknown clientId "${flags.client}". Add it to scripts/new-homes/clients.json`);
    process.exit(2);
  }

  const cwd = process.cwd();
  const output = resolve(cwd, flags.output || client.output || "src/data/new-homes/inventory.json");
  const previous = await readPrevious(output);

  log("info", "sync start", {
    clientId: client.clientId,
    market: client.market,
    builder: client.builder,
    adapter: "drhorton-public",
    output,
    previous: previous ? snapshotStats(previous) : null,
  });

  let pub = null;
  try {
    pub = await fetchPublicSnapshot(client, { skipDetails: flags.skipDetails });
  } catch (err) {
    log("warn", "Horton public scrape failed — keeping previous inventory", {
      err: String(err.message || err),
      blocked: err?.code === "BLOCKED",
    });
  }

  const snapshot = mergeSnapshots(null, pub, previous);
  const stats = snapshotStats(snapshot);
  if (stats.lots === 0) {
    const row = log("error", "zero lots — previous data kept", { clientId: client.clientId });
    await appendLog(resolve(here, "logs"), row);
    process.exit(1);
  }

  if (flags.dry) {
    log("info", "dry run — not writing", {
      stats,
      photos: snapshot.photoCount,
      models: snapshot.communities.reduce((n, c) => n + (c.models?.length || 0), 0),
    });
    return;
  }

  await writeSnapshot(output, snapshot);
  const coverage = snapshot.communities.map((community) => ({
    slug: community.slug,
    lots: community.lots.length,
    photos: community.lots.filter((lot) => lot.photo).length,
    models: community.models?.length || 0,
  }));
  const row = log("info", "sync ok", {
    clientId: client.clientId,
    output,
    stats,
    photos: snapshot.photoCount,
    models: snapshot.communities.reduce((n, c) => n + (c.models?.length || 0), 0),
    coverage,
    updatedAt: snapshot.updatedAt,
  });
  await appendLog(resolve(here, "logs"), row);
}

main().catch((err) => {
  log("error", "sync crashed — previous data kept", { err: String(err.message || err) });
  process.exit(1);
});
