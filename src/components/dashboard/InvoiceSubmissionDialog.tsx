import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarDays, FileText, Loader2, Paperclip, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  createInvoiceObjectUrl,
  formatInvoiceAmount,
  parseAmountToMinor,
  submitInvoice,
  subscribeToInvoices,
  type InvoiceRecord,
} from "@/lib/firebase/repositories/invoices";
import { listSuppliers, type SupplierRecord } from "@/lib/firebase/repositories/suppliers";

interface InvoiceSubmissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
}

const statusBadge = (status: InvoiceRecord["status"]) => {
  if (status === "approved") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Pending review</Badge>;
};

const MANUAL_SUPPLIER_VALUE = "__manual__";

const InvoiceSubmissionDialog = ({
  open,
  onOpenChange,
  projectId,
  projectName,
}: InvoiceSubmissionDialogProps) => {
  const [activeTab, setActiveTab] = useState("submit");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierMode, setSupplierMode] = useState(MANUAL_SUPPLIER_VALUE);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);
  const [supplierCatalogError, setSupplierCatalogError] = useState<string | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const { toast } = useToast();
  const projectInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.projectId === projectId),
    [invoices, projectId],
  );

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let unsubscribe = () => undefined;
    setIsLoading(true);
    const reportError = (error: Error) => {
      if (stopped) return;
      setIsLoading(false);
      setErrorMessage(error.message);
    };
    void subscribeToInvoices((nextInvoices) => {
      if (stopped) return;
      setInvoices(nextInvoices);
      setIsLoading(false);
    }, reportError).then((cleanup) => {
      if (stopped) cleanup();
      else unsubscribe = cleanup;
    }).catch(reportError);
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    setIsLoadingSuppliers(true);
    setSupplierCatalogError(null);
    void listSuppliers().then((nextSuppliers) => {
      if (stopped) return;
      setSuppliers(nextSuppliers);
    }).catch(() => {
      if (stopped) return;
      setSupplierCatalogError("Supplier catalogue is unavailable; enter the supplier manually.");
    }).finally(() => {
      if (!stopped) setIsLoadingSuppliers(false);
    });
    return () => {
      stopped = true;
    };
  }, [open]);

  const resetForm = () => {
    setInvoiceNumber("");
    setSupplierName("");
    setSupplierMode(MANUAL_SUPPLIER_VALUE);
    setInvoiceDate(format(new Date(), "yyyy-MM-dd"));
    setAmount("");
    setNotes("");
    setFile(null);
    setFileInputKey((value) => value + 1);
  };

  const handleSubmit = async () => {
    setErrorMessage(null);
    if (!file) {
      setErrorMessage("Choose an invoice image or PDF before submitting.");
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await submitInvoice({
        projectId,
        invoiceNumber,
        supplierName,
        invoiceDate,
        totalAmountMinor: parseAmountToMinor(amount),
        notes,
        file,
      });
      resetForm();
      setActiveTab("history");
      toast({
        title: "Invoice submitted",
        description: `${created.invoiceNumber} is ready for manager review.`,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The invoice could not be submitted.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDocument = async (invoice: InvoiceRecord) => {
    setOpeningId(invoice.id);
    setErrorMessage(null);
    try {
      const url = await createInvoiceObjectUrl(invoice);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = invoice.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The private file could not be opened.");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-primary" />
            Project invoices
          </DialogTitle>
          <DialogDescription>
            Submit a private receipt for {projectName}. Amounts are recorded in GBP.
          </DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="submit">Submit invoice</TabsTrigger>
            <TabsTrigger value="history">History ({projectInvoices.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="submit" className="space-y-4 pt-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invoice-number">Invoice number</Label>
                <Input
                  id="invoice-number"
                  value={invoiceNumber}
                  maxLength={80}
                  placeholder="INV-2048"
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={supplierMode === MANUAL_SUPPLIER_VALUE ? "invoice-supplier" : "invoice-supplier-select"}>
                  Supplier
                </Label>
                <Select
                  value={supplierMode === MANUAL_SUPPLIER_VALUE ? MANUAL_SUPPLIER_VALUE : supplierName}
                  onValueChange={(value) => {
                    setSupplierMode(value);
                    setSupplierName(value === MANUAL_SUPPLIER_VALUE ? "" : value);
                  }}
                  disabled={isLoadingSuppliers || isSubmitting}
                >
                  <SelectTrigger id="invoice-supplier-select" aria-label="Invoice supplier">
                    <SelectValue placeholder={isLoadingSuppliers ? "Loading suppliers..." : "Choose a supplier"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={MANUAL_SUPPLIER_VALUE}>Enter supplier manually</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.name}>{supplier.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {supplierMode === MANUAL_SUPPLIER_VALUE && (
                  <Input
                    id="invoice-supplier"
                    value={supplierName}
                    maxLength={120}
                    placeholder="Supplier name"
                    autoComplete="organization"
                    onChange={(event) => setSupplierName(event.target.value)}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {supplierCatalogError ?? (suppliers.length > 0
                    ? "Choose a catalogue supplier or enter a different name."
                    : "No catalogue suppliers yet; enter the name manually.")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-date">Invoice date</Label>
                <Input
                  id="invoice-date"
                  type="date"
                  value={invoiceDate}
                  onChange={(event) => setInvoiceDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-amount">Total amount (GBP)</Label>
                <Input
                  id="invoice-amount"
                  inputMode="decimal"
                  value={amount}
                  placeholder="1250.00"
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoice-file">Invoice file</Label>
              <Input
                key={fileInputKey}
                id="invoice-file"
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Image or PDF, smaller than 10 MB. The file becomes private audit evidence after submission.
              </p>
              {file && <p className="flex items-center gap-2 text-sm"><Paperclip className="h-4 w-4" />{file.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoice-notes">Notes (optional)</Label>
              <Textarea
                id="invoice-notes"
                value={notes}
                maxLength={1_000}
                rows={3}
                placeholder="Purchase order, delivery reference, or context for the manager."
                onChange={(event) => setNotes(event.target.value)}
              />
              <p className="text-right text-xs text-muted-foreground">{notes.length}/1000</p>
            </div>

            <Button
              className="w-full"
              disabled={isSubmitting || !projectId}
              onClick={handleSubmit}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
              {isSubmitting ? "Submitting..." : "Submit invoice"}
            </Button>
          </TabsContent>

          <TabsContent value="history" className="space-y-3 pt-3">
            {isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" /></div>
            ) : projectInvoices.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No invoices submitted yet.
              </div>
            ) : projectInvoices.map((invoice) => (
              <article key={invoice.id} data-testid="invoice-record" className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-lg font-semibold tabular-nums text-primary">{formatInvoiceAmount(invoice.totalAmountMinor)}</p>
                    <p className="font-medium">{invoice.supplierName}</p>
                    <p className="text-sm text-muted-foreground">{invoice.invoiceNumber} · {invoice.projectName}</p>
                  </div>
                  {statusBadge(invoice.status)}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{invoice.invoiceDate}</span>
                  <Button variant="ghost" size="sm" disabled={openingId === invoice.id} onClick={() => void openDocument(invoice)}>
                    {openingId === invoice.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileText className="h-4 w-4" />}
                    Download copy
                  </Button>
                </div>
                {invoice.reviewNotes && <p className="mt-2 rounded-md bg-muted/60 p-2 text-sm">Manager note: {invoice.reviewNotes}</p>}
              </article>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default InvoiceSubmissionDialog;
