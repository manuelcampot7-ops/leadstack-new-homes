import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 LeadStackNewHomes/1.0";

export function log(level, msg, extra) {
  const line = { ts: new Date().toISOString(), level, msg, ...extra };
  console.log(`[new-homes] ${level} ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);
  return line;
}

export async function fetchText(url, { tries = 3, timeoutMs = 20000, headers = {} } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...headers },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 401 || res.status === 403) {
        const err = new Error(`blocked HTTP ${res.status} for ${url}`);
        err.code = "BLOCKED";
        err.status = res.status;
        throw err;
      }
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        lastErr.status = res.status;
        await sleep(400 * i);
        continue;
      }
      return { status: res.status, text: await res.text(), url: res.url };
    } catch (err) {
      clearTimeout(timer);
      if (err && err.code === "BLOCKED") throw err;
      lastErr = err;
      await sleep(400 * i);
    }
  }
  throw lastErr || new Error(`fetch failed for ${url}`);
}

export async function fetchJson(url, opts) {
  const { text, status } = await fetchText(url, { ...opts, headers: { Accept: "application/json", ...(opts?.headers || {}) } });
  try {
    return { status, json: JSON.parse(text) };
  } catch {
    const err = new Error(`invalid JSON from ${url}`);
    err.status = status;
    throw err;
  }
}

export function isSnapshot(value) {
  return (
    value &&
    typeof value === "object" &&
    (value.source === "spr-latest.pdf" || value.source === "drhorton-public") &&
    Array.isArray(value.communities)
  );
}

export function filterSnapshot(snapshot, slugs) {
  if (!slugs || slugs.length === 0) return snapshot;
  const allow = new Set(slugs);
  return {
    ...snapshot,
    communities: snapshot.communities.filter((c) => allow.has(c.slug)),
  };
}

export function snapshotStats(snapshot) {
  const communities = snapshot?.communities || [];
  const lots = communities.reduce((n, c) => n + (c.lots?.length || 0), 0);
  const pins = communities.reduce(
    (n, c) => n + (c.lots || []).filter((l) => typeof l.lat === "number" && typeof l.lng === "number").length,
    0,
  );
  return { communities: communities.length, lots, pins };
}

export async function readPrevious(outputPath) {
  try {
    const raw = await readFile(outputPath, "utf8");
    const json = JSON.parse(raw);
    return isSnapshot(json) ? json : null;
  } catch {
    return null;
  }
}

/** Atomic write. Never truncates the live file on failure. */
export async function writeSnapshot(outputPath, snapshot) {
  if (!isSnapshot(snapshot) || snapshot.communities.length === 0) {
    throw new Error("refusing to write empty or invalid snapshot");
  }
  const abs = resolve(outputPath);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  const bak = `${abs}.bak`;
  const body = JSON.stringify(snapshot, null, 2) + "\n";
  await writeFile(tmp, body, "utf8");
  try {
    const prev = await readFile(abs, "utf8");
    await writeFile(bak, prev, "utf8");
  } catch {
    /* first write — no previous file */
  }
  await rename(tmp, abs);
}

export async function appendLog(dir, row) {
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, "sync.jsonl");
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, JSON.stringify(row) + "\n", "utf8");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
