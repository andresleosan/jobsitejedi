import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Clock, Loader2, Package, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  createMaterialDeliveryRequest,
  subscribeToMaterialDeliveryRequests,
  subscribeToStorageMaterials,
  type MaterialDeliveryRequestRecord,
  type StorageMaterialRecord,
} from "@/lib/firebase/repositories/inventory";

interface MaterialDeliveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
}

interface SelectedMaterial {
  materialId: string;
  quantity: number;
}

const statusLabel: Record<MaterialDeliveryRequestRecord["status"], string> = {
  pending: "Pending",
  in_progress: "In progress",
  delivered: "Delivered",
  rejected: "Rejected",
};

const MaterialDeliveryDialog = ({
  open,
  onOpenChange,
  projectId,
  projectName,
}: MaterialDeliveryDialogProps) => {
  const [materials, setMaterials] = useState<StorageMaterialRecord[]>([]);
  const [requests, setRequests] = useState<MaterialDeliveryRequestRecord[]>([]);
  const [selectedItems, setSelectedItems] = useState<SelectedMaterial[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [notes, setNotes] = useState("");
  const [activeTab, setActiveTab] = useState("request");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stopRequests = () => undefined;
    setIsLoading(true);
    const reportError = (error: Error) => {
      if (stopped) return;
      setIsLoading(false);
      toast({ title: "Unable to load deliveries", description: error.message, variant: "destructive" });
    };
    const stopMaterials = subscribeToStorageMaterials((nextMaterials) => {
      if (!stopped) setMaterials(nextMaterials);
    }, reportError);
    void subscribeToMaterialDeliveryRequests((nextRequests) => {
      if (stopped) return;
      setRequests(nextRequests);
      setIsLoading(false);
    }, reportError).then((cleanup) => {
      if (stopped) cleanup();
      else stopRequests = cleanup;
    }).catch(reportError);
    return () => {
      stopped = true;
      stopMaterials();
      stopRequests();
    };
  }, [open, toast]);

  const materialsById = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  );
  const availableMaterials = useMemo(() => {
    const selectedIds = new Set(selectedItems.map((item) => item.materialId));
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return materials.filter((material) =>
      !selectedIds.has(material.id)
      && (!normalizedSearch
        || material.name.toLowerCase().includes(normalizedSearch)
        || material.category.toLowerCase().includes(normalizedSearch)),
    );
  }, [materials, searchTerm, selectedItems]);

  const addMaterial = (materialId: string) => {
    setSelectedItems((current) => [...current, { materialId, quantity: 1 }]);
    setSearchTerm("");
  };

  const updateQuantity = (materialId: string, value: string) => {
    const quantity = Number(value);
    setSelectedItems((current) => current.map((item) =>
      item.materialId === materialId
        ? { ...item, quantity: Number.isFinite(quantity) ? quantity : 0 }
        : item));
  };

  const submitRequest = async () => {
    if (!selectedItems.length || selectedItems.some((item) => item.quantity <= 0)) {
      toast({
        title: "Check material quantities",
        description: "Add at least one material and use quantities greater than zero.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      await createMaterialDeliveryRequest({ projectId, notes, items: selectedItems });
      setSelectedItems([]);
      setSearchTerm("");
      setNotes("");
      setActiveTab("history");
      toast({ title: "Delivery requested", description: "The yard team can now process this request." });
    } catch (error) {
      toast({
        title: "Request failed",
        description: error instanceof Error ? error.message : "The delivery request could not be created.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Request material delivery
          </DialogTitle>
          <DialogDescription>{projectName}</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="request">New request</TabsTrigger>
            <TabsTrigger value="history">My requests ({requests.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="request" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="delivery-material-search">Find a material</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="delivery-material-search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search the yard catalogue"
                  className="pl-9"
                />
              </div>
              <ScrollArea className="h-32 rounded-md border">
                <div className="p-1">
                  {availableMaterials.length ? availableMaterials.map((material) => (
                    <button
                      key={material.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => addMaterial(material.id)}
                    >
                      <span>{material.name}</span>
                      <span className="text-xs text-muted-foreground">{material.unit}</span>
                    </button>
                  )) : (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No more matching materials.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-2">
              <Label>Materials requested ({selectedItems.length})</Label>
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
                {selectedItems.length ? selectedItems.map((item) => {
                  const material = materialsById.get(item.materialId);
                  return (
                    <div key={item.materialId} className="flex items-center gap-2 rounded-md bg-muted/60 p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{material?.name ?? "Unknown material"}</p>
                        <p className="text-xs text-muted-foreground">{material?.unit ?? "units"}</p>
                      </div>
                      <Label htmlFor={`delivery-quantity-${item.materialId}`} className="sr-only">
                        Quantity for {material?.name ?? "material"}
                      </Label>
                      <Input
                        id={`delivery-quantity-${item.materialId}`}
                        type="number"
                        min="0.1"
                        max="1000000"
                        step="0.1"
                        value={item.quantity}
                        onChange={(event) => updateQuantity(item.materialId, event.target.value)}
                        className="w-24"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${material?.name ?? "material"}`}
                        onClick={() => setSelectedItems((current) =>
                          current.filter((selected) => selected.materialId !== item.materialId))}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  );
                }) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">Select materials above.</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delivery-notes">Notes (optional)</Label>
              <Textarea
                id="delivery-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={1000}
                placeholder="Access instructions or delivery details"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" onClick={submitRequest} disabled={isSubmitting || !selectedItems.length}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit request
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <ScrollArea className="h-[480px] pr-3">
              {isLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : requests.length ? (
                <div className="space-y-3">
                  {requests.map((request) => (
                    <div key={request.id} className="space-y-3 rounded-lg border bg-card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          {request.createdAt ? format(request.createdAt, "PPp") : "Just now"}
                        </span>
                        <Badge variant={request.status === "rejected" ? "destructive" : "secondary"}>
                          {statusLabel[request.status]}
                        </Badge>
                      </div>
                      <ul className="space-y-1 text-sm">
                        {request.items.map((item) => {
                          const material = materialsById.get(item.materialId);
                          return (
                            <li key={item.id} className="flex justify-between gap-3">
                              <span>{material?.name ?? "Unknown material"}</span>
                              <span className="text-muted-foreground">{item.quantity} {material?.unit ?? "units"}</span>
                            </li>
                          );
                        })}
                      </ul>
                      {request.notes && <p className="text-sm text-muted-foreground">{request.notes}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">No delivery requests yet.</p>
              )}
            </ScrollArea>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default MaterialDeliveryDialog;
