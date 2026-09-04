import { defineConfig } from "vite";

// Nothing fancy here on purpose -- this example is meant to be copied out of
// the recipe repo and run standalone, so it should look like a project you'd
// bootstrap yourself, not one wired into a larger monorepo build.
export default defineConfig({
  server: {
    open: true,
  },
});
