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
//
// plays.ts is excluded, and gets its OWN hash below. It is the scouting report:
// imported only by TeamDeepDive.tsx, referenced nowhere in tradeEngine.ts, and
// incapable of changing which trades get suggested. While it sat in here, eight
// scouting-report deploys on 2026-07-27 moved the engine hash without touching
// the engine, and a whole feedback queue read as "describes an engine that no
// longer exists" when the trade path was byte-identical. Proving otherwise took
// hand-diffing four tags.
//
// Same reasoning that moved intentLabels.ts out in daniels 1.19: renaming a
// label is copy, not a new engine.
//
// Splitting rather than simply dropping, because scouting-play feedback is
// stamped too, and dropping plays.ts outright would leave those entries
// unattributable. That exact gap is why find.ts and rationalePrompt.ts were
// added to this list in the first place.
//
// Shared by scripts/build-api.mjs (API bundles) and vite.config.ts (frontend).
// It lives here rather than inside build-api.mjs because the two builds MUST
// agree: the frontend patch-notes modal displayed "dev" in production while
// the server stamped the real hash, so the number a user could read and the
// number attached to their feedback were different things.
const EXCLUDED = new Set(["version.ts", "plays.ts"]);

/** Hash of every file that decides which trades get suggested and how they are
 *  explained. Stamped on trade and site feedback. */
export function algoFingerprint() {
  const files = [
    ...readdirSync(join(root, "src/algo"))
      .filter((f) => f.endsWith(".ts") && !EXCLUDED.has(f))
      .map((f) => join("src/algo", f)),
    join("api/_lib/tradeEngine.ts"),
    join("api/trades/find.ts"),
    join("api/_lib/rationalePrompt.ts"),
  ].sort(); // sorted so the hash doesn't depend on directory order
  return hashFiles(files);
}

/** Hash of the scouting report alone. Stamped on play feedback, so a thumbs
 *  down on a play stays pinned to the play definitions that produced it. */
export function scoutFingerprint() {
  return hashFiles([join("src/algo/plays.ts")]);
}

function hashFiles(files) {
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f); // path included so a rename alone still moves the hash
    h.update(readFileSync(join(root, f)));
  }
  return h.digest("hex").slice(0, 12);
}
