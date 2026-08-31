import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createProject } from "@/lib/firebase/repositories/projects";
import { listAssignableBuilders, type AssignableBuilder } from "@/lib/firebase/functions";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectCreated: () => void;
}

const CreateProjectDialog = ({ open, onOpenChange, onProjectCreated }: CreateProjectDialogProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingBuilders, setIsLoadingBuilders] = useState(false);
  const [builders, setBuilders] = useState<AssignableBuilder[]>([]);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    builder_id: "",
    name: "",
    description: "",
    client_name: "",
    address: "",
  });
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoadingBuilders(true);
    setBuilderError(null);

    void listAssignableBuilders()
      .then((nextBuilders) => {
        if (cancelled) return;
        setBuilders(nextBuilders);
        setFormData((current) => ({
          ...current,
          builder_id: nextBuilders.some((builder) => builder.id === current.builder_id)
            ? current.builder_id
            : "",
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setBuilders([]);
        setBuilderError(error instanceof Error ? error.message : "Builders could not be loaded");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBuilders(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.client_name || !formData.builder_id) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      await createProject({
        builderId: formData.builder_id,
        name: formData.name,
        description: formData.description,
        clientName: formData.client_name,
        address: formData.address,
      });

      toast({
        title: "Project created",
        description: "New project has been created successfully",
      });

      setFormData({ builder_id: "", name: "", description: "", client_name: "", address: "" });
      onOpenChange(false);
      onProjectCreated();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create project",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>Add a new construction project to track</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-builder">Assigned Builder *</Label>
            <Select
              value={formData.builder_id}
              onValueChange={(builder_id) => setFormData({ ...formData, builder_id })}
              disabled={isLoading || isLoadingBuilders || builders.length === 0}
            >
              <SelectTrigger id="project-builder" aria-label="Assigned builder">
                <SelectValue placeholder={isLoadingBuilders ? "Loading authorized builders…" : "Choose a builder"} />
              </SelectTrigger>
              <SelectContent>
                {builders.map((builder) => (
                  <SelectItem key={builder.id} value={builder.id}>
                    {builder.displayName || builder.email || `Builder ${builder.id.slice(0, 8)}`}
                    {builder.displayName && builder.email ? ` · ${builder.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isLoadingBuilders && builders.length === 0 && !builderError && (
              <p className="text-sm text-muted-foreground">No active builders are provisioned. Invite a builder before creating a project.</p>
            )}
            {builderError && <p role="alert" className="text-sm text-destructive">{builderError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Project Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Downtown Office Building"
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="client">Client Name *</Label>
            <Input
              id="client"
              value={formData.client_name}
              onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
              placeholder="ABC Construction Co."
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="123 Main Street"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Project details and objectives..."
              disabled={isLoading}
              rows={4}
            />
          </div>

          <div className="flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || isLoadingBuilders || builders.length === 0}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateProjectDialog;
