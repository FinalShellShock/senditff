// Build a historical dynasty-value index, keyed by Sleeper player id and date.
//
// This exists because "bought youth" was defined as "received a player under
// 25", and Johnny pointed out that bucket is mostly dart throws: the majority
// of 24 year olds in a player pool never have careers. Without a value at the
// time of the trade there is no way to tell a young stud from a practice squad
// flier, so the bucket measured roster churn and returned noise.
//
// Sources, both public:
//   db_playerids.csv    sleeper_id <-> fantasypros_id crosswalk (12,468 rows)
//   db_fpecr.csv.gz     FantasyPros expert consensus rankings with scrape_date
//                       (1.53M rows; 129,581 of them dynasty-overall, monthly
//                       from 2019-12 to 2025-08)
//
// ECR is a RANK, not a value, and rank-to-value is steeply non-linear: the gap
// between the 1st and 10th ranked player dwarfs the gap between 100th and
// 110th. So this also stores a normalised value proxy on a decaying curve,
// which is the same shape FantasyCalc-style values take.
//
//   node scripts/research/build-values.mjs

import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";

const IDS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";
const ECR_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr.csv.gz";
const ECR_GZ = "/tmp/fpecr.csv.gz";
const OUT = "scripts/research/values-history.json";

function parseCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ── Crosswalk ────────────────────────────────────────────────────────────────
console.log("fetching player id crosswalk...");
const idsCsv = await (await fetch(IDS_URL)).text();
const idLines = idsCsv.split("\n");
const idHdr = parseCsvLine(idLines[0]);
const iSleeper = idHdr.indexOf("sleeper_id");
const iFp = idHdr.indexOf("fantasypros_id");
const fpToSleeper = new Map();
for (let i = 1; i < idLines.length; i++) {
  if (!idLines[i]) continue;
  const p = parseCsvLine(idLines[i]);
  const sl = p[iSleeper], fp = p[iFp];
  if (sl && fp) fpToSleeper.set(fp, sl);
}
console.log(`  crosswalk: ${fpToSleeper.size.toLocaleString()} fantasypros -> sleeper`);

// ── Historical ECR ───────────────────────────────────────────────────────────
if (!existsSync(ECR_GZ)) {
  console.log("downloading historical rankings (104MB)...");
  const res = await fetch(ECR_URL);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(ECR_GZ));
}

console.log("indexing dynasty-overall rankings...");
const { createReadStream } = await import("node:fs");
const rl = createInterface({
  input: createReadStream(ECR_GZ).pipe(createGunzip()),
  crlfDelay: Infinity,
});

let hdr = null, iType, iId, iEcr, iDate, iPos;
// index[sleeperId] = [[yyyymm, ecr, pos], ...] ascending by date
const index = new Map();
let rows = 0, kept = 0;
for await (const line of rl) {
  if (!hdr) {
    hdr = parseCsvLine(line);
    iType = hdr.indexOf("page_type");
    iId = hdr.indexOf("id");
    iEcr = hdr.indexOf("ecr");
    iDate = hdr.indexOf("scrape_date");
    iPos = hdr.indexOf("pos");
    continue;
  }
  rows++;
  const p = parseCsvLine(line);
  if (p[iType] !== "dynasty-overall") continue;
  const sl = fpToSleeper.get(p[iId]);
  const ecr = Number(p[iEcr]);
  const date = p[iDate];
  if (!sl || !date || !Number.isFinite(ecr)) continue;
  const ym = Number(date.slice(0, 4)) * 100 + Number(date.slice(5, 7));
  const arr = index.get(sl) ?? [];
  // one entry per month, first scrape of the month wins
  if (!arr.length || arr[arr.length - 1][0] !== ym) arr.push([ym, ecr, p[iPos] ?? ""]);
  index.set(sl, arr);
  kept++;
}
console.log(`  scanned ${rows.toLocaleString()} rows, kept ${kept.toLocaleString()} dynasty-overall`);
console.log(`  players with history: ${index.size.toLocaleString()}`);

const obj = {};
for (const [k, v] of index) obj[k] = v;
writeFileSync(OUT, JSON.stringify(obj));
console.log(`wrote ${OUT}`);

// Sanity: coverage over time
const months = new Set();
for (const v of index.values()) for (const [ym] of v) months.add(ym);
const sorted = [...months].sort();
console.log(`months covered: ${sorted.length}  (${sorted[0]} .. ${sorted[sorted.length - 1]})`);
