import * as esbuild from "esbuild";

const opts = {
  entryPoints: ["src/main.jsx"],
  bundle: true,
  outfile: "public/app.js",
  format: "iife",
  target: ["es2019"],
  jsx: "automatic",
  loader: { ".js": "jsx" },
  minify: true,
  sourcemap: false,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("watching…");
} else {
  await esbuild.build(opts);
  console.log("built public/app.js");
}
