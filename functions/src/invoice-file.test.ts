import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { sanitizeInvoiceFile } from "./invoice-file.js";

describe("invoice file sanitization", () => {
  test("parses and canonicalizes a PDF", async () => {
    const document = await PDFDocument.create();
    document.addPage([200, 200]);
    const result = await sanitizeInvoiceFile(
      Buffer.from(await document.save()),
      "application/pdf",
      "supplier-invoice.pdf",
    );

    assert.equal(result.contentType, "application/pdf");
    assert.equal(result.fileName, "invoice.pdf");
    assert.ok(result.bytes.subarray(0, 5).toString("ascii") === "%PDF-");
  });

  test("decodes and re-encodes an image without trusting its name", async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "white" },
    }).png().toBuffer();
    const result = await sanitizeInvoiceFile(source, "image/png", "receipt.png");

    assert.equal(result.contentType, "image/png");
    assert.equal(result.fileName, "invoice.png");
    assert.notEqual(result.bytes, source);
  });

  test("rejects invalid bytes and forged MIME or extension", async () => {
    await assert.rejects(
      sanitizeInvoiceFile(Buffer.from("not-an-image"), "image/png", "invoice.png"),
    );
    const jpeg = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "white" },
    }).jpeg().toBuffer();
    await assert.rejects(sanitizeInvoiceFile(jpeg, "image/png", "invoice.png"));
    await assert.rejects(sanitizeInvoiceFile(jpeg, "image/jpeg", "invoice.pdf"));
  });

  test("rejects PDF active-content markers", async () => {
    const document = await PDFDocument.create();
    document.addPage([200, 200]);
    const bytes = Buffer.concat([
      Buffer.from(await document.save()),
      Buffer.from("\n/JavaScript\n%%EOF"),
    ]);
    await assert.rejects(
      sanitizeInvoiceFile(bytes, "application/pdf", "invoice.pdf"),
      /active-content/,
    );
  });
});
