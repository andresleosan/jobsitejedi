"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const pdf_lib_1 = require("pdf-lib");
const sharp_1 = __importDefault(require("sharp"));
const invoice_file_js_1 = require("./invoice-file.js");
(0, node_test_1.describe)("invoice file sanitization", () => {
    (0, node_test_1.test)("parses and canonicalizes a PDF", async () => {
        const document = await pdf_lib_1.PDFDocument.create();
        document.addPage([200, 200]);
        const result = await (0, invoice_file_js_1.sanitizeInvoiceFile)(Buffer.from(await document.save()), "application/pdf", "supplier-invoice.pdf");
        strict_1.default.equal(result.contentType, "application/pdf");
        strict_1.default.equal(result.fileName, "invoice.pdf");
        strict_1.default.ok(result.bytes.subarray(0, 5).toString("ascii") === "%PDF-");
    });
    (0, node_test_1.test)("decodes and re-encodes an image without trusting its name", async () => {
        const source = await (0, sharp_1.default)({
            create: { width: 2, height: 2, channels: 3, background: "white" },
        }).png().toBuffer();
        const result = await (0, invoice_file_js_1.sanitizeInvoiceFile)(source, "image/png", "receipt.png");
        strict_1.default.equal(result.contentType, "image/png");
        strict_1.default.equal(result.fileName, "invoice.png");
        strict_1.default.notEqual(result.bytes, source);
    });
    (0, node_test_1.test)("rejects invalid bytes and forged MIME or extension", async () => {
        await strict_1.default.rejects((0, invoice_file_js_1.sanitizeInvoiceFile)(Buffer.from("not-an-image"), "image/png", "invoice.png"));
        const jpeg = await (0, sharp_1.default)({
            create: { width: 2, height: 2, channels: 3, background: "white" },
        }).jpeg().toBuffer();
        await strict_1.default.rejects((0, invoice_file_js_1.sanitizeInvoiceFile)(jpeg, "image/png", "invoice.png"));
        await strict_1.default.rejects((0, invoice_file_js_1.sanitizeInvoiceFile)(jpeg, "image/jpeg", "invoice.pdf"));
    });
    (0, node_test_1.test)("rejects PDF active-content markers", async () => {
        const document = await pdf_lib_1.PDFDocument.create();
        document.addPage([200, 200]);
        const bytes = Buffer.concat([
            Buffer.from(await document.save()),
            Buffer.from("\n/JavaScript\n%%EOF"),
        ]);
        await strict_1.default.rejects((0, invoice_file_js_1.sanitizeInvoiceFile)(bytes, "application/pdf", "invoice.pdf"), /active-content/);
    });
});
