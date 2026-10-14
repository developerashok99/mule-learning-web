// @ts-check
import { defineConfig } from "astro/config";

// GitHub Pages serves this repository at https://developerashok99.github.io/mule-learning-web/.
// SITE_BASE can override the path (e.g. "/" for a custom domain).
const base = process.env.SITE_BASE ?? "/mule-learning-web";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://developerashok99.github.io",
  base,
  trailingSlash: "always",
  build: { format: "directory" },
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  devToolbar: { enabled: false },
  vite: { build: { chunkSizeWarningLimit: 4000 } },
});
