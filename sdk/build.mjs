/**
 * Build the SDK into sdk/dist: one self-contained ES module (the protocol core is bundled in, so the
 * package depends on nothing) and its type declarations. Run from anywhere:  node sdk/build.mjs
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
rmSync(join(here, "dist"), { recursive: true, force: true });

await build({
  entryPoints: [join(here, "src/index.ts")],
  outfile: join(here, "dist/index.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  legalComments: "none",
});

// Declarations for the SDK and for the one file it imports from outside its folder (the protocol core).
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", join(here, "tsconfig.build.json")], { stdio: "inherit" });
console.log("Built sdk/dist/index.js and sdk/dist/types.");
