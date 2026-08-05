// Stamped on every logged feedback entry so tuning data stays attributable to
// the engine that produced it.

// Friendly label, for reading feedback at a glance.
// Formation lineage: Pro Set -> Spread -> Audible -> West Coast -> Shotgun
// -> Pistol -> Empty.
// Rename this whenever a new formation starts. Nothing depends on you
// remembering to: attribution is handled by the fingerprint below.
export const ALGO_VERSION = "empty";

// Content hash of every file that decides which trades get suggested, written
// to src/algoFingerprint.generated.ts by scripts/build-api.mjs. It changes by
// itself the moment the algorithm's code changes, so a thumbs-down stays
// pinned to the exact engine that produced it with no manual bookkeeping.
//
// A generated file rather than a build-time define because BOTH the API
// bundles and the frontend need it, and .vercelignore excludes api/**/*.ts, so
// Vercel's builder cannot compute it. The frontend used to fall back to "dev"
// in production while the server stamped the real hash.
export { ALGO_FINGERPRINT_BUILD as ALGO_FINGERPRINT } from "../algoFingerprint.generated";

// The scouting report hashed separately, and stamped on PLAY feedback instead
// of the engine hash above.
//
// plays.ts used to live inside ALGO_FINGERPRINT, which meant every scouting
// copy edit announced itself as a new trade engine. Eight deploys on
// 2026-07-27 did exactly that, and the next feedback pull read as though the
// entire queue described a dead engine while the trade path had not changed a
// byte since daniels 1.14.
export { SCOUT_FINGERPRINT_BUILD as SCOUT_FINGERPRINT } from "../algoFingerprint.generated";
