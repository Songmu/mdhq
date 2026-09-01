import { describe, expect, it } from "vitest";
import { DEFAULT_USER_AGENT, PROJECT_URL, VERSION } from "./version.js";

describe("version metadata", () => {
  it("uses the mdhq package and repository identity", () => {
    expect(PROJECT_URL).toBe("https://github.com/Songmu/mdhq");
    expect(DEFAULT_USER_AGENT).toBe(`mdhq/${VERSION} (+${PROJECT_URL})`);
  });
});
