import { inflateRawSync } from "node:zlib";

export interface ImportedJob {
  title: string;
  description: string | null;
  section: string | null;
}

export const MAX_SPREADSHEET_BYTES = 5 * 1024 * 1024;
export const MAX_SPREADSHEET_ROWS = 500;
export const MAX_SPREADSHEET_COLUMNS = 16;
export const MAX_SPREADSHEET_CELL_LENGTH = 2_000;

const MAX_ZIP_ENTRIES = 100;
const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

export class SpreadsheetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetParseError";
  }
}

const fail = (message: string): never => {
  throw new SpreadsheetParseError(message);
};

const decodeUtf8 = (value: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return fail("Spreadsheet text is not valid UTF-8");
  }
};

const cleanCell = (value: string): string => {
  if ([...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint < 32 && codePoint !== 9 && codePoint !== 10) || codePoint === 127;
  })) {
    return fail("Spreadsheet contains invalid control characters");
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length > MAX_SPREADSHEET_CELL_LENGTH) {
    return fail("Spreadsheet cell is too long");
  }
  return normalized;
};

const parseCsv = (source: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const pushRow = () => {
    row.push(cleanCell(cell));
    if (row.length > MAX_SPREADSHEET_COLUMNS) fail("Spreadsheet has too many columns");
    rows.push(row);
    if (rows.length > MAX_SPREADSHEET_ROWS + 1) fail("Spreadsheet has too many rows");
    row = [];
    cell = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === "," || character === "\t") {
      row.push(cleanCell(cell));
      if (row.length > MAX_SPREADSHEET_COLUMNS) fail("Spreadsheet has too many columns");
      cell = "";
    } else if (character === "\n") {
      pushRow();
    } else if (character === "\r") {
      if (source[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      cell += character;
    }
  }

  if (quoted) fail("Spreadsheet contains an unterminated quoted cell");
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
};

const normalizeHeader = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const HEADER_ALIASES = {
  title: new Set(["title", "job", "job title", "job name", "task", "work", "trabajo", "tarea", "titulo", "nombre del trabajo"]),
  description: new Set(["description", "details", "detail", "notes", "descripcion", "detalles", "notas"]),
  section: new Set(["section", "area", "room", "category", "seccion", "area de trabajo", "habitacion", "categoria"]),
};

const rowsToJobs = (rows: string[][]): ImportedJob[] => {
  if (rows.length === 0) return [];
  const headerRow = rows.findIndex((candidate) => candidate.some(Boolean));
  if (headerRow === -1) return [];

  const headers = rows[headerRow].map(normalizeHeader);
  const titleIndex = headers.findIndex((header) => HEADER_ALIASES.title.has(header));
  const descriptionIndex = headers.findIndex((header) => HEADER_ALIASES.description.has(header));
  const sectionIndex = headers.findIndex((header) => HEADER_ALIASES.section.has(header));
  const hasHeader = titleIndex >= 0;
  const effectiveTitleIndex = hasHeader ? titleIndex : 0;
  const firstDataRow = hasHeader ? headerRow + 1 : headerRow;
  const jobs: ImportedJob[] = [];

  for (const candidate of rows.slice(firstDataRow)) {
    const title = cleanCell(candidate[effectiveTitleIndex] ?? "");
    if (!title) continue;
    if (jobs.length >= MAX_SPREADSHEET_ROWS) fail("Spreadsheet has too many jobs");
    jobs.push({
      title,
      description: descriptionIndex >= 0 ? cleanCell(candidate[descriptionIndex] ?? "") || null : null,
      section: sectionIndex >= 0 ? cleanCell(candidate[sectionIndex] ?? "") || null : null,
    });
  }

  return jobs;
};

const decodeXml = (value: string): string => value
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));

