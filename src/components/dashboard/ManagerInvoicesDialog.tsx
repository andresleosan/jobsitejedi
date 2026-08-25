import { useEffect, useMemo, useState } from "react";
import { CalendarDays, FileText, Loader2, ReceiptText, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createInvoiceObjectUrl,
  formatInvoiceAmount,
  reviewInvoice,
  subscribeToInvoices,
  type InvoiceRecord,
  type InvoiceStatus,
} from "@/lib/firebase/repositories/invoices";
import { useToast } from "@/hooks/use-toast";

interface ManagerInvoicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Filter = "submitted" | "approved" | "rejected" | "all";

const statusBadge = (status: InvoiceStatus) => {
  if (status === "approved") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Pending review</Badge>;
};

const ManagerInvoicesDialog = ({ open, onOpenChange }: ManagerInvoicesDialogProps) => {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("submitted");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const visibleInvoices = useMemo(
    () => invoices.filter((invoice) => filter === "all" || invoice.status === filter),
    [filter, invoices],
  );
  const pendingCount = invoices.filter((invoice) => invoice.status === "submitted").length;

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

  const handleReview = async (invoice: InvoiceRecord, status: "approved" | "rejected") => {
    setReviewingId(invoice.id);
    setErrorMessage(null);
    try {
      await reviewInvoice({
        invoiceId: invoice.id,
        status,
        reviewNotes: reviewNotes[invoice.id] ?? null,
      });
      toast({
        title: status === "approved" ? "Invoice approved" : "Invoice rejected",
        description: `${invoice.invoiceNumber} was ${status}.`,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The invoice review could not be saved.");
    } finally {
      setReviewingId(null);
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
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ReceiptText className="h-5 w-5 text-primary" />
            Invoice review
            {pendingCount > 0 && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{pendingCount} pending</Badge>}
          </DialogTitle>
          <DialogDescription>Review project-linked amounts and their private source files.</DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="submitted">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin motion-reduce:animate-none" /></div>
        ) : visibleInvoices.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            No {filter === "all" ? "" : filter} invoices.
          </div>
        ) : (
          <div className="space-y-4">
            {visibleInvoices.map((invoice) => (
              <article key={invoice.id} data-testid="invoice-review" className="space-y-3 rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold tabular-nums text-primary">{formatInvoiceAmount(invoice.totalAmountMinor)}</p>
                    <p className="font-medium">{invoice.supplierName}</p>
                    <p className="text-sm text-muted-foreground">{invoice.invoiceNumber} · {invoice.projectName}</p>
                  </div>
                  {statusBadge(invoice.status)}
                </div>

                <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />Invoice date {invoice.invoiceDate}</p>
                  <p className="flex items-center gap-2"><User className="h-4 w-4" />{invoice.uploadedByName ?? invoice.uploadedBy}</p>
                </div>
                {invoice.notes && <p className="rounded-md bg-muted/60 p-3 text-sm">{invoice.notes}</p>}

                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <Button variant="outline" size="sm" disabled={openingId === invoice.id} onClick={() => void openDocument(invoice)}>
                    {openingId === invoice.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileText className="h-4 w-4" />}
                    Download invoice
                  </Button>
                </div>

                {invoice.status === "submitted" ? (
                  <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                    <Textarea
                      aria-label={`Review notes for ${invoice.invoiceNumber}`}
                      value={reviewNotes[invoice.id] ?? ""}
                      maxLength={1_000}
                      rows={2}
                      placeholder="Optional review note"
                      onChange={(event) => setReviewNotes((current) => ({ ...current, [invoice.id]: event.target.value }))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={reviewingId === invoice.id} onClick={() => void handleReview(invoice, "approved")}>
                        {reviewingId === invoice.id && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                        Approve invoice
                      </Button>
                      <Button variant="destructive" size="sm" disabled={reviewingId === invoice.id} onClick={() => void handleReview(invoice, "rejected")}>
                        Reject invoice
                      </Button>
                    </div>
                  </div>
                ) : invoice.reviewNotes ? (
                  <p className="rounded-md bg-muted/60 p-3 text-sm">Review note: {invoice.reviewNotes}</p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ManagerInvoicesDialog;
