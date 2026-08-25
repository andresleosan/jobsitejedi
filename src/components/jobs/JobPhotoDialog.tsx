import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  createJobPhotoObjectUrl,
  deleteJobPhoto,
  listJobPhotos,
  uploadJobPhoto,
  type JobPhotoKind,
  type JobPhotoRecord,
} from "@/lib/firebase/repositories/jobPhotos";
import { submitJobForReview, type JobRecord } from "@/lib/firebase/repositories/jobs";
import { createThumbnail } from "@/lib/imageUtils";
import { ImagePlus, Loader2, ShieldCheck, Trash2, Upload, X } from "lucide-react";

interface JobPhotoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobRecord | null;
  kind: JobPhotoKind;
  onUploaded?: () => void;
  readOnly?: boolean;
}

interface DraftPhoto {
  file: File;
  previewUrl: string;
}

interface ExistingPhoto {
  record: JobPhotoRecord;
  previewUrl: string;
}

const MAX_PHOTOS_PER_BATCH = 10;
const MAX_FILE_SIZE = 8 * 1024 * 1024;

const kindLabels: Record<JobPhotoKind, { title: string; description: string }> = {
  reference: {
    title: "Reference photos",
    description: "Add visual context to this job before work starts.",
  },
  completion: {
    title: "Work evidence",
    description: "Upload photos that show the work completed on this job.",
  },
  feedback: {
    title: "Review feedback",
    description: "Attach a photo or correction evidence for this job.",
  },
};

