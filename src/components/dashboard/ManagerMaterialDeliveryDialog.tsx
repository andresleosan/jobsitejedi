import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Clock, Loader2, Package, Play, User, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  subscribeToMaterialDeliveryRequests,
  subscribeToStorageMaterials,
  updateMaterialDeliveryRequest,
  type MaterialDeliveryRequestRecord,
  type StorageMaterialRecord,
} from "@/lib/firebase/repositories/inventory";
import type { ProjectRecord } from "@/lib/firebase/repositories/projects";

interface ManagerMaterialDeliveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectRecord[];
}

type DeliveryFilter = "active" | "completed" | "all";

const statusLabel: Record<MaterialDeliveryRequestRecord["status"], string> = {
  pending: "Pending",
  in_progress: "In progress",
  delivered: "Delivered",
  rejected: "Rejected",
};

const ManagerMaterialDeliveryDialog = ({
  open,
  onOpenChange,
  projects,
}: ManagerMaterialDeliveryDialogProps) => {
  const [requests, setRequests] = useState<MaterialDeliveryRequestRecord[]>([]);
  const [materials, setMaterials] = useState<StorageMaterialRecord[]>([]);
  const [filter, setFilter] = useState<DeliveryFilter>("active");
  const [isLoading, setIsLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectingRequest, setRejectingRequest] = useState<MaterialDeliveryRequestRecord | null>(null);
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
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const filteredRequests = useMemo(() => requests.filter((request) => {
    if (filter === "active") return request.status === "pending" || request.status === "in_progress";
    if (filter === "completed") return request.status === "delivered" || request.status === "rejected";
    return true;
  }), [filter, requests]);
  const activeCount = requests.filter((request) =>
    request.status === "pending" || request.status === "in_progress").length;

  const transitionRequest = async (
    request: MaterialDeliveryRequestRecord,
    status: MaterialDeliveryRequestRecord["status"],
  ) => {
    setProcessingId(request.id);
    try {
      await updateMaterialDeliveryRequest({ requestId: request.id, status });
      toast({
        title: status === "delivered" ? "Delivery completed" : status === "rejected" ? "Request rejected" : "Delivery started",
        description: `${projectsById.get(request.projectId)?.name ?? "Project"} is now ${statusLabel[status].toLowerCase()}.`,
      });
    } catch (error) {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "The delivery status could not be updated.",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Material deliveries
            </DialogTitle>
            <DialogDescription>{activeCount} active request{activeCount === 1 ? "" : "s"}</DialogDescription>
          </DialogHeader>

          <Tabs value={filter} onValueChange={(value) => setFilter(value as DeliveryFilter)} className="min-h-0 flex-1">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="active">Active ({activeCount})</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
            <TabsContent value={filter} className="mt-4">
              <ScrollArea className="h-[560px] pr-3">
                {isLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin" /></div>
                ) : filteredRequests.length ? (
                  <div className="space-y-4">
                    {filteredRequests.map((request) => (
                      <article
                        key={request.id}
                        data-testid="delivery-request"
                        className="space-y-3 rounded-lg border bg-card p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{projectsById.get(request.projectId)?.name ?? "Unknown project"}</p>
                            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                              <User className="h-4 w-4" />
                              {request.requestedByName || request.userId}
                            </p>
                          </div>
                          <Badge variant={request.status === "rejected" ? "destructive" : "secondary"}>
                            {statusLabel[request.status]}
                          </Badge>
                        </div>

                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          {request.createdAt ? format(request.createdAt, "PPp") : "Just now"}
                        </p>

                        <div className="rounded-md bg-muted/60 p-3">
                          <p className="mb-2 text-sm font-medium">Materials requested</p>
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
                        </div>

                        {request.notes && <p className="text-sm text-muted-foreground">{request.notes}</p>}

                        {(request.status === "pending" || request.status === "in_progress") && (
                          <div className="flex flex-wrap gap-2 border-t pt-3">
                            {request.status === "pending" ? (
                              <Button
                                size="sm"
                                disabled={processingId === request.id}
                                onClick={() => transitionRequest(request, "in_progress")}
                              >
                                {processingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                Start delivery
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                disabled={processingId === request.id}
                                onClick={() => transitionRequest(request, "delivered")}
                              >
                                {processingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                Mark delivered
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              disabled={processingId === request.id}
                              onClick={() => setRejectingRequest(request)}
                            >
                              <XCircle className="h-4 w-4" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">No delivery requests in this view.</p>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(rejectingRequest)} onOpenChange={(nextOpen) => !nextOpen && setRejectingRequest(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this delivery request?</AlertDialogTitle>
            <AlertDialogDescription>
              This closes the request and cannot be undone from the dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep request</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (rejectingRequest) void transitionRequest(rejectingRequest, "rejected");
                setRejectingRequest(null);
              }}
            >
              Reject request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ManagerMaterialDeliveryDialog;
