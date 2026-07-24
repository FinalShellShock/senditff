// Pulls the `feedback` collection down to local JSON/CSV for algo tuning.
//
// Usage:
//   npm run feedback:export -- [--env-file <path>] [--since <ISO date>] [--league <leagueId>]
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
  userId?: string;
  userEmail?: string;
  algoVersion?: string;
  algoFingerprint?: string;
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
    forced: diagnostics.forced ?? "",
    degraded: diagnostics.degraded ?? "",
  };

  return CSV_COLUMNS.map((col) => csvEscape(row[col]));
}

async function main(): Promise<void> {
  const envFile = flagValue("--env-file") ?? DEFAULT_ENV_FILE;
  const since = flagValue("--since");
  const league = flagValue("--league");

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

  if (since) {
    entries = entries.filter((e) => (e.createdAt ?? "") >= since);
  }
  if (league) {
    entries = entries.filter((e) => e.leagueId === league);
  }

  const jsonPath = resolve("feedback-export.json");
  writeFileSync(jsonPath, JSON.stringify(entries, null, 2));

  const csvLines = [CSV_COLUMNS.join(",")];
  for (const entry of entries) {
    csvLines.push(toRow(entry).join(","));
  }
  const csvPath = resolve("feedback-export.csv");
  writeFileSync(csvPath, csvLines.join("\n") + "\n");

  const upCount = entries.filter((e) => e.verdict === "up").length;
  const downCount = entries.filter((e) => e.verdict === "down").length;

  const reasonTally = new Map<string, number>();
  for (const entry of entries) {
    for (const reason of entry.reasons ?? []) {
      reasonTally.set(reason, (reasonTally.get(reason) ?? 0) + 1);
    }
  }
  const sortedReasons = [...reasonTally.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`Total entries: ${entries.length}`);
  console.log(`Up: ${upCount}, Down: ${downCount}`);
  console.log("Reasons by frequency:");
  if (sortedReasons.length === 0) {
    console.log("  (none)");
  }
  for (const [reason, count] of sortedReasons) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log(`\nWrote: ${jsonPath}`);
  console.log(`Wrote: ${csvPath}`);
}

main().catch((err) => {
  console.error("feedback export failed:");
  console.error(err);
  process.exit(1);
});
