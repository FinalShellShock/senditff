import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error -- plain .mjs helper, shared with scripts/build-api.mjs so
// the frontend and the API bundles can never disagree about the hash.
import { algoFingerprint } from "./scripts/algo-fingerprint.mjs";

export default defineConfig({
  plugins: [react()],
  // Same fingerprint the API bundles are stamped with. Without this the
  // frontend fell back to "dev" in production, so the patch-notes modal showed
  // a different build id than the one attached to logged feedback.
  define: {
    __ALGO_FINGERPRINT__: JSON.stringify(algoFingerprint()),
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    // `npm run dev` runs the frontend only; /api calls proxy to the live
    // deployment so the app is fully usable without vercel dev + server
    // secrets. Auth still works: the Bearer token verifies server-side
    // regardless of origin. Override with SENDIT_API_PROXY if needed.
    // Target www (the apex 307-redirects there, which breaks fetch CORS).
    proxy: {
      "/api": {
        target: process.env["SENDIT_API_PROXY"] ?? "https://www.senditff.com",
        changeOrigin: true,
      },
    },
  },
});
