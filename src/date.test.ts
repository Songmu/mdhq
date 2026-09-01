import { describe, expect, it } from "vitest";
import {
  httpDateToRfc3339,
  normalizeSourceDate,
  rfc3339ToHttpDate
} from "./date.js";

describe("date utilities", () => {
  it("normalizes source dates without inventing time for date-only values", () => {
    expect(normalizeSourceDate("2026-08-31")).toBe("2026-08-31");
    expect(normalizeSourceDate("2026-08-31T12:34:56.789+09:00")).toBe(
      "2026-08-31T12:34:56+09:00"
    );
    expect(normalizeSourceDate("August 31, 2026")).toBeUndefined();
    expect(normalizeSourceDate("2026-02-30T00:00:00Z")).toBeUndefined();
    expect(normalizeSourceDate("2026-08-31T24:00:00Z")).toBeUndefined();
    expect(normalizeSourceDate("2026-08-31T12:00:00+24:00")).toBeUndefined();
    expect(normalizeSourceDate("2026-08-31T12:00:00+")).toBeUndefined();
  });

  it("converts between HTTP-date and RFC 3339", () => {
    expect(httpDateToRfc3339("Mon, 31 Aug 2026 03:00:00 GMT")).toBe(
      "2026-08-31T03:00:00Z"
    );
    expect(rfc3339ToHttpDate("2026-08-31T03:00:00Z")).toBe(
      "Mon, 31 Aug 2026 03:00:00 GMT"
    );
    expect(httpDateToRfc3339("2026-08-31")).toBeUndefined();
    expect(httpDateToRfc3339("Sun, 31 Aug 2026 03:00:00 GMT")).toBeUndefined();
    expect(rfc3339ToHttpDate("2026-02-30T03:00:00Z")).toBeUndefined();
    expect(httpDateToRfc3339("Sunday, 06-Nov-94 08:49:37 GMT")).toBe(
      "1994-11-06T08:49:37Z"
    );
    expect(httpDateToRfc3339("Sun Nov  6 08:49:37 1994")).toBe(
      "1994-11-06T08:49:37Z"
    );
  });
});
