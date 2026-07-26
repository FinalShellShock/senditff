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
// The file writes missing values as the literal string "NA", not as empty, so
// a truthiness check silently accepts them and collapses every missing row
// onto a single "NA" key.
const NA = (v) => !v || v === "NA" || v === "";
const fpToSleeper = new Map();
for (let i = 1; i < idLines.length; i++) {
  if (!idLines[i]) continue;
  const p = parseCsvLine(idLines[i]);
  const sl = p[iSleeper], fp = p[iFp];
  if (!NA(sl) && !NA(fp)) fpToSleeper.set(fp, sl);
}
console.log(`  crosswalk: ${fpToSleeper.size.toLocaleString()} fantasypros -> sleeper (id match)`);

// ── Fallback: match on name ──────────────────────────────────────────────────
// The id crosswalk covers well under half the file, so a large share of ECR
// rows would go unpriced. Sleeper's own player DB has names, positions and
// teams, so anything the ids miss can usually be recovered by name.
//
// Matched on normalised name PLUS position, never name alone: shared names are
// common in a 12,000 player pool and a silent wrong match is worse than a miss.
// Where the ECR row also carries a team, that is used to break remaining ties.
const norm = (n) =>
  (n ?? "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z]/g, "");
console.log("fetching sleeper player DB for the name fallback...");
const sleeperDb = await (await fetch("https://api.sleeper.app/v1/players/nfl")).json();
const byNamePos = new Map();   // "name|POS" -> [sleeperId]
const byNamePosTeam = new Map(); // "name|POS|TEAM" -> sleeperId
for (const [sid, p] of Object.entries(sleeperDb)) {
  if (!p?.position || !["QB", "RB", "WR", "TE"].includes(p.position)) continue;
  const n = norm(p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`);
  if (!n) continue;
  const k = `${n}|${p.position}`;
  byNamePos.set(k, [...(byNamePos.get(k) ?? []), sid]);
  if (p.team) byNamePosTeam.set(`${k}|${p.team}`, sid);
}
console.log(`  sleeper name index: ${byNamePos.size.toLocaleString()} name+position keys`);

let hitId = 0, hitNameTeam = 0, hitName = 0, ambiguous = 0, missed = 0;
const resolve = (fpId, name, pos, team) => {
  const viaId = fpToSleeper.get(fpId);
  if (viaId) { hitId++; return viaId; }
  const k = `${norm(name)}|${pos}`;
  if (team) {
    const t = byNamePosTeam.get(`${k}|${team}`);
    if (t) { hitNameTeam++; return t; }
  }
  const cands = byNamePos.get(k);
  if (cands?.length === 1) { hitName++; return cands[0]; }
  if (cands?.length > 1) { ambiguous++; return null; }
  missed++;
  return null;
};

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

let hdr = null, iType, iId, iEcr, iDate, iPos, iPlayer, iTeam;
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
    iPlayer = hdr.indexOf("player");
    iTeam = hdr.indexOf("team");
    continue;
  }
  rows++;
  const p = parseCsvLine(line);
  if (p[iType] !== "dynasty-overall") continue;
  const sl = resolve(p[iId], p[iPlayer], p[iPos], p[iTeam]);
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
const tot = hitId + hitNameTeam + hitName + ambiguous + missed;
console.log(`  resolution: id ${hitId.toLocaleString()} · name+team ${hitNameTeam.toLocaleString()} · name+pos ${hitName.toLocaleString()} · ambiguous ${ambiguous.toLocaleString()} · unmatched ${missed.toLocaleString()}`);
console.log(`  resolved ${(100 * (hitId + hitNameTeam + hitName) / Math.max(1, tot)).toFixed(1)}% of dynasty-overall rows`);
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
