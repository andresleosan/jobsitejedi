import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { storage } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Sparkles } from "lucide-react";
import { z } from "zod";
import { Card } from "@/components/ui/card";

interface EnhancedInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  userId: string;
}

interface Supplier {
  id: string;
  name: string;
}

const EnhancedInvoiceDialog = ({ open, onOpenChange, projectId, userId }: EnhancedInvoiceDialogProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    invoice_number: "",
    date: new Date().toISOString().split("T")[0],
    total_amount: "",
    notes: "",
    supplier_id: "",
  });

  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchSuppliers();
    }
  }, [open]);

  const fetchSuppliers = async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .order("name");

    if (!error && data) {
      setSuppliers(data);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProcessWithAI = async () => {
    if (!selectedImage) {
      toast({
        title: "No image selected",
        description: "Please upload an invoice image first",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Upload image to Supabase Storage
      const fileName = `${Date.now()}-${selectedImage.name}`;
      await storage.upload("invoices", fileName, selectedImage);

      // Call edge function to process invoice
      const { data, error } = await supabase.functions.invoke("process-invoice", {
        body: {
          imageUrl: imagePreview,
          supplierId: formData.supplier_id || null,
        },
      });

      if (error) throw error;

      const extracted = data.extractedData;
      
      // Auto-fill form with extracted data
      setFormData({
        ...formData,
        invoice_number: extracted.invoice_number || formData.invoice_number,
        date: extracted.date || formData.date,
        total_amount: extracted.total_amount?.toString() || formData.total_amount,
        notes: extracted.line_items 
          ? `Extracted items:\n${extracted.line_items.map((item: any) => 
              `- ${item.description}: ${item.quantity} x £${item.unit_price}`
            ).join('\n')}`
          : formData.notes,
      });

      toast({
        title: "Invoice processed",
        description: "Data has been extracted from the invoice image",
      });
    } catch (error: any) {
      console.error("AI processing error:", error);
      toast({
        title: "Processing failed",
        description: error.message || "Failed to process invoice with AI",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate input with Zod schema
    const invoiceSchema = z.object({
      invoice_number: z.string().trim().min(1, "Invoice number is required").max(50, "Invoice number too long"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
      total_amount: z.string().refine((val) => {
        const num = parseFloat(val);
        return !isNaN(num) && num >= 0 && num <= 9999999.99;
      }, "Total amount must be a valid positive number"),
      notes: z.string().max(1000, "Notes too long").optional(),
      supplier_id: z.string().uuid().optional().or(z.literal("")),
    });

    try {
      const validated = invoiceSchema.parse(formData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({
          title: "Validation Error",
          description: error.errors[0].message,
          variant: "destructive",
        });
        return;
      }
    }

    setIsLoading(true);
    try {
      let imageUrl = null;
      
      if (selectedImage) {
        const fileName = `${Date.now()}-${selectedImage.name}`;
        await storage.upload("invoices", fileName, selectedImage, {
          cacheControl: '3600',
          upsert: false
        });

        // Store the file path (not signed URL) so we can generate signed URLs later
        imageUrl = fileName;
      }

      const { error } = await supabase.from("invoices").insert({
        project_id: projectId,
        invoice_number: formData.invoice_number,
        date: formData.date,
        total_amount: parseFloat(formData.total_amount),
        notes: formData.notes,
        uploaded_by: userId,
        supplier_id: formData.supplier_id || null,
        image_url: imageUrl,
        needs_review: !!imageUrl,
      });

      if (error) throw error;

      toast({
        title: "Invoice added",
        description: imageUrl 
          ? "Invoice has been uploaded and is ready for manager review"
          : "Invoice has been recorded successfully",
      });

      // Reset form
      setFormData({
        invoice_number: "",
        date: new Date().toISOString().split("T")[0],
        total_amount: "",
        notes: "",
        supplier_id: "",
      });
      setSelectedImage(null);
      setImagePreview(null);
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add invoice",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-2 flex-shrink-0">
          <DialogTitle>Add Invoice</DialogTitle>
          <DialogDescription>
            Upload an invoice image and let AI extract the data, or enter manually
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            <Card className="p-4 bg-accent/50">
              <Label htmlFor="invoice_image" className="block mb-2">
                Invoice Image
              </Label>
              <div className="space-y-3">
                <Input
                  id="invoice_image"
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  disabled={isLoading || isProcessing}
                />
                {imagePreview && (
                  <div className="space-y-2">
                    <img 
                      src={imagePreview} 
                      alt="Invoice preview" 
                      className="w-full h-48 object-contain border rounded"
                    />
                    <Button
                      type="button"
                      onClick={handleProcessWithAI}
                      disabled={isProcessing || isLoading}
                      className="w-full"
                      variant="secondary"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Processing with AI...
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Extract Data with AI
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            <div className="space-y-2">
              <Label htmlFor="supplier_id">Supplier (Optional)</Label>
              <Select
                value={formData.supplier_id}
                onValueChange={(value) => setFormData({ ...formData, supplier_id: value })}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoice_number">Invoice Number *</Label>
              <Input
                id="invoice_number"
                value={formData.invoice_number}
                onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
                placeholder="INV-001"
                disabled={isLoading}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                disabled={isLoading}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="total_amount">Total Amount (£) *</Label>
              <Input
                id="total_amount"
                type="number"
                step="0.01"
                value={formData.total_amount}
                onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
                placeholder="1500.00"
                disabled={isLoading}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Invoice details..."
                disabled={isLoading}
                rows={3}
              />
            </div>
          </div>

          <div className="flex gap-3 justify-end px-4 py-3 border-t bg-background flex-shrink-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Upload className="mr-2 h-4 w-4" />
              Add Invoice
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EnhancedInvoiceDialog;
