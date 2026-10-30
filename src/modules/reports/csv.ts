// Pure CSV writer for the reports. Quotes every cell and defuses spreadsheet formulas.

export type Cell = string | number | null;

function cell(value: Cell): string {
  if (value === null) return '""';
  let text = String(value);
  // A leading = + - @ (or tab / carriage return) would be run as a formula by Excel and Sheets.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
