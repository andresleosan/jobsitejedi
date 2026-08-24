import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, Plus, Loader2, Clock, CheckCircle2, AlertCircle, PlayCircle, Users, Package, Download, XCircle, FileSpreadsheet, Edit, ChevronDown, FolderOpen, ChevronRight, Trash2, CheckSquare, Square, Building2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CreateJobDialog } from "@/components/jobs/CreateJobDialog";
import { EditJobDialog } from "@/components/jobs/EditJobDialog";
import { JobSubmissionDialog } from "@/components/jobs/JobSubmissionDialog";
import { ManagerFeedbackDialog } from "@/components/jobs/ManagerFeedbackDialog";
import { BulkJobUploadDialog } from "@/components/jobs/BulkJobUploadDialog";
import { JobCard } from "@/components/jobs/JobCard";
import { getThumbnailPath } from "@/lib/imageUtils";
import { getStoragePath, storage } from "@/lib/storage";

export default function ProjectDetails() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [project, setProject] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [userRole, setUserRole] = useState<"manager" | "builder" | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [selectedJobForSubmission, setSelectedJobForSubmission] = useState<string | null>(null);
  const [selectedJobForFeedback, setSelectedJobForFeedback] = useState<string | null>(null);
  const [selectedJobForEdit, setSelectedJobForEdit] = useState<any | null>(null);
  const [activeWorkers, setActiveWorkers] = useState<{ [key: string]: any[] }>({});
  const [photoUrls, setPhotoUrls] = useState<{ [key: string]: string[] }>({});
  const [managerFeedbackPhotoUrls, setManagerFeedbackPhotoUrls] = useState<{ [key: string]: string[] }>({});
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  
  // Selection mode state for bulk delete
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Loading animation state
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStage, setLoadingStage] = useState("Initializing...");

  // Loading animation effect
  useEffect(() => {
    if (isLoading) {
      setLoadingProgress(0);
      setLoadingStage("Initializing...");
      
      const stages = [
        { progress: 15, stage: "Connecting to database...", delay: 200 },
        { progress: 30, stage: "Loading project details...", delay: 400 },
        { progress: 50, stage: "Fetching jobs...", delay: 600 },
        { progress: 70, stage: "Loading time tracking...", delay: 800 },
        { progress: 85, stage: "Preparing workspace...", delay: 1000 },
        { progress: 95, stage: "Almost ready...", delay: 1200 },
      ];
      
      const timers: NodeJS.Timeout[] = [];
      
      stages.forEach(({ progress, stage, delay }) => {
        const timer = setTimeout(() => {
          setLoadingProgress(progress);
          setLoadingStage(stage);
        }, delay);
        timers.push(timer);
      });
      
      return () => timers.forEach(clearTimeout);
    } else {
      // Complete the animation when loading finishes
      setLoadingProgress(100);
      setLoadingStage("Complete!");
    }
  }, [isLoading]);

  // Group jobs by section
  const groupedJobs = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    const unsectioned: any[] = [];
    
    jobs.forEach(job => {
      if (job.section) {
        if (!groups[job.section]) {
          groups[job.section] = [];
        }
        groups[job.section].push(job);
      } else {
        unsectioned.push(job);
      }
    });
    
    // Sort sections alphabetically
    const sortedGroups = Object.keys(groups).sort().reduce((acc, key) => {
      acc[key] = groups[key];
      return acc;
    }, {} as { [key: string]: any[] });
    
    return { sections: sortedGroups, unsectioned };
  }, [jobs]);

  // Sections start collapsed by default - no initialization needed

  const toggleSection = (section: string) => {
    setOpenSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

  // Selection mode functions
  const toggleJobSelection = (jobId: string) => {
    setSelectedJobs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(jobId)) {
        newSet.delete(jobId);
      } else {
        newSet.add(jobId);
      }
      return newSet;
    });
  };

  const selectAllJobs = () => {
    const allJobIds = jobs.map(j => j.id);
    setSelectedJobs(new Set(allJobIds));
  };

  const deselectAllJobs = () => {
    setSelectedJobs(new Set());
  };

  const toggleSelectionMode = () => {
    if (selectionMode) {
      setSelectionMode(false);
      setSelectedJobs(new Set());
    } else {
      setSelectionMode(true);
    }
  };

  const handleDeleteSelectedJobs = async () => {
    if (selectedJobs.size === 0) return;
    
    setIsDeleting(true);
    try {
      // Delete jobs one by one (Supabase doesn't have bulk delete with .in() for managers)
      for (const jobId of selectedJobs) {
        // First delete related records
        await supabase.from("job_photos").delete().eq("job_id", jobId);
        await supabase.from("job_time_tracking").delete().eq("job_id", jobId);
        await supabase.from("job_materials").delete().eq("job_id", jobId);
        
        // Delete job completions and their photos
        const { data: completions } = await supabase
          .from("job_completions")
          .select("id")
          .eq("job_id", jobId);
        
        if (completions) {
          for (const completion of completions) {
            await supabase.from("job_completion_photos").delete().eq("completion_id", completion.id);
            await supabase.from("job_collaborators").delete().eq("job_completion_id", completion.id);
          }
        }
        await supabase.from("job_completions").delete().eq("job_id", jobId);
        
        // Finally delete the job
        const { error } = await supabase.from("jobs").delete().eq("id", jobId);
        if (error) throw error;
      }

      toast({
        title: "Success",
        description: `${selectedJobs.size} job(s) deleted successfully`,
      });

      setSelectedJobs(new Set());
      setSelectionMode(false);
      setShowDeleteConfirm(false);
      fetchJobs();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete jobs",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    checkAuth();
    fetchProjectData();
    
    // Set up realtime subscription
    const channel = supabase
      .channel('job-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `project_id=eq.${projectId}` }, () => fetchJobs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_time_tracking' }, () => fetchJobs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_materials' }, () => fetchJobs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_usage' }, () => fetchJobs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_completions' }, () => fetchJobs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_completion_photos' }, () => fetchJobs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_collaborators' }, () => fetchJobs())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const checkAuth = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate("/auth");
        return;
      }

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .single();

      if (roleData) {
        setUserRole(roleData.role as "manager" | "builder");
      }
    } catch (error: any) {
      console.error("Error checking auth:", error);
    }
  };

  const fetchProjectData = async () => {
    try {
      setIsLoading(true);
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (projectError) throw projectError;
      setProject(projectData);

      await fetchJobs();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load project",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchJobs = async () => {
    try {
      // Fetch base jobs for this project
      const { data: jobsData, error: jobsError } = await supabase
        .from("jobs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (jobsError) throw jobsError;

      const enrichedJobs: any[] = [];
      const workersMap: { [key: string]: any[] } = {};
      const urlsMap: { [key: string]: string[] } = {};

      for (const job of jobsData || []) {
        const jobCopy: any = { ...job };

        // Creator profile
        const { data: creator } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", job.created_by)
          .maybeSingle();
        jobCopy.profiles = creator ? { full_name: creator.full_name } : null;

        // Time tracking entries
        const { data: tt } = await supabase
          .from("job_time_tracking")
          .select("*")
          .eq("job_id", job.id);
        jobCopy.job_time_tracking = tt || [];

        // Active workers (ended_at IS NULL) + names
        const { data: activeTracking } = await supabase
          .from("job_time_tracking")
          .select("id, user_id")
          .eq("job_id", job.id)
          .is("ended_at", null);
        if (activeTracking && activeTracking.length > 0) {
          const userIds = activeTracking.map((t: any) => t.user_id);
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);
          const merged = (activeTracking || []).map((t: any) => ({
            ...t,
            profiles: profs?.find((p: any) => p.id === t.user_id),
          }));
          workersMap[job.id] = merged;
        }

        // Materials used on this job
        const { data: jm } = await supabase
          .from("job_materials")
          .select("id, material_usage_id")
          .eq("job_id", job.id);
        const jmDetailed: any[] = [];
        for (const link of jm || []) {
          const { data: mu } = await supabase
            .from("material_usage")
            .select("*")
            .eq("id", link.material_usage_id)
            .maybeSingle();
          let material: any = null;
          if (mu?.material_id) {
            const { data: mat } = await supabase
              .from("materials")
              .select("*")
              .eq("id", mu.material_id)
              .maybeSingle();
            material = mat || null;
          }
          jmDetailed.push({ id: link.id, material_usage: { ...mu, materials: material } });
        }
        jobCopy.job_materials = jmDetailed;

        // Job completions (most recent first) with photos and collaborators
        const { data: completions } = await supabase
          .from("job_completions")
          .select("*")
          .eq("job_id", job.id)
          .order("completed_at", { ascending: false });
        const compsDetailed: any[] = [];
        for (const comp of completions || []) {
          const { data: photos } = await supabase
            .from("job_completion_photos")
            .select("*")
            .eq("completion_id", comp.id);

          const { data: collabs } = await supabase
            .from("job_collaborators")
            .select("*")
            .eq("job_completion_id", comp.id);

          const { data: submitter } = await supabase
            .from("profiles")
            .select("id, full_name")
            .eq("id", comp.completed_by)
            .maybeSingle();

          let collabWithProfiles: any[] = [];
          if (collabs && collabs.length > 0) {
            const collabIds = collabs.map((c: any) => c.user_id);
            const { data: collabProfs } = await supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", collabIds);
            collabWithProfiles = (collabs || []).map((c: any) => ({
              ...c,
              profiles: collabProfs?.find((p: any) => p.id === c.user_id),
            }));
          }

          const compDetail = {
            ...comp,
            job_completion_photos: photos || [],
            job_collaborators: collabWithProfiles,
            profiles: submitter ? { full_name: submitter.full_name } : null,
          };
          compsDetailed.push(compDetail);

          // Prepare signed URLs for thumbnails (faster loading)
          if (!urlsMap[job.id] && (photos?.length || 0) > 0) {
            const urls: string[] = [];
            for (const photo of photos || []) {
              // Try to get thumbnail first, fall back to original
              const thumbPath = getThumbnailPath(photo.photo_url);
              let signedUrl = await storage.createSignedUrl("job-completion-photos", thumbPath, 3600);

              // If thumbnail doesn't exist, use original
              if (!signedUrl) {
                signedUrl = await storage.createSignedUrl("job-completion-photos", photo.photo_url, 3600);
              }

              if (signedUrl) urls.push(signedUrl);
            }
            if (urls.length > 0) urlsMap[job.id] = urls;
          }
        }
        jobCopy.job_completions = compsDetailed;

        // Fetch manager feedback photos from job_photos table
        const { data: managerPhotos } = await supabase
          .from("job_photos")
          .select("*")
          .eq("job_id", job.id);
        
        if (managerPhotos && managerPhotos.length > 0) {
          jobCopy.job_photos = managerPhotos;
        } else {
          jobCopy.job_photos = [];
        }
        
        // Generate signed URLs for manager feedback photos (use thumbnails)
        const managerPhotoUrls: { [key: string]: string[] } = {};
        if (managerPhotos && managerPhotos.length > 0) {
          const urls: string[] = [];
          for (const photo of managerPhotos) {
            const photoPath = getStoragePath(photo.photo_url, "job-photos");

            // Try thumbnail first
            const thumbPath = getThumbnailPath(photoPath);
            let signedUrl = await storage.createSignedUrl("job-photos", thumbPath, 3600);

            // Fall back to original if thumbnail doesn't exist
            if (!signedUrl) {
              signedUrl = await storage.createSignedUrl("job-photos", photoPath, 3600);
            }

            if (signedUrl) {
              urls.push(signedUrl);
            }
          }
          if (urls.length > 0) managerPhotoUrls[job.id] = urls;
        }
        
        // Store manager feedback photo URLs
        setManagerFeedbackPhotoUrls(prev => ({ ...prev, ...managerPhotoUrls }));

        enrichedJobs.push(jobCopy);
      }

      setJobs(enrichedJobs);
      setActiveWorkers(workersMap);
      setPhotoUrls(urlsMap);
    } catch (error: any) {
      console.error("Error fetching jobs:", error);
    }
  };

  const startJobTracking = async (jobId: string) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { error } = await supabase
        .from("job_time_tracking")
        .insert({
          job_id: jobId,
          user_id: userData.user.id,
          project_id: projectId!,
        });

      if (error) throw error;

      toast({
        title: "Time tracking started",
        description: "Your time is now being tracked for this job",
      });
      
      fetchJobs();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start tracking",
        variant: "destructive",
      });
    }
  };

  const handleJobStatusChange = async (jobId: string, status: "completed" | "needs_correction") => {
    // If needs correction, open the feedback dialog instead
    if (status === "needs_correction") {
      setSelectedJobForFeedback(jobId);
      return;
    }

    try {
      const { error } = await supabase
        .from("jobs")
        .update({ status })
        .eq("id", jobId);

      if (error) throw error;

      toast({
        title: "Success",
        description: status === "completed" ? "Job marked as complete" : "Job needs correction",
      });
      
      fetchJobs();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update job status",
        variant: "destructive",
      });
    }
  };

  const calculateTotalTime = (timeTracking: any[]) => {
    return timeTracking.reduce((total: number, track: any) => {
      if (track.ended_at) {
        const minutes = Math.round(
          (new Date(track.ended_at).getTime() - new Date(track.started_at).getTime()) / 60000
        );
        return total + minutes;
      }
      return total;
    }, 0);
  };

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const downloadPhoto = async (photoPath: string, bucket: string = "job-completion-photos") => {
    try {
      // Extract just the path if it's a full URL
      const cleanPath = getStoragePath(photoPath, bucket);

      const data = await storage.download(bucket, cleanPath);

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = cleanPath.split("/").pop() || "photo.jpg";
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
    }
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-md px-8 space-y-8">
          {/* Animated Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
              <div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse" />
              <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 backdrop-blur-sm border border-primary/20">
                <Building2 className="h-10 w-10 text-primary animate-pulse" />
              </div>
            </div>
          </div>
          
          {/* Title */}
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold text-foreground">Loading Project</h2>
            <p className="text-sm text-muted-foreground">{loadingStage}</p>
          </div>
          
          {/* Progress Bar */}
          <div className="space-y-3">
            <div className="relative">
              <Progress 
                value={loadingProgress} 
                className="h-2 bg-muted"
              />
              <div 
                className="absolute top-0 left-0 h-2 bg-gradient-to-r from-primary/50 via-primary to-primary/50 rounded-full opacity-50 blur-sm transition-all duration-500"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <div className="flex justify-between items-center px-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-xs text-muted-foreground">Processing...</span>
              </div>
              <span className="text-sm font-semibold text-primary tabular-nums">{loadingProgress}%</span>
            </div>
          </div>
          
          {/* Loading Steps Indicator */}
          <div className="flex justify-center gap-1.5 pt-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div 
                key={i}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  loadingProgress >= (i + 1) * 20 
                    ? 'bg-primary scale-100' 
                    : 'bg-muted scale-75'
                }`}
                style={{ 
                  animationDelay: `${i * 100}ms`,
                  transform: loadingProgress >= (i + 1) * 20 ? 'scale(1)' : 'scale(0.75)'
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <p>Project not found</p>
          <Button onClick={() => navigate(-1)} className="mt-4">
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/managers")} className="shrink-0 mt-1">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl md:text-3xl font-bold break-words">{project.name}</h1>
            <p className="text-muted-foreground text-sm md:text-base">{project.description}</p>
          </div>
        </div>
        {userRole === "manager" && (
          <div className="flex flex-wrap gap-2">
            <Button 
              variant={selectionMode ? "default" : "outline"} 
              onClick={toggleSelectionMode}
              size="sm"
              className="text-xs md:text-sm"
            >
              {selectionMode ? (
                <>
                  <XCircle className="h-4 w-4 mr-1 md:mr-2" />
                  <span className="hidden sm:inline">Cancel</span>
                  <span className="sm:hidden">Cancel</span>
                </>
              ) : (
                <>
                  <CheckSquare className="h-4 w-4 mr-1 md:mr-2" />
                  <span className="hidden sm:inline">Select Jobs</span>
                  <span className="sm:hidden">Select</span>
                </>
              )}
            </Button>
            {!selectionMode && (
              <>
                <Button variant="outline" onClick={() => setShowBulkUpload(true)} size="sm" className="text-xs md:text-sm">
                  <FileSpreadsheet className="h-4 w-4 mr-1 md:mr-2" />
                  <span className="hidden sm:inline">Import from Excel</span>
                  <span className="sm:hidden">Import</span>
                </Button>
                <Button onClick={() => setShowCreateJob(true)} size="sm" className="text-xs md:text-sm">
                  <Plus className="h-4 w-4 mr-1 md:mr-2" />
                  <span className="hidden sm:inline">Create Job</span>
                  <span className="sm:hidden">Create</span>
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Selection toolbar */}
      {selectionMode && userRole === "manager" && jobs.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-3 px-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <span className="text-sm font-medium">
                  {selectedJobs.size} of {jobs.length} selected
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAllJobs} className="text-xs">
                    <CheckSquare className="h-4 w-4 mr-1" />
                    All
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAllJobs} className="text-xs">
                    <Square className="h-4 w-4 mr-1" />
                    None
                  </Button>
                </div>
              </div>
              <Button 
                variant="destructive" 
                size="sm"
                disabled={selectedJobs.size === 0}
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete ({selectedJobs.size})
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {jobs.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <p className="text-muted-foreground">No jobs yet</p>
                {userRole === "manager" && (
                  <Button className="mt-4" onClick={() => setShowCreateJob(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Job
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Section-based job organization */}
            {Object.entries(groupedJobs.sections).map(([sectionName, sectionJobs]) => {
              const isOpen = openSections.has(sectionName);
              const completedCount = sectionJobs.filter((j: any) => j.status === "completed").length;
              const pendingCount = sectionJobs.filter((j: any) => j.status === "pending" || j.status === "waiting_review").length;
              
              return (
                <Collapsible key={sectionName} open={isOpen} onOpenChange={() => toggleSection(sectionName)}>
                  <CollapsibleTrigger asChild>
                    <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <CardHeader className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {isOpen ? (
                              <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform" />
                            )}
                            <FolderOpen className="h-5 w-5 text-primary" />
                            <CardTitle className="text-lg">{sectionName}</CardTitle>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {sectionJobs.length} job{sectionJobs.length !== 1 ? "s" : ""}
                            </Badge>
                            {completedCount > 0 && (
                              <Badge variant="default" className="text-xs">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                {completedCount}
                              </Badge>
                            )}
                            {pendingCount > 0 && (
                              <Badge variant="warning" className="text-xs">
                                <Clock className="h-3 w-3 mr-1" />
                                {pendingCount}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-4 border-l-2 border-primary/20 ml-4 mt-2 space-y-3">
                    {sectionJobs.map((job: any) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        userRole={userRole}
                        activeWorkers={activeWorkers[job.id] || []}
                        photoUrls={photoUrls[job.id] || []}
                        managerFeedbackPhotoUrls={managerFeedbackPhotoUrls[job.id] || []}
                        onEdit={setSelectedJobForEdit}
                        onStartTracking={startJobTracking}
                        onSubmitForReview={setSelectedJobForSubmission}
                        onNeedsCorrection={(jobId) => handleJobStatusChange(jobId, "needs_correction")}
                        onJobDone={(jobId) => handleJobStatusChange(jobId, "completed")}
                        onDownloadPhoto={downloadPhoto}
                        calculateTotalTime={calculateTotalTime}
                        formatTime={formatTime}
                        selectionMode={selectionMode}
                        isSelected={selectedJobs.has(job.id)}
                        onToggleSelect={toggleJobSelection}
                      />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

            {/* Unsectioned jobs */}
            {groupedJobs.unsectioned.length > 0 && (
              <Collapsible 
                open={openSections.has("__unsectioned__")} 
                onOpenChange={() => toggleSection("__unsectioned__")}
              >
                <CollapsibleTrigger asChild>
                  <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <CardHeader className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {openSections.has("__unsectioned__") ? (
                            <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform" />
                          )}
                          <FolderOpen className="h-5 w-5 text-muted-foreground" />
                          <CardTitle className="text-lg text-muted-foreground">Unsectioned Jobs</CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {groupedJobs.unsectioned.length} job{groupedJobs.unsectioned.length !== 1 ? "s" : ""}
                          </Badge>
                          {groupedJobs.unsectioned.filter((j: any) => j.status === "completed").length > 0 && (
                            <Badge variant="default" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {groupedJobs.unsectioned.filter((j: any) => j.status === "completed").length}
                            </Badge>
                          )}
                          {groupedJobs.unsectioned.filter((j: any) => j.status === "pending" || j.status === "waiting_review").length > 0 && (
                            <Badge variant="warning" className="text-xs">
                              <Clock className="h-3 w-3 mr-1" />
                              {groupedJobs.unsectioned.filter((j: any) => j.status === "pending" || j.status === "waiting_review").length}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 border-l-2 border-muted ml-4 mt-2 space-y-3">
                  {groupedJobs.unsectioned.map((job: any) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      userRole={userRole}
                      activeWorkers={activeWorkers[job.id] || []}
                      photoUrls={photoUrls[job.id] || []}
                      managerFeedbackPhotoUrls={managerFeedbackPhotoUrls[job.id] || []}
                      onEdit={setSelectedJobForEdit}
                      onStartTracking={startJobTracking}
                      onSubmitForReview={setSelectedJobForSubmission}
                      onNeedsCorrection={(jobId) => handleJobStatusChange(jobId, "needs_correction")}
                      onJobDone={(jobId) => handleJobStatusChange(jobId, "completed")}
                      onDownloadPhoto={downloadPhoto}
                      calculateTotalTime={calculateTotalTime}
                      formatTime={formatTime}
                      selectionMode={selectionMode}
                      isSelected={selectedJobs.has(job.id)}
                      onToggleSelect={toggleJobSelection}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* If no sections exist yet, show jobs in a simple list */}
            {Object.keys(groupedJobs.sections).length === 0 && groupedJobs.unsectioned.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                No jobs to display
              </div>
            )}
          </>
        )}
      </div>

      {userRole === "manager" && (
        <CreateJobDialog
          open={showCreateJob}
          onOpenChange={setShowCreateJob}
          projectId={projectId!}
          onJobCreated={fetchJobs}
        />
      )}

      {showBulkUpload && (
        <BulkJobUploadDialog
          open={showBulkUpload}
          onOpenChange={setShowBulkUpload}
          projectId={projectId!}
          onJobsCreated={fetchJobs}
        />
      )}

      {selectedJobForSubmission && (
        <JobSubmissionDialog
          open={!!selectedJobForSubmission}
          onOpenChange={(open) => !open && setSelectedJobForSubmission(null)}
          jobId={selectedJobForSubmission}
          projectId={projectId!}
          onSubmitted={fetchJobs}
        />
      )}

      {selectedJobForFeedback && (
        <ManagerFeedbackDialog
          open={!!selectedJobForFeedback}
          onOpenChange={(open) => !open && setSelectedJobForFeedback(null)}
          jobId={selectedJobForFeedback}
          onSubmitted={fetchJobs}
        />
      )}

      {selectedJobForEdit && (
        <EditJobDialog
          open={!!selectedJobForEdit}
          onOpenChange={(open) => !open && setSelectedJobForEdit(null)}
          job={selectedJobForEdit}
          onJobUpdated={fetchJobs}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedJobs.size} Job(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the selected jobs 
              and all associated data including time tracking, materials, photos, and submissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteSelectedJobs}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Jobs
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
