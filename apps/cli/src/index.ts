/** Public library surface of the CLI package. */
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
