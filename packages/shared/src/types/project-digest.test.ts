import { describe, it, expect } from "vitest";
import { emptyDigest, DIGEST_SECTIONS } from "./project-digest.js";

describe("project-digest types", () => {
  it("emptyDigest has a version and no entries", () => {
    const d = emptyDigest();
    expect(d.version).toBe(1);
    expect(d.entries).toEqual([]);
  });

  it("emptyDigest has an empty deepDives array", () => {
    expect(emptyDigest().deepDives).toEqual([]);
  });

  it("DIGEST_SECTIONS lists the map tiers", () => {
    expect(DIGEST_SECTIONS).toContain("architecture");
    expect(DIGEST_SECTIONS).toContain("gotchas");
  });
});
