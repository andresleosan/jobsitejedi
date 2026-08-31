"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeInvoiceFile = exports.MAX_INVOICE_FILE_BYTES = void 0;
const pdf_lib_1 = require("pdf-lib");
const sharp_1 = __importDefault(require("sharp"));
exports.MAX_INVOICE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_INVOICE_PIXELS = 40_000_000;
const MAX_INVOICE_PAGES = 100;
const extensionsByType = {
    "application/pdf": new Set(["pdf"]),
    "image/jpeg": new Set(["jpg", "jpeg"]),
    "image/png": new Set(["png"]),
    "image/webp": new Set(["webp"]),
};
const extensionOf = (fileName) => {
    const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
    return match?.[1].toLowerCase() ?? "";
};
const assertDeclaredType = (contentType, claimedContentType, originalFileName) => {
    if (claimedContentType.trim().toLowerCase() !== contentType) {
        throw new Error("Invoice content does not match its declared MIME type");
    }
    if (!extensionsByType[contentType].has(extensionOf(originalFileName))) {
        throw new Error("Invoice content does not match its declared extension");
    }
};
const sanitizePdf = async (input, claimedContentType, originalFileName) => {
    assertDeclaredType("application/pdf", claimedContentType, originalFileName);
    const source = input.toString("latin1");
    if (!source.startsWith("%PDF-") || !/%%EOF[\s\0]*$/.test(source)) {
        throw new Error("PDF structure is incomplete");
    }
    if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA)\b/.test(source)) {
        throw new Error("PDF contains an unsupported active-content feature");
    }
    const document = await pdf_lib_1.PDFDocument.load(input, {
        ignoreEncryption: false,
        throwOnInvalidObject: true,
        updateMetadata: false,
    });
    const pageCount = document.getPageCount();
    if (pageCount < 1 || pageCount > MAX_INVOICE_PAGES) {
        throw new Error("PDF page count is outside the allowed range");
    }
    const bytes = Buffer.from(await document.save({
        addDefaultPage: false,
        useObjectStreams: true,
        updateFieldAppearances: false,
    }));
    if (bytes.length <= 0 || bytes.length >= exports.MAX_INVOICE_FILE_BYTES) {
        throw new Error("Sanitized PDF is outside the allowed size range");
    }
    return { bytes, contentType: "application/pdf", extension: "pdf", fileName: "invoice.pdf" };
};
const sanitizeImage = async (input, claimedContentType, originalFileName) => {
    const image = (0, sharp_1.default)(input, {
        failOn: "warning",
        limitInputPixels: MAX_INVOICE_PIXELS,
        limitInputChannels: 4,
        pages: 1,
        sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (!metadata.width
        || !metadata.height
        || metadata.width * metadata.height > MAX_INVOICE_PIXELS
        || (metadata.pages ?? 1) !== 1) {
        throw new Error("Image dimensions or page count are invalid");
    }
    let contentType;
    let extension;
    let output;
    if (metadata.format === "jpeg") {
        contentType = "image/jpeg";
        extension = "jpg";
        output = image.rotate().jpeg({ quality: 95, progressive: false });
    }
    else if (metadata.format === "png") {
        contentType = "image/png";
        extension = "png";
        output = image.rotate().png({ compressionLevel: 9, progressive: false });
    }
    else if (metadata.format === "webp") {
        contentType = "image/webp";
        extension = "webp";
        output = image.rotate().webp({ quality: 95 });
    }
    else {
        throw new Error("Invoice image format is not supported");
    }
    assertDeclaredType(contentType, claimedContentType, originalFileName);
    const bytes = await output.toBuffer();
    if (bytes.length <= 0 || bytes.length >= exports.MAX_INVOICE_FILE_BYTES) {
        throw new Error("Sanitized image is outside the allowed size range");
    }
    return { bytes, contentType, extension, fileName: `invoice.${extension}` };
};
const sanitizeInvoiceFile = async (input, claimedContentType, originalFileName) => {
    if (!Buffer.isBuffer(input) || input.length <= 0 || input.length >= exports.MAX_INVOICE_FILE_BYTES) {
        throw new Error("Invoice file is outside the allowed size range");
    }
    if (input.subarray(0, 5).toString("ascii") === "%PDF-") {
        return sanitizePdf(input, claimedContentType, originalFileName);
    }
    return sanitizeImage(input, claimedContentType, originalFileName);
};
exports.sanitizeInvoiceFile = sanitizeInvoiceFile;
