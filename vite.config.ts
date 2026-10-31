import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves project sites under /<repository>/.
  base: "/workshop-Visitor-Terminal/",
  plugins: [react()],
  test: { environment: "node" }
});
