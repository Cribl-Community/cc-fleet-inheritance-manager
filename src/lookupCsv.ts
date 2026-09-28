export type LookupRowPatch =
  | {
      op: 'add' | 'replace';
      /** One-based data row number, as reported in the lookup content's `__id` column. Ignored for placement by `add`. */
      rowId: number;
      /** Cell values in column order, without the `__id` column. */
      value: string[];
    }
  | {
      op: 'remove';
      rowId: number;
    };

interface ParsedCsv {
  rows: string[][];
  lineEnding: string;
  trailingNewline: boolean;
}

/** RFC 4180 CSV parser: quoted fields, escaped quotes, and embedded newlines. */
export function parseCsv(text: string): ParsedCsv {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = /\r?\n$/.test(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error('The lookup file has an unterminated quoted field.');
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return { rows, lineEnding, trailingNewline };
}

function serializeField(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsv({ rows, lineEnding, trailingNewline }: ParsedCsv): string {
  const body = rows.map((row) => row.map(serializeField).join(',')).join(lineEnding);

  return trailingNewline ? `${body}${lineEnding}` : body;
}

/** Apply row patches, in order, to a CSV file whose first row is the header. */
export function applyLookupRowPatches(csv: string, patches: LookupRowPatch[]): string {
  const parsed = parseCsv(csv);
  const [header, ...rows] = parsed.rows;

  if (!header) {
    throw new Error('The lookup file has no header row.');
  }

  const checkRowId = (rowId: number) => {
    if (!Number.isInteger(rowId) || rowId < 1 || rowId > rows.length) {
      throw new Error(`Row ${rowId} does not exist in the lookup file (it has ${rows.length} rows).`);
    }
  };
  const checkValue = (value: string[]) => {
    if (value.length !== header.length) {
      throw new Error(`A row has ${value.length} values, but the lookup has ${header.length} columns.`);
    }
  };

  for (const patch of patches) {
    if (patch.op === 'replace') {
      checkRowId(patch.rowId);
      checkValue(patch.value);
      rows[patch.rowId - 1] = patch.value;
    } else if (patch.op === 'remove') {
      checkRowId(patch.rowId);
      rows.splice(patch.rowId - 1, 1);
    } else {
      checkValue(patch.value);
      rows.push(patch.value);
    }
  }

  return serializeCsv({ ...parsed, rows: [header, ...rows] });
}
