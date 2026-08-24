import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getStoragePath, storage } from "@/lib/storage";
import { Loader2, Trash2, CheckCircle2, Clock, User, Building2, Image } from "lucide-react";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface RubbishRequest {
  id: string;
  user_id: string;
  project_id: string;
  photo_url: string | null;
  description: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  project_name?: string;
  builder_name?: string;
}

interface ManagerRubbishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ManagerRubbishDialog = ({ open, onOpenChange }: ManagerRubbishDialogProps) => {
  const [requests, setRequests] = useState<RubbishRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "resolved">("pending");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<string[] | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchRequests();
    }
  }, [open, filter]);

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from("rubbish_collection_requests")
        .select("*, projects(name)")
        .order("created_at", { ascending: false });

      if (filter !== "all") {
        query = query.eq("status", filter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch builder names
      const userIds = [...new Set(data?.map(r => r.user_id) || [])];
      let profilesMap = new Map<string, string>();

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);

        profiles?.forEach(p => profilesMap.set(p.id, p.full_name));
      }

      const mapped = await Promise.all((data || []).map(async (r) => {
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
          builder_name: profilesMap.get(r.user_id) || "Unknown",
        };
      }));

      setRequests(mapped);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to fetch requests",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolve = async (requestId: string) => {
    setResolvingId(requestId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from("rubbish_collection_requests")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id,
        })
        .eq("id", requestId);

      if (error) throw error;

      toast({
        title: "Request resolved",
        description: "The rubbish collection request has been marked as resolved",
      });

      fetchRequests();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to resolve request",
        variant: "destructive",
      });
    } finally {
      setResolvingId(null);
    }
  };

  const handleDelete = async (requestId: string) => {
    if (!confirm("Are you sure you want to delete this request?")) return;

    try {
      const { error } = await supabase
        .from("rubbish_collection_requests")
        .delete()
        .eq("id", requestId);

      if (error) throw error;

      toast({
        title: "Request deleted",
        description: "The rubbish collection request has been deleted",
      });

      fetchRequests();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete request",
        variant: "destructive",
      });
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="h-3 w-3" />
            Pending
          </span>
        );
      case "resolved":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle2 className="h-3 w-3" />
            Resolved
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {status}
          </span>
        );
    }
  };

  const pendingCount = requests.filter(r => r.status === "pending").length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-orange-500" />
              Rubbish Collection Requests
              {pendingCount > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 rounded-full">
                  {pendingCount} pending
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Filter:</span>
              <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Requests List */}
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : requests.length === 0 ? (
              <div className="text-center py-12">
                <Trash2 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No {filter !== "all" ? filter : ""} requests found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map((request) => {
                  const photoUrls = parsePhotoUrls(request.photo_url);
                  return (
                    <div
                      key={request.id}
                      className="border rounded-lg overflow-hidden bg-card"
                    >
                      <div className="p-4 space-y-3">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            {getStatusBadge(request.status)}
                            <div className="flex items-center gap-2 text-sm mt-2">
                              <Building2 className="h-4 w-4 text-primary" />
                              <span className="font-medium">{request.project_name}</span>
                            </div>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <p>{format(new Date(request.created_at), "dd MMM yyyy")}</p>
                            <p>{format(new Date(request.created_at), "HH:mm")}</p>
                          </div>
                        </div>

                        {/* Builder */}
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <User className="h-4 w-4" />
                          <span>Requested by: {request.builder_name}</span>
                        </div>

                        {/* Photos */}
                        {photoUrls.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Image className="h-4 w-4" />
                              <span>{photoUrls.length} photo{photoUrls.length > 1 ? 's' : ''}</span>
                            </div>
                            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                              {photoUrls.slice(0, 6).map((url, idx) => (
                                <img
                                  key={idx}
                                  src={url}
                                  alt={`Rubbish ${idx + 1}`}
                                  className="aspect-square object-cover rounded-md cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={() => setSelectedPhotos(photoUrls)}
                                />
                              ))}
                              {photoUrls.length > 6 && (
                                <button
                                  onClick={() => setSelectedPhotos(photoUrls)}
                                  className="aspect-square bg-muted rounded-md flex items-center justify-center text-sm text-muted-foreground hover:bg-muted/80"
                                >
                                  +{photoUrls.length - 6}
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Description */}
                        {request.description && (
                          <p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded">
                            {request.description}
                          </p>
                        )}

                        {/* Resolved info */}
                        {request.resolved_at && (
                          <p className="text-xs text-green-600">
                            Resolved on {format(new Date(request.resolved_at), "dd MMM yyyy, HH:mm")}
                          </p>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-2 border-t">
                          {request.status === "pending" && (
                            <Button
                              size="sm"
                              onClick={() => handleResolve(request.id)}
                              disabled={resolvingId === request.id}
                            >
                              {resolvingId === request.id ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                              )}
                              Mark Resolved
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(request.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Photo Gallery Modal */}
      <Dialog open={!!selectedPhotos} onOpenChange={() => setSelectedPhotos(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Photos ({selectedPhotos?.length || 0})</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {selectedPhotos?.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`Photo ${idx + 1}`}
                className="w-full aspect-square object-cover rounded-lg cursor-pointer hover:opacity-90"
                onClick={() => window.open(url, "_blank")}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ManagerRubbishDialog;
