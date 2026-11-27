import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === "production";
// Bundle goes to ./main.js. Set OBSIDIAN_PLUGIN_DIR to a vault plugin folder
// (e.g. <vault>/.obsidian/plugins/dsa-meisterwerkzeug) to build straight into it.
const outDir = process.env.OBSIDIAN_PLUGIN_DIR ? path.resolve(process.env.OBSIDIAN_PLUGIN_DIR) : here;
fs.mkdirSync(outDir, { recursive: true });

const copyStatic = () => {
  if (outDir === here) return;
  for (const f of ["manifest.json", "styles.css"]) fs.copyFileSync(path.join(here, f), path.join(outDir, f));
};

const ctx = await esbuild.context({
  entryPoints: [path.join(here, "src/main.ts")],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: path.join(outDir, "main.js"),
});

if (prod) {
  await ctx.rebuild();
  copyStatic();
  await ctx.dispose();
} else {
  copyStatic();
  await ctx.watch();
}
