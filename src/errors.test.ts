import { describe, expect, it } from "vitest";
import { MdhqError } from "./errors.js";

describe("MdhqError", () => {
  it("uses the renamed public error identity", () => {
    const error = new MdhqError("INVALID_URL", "Invalid URL");

    expect(error.name).toBe("MdhqError");
    expect(error.code).toBe("INVALID_URL");
  });
});
