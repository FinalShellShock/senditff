import { build } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { algoFingerprint } from "./algo-fingerprint.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
