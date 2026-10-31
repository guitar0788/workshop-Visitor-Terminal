import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves project sites under /<repository>/.
  base: "/workshop-Visitor-Terminal/",
  plugins: [react()],
  // Node-native staging guard suites run separately using `node --test`.
  test: { environment: "node", exclude: [...configDefaults.exclude, "worker/**/*.test.mjs"] }
});
