// Pulls the `feedback` collection down to local JSON/CSV for algo tuning.
//
// Usage:
//   npm run feedback:export -- [--env-file <path>] [--since <ISO date>]
//                              [--league <leagueId>] [--all] [--no-mark]
//
// By default this exports only entries not yet pulled, then stamps them
// `pulledAt` so the next run returns just what is new. Use --all to re-export
// everything (does not re-stamp what is already marked), and --no-mark to
// look without claiming.
//
// Server secrets live only in the Vercel dashboard (see CLAUDE.md), so this
// reads FIREBASE_SERVICE_ACCOUNT_JSON from process.env first, then falls
// back to parsing it out of a pulled env file (default .env.vercel.local):
//   npx vercel env pull .env.vercel.local
//   npm run feedback:export

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
// Default import, not `import * as admin`: this script runs directly under
// tsx's native ESM loader (unlike api/_lib/admin.ts, which esbuild bundles to
// CJS first). Node's ESM/CJS interop only synthesizes a `default` for
// firebase-admin, so a namespace import leaves admin.apps etc. undefined.
import admin from "firebase-admin";

const DEFAULT_ENV_FILE = ".env.vercel.local";
const SERVICE_ACCOUNT_KEY = "FIREBASE_SERVICE_ACCOUNT_JSON";

function flagValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

// Reads FIREBASE_SERVICE_ACCOUNT_JSON from process.env, or parses it out of
// a `vercel env pull`-style env file if present. Returns null if neither has it.
function loadServiceAccountJson(envFile: string): string | null {
  const fromEnv = process.env[SERVICE_ACCOUNT_KEY];
  if (fromEnv) return fromEnv;

  const path = resolve(envFile);
  if (!existsSync(path)) return null;

  const content = readFileSync(path, "utf8");
  const line = content
    .split("\n")
    .find((l) => l.startsWith(`${SERVICE_ACCOUNT_KEY}=`));
  if (!line) return null;

  const value = decodeEnvValue(line.slice(`${SERVICE_ACCOUNT_KEY}=`.length));
  return value || null;
}

// `vercel env pull` writes the value double-quoted with the JSON's own
// newlines encoded as \n, but it does NOT escape the backslashes already
// inside the value, so the private key's \n escapes come out looking
// identical to the pretty-print ones. A blind \n -> newline pass therefore
// puts raw newlines inside the private_key string literal and JSON.parse
// dies with "Bad control character in string literal".
//
// So walk it instead: outside a JSON string a \n is just pretty-print
// whitespace and can be unescaped; inside one it belongs to the key and has
// to stay a two-character escape for JSON.parse to turn it back into a
// newline itself.
function decodeEnvValue(rawValue: string): string {
  let s = rawValue.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }

  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "n") {
      out += inString ? "\\n" : "\n";
      i++;
      continue;
    }
    if (c === '"') inString = !inString;
    out += c;
  }
  return out;
}

type FeedbackAsset = { name?: string; position?: string; kind?: string };

type FeedbackPackage = {
  archetype?: string;
  fairness?: string;
  valueGive?: number;
  valueReceive?: number;
  give?: FeedbackAsset[];
  receive?: FeedbackAsset[];
  scores?: { myFit?: number; theirFit?: number; balance?: number; archMatch?: number };
};

type FeedbackSearch = {
  archetype?: string | null;
  position?: string | null;
  targetRosterId?: number | null;
  noFillerPicks?: boolean;
};

type FeedbackDiagnostics = { forced?: boolean; degraded?: string } | null;

type FeedbackDoc = {
  createdAt?: string;
  // "trade" (thumbs on a Send It package) or "site" (the footer Feedback
  // button). Absent on entries written before site feedback existed, which
  // were all trade feedback.
  kind?: string;
  // App feedback only: what it is about, and the page the person was on.
  category?: string;
  route?: string | null;
  // Human-readable release ("daniels 1.0"), alongside the exact-code
  // fingerprint. The hash says what ran; this says what to go read.
  release?: string;
  // Set by this script once an entry has been exported. Absent = never pulled.
  pulledAt?: string;
  userId?: string;
  userEmail?: string;
  algoVersion?: string;
  algoFingerprint?: string;
  prompt?: string | null;
  verdict?: string;
  reasons?: string[];
  comment?: string;
  leagueId?: string;
  rosterId?: number;
  counterRosterId?: number | null;
  packageIndex?: number;
  search?: FeedbackSearch;
  package?: FeedbackPackage;
  diagnostics?: FeedbackDiagnostics;
};

