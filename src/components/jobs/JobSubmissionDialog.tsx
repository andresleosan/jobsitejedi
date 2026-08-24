import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { storage } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { Camera, Upload, X, Loader2, Users } from "lucide-react";
import { CameraCapture } from "./CameraCapture";
import { Checkbox } from "@/components/ui/checkbox";
import { createThumbnail, getThumbnailPath } from "@/lib/imageUtils";

interface JobSubmissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  projectId: string;
  onSubmitted: () => void;
}

interface Builder {
  id: string;
  full_name: string;
}

export const JobSubmissionDialog = ({ open, onOpenChange, jobId, projectId, onSubmitted }: JobSubmissionDialogProps) => {
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loggedMaterials, setLoggedMaterials] = useState<any[]>([]);
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [selectedBuilders, setSelectedBuilders] = useState<string[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchLoggedMaterials();
      fetchBuilders();
    }
  }, [open]);

  const fetchLoggedMaterials = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      // Cast to any to avoid TS deep instantiation error
      const sb = supabase as any;

      // Fetch unassigned material usage for this project by the current user
      const usageResult = await sb
        .from("material_usage")
        .select("id, quantity_used, material_id")
        .eq("used_by", userData.user.id)
        .eq("project_id", projectId)
        .is("job_id", null);

      if (usageResult.error) throw usageResult.error;

      const allUsage = usageResult.data || [];
      if (allUsage.length === 0) {
        setLoggedMaterials([]);
        return;
      }

      // Exclude material_usage entries already linked via job_materials
      const usageIds = allUsage.map((u: any) => u.id);
      const linksResult = await sb
        .from("job_materials")
        .select("material_usage_id")
        .in("material_usage_id", usageIds);
      if (linksResult.error) throw linksResult.error;

      const linkedSet = new Set((linksResult.data || []).map((l: any) => l.material_usage_id));
      const unlinkedUsage = allUsage.filter((u: any) => !linkedSet.has(u.id));
      if (unlinkedUsage.length === 0) {
        setLoggedMaterials([]);
        return;
      }

      // Fetch material details only for the unlinked usage
      const materialIds = unlinkedUsage.map((u: any) => u.material_id);
      const materialsResult = await sb
        .from("materials")
        .select("id, name, unit, cost_per_unit")
        .in("id", materialIds);
      if (materialsResult.error) throw materialsResult.error;

      const combined = unlinkedUsage.map((usage: any) => ({
        ...usage,
        materials: materialsResult.data?.find((m: any) => m.id === usage.material_id)
      }));

      setLoggedMaterials(combined);
    } catch (error: any) {
      console.error("Error fetching materials:", error);
    }
  };

  const fetchBuilders = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .neq("id", userData.user.id);

      if (error) throw error;
      
      const buildersData = (data || []).map(profile => ({
        id: profile.id,
        full_name: profile.full_name,
      }));
      
      setBuilders(buildersData);
    } catch (error: any) {
      console.error("Error fetching builders:", error);
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

  const toggleBuilder = (builderId: string) => {
    setSelectedBuilders(prev =>
      prev.includes(builderId)
        ? prev.filter(id => id !== builderId)
        : [...prev, builderId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (photos.length === 0) {
      toast({
        title: "Photos Required",
        description: "Please upload at least one photo before submitting for review",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    console.log("Starting job submission for job:", jobId);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not authenticated");

      // Stop job time tracking
      const { data: activeTracking } = await supabase
        .from("job_time_tracking")
        .select("*")
        .eq("job_id", jobId)
        .eq("user_id", userData.user.id)
        .is("ended_at", null)
        .maybeSingle();

      if (activeTracking) {
        await supabase
          .from("job_time_tracking")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", activeTracking.id);
      }

      // Get the latest submission number for this job
      const { data: existingCompletions } = await supabase
        .from("job_completions")
        .select("submission_number")
        .eq("job_id", jobId)
        .order("submission_number", { ascending: false })
        .limit(1);

      const nextSubmissionNumber = existingCompletions && existingCompletions.length > 0 
        ? (existingCompletions[0].submission_number || 0) + 1 
        : 1;

      // Always create a NEW job completion (preserves history)
      const { data: newCompletion, error: completionError } = await supabase
        .from("job_completions")
        .insert({
          job_id: jobId,
          completed_by: userData.user.id,
          notes,
          submission_number: nextSubmissionNumber,
        })
        .select()
        .single();

      if (completionError) throw completionError;
      const completion = newCompletion;

      // Upload photos (both original and thumbnail)
      for (const photo of photos) {
        const fileName = `${completion.id}/${Date.now()}-${photo.name}`;
        const thumbPath = getThumbnailPath(fileName);
        
        // Upload original photo
        await storage.upload("job-completion-photos", fileName, photo);

        // Create and upload thumbnail
        try {
          const thumbnail = await createThumbnail(photo, 150, 0.6);
          await storage.upload("job-completion-photos", thumbPath, thumbnail, { contentType: "image/jpeg" });
        } catch (thumbError) {
          console.warn("Thumbnail creation failed, continuing with original:", thumbError);
        }

        const { error: photoError } = await supabase
          .from("job_completion_photos")
          .insert({
            completion_id: completion.id,
            photo_url: fileName,
          });

        if (photoError) throw photoError;
      }

      // Link logged materials to this job (via job_materials) and update material_usage.job_id
      for (const material of loggedMaterials) {
        // Check if job_material link already exists
        const { data: existingLink, error: linkCheckError } = await supabase
          .from("job_materials")
          .select("id")
          .eq("job_id", jobId)
          .eq("material_usage_id", material.id)
          .maybeSingle();
        if (linkCheckError) throw linkCheckError;

        if (!existingLink) {
          const { error: insertLinkError } = await supabase
            .from("job_materials")
            .insert({
              job_id: jobId,
              material_usage_id: material.id,
            });
          if (insertLinkError) throw insertLinkError;
        }

        // Update material_usage.job_id to link it to this job
        // This will remove it from the "View Logs" section in Material Management
        await supabase
          .from("material_usage")
          .update({ job_id: jobId })
          .eq("id", material.id);
      }

      // Add collaborators
      for (const builderId of selectedBuilders) {
        // Check if collaborator already exists
        const { data: existingCollab } = await supabase
          .from("job_collaborators")
          .select("id")
          .eq("job_completion_id", completion.id)
          .eq("user_id", builderId)
          .maybeSingle();

        if (!existingCollab) {
          await supabase
            .from("job_collaborators")
            .insert({
              job_completion_id: completion.id,
              user_id: builderId,
              added_by: userData.user.id,
            });
        }
      }

      // Status is set to "waiting_review" by a DB trigger after a completion is inserted/updated.
      // No direct status update here due to RLS on jobs.

      // Clear local materials list; they've been linked to the job
      setLoggedMaterials([]);

      console.log("Job submission successful!");
      
      toast({
        title: "Success",
        description: "Job submitted for review",
      });

      setNotes("");
      setPhotos([]);
      setSelectedBuilders([]);
      onSubmitted();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Job submission error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to submit job",
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
            <DialogTitle>Submit Job for Review</DialogTitle>
            <DialogDescription>
              Upload at least one photo and optional notes. Managers will review your submission in real time.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Photos * (Required)</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById("job-file-upload")?.click()}
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
                  id="job-file-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
               </div>
               {photos.length === 0 && (
                 <p className="text-xs text-muted-foreground">At least one photo is required to submit.</p>
               )}
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

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this job..."
                rows={3}
                disabled={isLoading}
              />
            </div>

            {loggedMaterials.length > 0 && (
              <div className="space-y-2">
                <Label>Materials Used ({loggedMaterials.length})</Label>
                <div className="text-sm text-muted-foreground">
                  These logged materials will be linked to this job
                </div>
              </div>
            )}

            {builders.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Tag Collaborators (Optional)
                </Label>
                <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                  {builders.map((builder) => (
                    <div key={builder.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={builder.id}
                        checked={selectedBuilders.includes(builder.id)}
                        onCheckedChange={() => toggleBuilder(builder.id)}
                      />
                      <label
                        htmlFor={builder.id}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {builder.full_name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || photos.length === 0}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit for Review
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
