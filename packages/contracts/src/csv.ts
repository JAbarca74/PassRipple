// CSV for the files PassRipple hands out (declarations, exports): UTF-8, CRLF lines, every
// cell quoted. A text cell that a spreadsheet would read as a formula (an organizer can type
// "=HYPERLINK(...)" into an event name) is prefixed with a quote so it stays text.

export type CsvCell = string | number | null;

function cell(value: CsvCell): string {
  const text = value === null ? "" : String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** The rows as a CSV document, each line ending in CRLF. */
export function csvDocument(rows: readonly (readonly CsvCell[])[]): string {
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
