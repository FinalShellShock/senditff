// Stamped on every logged feedback entry so tuning data stays attributable to
// the engine that produced it.

// Friendly label, for reading feedback at a glance.
// Formation lineage: Pro Set -> Spread -> Audible -> West Coast -> Shotgun.
// Rename this whenever a new formation starts. Nothing depends on you
// remembering to: attribution is handled by the fingerprint below.
export const ALGO_VERSION = "shotgun";

// Content hash of every file that decides which trades get suggested,
// injected at bundle time by scripts/build-api.mjs. It changes by itself the
// moment the algorithm's code changes, so a thumbs-down stays pinned to the
// exact engine that produced it with no manual bookkeeping. Falls back to
// "dev" outside a bundled build (local tsx runs, vite).
declare const __ALGO_FINGERPRINT__: string | undefined;
export const ALGO_FINGERPRINT =
  typeof __ALGO_FINGERPRINT__ === "string" ? __ALGO_FINGERPRINT__ : "dev";
