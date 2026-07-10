#!/usr/bin/env node
/** Entry point: command definitions (commander) and dispatch only. */
import { cmdCheck, cmdInfer, cmdTypes, cmdWatch } from './commands/analyze';
import {
  cmdConvert,
  CONVERT_TYPES,
  type ConvertType,
} from './commands/convert';
import { Command, Option } from 'commander';
import { cmdFmt } from './commands/fmt';
import { cmdInit } from './commands/init';
import { cmdRun } from './commands/run';

const program = new Command('typeflow')
  .description('typed JSON transformations, checked at compile time')
  .version('0.0.1');

program
  .command('check [patterns...]')
  .description('Analyze mappings and report diagnostics')
  .option('--json', 'report diagnostics as JSON')
  .action((patterns: string[], opts: { json?: boolean }) =>
    cmdCheck(patterns, Boolean(opts.json)),
  );

program
  .command('types [patterns...]')
  .description('Generate .d.typeflow.ts declaration files')
  .option('--check', 'fail if declarations are stale instead of writing them')
  .action((patterns: string[], opts: { check?: boolean }) =>
    cmdTypes(patterns, Boolean(opts.check)),
  );

program
  .command('infer <file>')
  .description('Print the inferred output type of a mapping')
  .action((file: string) => cmdInfer(file));

program
  .command('run <file>')
  .description('Execute a mapping (input from file or stdin)')
  .option('--input <path>', 'read input JSON from a file instead of stdin')
  .action((file: string, opts: { input?: string }) => cmdRun(file, opts.input));

program
  .command('fmt [patterns...]')
  .description('Rewrite mappings in canonical form')
  .option('--check', 'fail if files are unformatted instead of writing them')
  .action((patterns: string[], opts: { check?: boolean }) =>
    cmdFmt(patterns, Boolean(opts.check)),
  );

program
  .command('watch [patterns...]')
  .description('Re-check and regenerate types on change')
  .action((patterns: string[]) => cmdWatch(patterns));

program
  .command('init')
  .description('Scaffold an example mapping in the current directory')
  .action(() => cmdInit());

program
  .command('convert <patterns...>')
  .description('Convert jq/JSONata files to Typeflow mappings')
  .addOption(
    new Option('--type <type>', 'source language to convert from')
      .choices(CONVERT_TYPES)
      .makeOptionMandatory(),
  )
  .action((patterns: string[], opts: { type: ConvertType }) =>
    cmdConvert(patterns, opts.type),
  );

await program.parseAsync(process.argv);
