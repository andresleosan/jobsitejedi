import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Building2, CheckCircle2, Clock, Image, Loader2, Trash2, User } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  resolveRubbishRequest,
  subscribeToRubbishRequests,
  type RubbishRequestRecord,
} from "@/lib/firebase/repositories/inventory";
import { createPrivateObjectUrl } from "@/lib/firebase/storage";

interface ManagerRubbishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Array<{ id: string; name: string }>;
}

type Filter = "pending" | "resolved" | "all";

const ManagerRubbishDialog = ({ open, onOpenChange, projects }: ManagerRubbishDialogProps) => {
  const [requests, setRequests] = useState<RubbishRequestRecord[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("pending");
  const [isLoading, setIsLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<RubbishRequestRecord | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<string[] | null>(null);
  const { toast } = useToast();

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const visibleRequests = useMemo(
    () => requests.filter((request) => filter === "all" || request.status === filter),
    [filter, requests],
  );
  const privatePhotoPathsKey = useMemo(
    () => JSON.stringify([...new Set(requests.flatMap((request) => request.photoPaths))].sort()),
    [requests],
  );
  const pendingCount = requests.filter((request) => request.status === "pending").length;

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

  const resolveRequest = async () => {
    if (!confirmRequest) return;
    setResolvingId(confirmRequest.id);
    try {
      await resolveRubbishRequest(confirmRequest.id);
      toast({ title: "Collection resolved", description: "The request remains available as an audit record." });
      setConfirmRequest(null);
    } catch (error) {
      toast({
        title: "Unable to resolve request",
        description: error instanceof Error ? error.message : "The status could not be updated.",
        variant: "destructive",
      });
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Trash2 className="h-5 w-5 text-orange-600" />
              Rubbish collection requests
              {pendingCount > 0 && (
                <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">{pendingCount} pending</Badge>
              )}
            </DialogTitle>
            <DialogDescription>Review private evidence and close completed pickups.</DialogDescription>
          </DialogHeader>

          <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>

          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin" /></div>
          ) : visibleRequests.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              No {filter === "all" ? "" : filter} collection requests.
            </div>
          ) : (
            <div className="space-y-4">
              {visibleRequests.map((request) => {
                const urls = request.photoPaths.map((path) => photoUrls[path]).filter(Boolean);
                return (
                  <article key={request.id} className="space-y-3 rounded-xl border bg-card p-4" data-testid="rubbish-request">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <Badge
                          variant="secondary"
                          className={request.status === "resolved"
                            ? "gap-1 bg-emerald-100 text-emerald-800"
                            : "gap-1 bg-amber-100 text-amber-800"}
                        >
                          {request.status === "resolved"
                            ? <CheckCircle2 className="h-3 w-3" />
                            : <Clock className="h-3 w-3" />}
                          {request.status === "resolved" ? "Resolved" : "Pending"}
                        </Badge>
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <Building2 className="h-4 w-4 text-primary" />
                          {projectNames.get(request.projectId) ?? request.projectId}
                        </p>
                      </div>
                      <time className="text-xs text-muted-foreground">
                        {request.createdAt ? format(request.createdAt, "dd MMM yyyy, HH:mm") : "Syncing"}
                      </time>
                    </div>

                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-4 w-4" />
                      Requested by {request.requestedByName ?? request.userId}
                    </p>

                    <div className="space-y-2">
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Image className="h-4 w-4" />
                        {request.photoPaths.length} private photo{request.photoPaths.length === 1 ? "" : "s"}
                      </p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {urls.slice(0, 6).map((url, index) => (
                          <button
                            key={url}
                            type="button"
                            className="aspect-square overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Open rubbish photo ${index + 1}`}
                            onClick={() => setSelectedPhotos(urls)}
                          >
                            <img src={url} alt="" className="h-full w-full object-cover transition-opacity hover:opacity-80" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {request.description && <p className="rounded-md bg-muted/60 p-3 text-sm">{request.description}</p>}
                    {request.resolvedAt && (
                      <p className="text-xs text-emerald-700">Resolved {format(request.resolvedAt, "dd MMM yyyy, HH:mm")}</p>
                    )}
                    {request.status === "pending" && (
                      <div className="border-t pt-3">
                        <Button size="sm" disabled={resolvingId === request.id} onClick={() => setConfirmRequest(request)}>
                          {resolvingId === request.id && <Loader2 className="h-4 w-4 animate-spin" />}
                          Mark resolved
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={selectedPhotos !== null} onOpenChange={(nextOpen) => !nextOpen && setSelectedPhotos(null)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Rubbish evidence ({selectedPhotos?.length ?? 0})</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {selectedPhotos?.map((url, index) => (
              <img key={url} src={url} alt={`Rubbish evidence ${index + 1}`} className="aspect-square w-full rounded-lg object-cover" />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRequest !== null} onOpenChange={(nextOpen) => !nextOpen && setConfirmRequest(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this pickup as resolved?</AlertDialogTitle>
            <AlertDialogDescription>
              This closes the request and preserves its photos and details for audit history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resolveRequest}>Confirm resolved</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ManagerRubbishDialog;
