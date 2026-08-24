import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { storage } from "@/lib/storage";
import { Loader2, Upload, X, Image as ImageIcon } from "lucide-react";

interface DailyReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  userId: string;
}

const DailyReportDialog = ({ open, onOpenChange, projectId, userId }: DailyReportDialogProps) => {
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    if (photos.length + files.length > 20) {
      toast({
        title: "Too many photos",
        description: "You can upload a maximum of 20 photos",
        variant: "destructive",
      });
      return;
    }

    setPhotos([...photos, ...files]);
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      toast({
        title: "Description required",
        description: "Please add a description of the work done today",
        variant: "destructive",
      });
      return;
    }

    if (!projectId) {
      toast({
        title: "No project selected",
        description: "Please select a project first",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Create the daily report
      const { data: report, error: reportError } = await supabase
        .from("daily_reports")
        .insert({
          user_id: userId,
          project_id: projectId,
          description: description.trim(),
          date: new Date().toISOString().split('T')[0],
        })
        .select()
        .single();

      if (reportError) throw reportError;

      // Upload photos if any
      if (photos.length > 0) {
        const uploadPromises = photos.map(async (photo, index) => {
          const fileExt = photo.name.split('.').pop();
          const fileName = `${userId}/${report.id}/${Date.now()}_${index}.${fileExt}`;

          await storage.upload("daily-report-photos", fileName, photo);

          return supabase
            .from("daily_report_photos")
            .insert({
              report_id: report.id,
              photo_url: fileName,
            });
        });

        await Promise.all(uploadPromises);
      }

      toast({
        title: "Report submitted",
        description: "Your daily report has been submitted successfully",
      });

      // Reset form
      setDescription("");
      setPhotos([]);
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error submitting report:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to submit report",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] w-[95vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Daily Report</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="description">What was done today?</Label>
            <Textarea
              id="description"
              placeholder="Describe the work completed today..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="mt-2"
            />
          </div>

          <div>
            <Label>Photos (up to 20)</Label>
            <div className="mt-2 space-y-4">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => document.getElementById("photo-upload")?.click()}
                disabled={photos.length >= 20}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload Photos ({photos.length}/20)
              </Button>
              <input
                id="photo-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />

              {photos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {photos.map((photo, index) => (
                    <div key={index} className="relative group">
                      <div className="aspect-square rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                        {photo.type.startsWith('image/') ? (
                          <img
                            src={URL.createObjectURL(photo)}
                            alt={`Preview ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="h-8 w-8 text-muted-foreground" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !description.trim()}
              className="flex-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Report"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DailyReportDialog;
