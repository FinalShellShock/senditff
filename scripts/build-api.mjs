import { build } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const entries = [
  "api/leagues/sync.ts",
  "api/leagues/overview.ts",
  "api/trades/find.ts",
];

await Promise.all(
  entries.map((entry) =>
    build({
      entryPoints: [join(root, entry)],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      packages: "external",
      outfile: join(root, entry.replace(/\.ts$/, ".js")),
    }),
  ),
);

console.log("API bundles built");
