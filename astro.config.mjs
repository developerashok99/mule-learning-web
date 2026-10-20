// @ts-check
import { defineConfig } from "astro/config";
import { rmSync } from "node:fs";

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
  integrations: [
    {
      // The synthetic test media (public/test-media/) is only for the browser tests: published builds leave it out.
      name: "drop-test-media",
      hooks: {
        "astro:build:done": ({ dir }) => {
          if (process.env.SHOW_TEST_EPISODES !== "true") rmSync(new URL("test-media/", dir), { recursive: true, force: true });
        },
      },
    },
  ],
});
