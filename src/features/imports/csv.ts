/**
 * RFC 4180 CSV parser: quoted fields, escaped quotes (""), embedded commas and
 * newlines, CRLF/LF line endings and a UTF-8 BOM. Returns rows of strings.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') {
      quoted = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

/** Rows as objects keyed by header. Rows with a different column count are reported. */
export function csvObjects(text: string): { header: string[]; rows: { line: number; values: Record<string, string>; malformed: boolean }[] } {
  const all = parseCsv(text)
  const header = (all.shift() ?? []).map((h) => h.trim())
  return {
    header,
    rows: all.map((r, i) => ({
      line: i + 2,
      malformed: r.length !== header.length,
      values: Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()])),
    })),
  }
}
