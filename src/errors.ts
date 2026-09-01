export type MdhqErrorCode =
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

export class MdhqError extends Error {
  readonly code: MdhqErrorCode;
  readonly cause?: unknown;

  constructor(code: MdhqErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MdhqError";
    this.code = code;
    this.cause = options?.cause;
  }
}
