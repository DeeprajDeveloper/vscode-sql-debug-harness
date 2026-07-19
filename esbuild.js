#!/usr/bin/env node
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");
const root = __dirname;

const shared = {
  bundle: true,
  platform: "node",
  target: "node18",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info",
};

async function build() {
  const outDir = path.join(root, "out");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const ctx = await esbuild.context({
    ...shared,
    entryPoints: {
      extension: path.join(root, "src", "extension.ts"),
      cli: path.join(root, "src", "cli.ts"),
    },
    outdir: outDir,
    format: "cjs",
  });

  if (watch) {
    await ctx.watch();
    console.log("watching...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    const cliPath = path.join(root, "out", "cli.js");
    const content = fs.readFileSync(cliPath, "utf8");
    if (!content.startsWith("#!")) {
      fs.writeFileSync(cliPath, "#!/usr/bin/env node\n" + content);
    }
    try {
      fs.chmodSync(cliPath, 0o755);
    } catch {
      /* ignore on Windows */
    }
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
