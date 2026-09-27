/**
 * Rewrites package.json inside a Cribl pack archive (.crbl = gzipped tar).
 * Every other tar entry is copied byte-for-byte; only the package.json entry's
 * data, size, and header checksum change.
 */

const BLOCK_SIZE = 512;
const TYPE_PAX = 0x78; // 'x'
const TYPE_GNU_LONGNAME = 0x4c; // 'L'
const TYPE_PAX_GLOBAL = 0x67; // 'g'
const TYPE_REGULAR = 0x30; // '0'
const TYPE_REGULAR_LEGACY = 0x00;

export interface PackMetadataEdits {
  displayName?: string;
  description?: string;
  author?: string;
  tags?: string[];
}

export interface RewrittenPackArchive {
  archive: Uint8Array<ArrayBuffer>;
  previousVersion: string;
  newVersion: string;
  warnings: string[];
}

interface TarEntry {
  path: string;
  headerOffset: number;
  dataOffset: number;
  size: number;
  typeflag: number;
  sizeFromPax: boolean;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function pipeBytes(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

function roundUpToBlock(size: number): number {
  return Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
}

function readCString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;

  while (end < limit && bytes[end] !== 0) {
    end += 1;
  }

  return decoder.decode(bytes.subarray(offset, end));
}

function readOctal(bytes: Uint8Array, offset: number, length: number): number {
  if (bytes[offset] & 0x80) {
    throw new Error('Pack archive uses base-256 tar sizes, which are not supported.');
  }

  const text = readCString(bytes, offset, length).trim();
  return text ? parseInt(text, 8) : 0;
}

function computeHeaderChecksum(bytes: Uint8Array, headerOffset: number): number {
  let sum = 0;

  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    const isChecksumField = index >= 148 && index < 156;
    sum += isChecksumField ? 0x20 : bytes[headerOffset + index];
  }

  return sum;
}

function isZeroBlock(bytes: Uint8Array, offset: number): boolean {
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    if (bytes[offset + index] !== 0) {
      return false;
    }
  }

  return true;
}

function parsePaxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;

  while (offset < data.length) {
    const spaceIndex = data.indexOf(0x20, offset);
    if (spaceIndex < 0) {
      break;
    }

    const recordLength = parseInt(decoder.decode(data.subarray(offset, spaceIndex)), 10);
    if (!recordLength) {
      break;
    }

    // Record format: "<length> <key>=<value>\n"
    const record = decoder.decode(data.subarray(spaceIndex + 1, offset + recordLength - 1));
    const equalsIndex = record.indexOf('=');
    if (equalsIndex > 0) {
      records.set(record.slice(0, equalsIndex), record.slice(equalsIndex + 1));
    }

    offset += recordLength;
  }

  return records;
}

function listTarEntries(tar: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingPath: string | undefined;
  let pendingSizeFromPax = false;

  while (offset + BLOCK_SIZE <= tar.length) {
    if (isZeroBlock(tar, offset)) {
      break;
    }

    if (readOctal(tar, offset + 148, 8) !== computeHeaderChecksum(tar, offset)) {
      throw new Error('Pack archive is not a valid tar file (header checksum mismatch).');
    }

    const size = readOctal(tar, offset + 124, 12);
    const typeflag = tar[offset + 156];
    const dataOffset = offset + BLOCK_SIZE;
    const nextOffset = dataOffset + roundUpToBlock(size);

    if (nextOffset > tar.length) {
      throw new Error('Pack archive is truncated.');
    }

    const data = tar.subarray(dataOffset, dataOffset + size);

    if (typeflag === TYPE_PAX) {
      const records = parsePaxRecords(data);
      pendingPath = records.get('path') ?? pendingPath;
      pendingSizeFromPax = records.has('size');
    } else if (typeflag === TYPE_GNU_LONGNAME) {
      pendingPath = readCString(data, 0, data.length);
    } else if (typeflag !== TYPE_PAX_GLOBAL) {
      const name = readCString(tar, offset, 100);
      const magic = readCString(tar, offset + 257, 6);
      const prefix = magic.startsWith('ustar') ? readCString(tar, offset + 345, 155) : '';

      entries.push({
        path: pendingPath ?? (prefix ? `${prefix}/${name}` : name),
        headerOffset: offset,
        dataOffset,
        size,
        typeflag,
        sizeFromPax: pendingSizeFromPax,
      });
      pendingPath = undefined;
      pendingSizeFromPax = false;
    }

    offset = nextOffset;
  }

  if (entries.length === 0) {
    throw new Error('Pack archive contains no files.');
  }

  return entries;
}