const JobPhotoDialog = ({
  open,
  onOpenChange,
  job,
  kind,
  onUploaded,
  readOnly = false,
}: JobPhotoDialogProps) => {
  const [draftPhotos, setDraftPhotos] = useState<DraftPhoto[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<ExistingPhoto[]>([]);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [uploadIndex, setUploadIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftPhotosRef = useRef<DraftPhoto[]>([]);
  const existingPhotosRef = useRef<ExistingPhoto[]>([]);
  const { toast } = useToast();
  const labels = kindLabels[kind];

  const revokeDraftPreviews = useCallback(() => {
    draftPhotosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    draftPhotosRef.current = [];
  }, []);

  const revokeExistingPreviews = useCallback(() => {
    existingPhotosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    existingPhotosRef.current = [];
  }, []);

  const releaseDraftPhotos = useCallback(() => {
    revokeDraftPreviews();
    setDraftPhotos([]);
  }, [revokeDraftPreviews]);

  const loadExistingPhotos = useCallback(async () => {
    if (!job) return;
    setIsLoadingPhotos(true);
    try {
      const records = await listJobPhotos(job.id, kind);
      const previews = await Promise.all(
        records.map(async (record) => ({
          record,
          previewUrl: await createJobPhotoObjectUrl(record),
        })),
      );
      revokeExistingPreviews();
      existingPhotosRef.current = previews;
      setExistingPhotos(previews);
    } catch (error) {
      console.error("Error loading job photos:", error);
      revokeExistingPreviews();
      existingPhotosRef.current = [];
      setExistingPhotos([]);
      toast({
        title: "Photos unavailable",
        description: "The private photo gallery could not be loaded.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPhotos(false);
    }
  }, [job, kind, revokeExistingPreviews, toast]);

  useEffect(() => {
    if (!open || !job) return;
    void loadExistingPhotos();
    return () => {
      revokeExistingPreviews();
      revokeDraftPreviews();
    };
  }, [job, loadExistingPhotos, open, revokeDraftPreviews, revokeExistingPreviews]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;

    const accepted = files.filter((file) => file.type.startsWith("image/") && file.size <= MAX_FILE_SIZE);
    const rejected = files.length - accepted.length;
    const remaining = MAX_PHOTOS_PER_BATCH - draftPhotos.length;
    const nextPhotos = accepted.slice(0, remaining).map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setDraftPhotos((current) => {
      const next = [...current, ...nextPhotos];
      draftPhotosRef.current = next;
      return next;
    });
    if (rejected > 0 || accepted.length > remaining) {
      toast({
        title: "Some files were skipped",
        description: `Use images up to 8 MB, with a maximum of ${MAX_PHOTOS_PER_BATCH} per upload.`,
        variant: "destructive",
      });
    }
  };

  const removeDraftPhoto = (index: number) => {
    setDraftPhotos((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      draftPhotosRef.current = next;
      return next;
    });
  };

  const removeExistingPhoto = async (photo: ExistingPhoto) => {
    try {
      await deleteJobPhoto(photo.record.id);
      URL.revokeObjectURL(photo.previewUrl);
      setExistingPhotos((current) => {
        const next = current.filter((item) => item.record.id !== photo.record.id);
        existingPhotosRef.current = next;
        return next;
      });
      toast({ title: "Photo deleted", description: "The private photo was removed." });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "The photo could not be deleted.",
        variant: "destructive",
      });
    }
  };

  const handleUpload = async () => {
    if (!job || draftPhotos.length === 0) return;
    setIsUploading(true);
    setUploadIndex(0);
    try {
      for (const [index, draft] of draftPhotos.entries()) {
        setUploadIndex(index + 1);
        const thumbnail = await createThumbnail(draft.file, 320, 0.7);
        await uploadJobPhoto({
          jobId: job.id,
          kind,
          fileName: draft.file.name,
          contentType: draft.file.type,
          file: draft.file,
          thumbnail,
        });
      }
      releaseDraftPhotos();
      await loadExistingPhotos();
      onUploaded?.();
      toast({
        title: "Photos uploaded",
        description: `${draftPhotos.length} private photo${draftPhotos.length === 1 ? "" : "s"} added to the job.`,
      });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Some photos could not be uploaded.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setUploadIndex(0);
    }
  };

  const handleSubmitForReview = async () => {
    if (!job || existingPhotos.length === 0) return;
    setIsSubmittingReview(true);
    try {
      await submitJobForReview(job.id);
      onUploaded?.();
      toast({
        title: "Submitted for review",
        description: "A manager can now review the private evidence.",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Submission failed",
        description: error instanceof Error ? error.message : "The job could not be submitted.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isUploading) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5 text-primary" />
            {labels.title}
          </DialogTitle>
          <DialogDescription>
            {job?.title ?? "Job"} · {labels.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {!readOnly && <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Add evidence from this device</p>
                <p className="text-xs text-muted-foreground">JPG, PNG or HEIC · maximum 8 MB each</p>
              </div>
              <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isUploading}>
                <Upload className="h-4 w-4" />
                Choose photos
              </Button>
            </div>
            <Input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={handleFileSelect}
              aria-label="Choose photos for this job"
            />
          </div>}

          {!readOnly && draftPhotos.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Ready to upload</p>
                <span className="text-xs text-muted-foreground">{draftPhotos.length}/{MAX_PHOTOS_PER_BATCH}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {draftPhotos.map((photo, index) => (
                  <div key={`${photo.file.name}-${index}`} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                    <img src={photo.previewUrl} alt={`Selected photo ${index + 1}`} className="h-full w-full object-cover" />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute right-1 top-1 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => removeDraftPhoto(index)}
                      disabled={isUploading}
                      aria-label={`Remove selected photo ${index + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" className="mt-3 w-full" onClick={handleUpload} disabled={isUploading || isSubmittingReview}>
                {isUploading ? <Loader2 className="animate-spin" /> : <Upload />}
                {isUploading ? `Uploading ${uploadIndex}/${draftPhotos.length}` : "Upload private photos"}
              </Button>
            </div>
          )}

          <section aria-labelledby="existing-job-photos">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="existing-job-photos" className="text-sm font-medium">Private evidence</h3>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> Owner and manager access
              </span>
            </div>
            {isLoadingPhotos ? (
              <div className="flex items-center justify-center rounded-md border py-8"><Loader2 className="animate-spin" /></div>
            ) : existingPhotos.length === 0 ? (
              <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">No photos uploaded yet.</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {existingPhotos.map((photo) => (
                  <div key={photo.record.id} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                    <img src={photo.previewUrl} alt={photo.record.fileName} className="h-full w-full object-cover" />
                    {!readOnly && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute right-1 top-1 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => void removeExistingPhoto(photo)}
                      disabled={isUploading}
                      aria-label={`Delete ${photo.record.fileName}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {!readOnly && kind === "completion" && existingPhotos.length > 0 && job?.status !== "waiting_review" && job?.status !== "completed" && (
            <div className="rounded-md border border-secondary/50 bg-secondary/10 p-3">
              <p className="text-sm font-medium">Ready for manager review?</p>
              <p className="mt-1 text-xs text-muted-foreground">Submitting locks the job into the review queue until a manager responds.</p>
              <Button type="button" variant="secondary" className="mt-3 w-full" onClick={handleSubmitForReview} disabled={isUploading || isSubmittingReview}>
                {isSubmittingReview ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                {isSubmittingReview ? "Submitting..." : "Submit for review"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default JobPhotoDialog;
