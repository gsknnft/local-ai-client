import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

await build({
  entryPoints: [resolve(root, "src/index.ts")],
  bundle: true,
  platform: "neutral",
  format: "cjs",
  outfile: resolve(root, "dist/index.cjs"),
  target: "es2020",
  // Both backends are dynamic-imported at runtime — never bundle them.
  external: ["@mlc-ai/web-llm", "@huggingface/transformers"],
  sourcemap: false,
});

console.log("CJS bundle written to dist/index.cjs");
