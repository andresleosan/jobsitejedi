import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  ImageIcon,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CreateJobDialog } from "@/components/jobs/CreateJobDialog";
import JobPhotoDialog from "@/components/jobs/JobPhotoDialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  listJobsForProject,
  reviewJob,
  type JobRecord,
  type JobStatus,
} from "@/lib/firebase/repositories/jobs";
import { getProject, type ProjectRecord } from "@/lib/firebase/repositories/projects";

const statusConfig: Record<
  JobStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "warning" }
> = {
  approved: { label: "To do", variant: "secondary" },
  pending: { label: "Pending", variant: "warning" },
  waiting_review: { label: "Waiting review", variant: "warning" },
  needs_correction: { label: "Needs correction", variant: "destructive" },
  completed: { label: "Completed", variant: "default" },
};

const ProjectDetails = () => {
  const { projectId = "" } = useParams();
  const { user, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [photoState, setPhotoState] = useState<{
    job: JobRecord;
    kind: "reference" | "completion";
    readOnly: boolean;
  } | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !user) navigate("/auth");
  }, [isAuthLoading, navigate, user]);

  const loadProject = useCallback(async () => {
    if (!projectId || !user) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextProject, nextJobs] = await Promise.all([
        getProject(projectId),
        listJobsForProject(projectId, []),
      ]);
      if (!nextProject) throw new Error("Project was not found");
      setProject(nextProject);
      setJobs(nextJobs);
    } catch (error) {
      setProject(null);
      setJobs([]);
      setErrorMessage(error instanceof Error ? error.message : "Project details could not be loaded");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, user]);

  useEffect(() => {
    if (!isAuthLoading && user) void loadProject();
  }, [isAuthLoading, loadProject, user]);

  const groupedJobs = useMemo(() => {
    const groups = new Map<string, JobRecord[]>();
    jobs.forEach((job) => {
      const section = job.section?.trim() || "General work";
      groups.set(section, [...(groups.get(section) ?? []), job]);
    });
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [jobs]);

  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const reviewCount = jobs.filter((job) => job.status === "waiting_review").length;

  const handleReview = async (job: JobRecord, status: "completed" | "needs_correction") => {
    setReviewingId(job.id);
    try {
      await reviewJob(job.id, status, reviewNotes[job.id]);
      toast({
        title: status === "completed" ? "Job approved" : "Correction requested",
        description: `${job.title} was updated.`,
      });
      await loadProject();
    } catch (error) {
      toast({
        title: "Review failed",
        description: error instanceof Error ? error.message : "The job could not be reviewed.",
        variant: "destructive",
      });
    } finally {
      setReviewingId(null);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary motion-reduce:animate-none" />
      </div>
    );
  }

  if (!user) return null;

  if (!project || errorMessage) {
    return (
      <div className="min-h-screen bg-muted/30 p-4">
        <Card className="mx-auto mt-16 max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CircleAlert className="text-destructive" />Project unavailable</CardTitle>
            <CardDescription>{errorMessage ?? "This project could not be found."}</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(user.role === "manager" ? "/managers" : "/builders")}>Go back</Button>
            <Button onClick={() => void loadProject()}><RotateCcw />Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-card/95 shadow-sm backdrop-blur">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back to dashboard"
              onClick={() => navigate(user.role === "manager" ? "/managers" : "/builders")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="rounded-lg bg-primary p-2"><Building2 className="h-5 w-5 text-primary-foreground" /></div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">{project.name}</h1>
              <p className="truncate text-sm text-muted-foreground">{project.clientName}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {user.role === "manager" && <Button variant="outline" onClick={() => navigate("/statements")}>Project statements</Button>}
            {user.role === "manager" && <Button onClick={() => setIsCreateOpen(true)}><Plus />Add job</Button>}
          </div>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Project summary">
          <Card><CardContent className="flex items-center gap-3 p-4"><BriefcaseBusiness className="text-primary" /><div><p className="text-2xl font-bold tabular-nums">{jobs.length}</p><p className="text-xs text-muted-foreground">Total jobs</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><CheckCircle2 className="text-emerald-600" /><div><p className="text-2xl font-bold tabular-nums">{completedCount}</p><p className="text-xs text-muted-foreground">Completed</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><ClipboardCheck className="text-amber-600" /><div><p className="text-2xl font-bold tabular-nums">{reviewCount}</p><p className="text-xs text-muted-foreground">Waiting review</p></div></CardContent></Card>
          <Card><CardContent className="space-y-1 p-4 text-sm"><p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />{project.address ?? "No address"}</p><p className="flex items-center gap-2 text-muted-foreground"><CalendarDays className="h-4 w-4" />{project.updatedAt ? format(project.updatedAt, "dd MMM yyyy") : "No update date"}</p></CardContent></Card>
        </section>

        {jobs.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-14 text-center"><BriefcaseBusiness className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No jobs in this project</p><p className="mt-1 text-sm text-muted-foreground">{user.role === "manager" ? "Add the first job to start the site ledger." : "Your manager has not assigned work yet."}</p></CardContent></Card>
        ) : groupedJobs.map(([section, sectionJobs]) => (
          <section key={section} aria-labelledby={`section-${section.replace(/[^a-z0-9]+/gi, "-")}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id={`section-${section.replace(/[^a-z0-9]+/gi, "-")}`} className="text-lg font-semibold">{section}</h2>
              <Badge variant="outline">{sectionJobs.length} job{sectionJobs.length === 1 ? "" : "s"}</Badge>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {sectionJobs.map((job) => {
                const status = statusConfig[job.status];
                return (
                  <Card key={job.id} data-testid="project-job" className="overflow-hidden">
                    <CardHeader className="border-b bg-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><CardTitle className="text-lg">{job.title}</CardTitle><CardDescription className="mt-1 line-clamp-2">{job.description ?? "No description"}</CardDescription></div>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 p-4">
                      {job.reviewNotes && <p className="rounded-md bg-muted/70 p-3 text-sm">Manager note: {job.reviewNotes}</p>}
                      <div className="flex flex-wrap gap-2">
                        {user.role === "manager" && <Button size="sm" variant="outline" onClick={() => setPhotoState({ job, kind: "reference", readOnly: false })}><ImageIcon />Reference photos</Button>}
                        {user.role === "manager" && ["waiting_review", "completed", "needs_correction"].includes(job.status) && <Button size="sm" variant="outline" onClick={() => setPhotoState({ job, kind: "completion", readOnly: true })}><ImageIcon />Review evidence</Button>}
                        {user.role === "builder" && ["approved", "pending", "needs_correction"].includes(job.status) && <Button size="sm" onClick={() => setPhotoState({ job, kind: "completion", readOnly: false })}><ImageIcon />Work evidence</Button>}
                      </div>
                      {user.role === "manager" && job.status === "waiting_review" && (
                        <div className="space-y-2 border-t pt-3">
                          <Textarea
                            aria-label={`Review notes for ${job.title}`}
                            value={reviewNotes[job.id] ?? ""}
                            maxLength={1_000}
                            placeholder="Optional note for the builder"
                            onChange={(event) => setReviewNotes((current) => ({ ...current, [job.id]: event.target.value }))}
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="destructive" disabled={reviewingId === job.id} onClick={() => void handleReview(job, "needs_correction")}><CircleAlert />Request correction</Button>
                            <Button size="sm" disabled={reviewingId === job.id} onClick={() => void handleReview(job, "completed")}>{reviewingId === job.id ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <CheckCircle2 />}Approve job</Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      <CreateJobDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} projectId={project.id} onJobCreated={() => void loadProject()} />
      <JobPhotoDialog
        open={Boolean(photoState)}
        onOpenChange={(open) => { if (!open) setPhotoState(null); }}
        job={photoState?.job ?? null}
        kind={photoState?.kind ?? "completion"}
        readOnly={photoState?.readOnly ?? false}
        onUploaded={() => void loadProject()}
      />
    </div>
  );
};

export default ProjectDetails;
