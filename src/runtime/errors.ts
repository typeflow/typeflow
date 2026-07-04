export class TypeflowRuntimeError extends Error {
  constructor(
    message: string,
    public span?: { start: number; end: number },
  ) {
    super(message);
    this.name = 'TypeflowRuntimeError';
  }
}
