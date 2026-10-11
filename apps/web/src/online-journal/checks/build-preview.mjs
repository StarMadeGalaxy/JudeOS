import { build } from "../../../node_modules/vite/dist/node/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const moduleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
await build({
  configFile: false,
  root: path.resolve(moduleRoot, "../.."),
  build: {
    outDir: path.join(moduleRoot, "dist/preview"),
    emptyOutDir: true,
    rollupOptions: { input: path.join(moduleRoot, "preview.html") },
  },
});
