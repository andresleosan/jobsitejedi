import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Building2, Edit } from "lucide-react";
import EditProjectDialog from "./EditProjectDialog";
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
import { listProjects, updateProject, type ProjectRecord } from "@/lib/firebase/repositories/projects";
import { toast } from "sonner";

interface ProjectListProps {
  onProjectCreated: () => void;
}

const ProjectList = ({ onProjectCreated }: ProjectListProps) => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [navigatingToProject, setNavigatingToProject] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStage, setLoadingStage] = useState("");
  const [projectToFinish, setProjectToFinish] = useState<ProjectRecord | null>(null);
  const [isFinishDialogOpen, setIsFinishDialogOpen] = useState(false);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      setProjects(await listProjects("active"));
    } catch (error) {
      console.error("Error fetching projects:", error);
      toast.error("Failed to load projects");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects, onProjectCreated]);

  const handleConfirmFinish = async () => {
    if (!projectToFinish) return;

    try {
      await updateProject(projectToFinish.id, {
        name: projectToFinish.name,
        description: projectToFinish.description,
        clientName: projectToFinish.clientName,
        address: projectToFinish.address,
        status: "finished",
      });
      toast.success("Project moved to finished projects");
      await fetchProjects();
    } catch (error) {
      console.error("Error finishing project:", error);
      toast.error("Failed to update project status");
    } finally {
      setIsFinishDialogOpen(false);
      setProjectToFinish(null);
    }
  };

  const openProject = (projectId: string) => {
    if (navigatingToProject) return;

    setNavigatingToProject(projectId);
    setLoadingProgress(15);
    setLoadingStage("Connecting to project...");
    const stages = [
      { progress: 35, text: "Loading project data..." },
      { progress: 70, text: "Preparing dashboard..." },
      { progress: 100, text: "Almost ready..." },
    ];
    let stageIndex = 0;
    const interval = setInterval(() => {
      const stage = stages[stageIndex++];
      if (!stage) {
        clearInterval(interval);
        return;
      }
      setLoadingProgress(stage.progress);
      setLoadingStage(stage.text);
    }, 250);

    setTimeout(() => {
      clearInterval(interval);
      navigate(`/project/${projectId}`);
    }, 1000);
  };

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">Loading projects...</div>;
  }

  if (projects.length === 0) {
    return (
      <div className="py-12 text-center">
        <Building2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">No projects yet. Create your first project to get started.</p>
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-[400px]">
        <div className="space-y-4">
          {projects.map((project) => (
            <div
              key={project.id}
              className="relative cursor-pointer rounded-lg border bg-card p-4 transition-shadow hover:shadow-md"
              onClick={() => openProject(project.id)}
            >
              {navigatingToProject === project.id && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-background/95 p-6 backdrop-blur-sm">
                  <Building2 className="mb-3 h-8 w-8 animate-pulse text-primary" />
                  <div className="w-full max-w-xs space-y-2">
                    <Progress value={loadingProgress} className="h-2 bg-muted" />
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{loadingStage}</span>
                      <span className="font-semibold text-primary">{loadingProgress}%</span>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-medium">Opening {project.name}</p>
                </div>
              )}

              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{project.name}</h3>
                  <p className="text-sm text-muted-foreground">{project.clientName}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={project.status === "active" ? "default" : "secondary"}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (project.status === "active") {
                        setProjectToFinish(project);
                        setIsFinishDialogOpen(true);
                      }
                    }}
                  >
                    {project.status}
                  </Badge>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedProject(project);
                      setIsEditDialogOpen(true);
                    }}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Job and time metrics will return with the Firebase jobs vertical.
              </p>
            </div>
          ))}
        </div>
      </ScrollArea>

      <EditProjectDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onProjectUpdated={fetchProjects}
        project={selectedProject}
      />

      <AlertDialog open={isFinishDialogOpen} onOpenChange={setIsFinishDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finish Project</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to move &quot;{projectToFinish?.name}&quot; to finished projects?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmFinish}>Yes, finish project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ProjectList;
