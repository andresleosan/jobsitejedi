import { useState, useEffect, useCallback } from "react";
import { signOut } from "@/lib/firebase/auth";
import { listProjects, type ProjectRecord } from "@/lib/firebase/repositories/projects";
import {
  getActiveTimeEntry,
  startTimeEntry,
  stopTimeEntry,
  switchTimeEntry,
  type TimeEntry,
} from "@/lib/firebase/repositories/timeTracking";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Clock, MapPin, Repeat, Truck, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TimeTrackingCard from "./TimeTrackingCard";
import ChangeProjectDialog from "./ChangeProjectDialog";
import JobsToDoList from "@/components/jobs/JobsToDoList";
import ToolRequestDialog from "@/components/builders/ToolRequestDialog";
import MaterialDeliveryDialog from "./MaterialDeliveryDialog";

interface BuilderDashboardProps {
  userId: string;
}

const BuilderDashboard = ({ userId }: BuilderDashboardProps) => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [currentTimeEntry, setCurrentTimeEntry] = useState<TimeEntry | null>(null);
  const [isChangeProjectDialogOpen, setIsChangeProjectDialogOpen] = useState(false);
  const [isToolRequestDialogOpen, setIsToolRequestDialogOpen] = useState(false);
  const [isMaterialDeliveryDialogOpen, setIsMaterialDeliveryDialogOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const fetchProjects = useCallback(async () => {
    try {
      const data = await listProjects("active");
      setProjects(data);
      if (data.length > 0 && !selectedProjectId) setSelectedProjectId(data[0].id);
    } catch (error) {
      console.error("Error fetching projects:", error);
      return;
    }
  }, [selectedProjectId]);

  const checkClockInStatus = useCallback(async () => {
    try {
      const data = await getActiveTimeEntry();
      if (data) {
        setIsClockedIn(true);
        setCurrentTimeEntry(data);
        setSelectedProjectId(data.projectId);
      }
    } catch (error) {
      console.error("Error checking clock in status:", error);
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
    void checkClockInStatus();
  }, [checkClockInStatus, fetchProjects, userId]);

  const getLocation = (): Promise<{ lat: number; lng: number }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not supported"));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Geolocation error:", error);
          reject(error);
        }
      );
    });
  };

  const handleClockIn = async () => {
    if (!selectedProjectId) {
      toast({
        title: "Select a project",
        description: "Please select a project before clocking in",
        variant: "destructive",
      });
      return;
    }

    try {
      const location = await getLocation();

      const data = await startTimeEntry({ projectId: selectedProjectId, location });

      setIsClockedIn(true);
      setCurrentTimeEntry(data);
      toast({
        title: "Clocked In",
        description: `Started work on ${projects.find(p => p.id === selectedProjectId)?.name}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to clock in",
        variant: "destructive",
      });
    }
  };

  const handleClockOut = async () => {
    if (!currentTimeEntry) return;

    try {
      await stopTimeEntry(currentTimeEntry.id);

      setIsClockedIn(false);
      setCurrentTimeEntry(null);
      toast({
        title: "Clocked Out",
        description: "Your time has been recorded",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to clock out",
        variant: "destructive",
      });
    }
  };

  const handleProjectSwitch = async (newProjectId: string) => {
    if (isClockedIn && currentTimeEntry) {
      try {
        const location = await getLocation();
        const nextEntry = await switchTimeEntry(newProjectId, { location });
        setCurrentTimeEntry(nextEntry);
        setSelectedProjectId(newProjectId);
        toast({ title: "Project switched", description: "Time tracking continued on the new project" });
      } catch (error) {
        toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to switch project", variant: "destructive" });
      }
      return;
    }
    setSelectedProjectId(newProjectId);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({
        title: "Signed out",
        description: "Successfully signed out",
      });
      navigate("/auth");
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to sign out",
        variant: "destructive",
      });
    }
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-secondary p-2">
              <Clock className="h-5 w-5 text-secondary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Builder Dashboard</h1>
              <p className="text-sm text-muted-foreground">BuildTrack Pro</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Project Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Current Project</CardTitle>
            <CardDescription>Select the project you're working on</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              value={selectedProjectId}
              onValueChange={handleProjectSwitch}
              disabled={isClockedIn}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name} - {project.clientName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedProject && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{selectedProject.clientName}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Time Tracking */}
        <TimeTrackingCard
          isClockedIn={isClockedIn}
          currentTimeEntry={currentTimeEntry}
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
        />

        {selectedProjectId && <JobsToDoList projectId={selectedProjectId} />}

        {/* Firebase verticals still being migrated */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card
            className={isClockedIn ? "cursor-pointer hover:shadow-md transition-shadow" : "opacity-60"}
            onClick={() => isClockedIn && setIsChangeProjectDialogOpen(true)}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Repeat className="h-5 w-5 text-primary" />
                Change Project
              </CardTitle>
              <CardDescription>{isClockedIn ? "Track travel and continue the active shift" : "Clock in first"}</CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" />
                Material deliveries
              </CardTitle>
              <CardDescription>Request yard materials and follow each delivery.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                disabled={!selectedProjectId}
                onClick={() => setIsMaterialDeliveryDialogOpen(true)}
              >
                Request materials
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" />
                Tool requests
              </CardTitle>
              <CardDescription>Request available yard tools and follow their status.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                disabled={!selectedProjectId}
                onClick={() => setIsToolRequestDialogOpen(true)}
              >
                Request a tool
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      <ChangeProjectDialog
        open={isChangeProjectDialogOpen}
        onOpenChange={setIsChangeProjectDialogOpen}
        currentProjectId={selectedProjectId}
        projects={projects}
        currentTimeEntry={currentTimeEntry}
        onProjectChanged={(entry) => {
          setCurrentTimeEntry(entry);
          setIsClockedIn(true);
          setSelectedProjectId(entry.projectId);
        }}
      />

      {selectedProject && (
        <>
          <ToolRequestDialog
            open={isToolRequestDialogOpen}
            onOpenChange={setIsToolRequestDialogOpen}
            projectId={selectedProject.id}
            projectName={selectedProject.name}
            userId={userId}
          />
          <MaterialDeliveryDialog
            open={isMaterialDeliveryDialogOpen}
            onOpenChange={setIsMaterialDeliveryDialogOpen}
            projectId={selectedProject.id}
            projectName={selectedProject.name}
          />
        </>
      )}
    </div>
  );
};

export default BuilderDashboard;
