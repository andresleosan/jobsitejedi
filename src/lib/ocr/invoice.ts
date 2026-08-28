export interface InvoiceOcrSuggestions {
  text: string;
  invoiceNumber: string | null;
  supplierName: string | null;
  invoiceDate: string | null;
  amount: string | null;
}

type ProgressCallback = (progress: number) => void;

const MAX_OCR_FILE_SIZE = 10 * 1024 * 1024;
const DATE_PATTERN = /(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/;
const AMOUNT_PATTERN = /(?:\u00a3|GBP)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;
const INVOICE_NUMBER_PATTERN = /(?:invoice\s*(?:number|no\.?|#)|inv\.?\s*(?:number|no\.?|#)|reference)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{1,79})/i;

const cleanLine = (line: string) => line.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();

const isRealDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const toIsoDate = (value: string): string | null => {
  const parts = value.split(/[./-]/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;

  const [first, second, third] = parts;
  const year = first > 31 ? first : third < 100 ? 2000 + third : third;
  const month = second;
  const day = first > 31 ? third : first;
  if (!isRealDate(year, month, day)) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
};

const valueAfterLabel = (line: string, labels: RegExp) => {
  const match = labels.exec(line);
  return match?.[1]?.replace(/^[\s:#-]+/, "").trim() || null;
};

const parseAmount = (line: string): string | null => {
  const matches = [...line.matchAll(AMOUNT_PATTERN)];
  const candidate = matches.at(-1)?.[1];
  if (!candidate) return null;
  const value = Number(candidate.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000_000) return null;
  return value.toFixed(2);
};

export const parseInvoiceOcrText = (text: string): InvoiceOcrSuggestions => {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const invoiceNumber = text.match(INVOICE_NUMBER_PATTERN)?.[1]?.trim() ?? null;
  const dateLine = lines.find((line) => /\b(?:invoice\s+date|date)\b/i.test(line));
  const dateValue = dateLine?.match(DATE_PATTERN)?.[1];
  const invoiceDate = dateValue ? toIsoDate(dateValue) : null;
  const totalLine = lines.find((line) => /\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|total)\b/i.test(line));
  const amount = totalLine ? parseAmount(totalLine) : null;
  const supplierLine = lines.find((line) => /^(?:supplier|vendor|from|company)\b/i.test(line));
  const supplierName = valueAfterLabel(supplierLine ?? "", /^(?:supplier|vendor|from|company)\b(.*)$/i)
    ?? lines.find((line) => /[A-Za-z]{3}/.test(line) && !/^(?:invoice|tax invoice|bill|date|total|subtotal|vat|amount|due|address|phone|email)\b/i.test(line))
    ?? null;

  return {
    text: text.trim(),
    invoiceNumber,
    supplierName: supplierName?.slice(0, 120) ?? null,
    invoiceDate,
    amount,
  };
};

export const extractInvoiceOcr = async (
  file: File,
  onProgress?: ProgressCallback,
): Promise<InvoiceOcrSuggestions> => {
  if (!file.type.startsWith("image/")) throw new Error("OCR is available for invoice images; enter PDF fields manually.");
  if (file.size <= 0 || file.size >= MAX_OCR_FILE_SIZE) throw new Error("The invoice image must be smaller than 10 MB.");

  onProgress?.(0);
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (message) => onProgress?.(Math.round(message.progress * 100)),
  });
  try {
    const result = await worker.recognize(file);
    onProgress?.(100);
    return parseInvoiceOcrText(result.data.text);
  } finally {
    await worker.terminate();
  }
};
