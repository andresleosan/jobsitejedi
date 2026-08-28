import { deflateRawSync } from "node:zlib";
import { strict as assert } from "node:assert";
import test from "node:test";
import { parseSpreadsheet, SpreadsheetParseError } from "./spreadsheet.js";

const crc32 = (value: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const makeZip = (files: Record<string, string>): Buffer => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, source] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const uncompressed = Buffer.from(source, "utf8");
    const compressed = deflateRawSync(uncompressed);
    const checksum = crc32(uncompressed);
    const local = Buffer.alloc(30 + nameBuffer.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    compressed.copy(local, 30 + nameBuffer.length);
    localParts.push(local);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centralParts.length, 8);
  end.writeUInt16LE(centralParts.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
};

test("parses bounded CSV job imports and normalizes optional fields", () => {
  const content = [
    "Title,Description,Section",
    'Install vanity,"Double sink, oak",Bathroom',
    "Paint walls,,Living Room",
  ].join("\n");

  assert.deepEqual(parseSpreadsheet(Buffer.from(content), "text/csv", "jobs.csv"), [
    { title: "Install vanity", description: "Double sink, oak", section: "Bathroom" },
    { title: "Paint walls", description: null, section: "Living Room" },
  ]);
});

test("parses XLSX shared strings without evaluating formulas", () => {
  const sharedStrings = ["Title", "Description", "Section", "Tile shower", "Subway tiles", "Bathroom"];
  const sharedXml = `<sst>${sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`;
  const sheetXml = [
    "<worksheet><sheetData>",
    "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c><c r=\"C1\" t=\"s\"><v>2</v></c></row>",
    "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>3</v></c><c r=\"B2\" t=\"s\"><v>4</v></c><c r=\"C2\" t=\"s\"><v>5</v></c></row>",
    "</sheetData></worksheet>",
  ].join("");
  const buffer = makeZip({
    "xl/sharedStrings.xml": sharedXml,
    "xl/worksheets/sheet1.xml": sheetXml,
  });

  assert.deepEqual(
    parseSpreadsheet(
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "jobs.xlsx",
    ),
    [{ title: "Tile shower", description: "Subway tiles", section: "Bathroom" }],
  );
});

test("rejects formulas and unsupported file types", () => {
  const formulaSheet = makeZip({
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><f>IMPORTXML()</f><v>0</v></c></row></sheetData></worksheet>",
  });
  assert.throws(
    () => parseSpreadsheet(
      formulaSheet,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "jobs.xlsx",
    ),
    SpreadsheetParseError,
  );
  assert.throws(
    () => parseSpreadsheet(Buffer.from("data"), "application/octet-stream", "jobs.bin"),
    SpreadsheetParseError,
  );
});