type FeedbackEntry = FeedbackDoc & { id: string };

const CSV_COLUMNS = [
  "createdAt",
  "userEmail",
  "algoVersion",
  "algoFingerprint",
  "verdict",
  "reasons",
  "comment",
  "leagueId",
  "rosterId",
  "counterRosterId",
  "packageIndex",
  "archetype",
  "searchArchetype",
  "searchPosition",
  "searchTarget",
  "noFillerPicks",
  "fairness",
  "valueGive",
  "valueReceive",
  "myFit",
  "theirFit",
  "balance",
  "archMatch",
  "give",
  "receive",
  "prompt",
  "forced",
  "degraded",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function assetNames(assets: FeedbackAsset[] | undefined): string {
  if (!Array.isArray(assets)) return "";
  return assets
    .map((a) => a.name ?? "")
    .filter((n) => n.length > 0)
    .join(" + ");
}

function toRow(entry: FeedbackEntry): string[] {
  const pkg = entry.package ?? {};
  const scores = pkg.scores ?? {};
  const search = entry.search ?? {};
  const diagnostics = entry.diagnostics ?? {};

  const row: Record<CsvColumn, unknown> = {
    createdAt: entry.createdAt ?? "",
    userEmail: entry.userEmail ?? "",
    algoVersion: entry.algoVersion ?? "",
    algoFingerprint: entry.algoFingerprint ?? "",
    verdict: entry.verdict ?? "",
    reasons: (entry.reasons ?? []).join(";"),
    comment: entry.comment ?? "",
    leagueId: entry.leagueId ?? "",
    rosterId: entry.rosterId ?? "",
    counterRosterId: entry.counterRosterId ?? "",
    packageIndex: entry.packageIndex ?? "",
    archetype: pkg.archetype ?? "",
    searchArchetype: search.archetype ?? "",
    searchPosition: search.position ?? "",
    searchTarget: search.targetRosterId ?? "",
    noFillerPicks: search.noFillerPicks ?? "",
    fairness: pkg.fairness ?? "",
    valueGive: pkg.valueGive ?? "",
    valueReceive: pkg.valueReceive ?? "",
    myFit: scores.myFit ?? "",
    theirFit: scores.theirFit ?? "",
    balance: scores.balance ?? "",
    archMatch: scores.archMatch ?? "",
    give: assetNames(pkg.give),
    receive: assetNames(pkg.receive),
    prompt: entry.prompt ?? "",
    forced: diagnostics.forced ?? "",
    degraded: diagnostics.degraded ?? "",
  };

  return CSV_COLUMNS.map((col) => csvEscape(row[col]));
}

async function main(): Promise<void> {
  const envFile = flagValue("--env-file") ?? DEFAULT_ENV_FILE;
  const since = flagValue("--since");
  const league = flagValue("--league");
  const all = process.argv.includes("--all");
  const noMark = process.argv.includes("--no-mark");

  const serviceAccountJson = loadServiceAccountJson(envFile);
  if (!serviceAccountJson) {
    console.error(
      `${SERVICE_ACCOUNT_KEY} is not set and no ${envFile} file was found.\n\n` +
        "Pull server env from Vercel first:\n" +
        "  npx vercel env pull .env.vercel.local\n\n" +
        "then re-run:\n" +
        "  npm run feedback:export",
    );
    process.exit(1);
    return;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
    });
  }
  const db = admin.firestore();

  const snap = await db.collection("feedback").orderBy("createdAt", "asc").get();
  let entries: FeedbackEntry[] = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as FeedbackDoc),
  }));

  // Incremental by default: only what has not been pulled before. Filtering
  // client-side rather than with a `where` keeps this working on entries
  // written before the field existed (Firestore can't match a missing field).
  const totalCount = entries.length;
  const alreadyPulled = entries.filter((e) => e.pulledAt).length;
  if (!all) entries = entries.filter((e) => !e.pulledAt);

  if (since) {
    entries = entries.filter((e) => (e.createdAt ?? "") >= since);
  }
  if (league) {
    entries = entries.filter((e) => e.leagueId === league);
  }

  // Split the two kinds. Site feedback is free-form prose about the app, and
  // folding it into the algorithm tuning data would poison the exact signal
  // this export exists to produce: reason tallies and verdict splits only mean
  // something across comparable trade judgments. Entries written before site
  // feedback existed have no `kind` and were all trade feedback.
  const siteEntries = entries.filter((e) => e.kind === "site");
  const tradeEntries = entries.filter((e) => e.kind !== "site");

  const jsonPath = resolve("feedback-export.json");
  writeFileSync(jsonPath, JSON.stringify(tradeEntries, null, 2));

  if (siteEntries.length > 0) {
    const sitePath = resolve("feedback-site.json");
    writeFileSync(sitePath, JSON.stringify(siteEntries, null, 2));
  }

  const csvLines = [CSV_COLUMNS.join(",")];
  for (const entry of tradeEntries) {
    csvLines.push(toRow(entry).join(","));
  }
  const csvPath = resolve("feedback-export.csv");
  writeFileSync(csvPath, csvLines.join("\n") + "\n");

  const upCount = tradeEntries.filter((e) => e.verdict === "up").length;
  const downCount = tradeEntries.filter((e) => e.verdict === "down").length;

  const reasonTally = new Map<string, number>();
  for (const entry of tradeEntries) {
    for (const reason of entry.reasons ?? []) {
      reasonTally.set(reason, (reasonTally.get(reason) ?? 0) + 1);
    }
  }
  const sortedReasons = [...reasonTally.entries()].sort((a, b) => b[1] - a[1]);

  console.log(
    all
      ? `Total entries: ${entries.length} (--all: full history, ${alreadyPulled} previously pulled)`
      : `New since last pull: ${entries.length}  (of ${totalCount} total, ${alreadyPulled} already pulled)`,
  );
  if (!all && entries.length === 0) {
    console.log("Nothing new. Re-run with --all to re-export everything.");
  }
  console.log(`Trade feedback: ${tradeEntries.length} (up ${upCount}, down ${downCount})`);
  if (siteEntries.length > 0) {
    console.log(`App feedback: ${siteEntries.length} -> feedback-site.json`);
    // Grouped by category so a pile of comments is readable without sorting it
    // by hand every time.
    const byCategory = new Map<string, typeof siteEntries>();
    for (const entry of siteEntries) {
      const key = entry.category ?? "other";
      const bucket = byCategory.get(key) ?? [];
      bucket.push(entry);
      byCategory.set(key, bucket);
    }
    for (const [category, group] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${category} (${group.length}):`);
      for (const entry of group) {
        const where = entry.route ? ` ${entry.route}` : "";
        console.log(`    ${(entry.createdAt ?? "?").slice(0, 10)}${where}: ${(entry.comment ?? "").slice(0, 90)}`);
      }
    }
  }
  console.log("Reasons by frequency:");
  if (sortedReasons.length === 0) {
    console.log("  (none)");
  }
  for (const [reason, count] of sortedReasons) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log(`\nWrote: ${jsonPath}`);
  console.log(`Wrote: ${csvPath}`);

  // Claim what was just exported so the next run only returns new entries.
  // Done last, on purpose: if anything above threw, nothing is marked and the
  // pull is safely repeatable. --no-mark looks without claiming.
  const toMark = entries.filter((e) => !e.pulledAt);
  if (noMark) {
    console.log(`\n--no-mark: left ${toMark.length} entries unclaimed.`);
  } else if (toMark.length > 0) {
    const pulledAt = new Date().toISOString();
    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < toMark.length; i += 400) {
      const batch = db.batch();
      for (const entry of toMark.slice(i, i + 400)) {
        batch.update(db.collection("feedback").doc(entry.id), { pulledAt });
      }
      await batch.commit();
    }
    console.log(`\nMarked ${toMark.length} entries pulled at ${pulledAt}.`);
  }
}

main().catch((err) => {
  console.error("feedback export failed:");
  console.error(err);
  process.exit(1);
});
