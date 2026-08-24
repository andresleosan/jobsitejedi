import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getStoragePath, storage } from "@/lib/storage";
import { storage } from "@/lib/storage";
import { Loader2, Camera, Trash2, X, CheckCircle2, Building2, Plus } from "lucide-react";
import { format } from "date-fns";

interface RubbishRequest {
  id: string;
  photo_url: string | null;
  description: string | null;
  status: string;
  created_at: string;
  project_name?: string;
}

interface RubbishCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  userId: string;
}

const RubbishCollectionDialog = ({ open, onOpenChange, projectId, userId }: RubbishCollectionDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [myRequests, setMyRequests] = useState<RubbishRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [projectName, setProjectName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const MAX_PHOTOS = 10;

  useEffect(() => {
    if (open && projectId) {
      fetchProjectName();
    }
  }, [open, projectId]);

  const fetchProjectName = async () => {
    if (!projectId) return;
    const { data } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single();
    if (data) {
      setProjectName(data.name);
    }
  };

  const fetchMyRequests = async () => {
    setIsLoadingRequests(true);
    try {
      const { data: requests, error } = await supabase
        .from("rubbish_collection_requests")
        .select("*, projects(name)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;

      const mapped = await Promise.all((requests || []).map(async (r) => {
        const signedPhotoUrls = await Promise.all(
          parsePhotoUrls(r.photo_url).map((photoPath) =>
            storage.createSignedUrl(
              "rubbish-photos",
              getStoragePath(photoPath, "rubbish-photos"),
              3600,
            ),
          ),
        );

        return {
          ...r,
          photo_url: JSON.stringify(signedPhotoUrls.filter((url): url is string => Boolean(url))),
          project_name: (r.projects as any)?.name || "Unknown",
        };
      }));

      setMyRequests(mapped);
    } catch (error: any) {
      console.error("Error fetching requests:", error);
    } finally {
      setIsLoadingRequests(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      fetchMyRequests();
      fetchProjectName();
    } else {
      resetForm();
    }
    onOpenChange(isOpen);
  };

  const resetForm = () => {
    setPhotos([]);
    setPhotoPreviews([]);
    setDescription("");
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const remainingSlots = MAX_PHOTOS - photos.length;
    const filesToAdd = Array.from(files).slice(0, remainingSlots);

    if (filesToAdd.length < files.length) {
      toast({
        title: "Photo limit",
        description: `Maximum ${MAX_PHOTOS} photos allowed`,
        variant: "destructive",
      });
    }

    const newPhotos = [...photos, ...filesToAdd];
    setPhotos(newPhotos);

    // Generate previews for new files
    filesToAdd.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreviews(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!projectId) {
      toast({
        title: "Project required",
        description: "Please select a project first",
        variant: "destructive",
      });
      return;
    }

    if (photos.length === 0) {
      toast({
        title: "Photo required",
        description: "Please add at least one photo of what needs to be collected",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload all photos
      const uploadedUrls: string[] = [];
      
      for (const photo of photos) {
        const fileExt = photo.name.split('.').pop();
        const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        
        await storage.upload("rubbish-photos", fileName, photo);

        uploadedUrls.push(fileName);
      }

      // Store URLs as JSON array string
      const photoUrlsJson = JSON.stringify(uploadedUrls);

      // Create request
      const { error } = await supabase
        .from("rubbish_collection_requests")
        .insert({
          user_id: userId,
          project_id: projectId,
          photo_url: photoUrlsJson,
          description: description.trim() || null,
        });

      if (error) throw error;

      toast({
        title: "Request submitted",
        description: "A manager will be notified to collect the rubbish",
      });

      resetForm();
      fetchMyRequests();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to submit request",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>;
      case "resolved":
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle2 className="h-3 w-3" /> Resolved</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">{status}</span>;
    }
  };

  const parsePhotoUrls = (photoUrl: string | null): string[] => {
    if (!photoUrl) return [];
    try {
      const parsed = JSON.parse(photoUrl);
      return Array.isArray(parsed) ? parsed : [photoUrl];
    } catch {
      return photoUrl ? [photoUrl] : [];
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-orange-500" />
            Request Rubbish Collection
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* New Request Form */}
          <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
            <h3 className="font-medium">New Request</h3>

            {/* Project Reference */}
            <div className="space-y-2">
              <Label>Project</Label>
              <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-md">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{projectName || "Select a project"}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                The rubbish will be collected from this project location
              </p>
            </div>

            {/* Photos */}
            <div className="space-y-2">
              <Label>Photos * ({photos.length}/{MAX_PHOTOS})</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handlePhotoSelect}
                className="hidden"
              />
              
              {photoPreviews.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photoPreviews.map((preview, index) => (
                    <div key={index} className="relative aspect-square">
                      <img
                        src={preview}
                        alt={`Preview ${index + 1}`}
                        className="w-full h-full object-cover rounded-lg border"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => removePhoto(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  
                  {photos.length < MAX_PHOTOS && (
                    <Button
                      type="button"
                      variant="outline"
                      className="aspect-square flex flex-col items-center justify-center gap-1"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Plus className="h-6 w-6 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Add</span>
                    </Button>
                  )}
                </div>
              )}

              {photoPreviews.length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-32 flex flex-col items-center justify-center gap-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-8 w-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Take or select photos (up to {MAX_PHOTOS})</span>
                </Button>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="Describe what needs to be collected..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            {/* Submit Button */}
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || photos.length === 0 || !projectId}
              className="w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Request"
              )}
            </Button>
          </div>

          {/* My Recent Requests */}
          <div className="space-y-3">
            <h3 className="font-medium">My Recent Requests</h3>
            {isLoadingRequests ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : myRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No requests yet
              </p>
            ) : (
              <div className="space-y-2">
                {myRequests.map((request) => {
                  const photoUrls = parsePhotoUrls(request.photo_url);
                  return (
                    <div
                      key={request.id}
                      className="flex items-start gap-3 p-3 bg-card border rounded-lg"
                    >
                      {photoUrls.length > 0 && (
                        <div className="flex gap-1 flex-shrink-0">
                          <img
                            src={photoUrls[0]}
                            alt="Rubbish"
                            className="w-16 h-16 object-cover rounded-md"
                          />
                          {photoUrls.length > 1 && (
                            <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground">
                              +{photoUrls.length - 1}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {getStatusBadge(request.status)}
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(request.created_at), "dd MMM yyyy, HH:mm")}
                          </span>
                        </div>
                        <p className="text-sm font-medium mt-1">{request.project_name}</p>
                        {request.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {request.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RubbishCollectionDialog;
