export type MarkhqErrorCode =
  | "INVALID_URL"
  | "INVALID_HEADER"
  | "UNSUPPORTED_SCHEME"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "FETCH_FAILED"
  | "CONVERSION_FAILED"
  | "CONFIG_ERROR"
  | "PATH_COLLISION"
  | "PATH_TOO_LONG"
  | "STORAGE_ERROR";

export class MarkhqError extends Error {
  readonly code: MarkhqErrorCode;
  readonly cause?: unknown;

  constructor(code: MarkhqErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MarkhqError";
    this.code = code;
    this.cause = options?.cause;
  }
}
