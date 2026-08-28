import { useEffect, useState } from "react";
import { Building2, Loader2, Pencil, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  createSupplier,
  listSuppliers,
  updateSupplier,
  type SupplierRecord,
} from "@/lib/firebase/repositories/suppliers";

interface SupplierCatalogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SupplierCatalogDialog = ({ open, onOpenChange }: SupplierCatalogDialogProps) => {
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const loadSuppliers = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setSuppliers(await listSuppliers());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The supplier catalogue could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadSuppliers();
  }, [open]);

  const handleCreate = async () => {
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const supplier = await createSupplier({ name: newSupplierName });
      setNewSupplierName("");
      await loadSuppliers();
      toast({ title: "Supplier saved", description: `${supplier.name} is available for invoice submission.` });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The supplier could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = (supplier: SupplierRecord) => {
    setEditingId(supplier.id);
    setEditingName(supplier.name);
    setErrorMessage(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingName("");
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await updateSupplier(editingId, { name: editingName });
      cancelEditing();
      await loadSuppliers();
      toast({ title: "Supplier updated", description: "The display name was updated." });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The supplier could not be updated.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Supplier catalogue
          </DialogTitle>
          <DialogDescription>
            Maintain the names builders can choose when submitting invoices. Supplier records are kept for financial history.
          </DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        <section className="space-y-3 rounded-lg border bg-muted/30 p-4" aria-labelledby="supplier-create-heading">
          <div>
            <h2 id="supplier-create-heading" className="font-medium">Add supplier</h2>
            <p className="text-sm text-muted-foreground">Names are matched without case or accent differences.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="new-supplier-name">Supplier name</Label>
              <Input
                id="new-supplier-name"
                value={newSupplierName}
                maxLength={120}
                placeholder="Jedi Timber Supplies"
                disabled={isSaving}
                onChange={(event) => setNewSupplierName(event.target.value)}
              />
            </div>
            <Button disabled={isSaving || !newSupplierName.trim()} onClick={() => void handleCreate()}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" />}
              Add supplier
            </Button>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="supplier-list-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="supplier-list-heading" className="font-medium">Available suppliers</h2>
              <p className="text-sm text-muted-foreground">{suppliers.length} catalogue {suppliers.length === 1 ? "entry" : "entries"}</p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" /></div>
          ) : suppliers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No suppliers yet. Add the first catalogue entry above.
            </div>
          ) : (
            <div className="space-y-2">
              {suppliers.map((supplier) => (
                <article key={supplier.id} data-testid="supplier-catalog-entry" className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  {editingId === supplier.id ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1 space-y-2">
                        <Label htmlFor={`edit-supplier-${supplier.id}`}>Display name</Label>
                        <Input
                          id={`edit-supplier-${supplier.id}`}
                          value={editingName}
                          maxLength={120}
                          disabled={isSaving}
                          onChange={(event) => setEditingName(event.target.value)}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={isSaving || !editingName.trim()} onClick={() => void handleUpdate()}>
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" />}
                          Save
                        </Button>
                        <Button variant="ghost" size="sm" disabled={isSaving} onClick={cancelEditing}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <p className="truncate font-medium">{supplier.name}</p>
                      <p className="truncate text-xs text-muted-foreground">Canonical key: {supplier.normalizedName}</p>
                    </div>
                  )}
                  {editingId !== supplier.id && (
                    <Button variant="outline" size="sm" disabled={isSaving} onClick={() => startEditing(supplier)}>
                      <Pencil className="h-4 w-4" />
                      Edit name
                    </Button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
};

export default SupplierCatalogDialog;
