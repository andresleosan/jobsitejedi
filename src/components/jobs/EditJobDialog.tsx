import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { storage } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Upload, Camera, X } from "lucide-react";
import { CameraCapture } from "./CameraCapture";
import { createThumbnail, createThumbnailFromBlob } from "@/lib/imageUtils";

interface EditJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: {
    id: string;
    title: string;
    description: string | null;
    section?: string | null;
    project_id: string;
  } | null;
  onJobUpdated: () => void;
}

export const EditJobDialog = ({ open, onOpenChange, job, onJobUpdated }: EditJobDialogProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [section, setSection] = useState("");
  const [newSection, setNewSection] = useState("");
  const [showNewSection, setShowNewSection] = useState(false);
  const [existingSections, setExistingSections] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<{ id: string; url: string }[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (job) {
      setTitle(job.title);
      setDescription(job.description || "");
      setSection(job.section || "");
      setPhotos([]);
      fetchExistingSections();
      fetchExistingPhotos();
    }
  }, [job]);

  const fetchExistingSections = async () => {
    if (!job?.project_id) return;
    
    const { data } = await supabase
      .from("jobs")
      .select("section")
      .eq("project_id", job.project_id)
      .not("section", "is", null);
    
    if (data) {
      const uniqueSections = [...new Set(data.map(j => j.section).filter(Boolean))] as string[];
      setExistingSections(uniqueSections.sort());
    }
  };

  const fetchExistingPhotos = async () => {
    if (!job?.id) return;
    
    const { data } = await supabase
      .from("job_photos")
      .select("id, photo_url")
      .eq("job_id", job.id);
    
    if (data) {
      const photosWithUrls = await Promise.all(
        data.map(async (photo) => {
          const signedUrl = await storage.createSignedUrl("job-photos", photo.photo_url, 3600);
          return {
            id: photo.id,
            url: signedUrl || "",
          };
        })
      );
      setExistingPhotos(photosWithUrls.filter(p => p.url));
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
    const files = e.target.files;
    if (files) {
      const newPhotos = Array.from(files).map(file => ({
        file,
        preview: URL.createObjectURL(file),
      }));
      setPhotos(prev => [...prev, ...newPhotos]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCameraCapture = (blob: Blob) => {
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
    setPhotos(prev => [...prev, { file, preview: URL.createObjectURL(blob) }]);
    setShowCamera(false);
  };

  const removeNewPhoto = (index: number) => {
    setPhotos(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const removeExistingPhoto = async (photoId: string) => {
    try {
      const { error } = await supabase
        .from("job_photos")
        .delete()
        .eq("id", photoId);
      
      if (error) throw error;
      
      setExistingPhotos(prev => prev.filter(p => p.id !== photoId));
      toast({
        title: "Photo removed",
        description: "The photo has been deleted",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove photo",
        variant: "destructive",
      });
    }
  };

  const uploadPhotos = async () => {
    if (!job?.id || photos.length === 0) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    for (const photo of photos) {
      const fileExt = photo.file.name.split(".").pop();
      const fileName = `${job.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const thumbFileName = `${job.id}/thumbs/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Upload original
      await storage.upload("job-photos", fileName, photo.file);

      // Create and upload thumbnail
      try {
        const thumbnail = await createThumbnail(photo.file);
        await storage.upload("job-photos", thumbFileName, thumbnail);
      } catch (thumbError) {
        console.error("Failed to create thumbnail:", thumbError);
      }

      // Save photo reference
      const { error: insertError } = await supabase
        .from("job_photos")
        .insert({
          job_id: job.id,
          photo_url: fileName,
        });

      if (insertError) throw insertError;
    }
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

    if (!job) return;

    setIsLoading(true);
    try {
      // Update job details
      const { error } = await supabase
        .from("jobs")
        .update({
          title,
          description,
          section: section || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      if (error) throw error;

      // Upload new photos
      await uploadPhotos();

      toast({
        title: "Success",
        description: "Job updated successfully",
      });

      // Clean up previews
      photos.forEach(p => URL.revokeObjectURL(p.preview));
      setPhotos([]);

      onJobUpdated();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update job",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Job</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Job Title *</Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Install kitchen cabinets"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-section">Section</Label>
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
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what needs to be done..."
                rows={4}
                disabled={isLoading}
              />
            </div>

            {/* Photo Upload Section */}
            <div className="space-y-2">
              <Label>Reference Photos</Label>
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  className="flex-1"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Photos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCamera(true)}
                  disabled={isLoading}
                  className="flex-1"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Take Photo
                </Button>
              </div>

              {/* Existing Photos */}
              {existingPhotos.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Existing Photos</p>
                  <div className="grid grid-cols-3 gap-2">
                    {existingPhotos.map((photo) => (
                      <div key={photo.id} className="relative aspect-square">
                        <img
                          src={photo.url}
                          alt="Job photo"
                          className="w-full h-full object-cover rounded-lg"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => removeExistingPhoto(photo.id)}
                          disabled={isLoading}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New Photos Preview */}
              {photos.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">New Photos to Upload</p>
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((photo, index) => (
                      <div key={index} className="relative aspect-square">
                        <img
                          src={photo.preview}
                          alt="Preview"
                          className="w-full h-full object-cover rounded-lg"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => removeNewPhoto(index)}
                          disabled={isLoading}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </>
  );
};
