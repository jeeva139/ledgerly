/** RFC 4180 CSV text. Cells starting with = + - @ are prefixed so spreadsheets never run them as formulas. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number): string => {
    let s = typeof v === 'number' ? String(v) : v
    // Text only: numbers stay numeric (a leading "-" on a real number is fine).
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function csvFilename(report: string, period: string): string {
  return `ledgerly-${report}-${period}.csv`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
}
