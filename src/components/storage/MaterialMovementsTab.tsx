import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, ClipboardCheck, Loader2, PackageMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  recordMaterialUsage,
  subscribeToMaterialTransfers,
  subscribeToMaterialUsage,
  subscribeToStorageMaterials,
  transferMaterial,
  type MaterialTransferRecord,
  type MaterialUsageRecord,
  type StorageMaterialRecord,
} from "@/lib/firebase/repositories/inventory";
import { listProjects, type ProjectRecord } from "@/lib/firebase/repositories/projects";

type MovementType = "transfer" | "usage";

interface MovementView {
  id: string;
  type: MovementType;
  materialId: string;
  materialName: string | null;
  materialUnit: string | null;
  projectId: string;
  projectName: string | null;
  quantity: number;
  actorName: string | null;
  occurredAt: Date | null;
  usageDate: string | null;
  notes: string | null;
}

const localDate = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateTime = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value)
    : "Syncing timestamp…";

const MaterialMovementsTab = () => {
  const [materials, setMaterials] = useState<StorageMaterialRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [transfers, setTransfers] = useState<MaterialTransferRecord[]>([]);
  const [usage, setUsage] = useState<MaterialUsageRecord[]>([]);
  const [movementType, setMovementType] = useState<MovementType>("transfer");
  const [materialId, setMaterialId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [usageDate, setUsageDate] = useState(localDate);
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let disposed = false;
    let unsubscribeTransfers: (() => void) | undefined;
    let unsubscribeUsage: (() => void) | undefined;

    const reportLoadError = (description: string) => {
      if (!disposed) toast({ title: "Unable to load movements", description, variant: "destructive" });
    };

    const unsubscribeMaterials = subscribeToStorageMaterials(
      (records) => {
        if (!disposed) setMaterials(records);
      },
      () => reportLoadError("The material catalogue could not be loaded."),
    );

    void listProjects()
      .then((records) => {
        if (!disposed) setProjects(records);
      })
      .catch(() => reportLoadError("Projects could not be loaded."))
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });

    void subscribeToMaterialTransfers(
      (records) => {
        if (!disposed) setTransfers(records);
      },
      () => reportLoadError("Transfer history could not be loaded."),
    ).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else unsubscribeTransfers = unsubscribe;
    }).catch(() => reportLoadError("Transfer history could not be loaded."));

    void subscribeToMaterialUsage(
      (records) => {
        if (!disposed) setUsage(records);
      },
      () => reportLoadError("Usage history could not be loaded."),
    ).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else unsubscribeUsage = unsubscribe;
    }).catch(() => reportLoadError("Usage history could not be loaded."));

    return () => {
      disposed = true;
      unsubscribeMaterials();
      unsubscribeTransfers?.();
      unsubscribeUsage?.();
    };
  }, [toast]);

  const materialsById = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const selectedMaterial = materialsById.get(materialId);

  const movements = useMemo<MovementView[]>(() => [
    ...transfers.map((transfer) => ({
      id: transfer.id,
      type: "transfer" as const,
      materialId: transfer.materialId,
      materialName: transfer.materialName,
      materialUnit: transfer.materialUnit,
      projectId: transfer.projectId,
      projectName: transfer.projectName,
      quantity: transfer.quantity,
      actorName: transfer.transferredByName,
      occurredAt: transfer.transferredAt,
      usageDate: null,
      notes: transfer.notes,
    })),
    ...usage.map((record) => ({
      id: record.id,
      type: "usage" as const,
      materialId: record.materialId,
      materialName: record.materialName,
      materialUnit: record.materialUnit,
      projectId: record.projectId,
      projectName: record.projectName,
      quantity: record.quantityUsed,
      actorName: record.usedByName,
      occurredAt: record.createdAt,
      usageDate: record.date,
      notes: record.notes,
    })),
  ].sort((a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0)), [transfers, usage]);

  const resetForm = () => {
    setMaterialId("");
    setProjectId("");
    setQuantity("");
    setUsageDate(localDate());
    setNotes("");
  };

  const submitMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    if (!materialId || !projectId || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      toast({
        title: "Check the movement details",
        description: "Select a material and project, then enter a positive quantity.",
        variant: "destructive",
      });
      return;
    }
    if (selectedMaterial && parsedQuantity > selectedMaterial.quantity) {
      toast({
        title: "Insufficient stock",
        description: `Only ${selectedMaterial.quantity} ${selectedMaterial.unit} are available.`,
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (movementType === "transfer") {
        await transferMaterial({ materialId, projectId, quantity: parsedQuantity, notes });
      } else {
        await recordMaterialUsage({
          materialId,
          projectId,
          quantityUsed: parsedQuantity,
          date: usageDate,
          notes,
        });
      }
      toast({
        title: movementType === "transfer" ? "Transfer recorded" : "Usage recorded",
        description: "Central storage stock and the permanent movement history were updated together.",
      });
      resetForm();
    } catch (error) {
      toast({
        title: "Movement failed",
        description: error instanceof Error ? error.message : "The material movement could not be recorded.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center" aria-label="Loading material movements">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Card className="h-fit overflow-hidden border-primary/15 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-br from-primary/10 via-background to-background">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary p-2.5 text-primary-foreground shadow-sm">
              <ArrowRightLeft className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Record a material movement</CardTitle>
              <CardDescription className="mt-1">
                Every movement permanently records who changed stock, where it went and why.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <Tabs value={movementType} onValueChange={(value) => setMovementType(value as MovementType)}>
            <TabsList className="grid w-full grid-cols-2" aria-label="Material movement type">
              <TabsTrigger value="transfer">Transfer to project</TabsTrigger>
              <TabsTrigger value="usage">Direct usage</TabsTrigger>
            </TabsList>
            <TabsContent value="transfer" className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm text-muted-foreground">
              Use this when stock leaves central storage and is assigned to a project.
            </TabsContent>
            <TabsContent value="usage" className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-muted-foreground">
              Use this for material consumed directly from central storage on a project.
            </TabsContent>
          </Tabs>

          <form className="mt-5 space-y-4" onSubmit={submitMovement}>
            <div className="space-y-2">
              <Label htmlFor="movement-material">Material</Label>
              <Select value={materialId} onValueChange={setMaterialId} disabled={isSubmitting}>
                <SelectTrigger id="movement-material" aria-label="Material">
                  <SelectValue placeholder="Select available stock" />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((material) => (
                    <SelectItem key={material.id} value={material.id} disabled={material.quantity <= 0}>
                      {material.name} · {material.quantity} {material.unit} available
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="movement-project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId} disabled={isSubmitting}>
                <SelectTrigger id="movement-project" aria-label="Project">
                  <SelectValue placeholder="Select destination project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}{project.status !== "active" ? ` · ${project.status.replace("_", " ")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="movement-quantity">Quantity</Label>
                <Input
                  id="movement-quantity"
                  type="number"
                  min="0.01"
                  max={selectedMaterial?.quantity ?? 1_000_000}
                  step="0.01"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="0.00"
                  disabled={isSubmitting}
                  required
                />
                {selectedMaterial && (
                  <p className="text-xs text-muted-foreground">
                    Maximum: {selectedMaterial.quantity} {selectedMaterial.unit}
                  </p>
                )}
              </div>
              {movementType === "usage" && (
                <div className="space-y-2">
                  <Label htmlFor="movement-date">Usage date</Label>
                  <Input
                    id="movement-date"
                    type="date"
                    value={usageDate}
                    onChange={(event) => setUsageDate(event.target.value)}
                    disabled={isSubmitting}
                    required
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="movement-notes">Notes</Label>
              <Textarea
                id="movement-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Delivery reference, work area or reason…"
                disabled={isSubmitting}
              />
              <p className="text-right text-xs text-muted-foreground">{notes.length}/1000</p>
            </div>

            <Button className="w-full" type="submit" disabled={isSubmitting || materials.length === 0 || projects.length === 0}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : movementType === "transfer" ? <ArrowRightLeft className="h-4 w-4" /> : <PackageMinus className="h-4 w-4" />}
              {isSubmitting ? "Recording…" : movementType === "transfer" ? "Record transfer" : "Record usage"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden shadow-sm">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Movement history</CardTitle>
              <CardDescription>Immutable stock deductions, newest first.</CardDescription>
            </div>
            <Badge variant="secondary">{movements.length} records</Badge>
          </div>
        </CardHeader>
        <CardContent className="max-h-[720px] overflow-y-auto p-0">
          {movements.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center text-muted-foreground">
              <ClipboardCheck className="mb-3 h-10 w-10 opacity-40" />
              <p className="font-medium text-foreground">No movements recorded</p>
              <p className="mt-1 text-sm">The first transfer or direct usage will appear here.</p>
            </div>
          ) : (
            <div className="divide-y">
              {movements.map((movement) => {
                const material = materialsById.get(movement.materialId);
                const project = projectsById.get(movement.projectId);
                return (
                  <article key={`${movement.type}-${movement.id}`} className="p-5 transition-colors hover:bg-muted/30" data-testid="material-movement">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={movement.type === "transfer" ? "default" : "outline"}>
                            {movement.type === "transfer" ? "Transfer" : "Direct usage"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{formatDateTime(movement.occurredAt)}</span>
                        </div>
                        <h3 className="mt-2 font-semibold text-foreground">
                          {movement.materialName || material?.name || "Archived material"} → {movement.projectName || project?.name || "Archived project"}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Recorded by {movement.actorName || "authenticated manager"}
                          {movement.usageDate ? ` · Used ${movement.usageDate}` : ""}
                        </p>
                        {movement.notes && <p className="mt-2 text-sm text-foreground/80">{movement.notes}</p>}
                      </div>
                      <div className="shrink-0 rounded-lg bg-muted px-3 py-2 text-right">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stock out</p>
                        <p className="font-semibold text-foreground">
                          −{movement.quantity} {movement.materialUnit || material?.unit || "units"}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MaterialMovementsTab;
