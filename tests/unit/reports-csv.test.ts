import { describe, expect, it } from "vitest";
import { toCsv } from "@/modules/reports/csv";

describe("report CSV", () => {
  it("quotes cells, escapes quotes and ends every row with CRLF", () => {
    expect(toCsv(["A", "B"], [["x, y", 'say "hi"'], [1.5, null]])).toBe('"A","B"\r\n"x, y","say ""hi"""\r\n"1.5",""\r\n');
  });

  it("defuses cells a spreadsheet would run as a formula, but leaves numbers alone", () => {
    const csv = toCsv(["h"], [["=1+1"], ["+cmd"], ["-5 days"], ["@SUM(A1)"], [-2]]);
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).toContain(`"'+cmd"`);
    expect(csv).toContain(`"'-5 days"`);
    expect(csv).toContain(`"'@SUM(A1)"`);
    expect(csv).toContain('"-2"');
  });
});
