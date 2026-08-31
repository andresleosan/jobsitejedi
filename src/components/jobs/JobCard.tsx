import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, CheckCircle2, AlertCircle, PlayCircle, Users, Package, Download, XCircle, Edit } from "lucide-react";
import { isManagementRole, type AppRole } from "@/lib/firebase/types";

interface ProfileSummary {
  full_name?: string | null;
}

interface ActiveWorker {
  id: string;
  user_id?: string;
  profiles?: ProfileSummary | null;
}

interface MaterialUsage {
  quantity_used?: number | null;
  materials?: {
    cost_per_unit?: number | null;
    name?: string | null;
    unit?: string | null;
  } | null;
}

interface JobMaterial {
  id: string;
  material_usage?: MaterialUsage | null;
}

interface JobCollaborator {
  user_id: string;
  profiles?: ProfileSummary | null;
}

interface JobCompletionPhoto {
  photo_url: string;
}

interface JobCompletion {
  profiles?: ProfileSummary | null;
  notes?: string | null;
  job_collaborators?: JobCollaborator[];
  job_completion_photos: JobCompletionPhoto[];
}

interface JobPhoto {
  photo_url: string;
}

interface JobCardJob {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  profiles?: ProfileSummary | null;
  job_completions?: JobCompletion[];
  job_time_tracking?: unknown[];
  job_materials?: JobMaterial[];
  manager_feedback?: string | null;
  job_photos?: JobPhoto[];
}

interface JobCardProps {
  job: JobCardJob;
  userRole: AppRole | null;
  activeWorkers: ActiveWorker[];
  photoUrls: string[];
  managerFeedbackPhotoUrls: string[];
  onEdit: (job: JobCardJob) => void;
  onStartTracking: (jobId: string) => void;
  onSubmitForReview: (jobId: string) => void;
  onNeedsCorrection: (jobId: string) => void;
  onJobDone: (jobId: string) => void;
  onDownloadPhoto: (photoPath: string, bucket?: string) => void;
  calculateTotalTime: (timeTracking: unknown[]) => number;
  formatTime: (minutes: number) => string;
  // Selection mode props
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (jobId: string) => void;
}

