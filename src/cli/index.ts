/** Public library surface of the CLI package (also used by the umbrella loader). */
export { expandFiles } from './glob';
export {
  color,
  compileFile,
  countBySeverity,
  dtsPathFor,
  inferredOutput,
  printDiagnostics,
  writeDts,
  type FileReport,
} from './reports';
export { loadExternalFunctions } from './external';
