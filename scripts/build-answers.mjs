// Builds answers.json by calling the NYT Wordle endpoint server-side
// (browsers can't: the endpoint sends no CORS headers).
//
// Usage: node scripts/build-answers.mjs [output-file]
//
// Incremental: entries already in the output file are kept, so only missing
// dates (plus today and later, which can still change) are fetched.
//
// Env overrides (used for testing): WORDLE_BASE_URL, START, DAYS_AHEAD.

import { readFile, writeFile } from "node:fs/promises";

const BASE = process.env.WORDLE_BASE_URL ?? "https://www.nytimes.com/svc/wordle/v2";
const START = process.env.START ?? "2021-06-19"; // first-ever Wordle
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD ?? 30);
const OUT = process.argv[2] ?? "answers.json";
const CONCURRENCY = 6;

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1, d + n)));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let data = {};
try { data = JSON.parse(await readFile(OUT, "utf8")); } catch { /* first run */ }

const today = iso(new Date());
const end = addDays(today, DAYS_AHEAD);
const todo = [];
for (let d = START; d <= end; d = addDays(d, 1)) {
  if (!data[d] || d >= today) todo.push(d);
}
console.log(`${Object.keys(data).length} cached, ${todo.length} to fetch (${START} → ${end})`);

async function fetchOne(date) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/${date}.json`, { headers: { Accept: "application/json" } });
      if (res.status === 404) return null; // not published (yet)
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (typeof j.solution !== "string" || !/^[a-z]{5}$/i.test(j.solution)) throw new Error("bad payload");
      return { id: j.id, solution: j.solution.toLowerCase(), editor: j.editor ?? null };
    } catch (err) {
      if (attempt === 3) { console.warn(`! ${date}: ${err.message}`); return null; }
      await sleep(500 * attempt);
    }
  }
}

let next = 0, fetched = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < todo.length) {
    const date = todo[next++];
    const entry = await fetchOne(date);
    if (entry) { data[date] = entry; fetched++; }
  }
}));

const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
const total = Object.keys(sorted).length;
if (total === 0) {
  console.error("No answers fetched; refusing to publish an empty archive.");
  process.exit(1);
}
await writeFile(OUT, JSON.stringify(sorted));
console.log(`Fetched ${fetched} new. ${total} answers written to ${OUT}`);
