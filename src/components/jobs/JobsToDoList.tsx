import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Clock, ImagePlus, Loader2 } from "lucide-react";
import { listJobsForProject, type JobRecord, type JobStatus } from "@/lib/firebase/repositories/jobs";
import JobPhotoDialog from "./JobPhotoDialog";

interface JobsToDoListProps {
  projectId: string;
}

const statusConfig: Record<JobStatus, { label: string; variant: "secondary" | "destructive" | "warning" | "default"; icon: typeof AlertCircle }> = {
  approved: { label: "To Do", variant: "secondary", icon: AlertCircle },
  pending: { label: "Waiting for Review", variant: "warning", icon: Clock },
  waiting_review: { label: "Waiting for Review", variant: "warning", icon: Clock },
  needs_correction: { label: "Needs Correction", variant: "destructive", icon: AlertCircle },
  completed: { label: "Done", variant: "default", icon: CheckCircle2 },
};

export default function JobsToDoList({ projectId }: JobsToDoListProps) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [navigating, setNavigating] = useState(false);
  const [photoJob, setPhotoJob] = useState<JobRecord | null>(null);
  const navigate = useNavigate();

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      setJobs(await listJobsForProject(projectId));
    } catch (error) {
      console.error("Error fetching jobs:", error);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) void fetchJobs();
  }, [fetchJobs, projectId]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Jobs To Do</CardTitle>
        <Button variant="outline" size="sm" disabled={navigating} onClick={() => {
          setNavigating(true);
          navigate(`/project/${projectId}`);
        }}>
          {navigating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {navigating ? "Loading..." : "View All Jobs"}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs yet</p>
        ) : (
          <ul className="space-y-3">
            {jobs.slice(0, 6).map((job) => {
              const config = statusConfig[job.status];
              const Icon = config.icon;
              return (
                <li key={job.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{job.title}</div>
                      {job.description && <div className="line-clamp-2 text-sm text-muted-foreground">{job.description}</div>}
                      {job.section && <div className="mt-1 text-xs text-muted-foreground">Section: {job.section}</div>}
                    </div>
                    <Badge variant={config.variant} className="flex items-center gap-1">
                      <Icon className="h-3 w-3" /> {config.label}
                    </Badge>
                  </div>
                  <div className="mt-3 flex justify-end border-t pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPhotoJob(job)}
                      aria-label={`Upload photos for ${job.title}`}
                    >
                      <ImagePlus className="h-4 w-4" />
                      Upload evidence
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Evidence is stored privately and visible to the assigned builder and managers.</p>
      </CardContent>
      <JobPhotoDialog
        open={Boolean(photoJob)}
        onOpenChange={(open) => {
          if (!open) setPhotoJob(null);
        }}
        job={photoJob}
        kind="completion"
        onUploaded={() => void fetchJobs()}
      />
    </Card>
  );
}
