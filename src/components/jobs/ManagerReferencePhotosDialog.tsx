import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Image, X, Loader2, Download } from "lucide-react";
import { getStoragePath, storage } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { getThumbnailPath } from "@/lib/imageUtils";

interface ManagerReferencePhotosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobTitle: string;
  photos: Array<{ id: string; photo_url: string; created_at?: string }>;
}

export const ManagerReferencePhotosDialog = ({
  open,
  onOpenChange,
  jobTitle,
  photos,
}: ManagerReferencePhotosDialogProps) => {
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const { toast } = useToast();

  const extractPhotoPath = (photoUrl: string) => {
    return getStoragePath(photoUrl, "job-photos");
  };

  useEffect(() => {
    const fetchSignedUrls = async () => {
      if (!photos || photos.length === 0) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const urls: Record<string, string> = {};

      for (const photo of photos) {
        const photoPath = extractPhotoPath(photo.photo_url);
        
        // Try thumbnail first for faster loading
        const thumbPath = getThumbnailPath(photoPath);
        let signedUrl = await storage.createSignedUrl("job-photos", thumbPath, 3600);

        // Fall back to original if thumbnail doesn't exist
        if (!signedUrl) {
          signedUrl = await storage.createSignedUrl("job-photos", photoPath, 3600);
        }

        if (signedUrl) {
          urls[photo.id] = signedUrl;
        }
      }

      setSignedUrls(urls);
      setLoading(false);
    };

    if (open) {
      fetchSignedUrls();
    }
  }, [open, photos]);

  const handleDownload = async (photo: { id: string; photo_url: string }) => {
    try {
      setDownloading(photo.id);
      const photoPath = extractPhotoPath(photo.photo_url);
      
      const data = await storage.download("job-photos", photoPath);

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = photoPath.split("/").pop() || "reference-photo.jpg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to download photo",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  if (!photos || photos.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reference Photos - {jobTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Image className="h-12 w-12 mb-4 opacity-50" />
            <p>No reference photos available for this job</p>
          </div>
          <div className="flex justify-end pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reference Photos - {jobTitle}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Photos uploaded by the manager to guide this job
          </p>
        </DialogHeader>
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {photos.map((photo) => (
                <div key={photo.id} className="relative group">
                  {signedUrls[photo.id] ? (
                    <div className="space-y-2">
                      <div className="relative">
                        <img
                          src={signedUrls[photo.id]}
                          alt="Manager reference"
                          className="w-full aspect-square object-cover rounded-lg border-2 border-border shadow-md"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                          onClick={() => handleDownload(photo)}
                          disabled={downloading === photo.id}
                        >
                          {downloading === photo.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {photo.created_at && (
                        <p className="text-xs text-muted-foreground text-center">
                          Uploaded {format(new Date(photo.created_at), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="w-full aspect-square flex items-center justify-center bg-muted rounded-lg border-2 border-border">
                      <Image className="h-8 w-8 text-muted-foreground opacity-50" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="mr-2 h-4 w-4" />
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
