#!/usr/bin/env bun
import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createMapping } from "@thomasfarineau/typeflow-runtime";
import { emitDts } from "@thomasfarineau/typeflow-compiler";
import { createTypeScriptResolver } from "@thomasfarineau/typeflow-adapter-typescript";
import { format } from "@thomasfarineau/typeflow-formatter";
import { formatDiagnostic } from "@thomasfarineau/typeflow-core";
import {
  compileFile,
  countBySeverity,
  dtsPathFor,
  expandFiles,
  inferredOutput,
  printDiagnostics,
  writeDts,
  type FileReport,
} from "./index.ts";

const HELP = `typeflow — typed JSON transformations, checked at compile time

Usage:
  typeflow check [patterns...]           Analyze mappings and report diagnostics
  typeflow types [patterns...] [--check] Generate .d.typeflow.ts declaration files
  typeflow infer <file>                  Print the inferred output type of a mapping
  typeflow run <file> [--input <json>]   Execute a mapping (input from file or stdin)
  typeflow fmt [patterns...] [--check]   Rewrite mappings in canonical form
  typeflow watch [patterns...]           Re-check and regenerate types on change
  typeflow init                          Scaffold an example mapping in the current directory
  typeflow help                          Show this message

Patterns default to **/*.typeflow (node_modules excluded).`;

const color = process.stderr.isTTY ?? false;

function splitArgs(argv: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && (name === "input" || name === "out")) {
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, true);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function compileAll(patterns: string[]): Promise<FileReport[]> {
  const files = await expandFiles(patterns);
  if (files.length === 0) {
    console.error("No .typeflow files found.");
    process.exit(1);
  }
  const resolver = createTypeScriptResolver();
  const reports: FileReport[] = [];
  for (const file of files) {
    reports.push(await compileFile(file, resolver));
  }
  return reports;
}

function summarize(reports: FileReport[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const r of reports) {
    printDiagnostics(r, color);
    const c = countBySeverity(r.result.diagnostics);
    errors += c.errors;
    warnings += c.warnings;
  }
  return { errors, warnings };
}

async function cmdCheck(patterns: string[]): Promise<void> {
  const reports = await compileAll(patterns);
  const { errors, warnings } = summarize(reports);
  const suffix = warnings ? `, ${warnings} warning(s)` : "";
  if (errors > 0) {
    console.error(`✖ ${reports.length} mapping(s) checked, ${errors} error(s)${suffix}.`);
    process.exit(1);
  }
  console.log(`✔ ${reports.length} mapping(s) checked, 0 errors${suffix}.`);
}

async function cmdTypes(patterns: string[], checkOnly: boolean): Promise<void> {
  const reports = await compileAll(patterns);
  const { errors } = summarize(reports);
  if (errors > 0) {
    console.error(`✖ Type generation aborted: ${errors} error(s).`);
    process.exit(1);
  }
  let drift = 0;
  for (const r of reports) {
    if (checkOnly) {
      const expected = emitDts(r.result, { sourceFileName: r.fileName });
      const outPath = dtsPathFor(r.filePath);
      const actual = existsSync(outPath) ? await readFile(outPath, "utf8") : null;
      if (actual !== expected) {
        drift++;
        console.error(`stale declarations: ${relative(process.cwd(), outPath)} (run 'typeflow types')`);
      }
    } else {
      const outPath = await writeDts(r);
      console.log(`generated ${relative(process.cwd(), outPath)}`);
    }
  }
  if (checkOnly) {
    if (drift > 0) process.exit(1);
    console.log(`✔ ${reports.length} declaration file(s) up to date.`);
  }
}

async function cmdInfer(file: string | undefined): Promise<void> {
  if (!file) {
    console.error("Usage: typeflow infer <file>");
    process.exit(1);
  }
  const report = await compileFile(file);
  printDiagnostics(report, color);
  const { errors } = countBySeverity(report.result.diagnostics);
  if (errors > 0) process.exit(1);
  console.log(inferredOutput(report));
}

