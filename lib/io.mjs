import { readFileSync } from 'node:fs';

// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, newlines in quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

export function parseJsonl(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`Invalid JSON on line ${i + 1}`); }
  });
}

export function loadRows(path) {
  const text = readFileSync(path, 'utf8');
  if (/\.csv$/i.test(path)) return parseCsv(text);
  if (/\.jsonl?$/i.test(path)) return /\.jsonl$/i.test(path) ? parseJsonl(text) : JSON.parse(text);
  throw new Error('Input must be .csv, .jsonl or .json');
}
