import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, ImageIcon, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  listJobsForManager,
  reviewJob,
  type JobRecord,
} from "@/lib/firebase/repositories/jobs";
import JobPhotoDialog from "@/components/jobs/JobPhotoDialog";
import { runActiveSessionTask } from "./active-session-task";

interface ManagerJobReviewPanelProps {
  isSessionActive: () => boolean;
}

const ManagerJobReviewPanel = ({ isSessionActive }: ManagerJobReviewPanelProps) => {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [isPhotoDialogOpen, setIsPhotoDialogOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [isReviewing, setIsReviewing] = useState(false);
  const { toast } = useToast();
  const isMountedRef = useRef(true);
  const jobsRequestIdRef = useRef(0);
  const reviewRequestIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      jobsRequestIdRef.current += 1;
      reviewRequestIdRef.current += 1;
    };
  }, []);

  const fetchJobs = useCallback(async () => {
    if (!isSessionActive()) return;
    const requestId = jobsRequestIdRef.current + 1;
    jobsRequestIdRef.current = requestId;
    setIsLoading(true);
    await runActiveSessionTask({
      task: () => listJobsForManager(["waiting_review"]),
      isTaskCurrent: () => (
        isMountedRef.current && jobsRequestIdRef.current === requestId
      ),
      isSessionActive,
      onSuccess: setJobs,
      onError: (error) => {
        console.error("Error loading manager job review queue:", error);
        setJobs([]);
        toast({
          title: "Review queue unavailable",
          description: error instanceof Error ? error.message : "Jobs could not be loaded.",
          variant: "destructive",
        });
      },
      onSettled: () => setIsLoading(false),
    });
  }, [isSessionActive, toast]);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const handleReview = async (status: "completed" | "needs_correction") => {
    if (!selectedJob || !isSessionActive()) return;
    const requestId = reviewRequestIdRef.current + 1;
    reviewRequestIdRef.current = requestId;
    const isReviewCurrent = () => (
      isMountedRef.current && reviewRequestIdRef.current === requestId
    );
    setIsReviewing(true);
    try {
      await reviewJob(selectedJob.id, status, reviewNotes);
      if (!isReviewCurrent() || !isSessionActive()) return;
      toast({
        title: status === "completed" ? "Job approved" : "Correction requested",
        description: status === "completed" ? "The job is now marked completed." : "The builder can update the evidence and resubmit.",
      });
      setSelectedJob(null);
      setIsPhotoDialogOpen(false);
      setReviewNotes("");
      await fetchJobs();
    } catch (error) {
      if (!isReviewCurrent() || !isSessionActive()) return;
      toast({
        title: "Review failed",
        description: error instanceof Error ? error.message : "The job status could not be changed.",
        variant: "destructive",
      });
    } finally {
      if (isReviewCurrent()) setIsReviewing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Job review queue
        </CardTitle>
        <CardDescription>Review private work evidence before closing a job.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
        ) : jobs.length === 0 ? (
          <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">No jobs are waiting for review.</div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate font-medium">{job.title}</div>
                    <Badge variant="warning" className="shrink-0"><Clock className="h-3 w-3" /> Waiting review</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Builder: {job.builderId}</p>
                </div>
                <Button type="button" variant="outline" onClick={() => { setSelectedJob(job); setReviewNotes(""); setIsPhotoDialogOpen(true); }}>
                  <ImageIcon className="h-4 w-4" /> Review photos
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <JobPhotoDialog
        open={isPhotoDialogOpen}
        onOpenChange={(open) => {
          setIsPhotoDialogOpen(open);
        }}
        job={selectedJob}
        kind="completion"
        onUploaded={() => void fetchJobs()}
        readOnly
      />

      {selectedJob && (
        <div className="border-t p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="h-4 w-4 text-primary" />
            Decision for {selectedJob.title}
          </div>
          <Textarea
            value={reviewNotes}
            onChange={(event) => setReviewNotes(event.target.value)}
            placeholder="Optional review notes for the builder"
            className="mb-3"
            aria-label="Review notes"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="destructive" onClick={() => void handleReview("needs_correction")} disabled={isReviewing}>
              <AlertCircle className="h-4 w-4" /> Request correction
            </Button>
            <Button type="button" onClick={() => void handleReview("completed")} disabled={isReviewing}>
              {isReviewing ? <Loader2 className="animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve job
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

export default ManagerJobReviewPanel;