export const JobCard = ({
  job,
  userRole,
  activeWorkers,
  photoUrls,
  managerFeedbackPhotoUrls,
  onEdit,
  onStartTracking,
  onSubmitForReview,
  onNeedsCorrection,
  onJobDone,
  onDownloadPhoto,
  calculateTotalTime,
  formatTime,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: JobCardProps) => {
  const completion = job.job_completions?.[0];
  const totalTime = calculateTotalTime(job.job_time_tracking || []);
  const workers = activeWorkers || [];
  const materials = job.job_materials || [];
  const photos = photoUrls || [];

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      approved: { label: "To Do", variant: "secondary" as const, icon: AlertCircle },
      in_progress: { label: "In Progress", variant: "default" as const, icon: PlayCircle },
      pending: { label: "Waiting for Review", variant: "warning" as const, icon: Clock },
      waiting_review: { label: "Waiting for Review", variant: "warning" as const, icon: Clock },
      needs_correction: { label: "Needs Correction", variant: "destructive" as const, icon: AlertCircle },
      completed: { label: "Job Done", variant: "default" as const, icon: CheckCircle2 },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.approved;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  return (
    <Card className={`overflow-hidden transition-all ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''}`}>
      <CardHeader className="bg-muted/30 py-4">
        <div className="flex items-start justify-between gap-4">
          {selectionMode && (
            <div className="flex items-center pt-1">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggleSelect?.(job.id)}
                className="h-5 w-5"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="mb-1">
              <CardTitle className="text-lg">{job.title}</CardTitle>
            </div>
            {job.description && (
              <CardDescription className="text-sm line-clamp-2">{job.description}</CardDescription>
            )}
            <div className="mt-2 text-xs text-muted-foreground">
              Created by {job.profiles?.full_name || "Unknown"}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            {isManagementRole(userRole) && (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => onEdit(job)}
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
            {getStatusBadge(job.status)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 px-3 sm:px-6">
        <div className="grid gap-4">
          {/* Quick Stats Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Currently Working */}
            <Card className="shadow-sm">
              <CardHeader className="pb-2 px-3 pt-3">
                <CardTitle className="text-xs sm:text-sm flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="truncate">Currently Working</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                {workers.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {workers.map((worker) => (
                      <Badge key={worker.id} variant="secondary" className="animate-pulse text-xs">
                        {worker.profiles?.full_name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No one working</p>
                )}
              </CardContent>
            </Card>

            {/* Time Worked */}
            <Card className="shadow-sm">
              <CardHeader className="pb-2 px-3 pt-3">
                <CardTitle className="text-xs sm:text-sm flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="truncate">Time Worked</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="text-xl sm:text-2xl font-bold">
                  {totalTime > 0 ? formatTime(totalTime) : "0h 0m"}
                </div>
                {job.job_time_tracking && job.job_time_tracking.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {job.job_time_tracking.length} session(s)
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Materials */}
            <Card className="shadow-sm">
              <CardHeader className="pb-2 px-3 pt-3">
                <CardTitle className="text-xs sm:text-sm flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="truncate">Materials Used</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="text-xl sm:text-2xl font-bold">{materials.length}</div>
                {materials.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    £{materials.reduce((sum, m) => {
                      const usage = m.material_usage;
                      const material = usage?.materials;
                      return sum + ((usage?.quantity_used ?? 0) * (material?.cost_per_unit ?? 0));
                    }, 0).toFixed(2)} total
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Submission Details for Waiting Review and Completed */}
          {(job.status === "pending" || job.status === "waiting_review" || job.status === "completed") && completion && (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="font-semibold text-base">Submission Details</h3>
                
                {/* Submitted by & Collaborators */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    Submitted by {completion.profiles?.full_name}
                  </Badge>
                  {completion.job_collaborators?.length > 0 && (
                    <>
                      <span className="text-sm text-muted-foreground">with</span>
                      {completion.job_collaborators.map((collab) => (
                        <Badge key={collab.user_id} variant="secondary">
                          {collab.profiles?.full_name}
                        </Badge>
                      ))}
                    </>
                  )}
                </div>

                {/* Builder Notes */}
                {completion.notes && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Builder Notes:</p>
                    <p className="text-sm bg-muted p-4 rounded-lg">{completion.notes}</p>
                  </div>
                )}

                {/* Photos */}
                {photos.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Photos ({photos.length})</p>
                    <ScrollArea className="w-full whitespace-nowrap">
                      <div className="flex gap-3 pb-4">
                        {photos.map((url, index) => (
                          <div key={index} className="relative group shrink-0">
                            <img
                              src={url}
                              alt={`Job completion ${index + 1}`}
                              className="h-24 w-24 sm:h-32 sm:w-32 object-cover rounded-lg border-2 border-border"
                              loading="lazy"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              className="absolute bottom-1 right-1 h-7 w-7 p-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                              onClick={() => {
                                const photo = completion.job_completion_photos[index];
                                if (photo) onDownloadPhoto(photo.photo_url);
                              }}
                            >
                              <Download className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  </div>
                )}

                {/* Materials Details */}
                {materials.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Materials Breakdown</p>
                    <div className="border rounded-lg divide-y">
                      {materials.map((jm) => {
                        const usage = jm.material_usage;
                        const material = usage?.materials;
                        return (
                          <div key={jm.id} className="p-3 flex justify-between items-center">
                            <div>
                              <div className="font-medium text-sm">{material?.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {usage?.quantity_used} {material?.unit}
                              </div>
                            </div>
                            <div className="font-semibold text-sm">
                              £{((usage?.quantity_used ?? 0) * (material?.cost_per_unit ?? 0)).toFixed(2)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Manager Feedback Section for Needs Correction */}
          {job.status === "needs_correction" && (job.manager_feedback || (job.job_photos && job.job_photos.length > 0)) && (
            <>
              <Separator />
              <div className="space-y-4 bg-destructive/5 p-4 rounded-lg border-2 border-destructive/20">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  <h3 className="font-semibold text-lg text-destructive">Corrections Required</h3>
                </div>
                
                {/* Manager Feedback Notes */}
                {job.manager_feedback && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Manager Feedback:</p>
                    <p className="text-sm bg-background p-4 rounded-lg border">{job.manager_feedback}</p>
                  </div>
                )}

                {/* Manager Reference Photos */}
                {job.job_photos && job.job_photos.length > 0 && managerFeedbackPhotoUrls && managerFeedbackPhotoUrls.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Reference Photos ({job.job_photos.length})</p>
                    <ScrollArea className="w-full whitespace-nowrap">
                      <div className="flex gap-3 pb-4">
                        {managerFeedbackPhotoUrls.map((signedUrl: string, index: number) => (
                          <div key={index} className="relative group shrink-0">
                            <img
                              src={signedUrl}
                              alt={`Manager reference ${index + 1}`}
                              className="h-24 w-24 sm:h-32 sm:w-32 object-cover rounded-lg border-2 border-destructive"
                              loading="lazy"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              className="absolute bottom-1 right-1 h-7 w-7 p-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                              onClick={() => {
                                const photo = job.job_photos?.[index];
                                if (photo) onDownloadPhoto(photo.photo_url, "job-photos");
                              }}
                            >
                              <Download className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 pt-4 border-t">
            {userRole === "builder" && job.status === "approved" && (
              <>
                {!workers.some(w => w.user_id === userRole) && (
                  <Button
                    variant="outline"
                    onClick={() => onStartTracking(job.id)}
                  >
                    <PlayCircle className="h-4 w-4 mr-2" />
                    Start Working
                  </Button>
                )}
                <Button onClick={() => onSubmitForReview(job.id)}>
                  Submit for Review
                </Button>
              </>
            )}
            {userRole === "builder" && job.status === "needs_correction" && (
              <Button onClick={() => onSubmitForReview(job.id)}>
                Resubmit Job
              </Button>
            )}
            {isManagementRole(userRole) && (job.status === "pending" || job.status === "waiting_review") && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => onNeedsCorrection(job.id)}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Needs Correction
                </Button>
                <Button onClick={() => onJobDone(job.id)}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Job Done
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
