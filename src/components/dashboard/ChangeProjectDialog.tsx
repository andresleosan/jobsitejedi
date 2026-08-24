import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  arriveFromTravel,
  startTravelTimeEntry,
  type TimeEntry,
} from "@/lib/firebase/repositories/timeTracking";
import { type ProjectRecord } from "@/lib/firebase/repositories/projects";
import { Loader2, MapPin, Navigation } from "lucide-react";

interface ChangeProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProjectId: string;
  projects: ProjectRecord[];
  currentTimeEntry: TimeEntry | null;
  onProjectChanged: (entry: TimeEntry) => void;
}

const getLocation = (): Promise<{ lat: number; lng: number }> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      reject,
    );
  });

const ChangeProjectDialog = ({
  open,
  onOpenChange,
  currentProjectId,
  projects,
  currentTimeEntry,
  onProjectChanged,
}: ChangeProjectDialogProps) => {
  const [newProjectId, setNewProjectId] = useState("");
  const [isTraveling, setIsTraveling] = useState(false);
  const [travelTimeEntry, setTravelTimeEntry] = useState<TimeEntry | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleStartTrip = async () => {
    if (!newProjectId || !currentTimeEntry) {
      toast({
        title: "Select a project",
        description: "Choose the project you are traveling to",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const location = await getLocation();
      const fromProject = projects.find((project) => project.id === currentProjectId);
      const toProject = projects.find((project) => project.id === newProjectId);
      const travelEntry = await startTravelTimeEntry({
        fromProjectId: currentProjectId,
        toProjectId: newProjectId,
        fromProjectName: fromProject?.name,
        toProjectName: toProject?.name,
        location,
      });

      setTravelTimeEntry(travelEntry);
      setIsTraveling(true);
      toast({
        title: "Trip started",
        description: `Traveling from ${fromProject?.name ?? "current project"} to ${toProject?.name ?? "destination"}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start trip",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleArrived = async () => {
    if (!travelTimeEntry) return;
    setIsProcessing(true);
    try {
      const location = await getLocation();
      const nextEntry = await arriveFromTravel({
        travelEntryId: travelTimeEntry.id,
        toProjectId: newProjectId,
        location,
      });
      const toProject = projects.find((project) => project.id === newProjectId);

      toast({
        title: "Arrived",
        description: `Clocked in to ${toProject?.name ?? "destination project"}`,
      });
      onProjectChanged(nextEntry);
      setNewProjectId("");
      setTravelTimeEntry(null);
      setIsTraveling(false);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to complete arrival",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const availableProjects = projects.filter((project) => project.id !== currentProjectId);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isTraveling) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-md w-[95vw]">
        <DialogHeader>
          <DialogTitle>{isTraveling ? "Traveling to Project" : "Change Project"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!isTraveling ? (
            <>
              <div>
                <Label htmlFor="new-project">Select New Project</Label>
                <Select value={newProjectId} onValueChange={setNewProjectId}>
                  <SelectTrigger id="new-project" className="mt-2">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name} - {project.clientName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleStartTrip} disabled={isProcessing || !newProjectId} className="flex-1">
                  {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Navigation className="h-4 w-4 mr-2" />}
                  {isProcessing ? "Starting..." : "Start Trip"}
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-center space-y-4 py-6">
                <div className="flex justify-center">
                  <div className="rounded-full bg-primary/10 p-4 animate-pulse">
                    <Navigation className="h-8 w-8 text-primary" />
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Traveling...</h3>
                  <p className="text-sm text-muted-foreground mt-1">Press “Arrived” when you reach the destination</p>
                </div>
              </div>

              <Button onClick={handleArrived} disabled={isProcessing} className="w-full" size="lg">
                {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MapPin className="h-4 w-4 mr-2" />}
                {isProcessing ? "Processing..." : "Arrived"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChangeProjectDialog;
