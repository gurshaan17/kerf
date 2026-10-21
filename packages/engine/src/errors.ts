export type EngineErrorCode =
  | 'not-found'
  | 'incompatible-track'
  | 'invalid-range'
  | 'overlap'
  | 'locked'
  | 'invalid-command'
  | 'internal';

/** A recoverable edit failure carrying a code the UI can translate. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly hint: string | undefined;

  constructor(code: EngineErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.hint = hint;
  }
}

export function isEngineError(value: unknown): value is EngineError {
  return value instanceof EngineError;
}
