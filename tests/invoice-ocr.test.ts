import { describe, expect, it } from "vitest";
import { extractInvoiceOcr, parseInvoiceOcrText } from "../src/lib/ocr/invoice";

describe("invoice OCR parsing", () => {
  it("extracts conservative suggestions from a UK invoice layout", () => {
    expect(parseInvoiceOcrText(`
      Jedi Timber Supplies
      Invoice Number: INV-2048
      Invoice Date: 24/08/2026
      Total: \u00a31,234.56
    `)).toMatchObject({
      invoiceNumber: "INV-2048",
      supplierName: "Jedi Timber Supplies",
      invoiceDate: "2026-08-24",
      amount: "1234.56",
    });
  });

  it("does not invent invalid dates or amounts", () => {
    expect(parseInvoiceOcrText("Invoice Date: 31/02/2026\nTotal: \u00a30")).toMatchObject({
      invoiceDate: null,
      amount: null,
    });
  });

  it("keeps PDF uploads on the manual path", async () => {
    const pdf = new File(["%PDF"], "invoice.pdf", { type: "application/pdf" });
    await expect(extractInvoiceOcr(pdf)).rejects.toThrow("enter PDF fields manually");
  });
});