function findPackageJsonEntry(entries: TarEntry[]): TarEntry {
  const candidates = entries
    .filter((entry) => entry.typeflag === TYPE_REGULAR || entry.typeflag === TYPE_REGULAR_LEGACY)
    .map((entry) => ({ entry, segments: entry.path.replace(/^(\.\/)+/, '').split('/') }))
    .filter(({ segments }) => segments[segments.length - 1] === 'package.json' && !segments.includes('node_modules'))
    .sort((left, right) => left.segments.length - right.segments.length);

  const match = candidates[0];

  if (!match || match.segments.length > 2) {
    throw new Error('Could not find the pack package.json inside the exported archive.');
  }

  if (match.entry.sizeFromPax) {
    throw new Error('The pack package.json uses an extended tar size header, which is not supported.');
  }

  return match.entry;
}

function replaceEntryData(tar: Uint8Array, entry: TarEntry, newData: Uint8Array): Uint8Array<ArrayBuffer> {
  const oldDataEnd = entry.dataOffset + roundUpToBlock(entry.size);
  const newDataEnd = entry.dataOffset + roundUpToBlock(newData.length);
  const output = new Uint8Array(newDataEnd + (tar.length - oldDataEnd));

  output.set(tar.subarray(0, entry.dataOffset), 0);
  output.set(encoder.encode(`${newData.length.toString(8).padStart(11, '0')}\0`), entry.headerOffset + 124);
  output.set(
    encoder.encode(`${computeHeaderChecksum(output, entry.headerOffset).toString(8).padStart(6, '0')}\0 `),
    entry.headerOffset + 148,
  );
  output.set(newData, entry.dataOffset);
  output.set(tar.subarray(oldDataEnd), newDataEnd);

  return output;
}

export function bumpPatchVersion(version: unknown): string {
  const match = typeof version === 'string' ? /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim()) : null;

  if (!match) {
    throw new Error(`Pack version "${String(version)}" is not a semantic version, so it cannot be bumped automatically.`);
  }

  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function applyPackMetadataEdits(
  packageJson: Record<string, unknown>,
  edits: PackMetadataEdits,
): { packageJson: Record<string, unknown>; warnings: string[] } {
  const next: Record<string, unknown> = { ...packageJson };
  const warnings: string[] = [];

  if (edits.displayName !== undefined) {
    next.displayName = edits.displayName;
  }

  if (edits.description !== undefined) {
    next.description = edits.description;
  }

  if (edits.author !== undefined) {
    next.author = edits.author;
  }

  if (edits.tags !== undefined) {
    if (packageJson.tags === undefined || Array.isArray(packageJson.tags)) {
      next.tags = edits.tags;
    } else {
      warnings.push('Tags were not changed because this pack stores tags as categories, which this editor does not support.');
    }
  }

  // Cribl rejects an upgrade to the same version ("Version x is up to date").
  next.version = bumpPatchVersion(packageJson.version);

  return { packageJson: next, warnings };
}

export async function rewritePackArchive(
  crbl: Uint8Array<ArrayBuffer>,
  edits: PackMetadataEdits,
): Promise<RewrittenPackArchive> {
  const isGzip = crbl.length >= 2 && crbl[0] === 0x1f && crbl[1] === 0x8b;
  const tar = isGzip ? await pipeBytes(crbl, new DecompressionStream('gzip')) : crbl;
  const entry = findPackageJsonEntry(listTarEntries(tar));

  let original: unknown;
  try {
    original = JSON.parse(decoder.decode(tar.subarray(entry.dataOffset, entry.dataOffset + entry.size)));
  } catch {
    throw new Error('The pack package.json is not valid JSON.');
  }

  if (typeof original !== 'object' || original === null || Array.isArray(original)) {
    throw new Error('The pack package.json is not a JSON object.');
  }

  const packageJson = original as Record<string, unknown>;
  const { packageJson: updated, warnings } = applyPackMetadataEdits(packageJson, edits);
  const rewrittenTar = replaceEntryData(tar, entry, encoder.encode(`${JSON.stringify(updated, null, 2)}\n`));

  return {
    archive: await pipeBytes(rewrittenTar, new CompressionStream('gzip')),
    previousVersion: String(packageJson.version),
    newVersion: String(updated.version),
    warnings,
  };
}
