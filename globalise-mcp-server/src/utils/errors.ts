/**
 * Structured tool error: a message plus an actionable suggestion, both
 * surfaced verbatim to the model by errorResponse() in index.ts.
 *
 * Throw this instead of a plain { error, suggestion } object so the shape is
 * compiler-checked and the stack trace survives if the error escapes to an
 * unexpected catch site.
 */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
