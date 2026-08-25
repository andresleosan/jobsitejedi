import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";
import { createJob, listJobSections } from "@/lib/firebase/repositories/jobs";

interface CreateJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onJobCreated: () => void;
}

export const CreateJobDialog = ({
  open,
  onOpenChange,
  projectId,
  onJobCreated,
}: CreateJobDialogProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [section, setSection] = useState("");
  const [newSection, setNewSection] = useState("");
  const [showNewSection, setShowNewSection] = useState(false);
  const [existingSections, setExistingSections] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !projectId) return;
    void listJobSections(projectId)
      .then(setExistingSections)
      .catch(() => setExistingSections([]));
  }, [open, projectId]);

  const handleAddNewSection = () => {
    const value = newSection.trim();
    if (!value) return;
    setSection(value);
    setExistingSections((current) => [...new Set([...current, value])].sort());
    setNewSection("");
    setShowNewSection(false);
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setSection("");
    setNewSection("");
    setShowNewSection(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      toast({ title: "Error", description: "Please enter a job title", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      await createJob({ projectId, title, description, section });
      toast({ title: "Success", description: "Job created successfully" });
      resetForm();
      onJobCreated();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create job",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Job</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Job Title *</Label>
            <Input id="title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={isLoading} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="section">Section</Label>
            {!showNewSection ? (
              <div className="flex gap-2">
                <Select value={section || "__none__"} onValueChange={(value) => setSection(value === "__none__" ? "" : value)}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Select or create a section" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No section</SelectItem>
                    {existingSections.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" onClick={() => setShowNewSection(true)} disabled={isLoading}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input value={newSection} onChange={(event) => setNewSection(event.target.value)} disabled={isLoading} />
                <Button type="button" variant="outline" onClick={handleAddNewSection} disabled={isLoading}>Add</Button>
                <Button type="button" variant="ghost" onClick={() => setShowNewSection(false)} disabled={isLoading}>Cancel</Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} disabled={isLoading} />
          </div>
          <p className="text-xs text-muted-foreground">Photo references and completion evidence are managed from the project ledger after creation.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Job
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
