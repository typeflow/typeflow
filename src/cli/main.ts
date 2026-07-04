#!/usr/bin/env node
/** Entry point: argument parsing and command dispatch only. */
import { cmdCheck, cmdInfer, cmdTypes, cmdWatch } from './commands/analyze';
import { cmdFmt } from './commands/fmt';
import { cmdInit } from './commands/init';
import { cmdRun } from './commands/run';

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

function splitArgs(argv: string[]): {
  positional: string[];
  flags: Map<string, string | true>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (
        next !== undefined &&
        !next.startsWith('--') &&
        (name === 'input' || name === 'out')
      ) {
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

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = splitArgs(rest);

  switch (command) {
    case 'check':
      return cmdCheck(positional);
    case 'types':
      return cmdTypes(positional, flags.get('check') === true);
    case 'infer':
      return cmdInfer(positional[0]);
    case 'run':
      return cmdRun(
        positional[0],
        typeof flags.get('input') === 'string'
          ? (flags.get('input') as string)
          : undefined,
      );
    case 'fmt':
      return cmdFmt(positional, flags.get('check') === true);
    case 'watch':
      return cmdWatch(positional);
    case 'init':
      return cmdInit();
    case 'help':
    case '--help':
    case undefined:
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command '${command}'.\n\n${HELP}`);
      process.exit(1);
  }
}

await main();
