import { describe, expect, it } from "vitest";
import { average, formatBytes, formatCount, formatMs } from "../../../../src/analysis/measurements/format";

describe("format helpers", () => {
  it("formatCount pluralizes correctly", () => {
    expect(formatCount(1, "page")).toBe("1 page");
    expect(formatCount(2, "page")).toBe("2 pages");
    expect(formatCount(0, "page")).toBe("0 pages");
  });

  it("formatBytes scales units", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  it("formatMs rounds to whole milliseconds", () => {
    expect(formatMs(12.6)).toBe("13 ms");
  });

  it("average returns null on an empty array, never NaN or throws", () => {
    expect(average([])).toBeNull();
    expect(average([2, 4, 6])).toBe(4);
  });
});