async function cmdRun(file: string | undefined, inputPath: string | undefined): Promise<void> {
  if (!file) {
    console.error("Usage: typeflow run <file> [--input data.json]");
    process.exit(1);
  }
  const report = await compileFile(file);
  printDiagnostics(report, color);
  if (!report.result.ok || !report.result.compiled) process.exit(1);

  const raw = inputPath ? await readFile(resolve(inputPath), "utf8") : await Bun.stdin.text();
  if (!raw.trim()) {
    console.error("No input JSON provided (use --input <file> or pipe JSON to stdin).");
    process.exit(1);
  }
  const input: unknown = JSON.parse(raw);
  const output = createMapping(report.result.compiled)(input);
  console.log(JSON.stringify(output, null, 2));
}

async function cmdFmt(patterns: string[], checkOnly: boolean): Promise<void> {
  const files = await expandFiles(patterns);
  if (files.length === 0) {
    console.error("No .typeflow files found.");
    process.exit(1);
  }
  let changed = 0;
  let failed = 0;
  for (const file of files) {
    const rel = relative(process.cwd(), file).replace(/\\/g, "/");
    const source = await readFile(file, "utf8");
    const result = format(source);
    if (!result.ok) {
      failed++;
      for (const d of result.diagnostics) console.error(formatDiagnostic(d, source, rel, { color }));
      continue;
    }
    if (result.formatted === source) continue;
    changed++;
    if (checkOnly) {
      console.error(`not formatted: ${rel}`);
    } else {
      await writeFile(file, result.formatted, "utf8");
      console.log(`formatted ${rel}`);
    }
  }
  if (failed > 0 || (checkOnly && changed > 0)) process.exit(1);
  if (changed === 0) console.log(`✔ ${files.length} file(s) already formatted.`);
}

async function cmdWatch(patterns: string[]): Promise<void> {
  const runOnce = async () => {
    try {
      const reports = await compileAll(patterns);
      const { errors, warnings } = summarize(reports);
      if (errors === 0) {
        for (const r of reports) await writeDts(r);
      }
      const time = new Date().toLocaleTimeString();
      const suffix = warnings ? `, ${warnings} warning(s)` : "";
      console.log(
        errors > 0
          ? `[${time}] ✖ ${errors} error(s)${suffix}. Waiting for changes...`
          : `[${time}] ✔ ${reports.length} mapping(s) checked, declarations updated${suffix}. Waiting for changes...`,
      );
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
    }
  };

  await runOnce();
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(process.cwd(), { recursive: true }, (_event, fileName) => {
    if (!fileName) return;
    const name = fileName.toString();
    if (name.includes("node_modules") || name.endsWith(".d.typeflow.ts")) return;
    if (!name.endsWith(".typeflow") && !name.endsWith(".ts")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(runOnce, 150);
  });
  // Keep the process alive.
  await new Promise(() => {});
}

const EXAMPLE_TYPES = `export interface User {
  id: number;
  firstName: string;
  lastName: string;
  contact?: { email?: string };
  labels: { name: string; active: boolean }[];
}
`;

const EXAMPLE_MAPPING = `input user: User from "./user-types"

map {
  id: user.id,
  fullName: user.firstName + " " + user.lastName,
  email: user.contact?.email ?? "unknown",
  activeTags: user.labels[active].name,
}
`;

async function cmdInit(): Promise<void> {
  const created: string[] = [];
  if (!existsSync("user-types.ts")) {
    await writeFile("user-types.ts", EXAMPLE_TYPES, "utf8");
    created.push("user-types.ts");
  }
  if (!existsSync("user.typeflow")) {
    await writeFile("user.typeflow", EXAMPLE_MAPPING, "utf8");
    created.push("user.typeflow");
  }
  if (created.length === 0) {
    console.log("Nothing to do: user-types.ts and user.typeflow already exist.");
    return;
  }
  console.log(`Created ${created.join(", ")}.`);
  console.log("Try: typeflow check user.typeflow && typeflow infer user.typeflow");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = splitArgs(rest);

  switch (command) {
    case "check":
      return cmdCheck(positional);
    case "types":
      return cmdTypes(positional, flags.get("check") === true);
    case "infer":
      return cmdInfer(positional[0]);
    case "run":
      return cmdRun(positional[0], typeof flags.get("input") === "string" ? (flags.get("input") as string) : undefined);
    case "fmt":
      return cmdFmt(positional, flags.get("check") === true);
    case "watch":
      return cmdWatch(positional);
    case "init":
      return cmdInit();
    case "help":
    case "--help":
    case undefined:
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command '${command}'.\n\n${HELP}`);
      process.exit(1);
  }
}

await main();
