import { describe, expect, it } from "vitest";
import {
  httpDateToRfc3339,
  normalizeSourceDate,
  rfc3339ToHttpDate
} from "./date.js";

describe("normalizeSourceDate", () => {
  it("passes through a valid date-only value and rejects an invalid one", () => {
    expect(normalizeSourceDate("2026-08-31")).toBe("2026-08-31");
    expect(normalizeSourceDate("2026-02-30")).toBeUndefined();
  });

  it("normalizes an RFC 3339 date-time, dropping fractional seconds", () => {
    expect(normalizeSourceDate("2026-08-31T12:34:56.789+09:00")).toBe(
      "2026-08-31T12:34:56+09:00"
    );
    expect(normalizeSourceDate("2026-08-31T03:00:00Z")).toBe(
      "2026-08-31T03:00:00Z"
    );
  });

  it("rejects invalid calendar dates and times instead of letting them roll over", () => {
    expect(normalizeSourceDate("2026-02-30T00:00:00Z")).toBeUndefined();
    expect(normalizeSourceDate("2026-08-31T24:00:00Z")).toBeUndefined();
    expect(normalizeSourceDate("2026-13-01")).toBeUndefined();
    expect(normalizeSourceDate("2026-08-32")).toBeUndefined();
  });

  it("rejects malformed or out-of-range offsets", () => {
    expect(normalizeSourceDate("2026-08-31T12:00:00+24:00")).toBeUndefined();
    expect(normalizeSourceDate("2026-08-31T12:00:00+")).toBeUndefined();
  });

  it("accepts an offset without a colon and normalizes it to the colon form", () => {
    expect(normalizeSourceDate("2026-08-31T12:34:56+0900")).toBe(
      "2026-08-31T12:34:56+09:00"
    );
    expect(normalizeSourceDate("2026-08-31T12:34:56-0500")).toBe(
      "2026-08-31T12:34:56-05:00"
    );
  });

  it("accepts a space instead of T when an explicit zone is present", () => {
    expect(normalizeSourceDate("2026-08-31 12:34:56Z")).toBe(
      "2026-08-31T12:34:56Z"
    );
    expect(normalizeSourceDate("2026-08-31 12:34:56+09:00")).toBe(
      "2026-08-31T12:34:56+09:00"
    );
  });

  it("preserves a supplied explicit offset instead of converting to UTC", () => {
    expect(normalizeSourceDate("2026-08-31T12:34:56+09:00")).toBe(
      "2026-08-31T12:34:56+09:00"
    );
  });

  it("reduces a timezone-less local date-time to a date-only value", () => {
    expect(normalizeSourceDate("2026-08-31T12:34:56")).toBe("2026-08-31");
    expect(normalizeSourceDate("2026-08-31 12:34:56")).toBe("2026-08-31");
    expect(normalizeSourceDate("2026-08-31T24:00:00")).toBeUndefined();
    expect(normalizeSourceDate("2026-02-30T00:00:00")).toBeUndefined();
  });

  it("recognizes compact YYYYMMDD before treating it as a numeric epoch", () => {
    expect(normalizeSourceDate("20260831")).toBe("2026-08-31");
    expect(normalizeSourceDate(20260831)).toBe("2026-08-31");
    expect(normalizeSourceDate("20261301")).toBeUndefined();
    expect(normalizeSourceDate(20261301)).toBeUndefined();
  });

  it("accepts unambiguous English month-name date text as date-only", () => {
    expect(normalizeSourceDate("August 31, 2026")).toBe("2026-08-31");
    expect(normalizeSourceDate("Aug 31, 2026")).toBe("2026-08-31");
    expect(normalizeSourceDate("31 August 2026")).toBe("2026-08-31");
    expect(normalizeSourceDate("31 Aug 2026")).toBe("2026-08-31");
    expect(normalizeSourceDate("February 30, 2026")).toBeUndefined();
    expect(normalizeSourceDate("Frobruary 1, 2026")).toBeUndefined();
  });

  it("never guesses a locale for ambiguous numeric slash dates", () => {
    expect(normalizeSourceDate("09/02/2026")).toBeUndefined();
    expect(normalizeSourceDate("2026/09/02")).toBeUndefined();
  });

  it("never guesses a timezone abbreviation or the local timezone", () => {
    expect(normalizeSourceDate("2026-08-31T12:34:56 PST")).toBeUndefined();
    expect(normalizeSourceDate("Mon Aug 31 2026 12:34:56")).toBeUndefined();
  });

  it("interprets JSON numbers as Unix epoch seconds/ms/us/ns by digit count", () => {
    const seconds = 1_693_672_496; // 10 digits
    expect(normalizeSourceDate(seconds)).toBe(
      new Date(seconds * 1000).toISOString().replace(".000Z", "Z")
    );
    const milliseconds = 1_693_672_496_789; // 13 digits
    expect(normalizeSourceDate(milliseconds)).toBe(
      new Date(milliseconds).toISOString().replace(".789Z", "Z")
    );
    const microseconds = 1_693_672_496_789_123; // 16 digits
    expect(normalizeSourceDate(microseconds)).toBe(
      new Date(Math.trunc(microseconds / 1000)).toISOString().replace(".789Z", "Z")
    );
  });

  it("uses bigint-safe scaling for nanosecond epoch strings without precision loss", () => {
    const nanoseconds = "1693672496789123456"; // 19 digits
    expect(normalizeSourceDate(nanoseconds)).toBe("2023-09-02T16:34:56Z");
  });

  it("uses floor division for negative fractional epochs", () => {
    expect(normalizeSourceDate("-1000000000000001")).toBe("1938-04-24T22:13:19Z");
  });

  it("rejects unsafe integer numbers that JavaScript has already rounded", () => {
    expect(normalizeSourceDate(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });

  it("rejects numeric values with too few or too many digits to plausibly be an epoch", () => {
    expect(normalizeSourceDate(2026)).toBeUndefined();
    expect(normalizeSourceDate("42")).toBeUndefined();
    expect(normalizeSourceDate("12345678901234567890123")).toBeUndefined();
    expect(normalizeSourceDate(1.5)).toBeUndefined();
    expect(normalizeSourceDate(Number.NaN)).toBeUndefined();
    expect(normalizeSourceDate(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("resolves JSON-LD @value objects regardless of @type", () => {
    expect(
      normalizeSourceDate({
        "@value": "2026-08-31T12:34:56Z",
        "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
      })
    ).toBe("2026-08-31T12:34:56Z");
    expect(
      normalizeSourceDate({ "@value": 1_693_672_496, "@type": "xsd:integer" })
    ).toBe("2023-09-02T16:34:56Z");
  });

  it("selects the first valid candidate from a JSON-LD array, preserving order", () => {
    expect(normalizeSourceDate(["not a date", "2026-08-31", "2026-01-01"])).toBe(
      "2026-08-31"
    );
    expect(
      normalizeSourceDate([
        { "@value": "also not a date" },
        { "@value": "2026-08-31T12:34:56Z" }
      ])
    ).toBe("2026-08-31T12:34:56Z");
    expect(normalizeSourceDate(["not a date", "still not a date"])).toBeUndefined();
  });

  it("handles malformed or unsupported JSON-LD-like shapes without throwing", () => {
    expect(normalizeSourceDate(undefined)).toBeUndefined();
    expect(normalizeSourceDate(null)).toBeUndefined();
    expect(normalizeSourceDate(true)).toBeUndefined();
    expect(normalizeSourceDate({})).toBeUndefined();
    expect(normalizeSourceDate({ foo: "bar" })).toBeUndefined();
    expect(normalizeSourceDate([])).toBeUndefined();
  });

  it("handles cyclic and deeply nested JSON-LD-like shapes without overflowing", () => {
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);
    expect(normalizeSourceDate(cyclicArray)).toBeUndefined();

    const cyclicValue: Record<string, unknown> = {};
    cyclicValue["@value"] = cyclicValue;
    expect(normalizeSourceDate(cyclicValue)).toBeUndefined();

    let deeplyNested: unknown = "2026-08-31";
    for (let depth = 0; depth < 20_000; depth += 1) {
      deeplyNested = { "@value": deeplyNested };
    }
    expect(normalizeSourceDate(deeplyNested)).toBe("2026-08-31");
  });
});

describe("HTTP Last-Modified conversions", () => {
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
    expect(
      httpDateToRfc3339(
        "Sunday, 06-Nov-94 08:49:37 GMT",
        new Date("2026-09-01T00:00:00Z")
      )
    ).toBe(
      "1994-11-06T08:49:37Z"
    );
    expect(httpDateToRfc3339("Sun Nov  6 08:49:37 1994")).toBe(
      "1994-11-06T08:49:37Z"
    );
    expect(
      httpDateToRfc3339(
        "Saturday, 06-Nov-76 08:49:37 GMT",
        new Date("2026-09-01T00:00:00Z")
      )
    ).toBe("1976-11-06T08:49:37Z");
  });
});
