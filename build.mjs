import * as esbuild from "esbuild";
import { execSync } from "node:child_process";

// A short, human-readable build stamp shown to admins in the header, so it's
// obvious at a glance whether the browser is on the latest deploy.
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", ".");
let sha = "";
try { sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* not a git checkout */ }
const buildId = sha ? `${stamp}-${sha}` : stamp;

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
  define: {
    "process.env.NODE_ENV": '"production"',
    "__BUILD_ID__": JSON.stringify(buildId),
  },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("watching…");
} else {
  await esbuild.build(opts);
  console.log("built public/app.js  (build " + buildId + ")");
}
