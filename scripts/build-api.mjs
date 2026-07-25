import { build } from "esbuild";
import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Content hash of everything that decides what the user sees: which trades get
// suggested AND how they are explained. Logged feedback carries this, so a
// thumbs-down stays pinned to the exact engine that produced it and nobody has
// to remember to bump a version string.
//
// find.ts and _lib/rationalePrompt.ts are included because between them they
// build the Haiku prompt. Without them, prompt changes were invisible to the
// fingerprint, so "the rationale invented an age" feedback could not be
// attributed to a prompt version at all. That gap was found by segmenting real
// feedback and noticing rationale complaints had nowhere to land.
//
// version.ts is excluded: it holds the stamp, it doesn't affect any output.
function algoFingerprint() {
  const files = [
    ...readdirSync(join(root, "src/algo"))
      .filter((f) => f.endsWith(".ts") && f !== "version.ts")
      .map((f) => join("src/algo", f)),
    join("api/_lib/tradeEngine.ts"),
    join("api/trades/find.ts"),
    join("api/_lib/rationalePrompt.ts"),
  ].sort(); // sorted so the hash doesn't depend on directory order
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f); // path included so a rename alone still moves the hash
    h.update(readFileSync(join(root, f)));
  }
  return h.digest("hex").slice(0, 12);
}

const fingerprint = algoFingerprint();

const entries = [
  "api/leagues/sync.ts",
  "api/leagues/overview.ts",
  "api/leagues/trades.ts",
  "api/trades/find.ts",
  "api/user/leagues.ts",
  "api/feedback.ts",
];

await Promise.all(
  entries.map((entry) =>
    build({
      entryPoints: [join(root, entry)],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "cjs",
      packages: "external",
      define: { __ALGO_FINGERPRINT__: JSON.stringify(fingerprint) },
      outfile: join(root, entry.replace(/\.ts$/, ".js")),
    }),
  ),
);

console.log(`API bundles built (algo fingerprint ${fingerprint})`);
