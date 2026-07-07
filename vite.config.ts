import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    // `npm run dev` runs the frontend only; /api calls proxy to the live
    // deployment so the app is fully usable without vercel dev + server
    // secrets. Auth still works: the Bearer token verifies server-side
    // regardless of origin. Override with SENDIT_API_PROXY if needed.
    proxy: {
      "/api": {
        target: process.env["SENDIT_API_PROXY"] ?? "https://senditff.com",
        changeOrigin: true,
      },
    },
  },
});
