#!/usr/bin/env node
/**
 * Optional CLI entry for `npx sql-sp-harness generate|analyze`.
 * Shares the same TypeScript engine as the VS Code extension.
 */

import * as fs from "fs";
import * as path from "path";
import { analyze, generate } from "./engine";
import type { TraceStyle } from "./engine";

function printHelp(): void {
  console.log(`sql-sp-harness — T-SQL stored procedure debug harness

Usage:
  sql-sp-harness generate -i <file.sql> [-o <out.sql>] [--trace-style print|raiserror]
  sql-sp-harness analyze  -i <file.sql> [--plain]
  sql-sp-harness version

Options:
  -i, --input <path>       Input .sql file (or - for stdin)
  -o, --output <path>      Output file (generate; default stdout)
  --trace-style <style>    print (default) or raiserror
  --plain                  Plain-text analyze report (default)
  -h, --help               Show help
`);
}

function readInput(inputPath: string | undefined): string {
  if (!inputPath || inputPath === "-") {
    return fs.readFileSync(0, "utf-8");
  }
  return fs.readFileSync(path.resolve(inputPath), "utf-8");
}

function writeOutput(outputPath: string | undefined, content: string): void {
  if (!outputPath || outputPath === "-") {
    process.stdout.write(content);
    return;
  }
  fs.writeFileSync(path.resolve(outputPath), content, "utf-8");
}

function parseArgs(argv: string[]): {
  command: string;
  input?: string;
  output?: string;
  traceStyle: TraceStyle;
  help: boolean;
} {
  const args = [...argv];
  const command = args.shift() ?? "help";
  let input: string | undefined;
  let output: string | undefined;
  let traceStyle: TraceStyle = "print";
  let help = false;

  while (args.length) {
    const a = args.shift()!;
    if (a === "-h" || a === "--help") {
      help = true;
    } else if (a === "-i" || a === "--input") {
      input = args.shift();
    } else if (a === "-o" || a === "--output") {
      output = args.shift();
    } else if (a === "--trace-style") {
      const v = args.shift();
      traceStyle = v === "raiserror" ? "raiserror" : "print";
    } else if (a === "--plain") {
      // default
    } else if (!a.startsWith("-") && !input) {
      input = a;
    }
  }

  return { command, input, output, traceStyle, help };
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (
    parsed.help ||
    parsed.command === "help" ||
    parsed.command === "-h" ||
    parsed.command === "--help"
  ) {
    printHelp();
    process.exit(0);
  }

  if (parsed.command === "version" || parsed.command === "--version") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../package.json") as { version: string };
    console.log(pkg.version);
    process.exit(0);
  }

  if (parsed.command === "generate") {
    if (parsed.input === undefined) {
      console.error("generate requires -i <file.sql>");
      process.exit(1);
    }
    const sql = readInput(parsed.input);
    const result = generate(sql, { traceStyle: parsed.traceStyle });
    writeOutput(parsed.output, result.sql);
    if (result.stats.warnings.length) {
      process.stderr.write(
        `Completed with ${result.stats.warnings.length} warning(s).\n`
      );
      process.exit(2);
    }
    process.exit(0);
  }

  if (parsed.command === "analyze") {
    if (!parsed.input) {
      console.error("analyze requires -i <file.sql>");
      process.exit(1);
    }
    const sql = readInput(parsed.input);
    const report = analyze(sql);
    process.stdout.write(report.plainText + "\n");
    process.exit(0);
  }

  console.error(`Unknown command: ${parsed.command}`);
  printHelp();
  process.exit(1);
}

main();
