import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Building2, Camera, CheckCircle2, Clock, Loader2, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  createRubbishRequest,
  subscribeToRubbishRequests,
  type RubbishRequestRecord,
} from "@/lib/firebase/repositories/inventory";
import { createPrivateObjectUrl } from "@/lib/firebase/storage";

interface RubbishCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  projects: Array<{ id: string; name: string }>;
}

const MAX_PHOTOS = 10;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

const statusBadge = (status: RubbishRequestRecord["status"]) => status === "resolved" ? (
  <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
    <CheckCircle2 className="h-3 w-3" />
    Resolved
  </Badge>
) : (
  <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800">
    <Clock className="h-3 w-3" />
    Pending
  </Badge>
);

const RubbishCollectionDialog = ({
  open,
  onOpenChange,
  projectId,
  projectName,
  projects,
}: RubbishCollectionDialogProps) => {
  const [photos, setPhotos] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [requests, setRequests] = useState<RubbishRequestRecord[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState("request");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const privatePhotoPathsKey = useMemo(
    () => JSON.stringify([...new Set(requests.flatMap((request) => request.photoPaths))].sort()),
    [requests],
  );
  const previews = useMemo(
    () => photos.map((photo) => URL.createObjectURL(photo)),
    [photos],
  );

  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let unsubscribe = () => undefined;
    setIsLoading(true);
    const reportError = (error: Error) => {
      if (stopped) return;
      setIsLoading(false);
      toast({ title: "Unable to load collection requests", description: error.message, variant: "destructive" });
    };
    void subscribeToRubbishRequests((nextRequests) => {
      if (stopped) return;
      setRequests(nextRequests);
      setIsLoading(false);
    }, reportError).then((cleanup) => {
      if (stopped) cleanup();
      else unsubscribe = cleanup;
    }).catch(reportError);
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [open, toast]);

  useEffect(() => {
    if (!open) {
      setPhotoUrls({});
      return;
    }
    let stopped = false;
    const allocatedUrls: string[] = [];
    const paths = JSON.parse(privatePhotoPathsKey) as string[];
    void Promise.all(paths.map(async (path) => {
      try {
        const url = await createPrivateObjectUrl(path, "image/jpeg");
        allocatedUrls.push(url);
        return [path, url] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (!stopped) setPhotoUrls(Object.fromEntries(entries.filter((entry) => entry !== null)));
    });
    return () => {
      stopped = true;
      allocatedUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [open, privatePhotoPathsKey]);

  const resetForm = () => {
    setPhotos([]);
    setDescription("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
      setActiveTab("request");
    }
    onOpenChange(nextOpen);
  };

  const handlePhotoSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const valid = selected.filter((file) =>
      file.type.startsWith("image/") && file.size > 0 && file.size < MAX_PHOTO_SIZE);
    const remainingSlots = MAX_PHOTOS - photos.length;
    const accepted = valid.slice(0, remainingSlots);
    if (accepted.length !== selected.length) {
      toast({
        title: "Some photos were not added",
        description: `Use up to ${MAX_PHOTOS} non-empty images smaller than 10 MB each.`,
        variant: "destructive",
      });
    }
    setPhotos((current) => [...current, ...accepted]);
    event.target.value = "";
  };

  const submitRequest = async () => {
    if (!projectId || !photos.length) return;
    setIsSubmitting(true);
    try {
      await createRubbishRequest({
        projectId,
        description,
        photos: photos.map((photo) => ({
          file: photo,
          fileName: photo.name,
          contentType: photo.type,
        })),
      });
      toast({ title: "Collection requested", description: "The yard team can now review the rubbish evidence." });
      resetForm();
      setActiveTab("history");
    } catch (error) {
      toast({
        title: "Request failed",
        description: error instanceof Error ? error.message : "The request could not be submitted.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-orange-600" />
            Rubbish collection
          </DialogTitle>
          <DialogDescription>Request a pickup with private photographic evidence.</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="request">New request</TabsTrigger>
            <TabsTrigger value="history">My requests ({requests.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="request" className="space-y-5 pt-3">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Building2 className="h-4 w-4 text-primary" />
                {projectName}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">The pickup will use this project's location.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="rubbish-photos">Photos ({photos.length}/{MAX_PHOTOS})</Label>
                {photos.length > 0 && photos.length < MAX_PHOTOS && (
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Plus className="h-4 w-4" /> Add photos
                  </Button>
                )}
              </div>
              <input
                id="rubbish-photos"
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                onChange={handlePhotoSelect}
              />
              {previews.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {previews.map((preview, index) => (
                    <div key={preview} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
                      <img src={preview} alt={`Selected rubbish evidence ${index + 1}`} className="h-full w-full object-cover" />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute right-1 top-1 h-7 w-7"
                        aria-label={`Remove photo ${index + 1}`}
                        onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-32 w-full flex-col gap-2 border-dashed"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-7 w-7 text-orange-600" />
                  Take or select at least one photo
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Up to 10 images, each smaller than 10 MB.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rubbish-description">Description (optional)</Label>
              <Textarea
                id="rubbish-description"
                value={description}
                maxLength={1000}
                rows={3}
                placeholder="Access instructions, approximate volume, or anything the team should know."
                onChange={(event) => setDescription(event.target.value)}
              />
              <p className="text-right text-xs text-muted-foreground">{description.length}/1000</p>
            </div>

            <Button className="w-full" disabled={isSubmitting || !photos.length || !projectId} onClick={submitRequest}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting ? "Submitting..." : "Submit collection request"}
            </Button>
          </TabsContent>

          <TabsContent value="history" className="space-y-3 pt-3">
            {isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : requests.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No collection requests yet.
              </div>
            ) : requests.map((request) => {
              const firstPhoto = request.photoPaths.map((path) => photoUrls[path]).find(Boolean);
              return (
                <article key={request.id} className="flex gap-3 rounded-lg border bg-card p-3" data-testid="rubbish-request">
                  <div className="h-20 w-20 flex-none overflow-hidden rounded-md bg-muted">
                    {firstPhoto ? <img src={firstPhoto} alt="Rubbish evidence" className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {statusBadge(request.status)}
                      <span className="text-xs text-muted-foreground">
                        {request.createdAt ? format(request.createdAt, "dd MMM yyyy, HH:mm") : "Syncing"}
                      </span>
                    </div>
                    <p className="truncate text-sm font-medium">{projectNames.get(request.projectId) ?? request.projectId}</p>
                    {request.description && <p className="line-clamp-2 text-xs text-muted-foreground">{request.description}</p>}
                    <p className="text-xs text-muted-foreground">{request.photoPaths.length} photo{request.photoPaths.length === 1 ? "" : "s"}</p>
                  </div>
                </article>
              );
            })}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default RubbishCollectionDialog;
