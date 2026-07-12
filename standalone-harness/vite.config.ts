// Fully independent Vite config for the standalone lash-engine test harness.
// Deliberately does NOT use @lovable.dev/vite-tanstack-config (no SSR, no
// Nitro, no TanStack Router) — this builds a plain static SPA that can be
// hosted anywhere (e.g. GitHub Pages) for phone testing, decoupled from the
// main app's build pipeline entirely.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../harness-dist",
    emptyOutDir: true,
  },
});
