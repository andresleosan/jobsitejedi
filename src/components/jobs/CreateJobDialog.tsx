import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { storage } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { Camera, Upload, X, Loader2, Plus } from "lucide-react";
import { CameraCapture } from "./CameraCapture";

interface CreateJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onJobCreated: () => void;
}

export const CreateJobDialog = ({ open, onOpenChange, projectId, onJobCreated }: CreateJobDialogProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [section, setSection] = useState("");
  const [newSection, setNewSection] = useState("");
  const [showNewSection, setShowNewSection] = useState(false);
  const [existingSections, setExistingSections] = useState<string[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchExistingSections();
    }
  }, [open, projectId]);

  const fetchExistingSections = async () => {
    const { data } = await supabase
      .from("jobs")
      .select("section")
      .eq("project_id", projectId)
      .not("section", "is", null);
    
    if (data) {
      const uniqueSections = [...new Set(data.map(j => j.section).filter(Boolean))] as string[];
      setExistingSections(uniqueSections.sort());
    }
  };

  const handleAddNewSection = () => {
    if (newSection.trim()) {
      setSection(newSection.trim());
      if (!existingSections.includes(newSection.trim())) {
        setExistingSections(prev => [...prev, newSection.trim()].sort());
      }
      setNewSection("");
      setShowNewSection(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPhotos(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const handleCameraCapture = (blob: Blob) => {
    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
    setPhotos(prev => [...prev, file]);
    setShowCamera(false);
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({
        title: "Error",
        description: "Please enter a job title",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not authenticated");

      // Create the job
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          title,
          description,
          section: section || null,
          project_id: projectId,
          created_by: userData.user.id,
          status: "approved",
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Upload photos if any
      for (const photo of photos) {
        const fileName = `${job.id}/${Date.now()}-${photo.name}`;
        await storage.upload("job-photos", fileName, photo);

        // Save photo reference
        const { error: photoError } = await supabase
          .from("job_photos")
          .insert({
            job_id: job.id,
            photo_url: fileName,
          });

        if (photoError) throw photoError;
      }

      toast({
        title: "Success",
        description: "Job created successfully",
      });

      setTitle("");
      setDescription("");
      setSection("");
      setNewSection("");
      setShowNewSection(false);
      setPhotos([]);
      onJobCreated();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create job",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Job</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Job Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Install kitchen cabinets"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="section">Section</Label>
              {!showNewSection ? (
                <div className="flex gap-2">
                  <Select value={section || "__none__"} onValueChange={(val) => setSection(val === "__none__" ? "" : val)}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select or create a section" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No section</SelectItem>
                      {existingSections.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowNewSection(true)}
                    disabled={isLoading}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={newSection}
                    onChange={(e) => setNewSection(e.target.value)}
                    placeholder="Enter new section name"
                    disabled={isLoading}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddNewSection())}
                  />
                  <Button type="button" variant="outline" onClick={handleAddNewSection} disabled={isLoading}>
                    Add
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowNewSection(false)} disabled={isLoading}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what needs to be done..."
                rows={4}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label>Photos (Optional)</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById("file-upload")?.click()}
                  disabled={isLoading}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Photos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCamera(true)}
                  disabled={isLoading}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Take Photo
                </Button>
                <input
                  id="file-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
              {photos.length > 0 && (
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {photos.map((photo, index) => (
                    <div key={index} className="relative aspect-square">
                      <img
                        src={URL.createObjectURL(photo)}
                        alt={`Photo ${index + 1}`}
                        className="w-full h-full object-cover rounded"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                        onClick={() => removePhoto(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Job
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {showCamera && (
        <CameraCapture onCapture={handleCameraCapture} onClose={() => setShowCamera(false)} />
      )}
    </>
  );
};