const xmlAttribute = (attributes: string, name: string): string | null => {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`));
  return match?.[1] ?? null;
};

const columnNumber = (letters: string): number => {
  let result = 0;
  for (const character of letters) {
    result = result * 26 + character.charCodeAt(0) - 64;
    if (result > MAX_SPREADSHEET_COLUMNS) fail("Spreadsheet has too many columns");
  }
  return result;
};

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const readZipEntries = (buffer: Buffer): ZipEntry[] => {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  const minimumEocdSize = 22;
  if (buffer.length < minimumEocdSize) fail("Spreadsheet ZIP container is invalid");
  const searchStart = Math.max(0, buffer.length - minimumEocdSize - 0xffff);
  for (let offset = buffer.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) fail("Spreadsheet ZIP container is invalid");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES) fail("Spreadsheet ZIP has too many entries");
  if (
    centralDirectoryOffset + centralDirectorySize > buffer.length
    || centralDirectoryOffset >= eocdOffset
  ) fail("Spreadsheet ZIP directory is invalid");

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      fail("Spreadsheet ZIP entry is invalid");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength + extraLength + commentLength > buffer.length) {
      fail("Spreadsheet ZIP entry is invalid");
    }
    const name = decodeUtf8(buffer.subarray(offset + 46, offset + 46 + nameLength));
    if (
      !name
      || name.includes("..")
      || name.startsWith("/")
      || (flags & 1) !== 0
      || (method !== 0 && method !== 8)
      || uncompressedSize > MAX_XML_BYTES
      || compressedSize > MAX_XML_BYTES
      || (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)
    ) {
      fail("Spreadsheet ZIP entry is not supported");
    }
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const readZipEntry = (buffer: Buffer, entry: ZipEntry): string => {
  if (entry.localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
    fail("Spreadsheet ZIP local entry is invalid");
  }
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataOffset < 0 || dataEnd > buffer.length) fail("Spreadsheet ZIP data is invalid");

  const compressed = buffer.subarray(dataOffset, dataEnd);
  let content: Buffer;
  try {
    content = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_XML_BYTES });
  } catch {
    return fail("Spreadsheet ZIP entry could not be decompressed");
  }
  if (content.length !== entry.uncompressedSize || content.length > MAX_XML_BYTES) {
    fail("Spreadsheet XML size is invalid");
  }
  return decodeUtf8(content);
};

const parseXlsx = (buffer: Buffer): string[][] => {
  const entries = readZipEntries(buffer);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const sheetEntry = byName.get("xl/worksheets/sheet1.xml")
    ?? fail("Spreadsheet does not contain a first worksheet");

  const sharedStrings = byName.has("xl/sharedStrings.xml")
    ? [...readZipEntry(buffer, byName.get("xl/sharedStrings.xml")!).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)]
      .map((match) => [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
        .map((textMatch) => decodeXml(textMatch[1]))
        .join(""))
    : [];
  const sheetXml = readZipEntry(buffer, sheetEntry);
  const rows: string[][] = [];

  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length > MAX_SPREADSHEET_ROWS) fail("Spreadsheet has too many rows");
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const address = xmlAttribute(attributes, "r") ?? fail("Spreadsheet cell has no address");
      const columnMatch = address.match(/^([A-Z]+)\d+$/i)
        ?? fail("Spreadsheet cell address is invalid");
      const index = columnNumber(columnMatch[1].toUpperCase()) - 1;
      if (row[index] !== undefined) fail("Spreadsheet contains duplicate cells");

      const content = cellMatch[2] ?? "";
      if (/<f(?:\s|>)/i.test(content)) fail("Spreadsheet formulas are not accepted");
      const type = xmlAttribute(attributes, "t");
      let value = "";
      if (type === "inlineStr") {
        value = [...content.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
          .map((match) => decodeXml(match[1]))
          .join("");
      } else {
        const valueMatch = content.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
        value = valueMatch?.[1] ?? "";
        if (type === "s") {
          const sharedIndex = Number.parseInt(value, 10);
          if (
            !Number.isSafeInteger(sharedIndex)
            || sharedIndex < 0
            || sharedIndex >= sharedStrings.length
          ) {
            fail("Spreadsheet shared string index is invalid");
          }
          value = sharedStrings[sharedIndex];
        } else {
          value = decodeXml(value);
        }
      }
      row[index] = cleanCell(value);
    }
    rows.push(row);
  }
  return rows;
};

export const parseSpreadsheet = (
  buffer: Buffer,
  contentType: string,
  fileName: string,
): ImportedJob[] => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_SPREADSHEET_BYTES) {
    fail("Spreadsheet size is invalid");
  }
  const normalizedName = fileName.trim().toLowerCase();
  const extension = normalizedName.slice(normalizedName.lastIndexOf("."));
  const normalizedContentType = contentType.trim().toLowerCase();
  const isCsv = extension === ".csv" || extension === ".tsv"
    || normalizedContentType === "text/csv"
    || normalizedContentType === "text/tab-separated-values";
  const isXlsx = extension === ".xlsx"
    || normalizedContentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  if (!isCsv && !isXlsx) fail("Only CSV, TSV or XLSX files are supported");
  const source = isCsv ? decodeUtf8(buffer).replace(/^\uFEFF/, "") : null;
  return rowsToJobs(source === null ? parseXlsx(buffer) : parseCsv(source));
};
