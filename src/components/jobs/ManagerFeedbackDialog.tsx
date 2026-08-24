import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { storage } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { Camera, Upload, X, Loader2 } from "lucide-react";
import { CameraCapture } from "./CameraCapture";
import { createThumbnail, getThumbnailPath } from "@/lib/imageUtils";

interface ManagerFeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  onSubmitted: () => void;
}

export const ManagerFeedbackDialog = ({ open, onOpenChange, jobId, onSubmitted }: ManagerFeedbackDialogProps) => {
  const [feedback, setFeedback] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPhotos(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const handleCameraCapture = (blob: Blob) => {
    const file = new File([blob], `feedback-${Date.now()}.jpg`, { type: "image/jpeg" });
    setPhotos(prev => [...prev, file]);
    setShowCamera(false);
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (photos.length === 0 && !feedback.trim()) {
      toast({
        title: "Missing information",
        description: "Please add photos or feedback notes",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not authenticated");

      // Upload photos to storage (both original and thumbnail)
      const photoUrls: string[] = [];
      for (const photo of photos) {
        const fileName = `${jobId}/${Date.now()}-${photo.name}`;
        const thumbPath = getThumbnailPath(fileName);
        
        // Upload original photo
        await storage.upload("job-photos", fileName, photo);

        // Create and upload thumbnail
        try {
          const thumbnail = await createThumbnail(photo, 150, 0.6);
          await storage.upload("job-photos", thumbPath, thumbnail, { contentType: "image/jpeg" });
        } catch (thumbError) {
          console.warn("Thumbnail creation failed, continuing with original:", thumbError);
        }

        photoUrls.push(fileName);
      }

      // Update job with feedback and change status to needs_correction
      const updateData: any = {
        status: "needs_correction",
        manager_feedback: feedback.trim() || null,
      };

      const { error: updateError } = await supabase
        .from("jobs")
        .update(updateData)
        .eq("id", jobId);

      if (updateError) throw updateError;

      // Store photo references in job_photos table
      for (const photoUrl of photoUrls) {
        const { error: photoError } = await supabase
          .from("job_photos")
          .insert({
            job_id: jobId,
            photo_url: photoUrl,
          });

        if (photoError) throw photoError;
      }

      toast({
        title: "Feedback submitted",
        description: "The builder will be notified about the corrections needed",
      });

      // Reset form
      setFeedback("");
      setPhotos([]);
      onOpenChange(false);
      onSubmitted();
    } catch (error: any) {
      console.error("Error submitting feedback:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to submit feedback",
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
            <DialogTitle>Request Corrections</DialogTitle>
            <DialogDescription>
              Upload photos and add notes to explain what needs to be corrected
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Photo Upload Section */}
            <div className="space-y-3">
              <Label>Reference Photos (Optional)</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById("feedback-photo-upload")?.click()}
                  className="flex-1"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Photos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCamera(true)}
                  className="flex-1"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Take Photo
                </Button>
              </div>
              <input
                id="feedback-photo-upload"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              
              {photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {photos.map((photo, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={URL.createObjectURL(photo)}
                        alt={`Feedback ${index + 1}`}
                        className="w-full h-32 object-cover rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Feedback Notes */}
            <div className="space-y-2">
              <Label htmlFor="feedback-notes">Correction Notes (Optional)</Label>
              <Textarea
                id="feedback-notes"
                placeholder="Explain what needs to be corrected..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={6}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Feedback"
                )}
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
