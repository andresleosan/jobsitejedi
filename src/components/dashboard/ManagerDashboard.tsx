import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BriefcaseBusiness, Building2, FileSpreadsheet, LogOut, Plus, ReceiptText, Trash2, Truck, Users, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { signOut } from "@/lib/firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import { listProjects, type ProjectRecord } from "@/lib/firebase/repositories/projects";
import CreateProjectDialog from "./CreateProjectDialog";
import ProjectList from "./ProjectList";
import ManagerJobReviewPanel from "./ManagerJobReviewPanel";
import ManagerMaterialDeliveryDialog from "./ManagerMaterialDeliveryDialog";
import ManagerRubbishDialog from "./ManagerRubbishDialog";
import ManagerInvoicesDialog from "./ManagerInvoicesDialog";
import JobImportDialog from "./JobImportDialog";
import SupplierCatalogDialog from "./SupplierCatalogDialog";
import ReportsRiskPanel from "./ReportsRiskPanel";
import AccessRequestsPanel from "./AccessRequestsPanel";
import AdminUsersPanel from "./AdminUsersPanel";
import { runActiveSessionTask } from "./active-session-task";
import { PwaInstallAction } from "../PwaInstallAction";

interface ManagerDashboardProps {
  userId: string;
  email: string;
  role: "admin" | "manager";
}

const roleLabel = { admin: "Admin", manager: "Manager" } as const;

const ManagerDashboard = ({ userId, email, role }: ManagerDashboardProps) => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isMaterialDeliveryOpen, setIsMaterialDeliveryOpen] = useState(false);
  const [isRubbishDialogOpen, setIsRubbishDialogOpen] = useState(false);
  const [isInvoicesDialogOpen, setIsInvoicesDialogOpen] = useState(false);
  const [isJobImportOpen, setIsJobImportOpen] = useState(false);
  const [isSupplierCatalogOpen, setIsSupplierCatalogOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const isSigningOutRef = useRef(false);
  const projectsRequestIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      projectsRequestIdRef.current += 1;
    };
  }, []);

  const ownsActiveSession = useCallback(() =>
    isMountedRef.current
    && !isSigningOutRef.current
    && !isSigningOut
    && firebaseAuth.currentUser?.uid === userId, [isSigningOut, userId]);

  const fetchProjects = useCallback(async () => {
    if (!ownsActiveSession()) return;
    const requestId = projectsRequestIdRef.current + 1;
    projectsRequestIdRef.current = requestId;
    setIsLoadingProjects(true);
    await runActiveSessionTask({
      task: listProjects,
      isTaskCurrent: () => (
        isMountedRef.current && projectsRequestIdRef.current === requestId
      ),
      isSessionActive: ownsActiveSession,
      onSuccess: setProjects,
      onError: (error) => {
        console.error("Error fetching manager projects:", error);
        toast({
          title: "Projects could not be loaded",
          description: error instanceof Error ? error.message : "Try again in a moment.",
          variant: "destructive",
        });
      },
      onSettled: () => setIsLoadingProjects(false),
    });
  }, [ownsActiveSession, toast]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const handleSignOut = async () => {
    if (isSigningOutRef.current) return;
    isSigningOutRef.current = true;
    setIsSigningOut(true);
    try {
      await signOut();
      navigate("/auth");
    } catch (error) {
      isSigningOutRef.current = false;
      setIsSigningOut(false);
      toast({
        title: "Sign out failed",
        description: error instanceof Error ? error.message : "The session could not be closed.",
        variant: "destructive",
      });
    }
  };

  const activeProjects = projects.filter((project) => project.status === "active").length;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-card shadow-sm">
        <div className="container mx-auto flex items-center justify-between gap-3 px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <Users className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold sm:text-xl">{role === "admin" ? "Admin Dashboard" : "Manager Dashboard"}</h1>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">BuildTrack Pro · {role} workspace</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <div className="hidden text-right text-xs sm:block">
              <p className="text-muted-foreground">Rol: <span className="font-semibold text-foreground">{roleLabel[role]}</span></p>
              <p className="max-w-[18rem] truncate text-muted-foreground" title={email}>Correo: <span className="font-medium text-foreground">{email}</span></p>
            </div>
            <div className="hidden sm:block"><PwaInstallAction /></div>
            <Button variant="outline" size="sm" onClick={handleSignOut} disabled={isSigningOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="border-b bg-card px-3 py-2 sm:hidden"><PwaInstallAction /></div>

      <main className="container mx-auto space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6">
        {role === "admin" && <AccessRequestsPanel isSessionActive={ownsActiveSession} />}
        {role === "admin" && <AdminUsersPanel adminId={userId} isSessionActive={ownsActiveSession} />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active projects</CardTitle>
              <BriefcaseBusiness className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{activeProjects}</div>
              <p className="text-xs text-muted-foreground">of {projects.length} total Firebase projects</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Migration scope</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">Jobs + inventory</div>
              <p className="text-xs text-muted-foreground">Photos, tools, deliveries and rubbish requests use Firebase.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Projects</CardTitle>
                <CardDescription>Manage Firebase projects and their active work.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setIsCreateProjectOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New project
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/storage">
                    <Warehouse className="h-4 w-4" />
                    Storage
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => setIsMaterialDeliveryOpen(true)}>
                  <Truck className="h-4 w-4" />
                  Deliveries
                </Button>
                <Button variant="outline" onClick={() => setIsRubbishDialogOpen(true)}>
                  <Trash2 className="h-4 w-4" />
                  Rubbish requests
                </Button>
                <Button variant="outline" onClick={() => setIsInvoicesDialogOpen(true)}>
                  <ReceiptText className="h-4 w-4" />
                  Invoice review
                </Button>
                <Button variant="outline" onClick={() => setIsSupplierCatalogOpen(true)}>
                  <Building2 className="h-4 w-4" />
                  Supplier catalogue
                </Button>
                <Button variant="outline" onClick={() => setIsJobImportOpen(true)} disabled={projects.length === 0}>
                  <FileSpreadsheet className="h-4 w-4" />
                  Import jobs
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ProjectList
              projects={projects.filter((project) => project.status === "active")}
              isLoading={isLoadingProjects}
              onProjectsChanged={fetchProjects}
            />
          </CardContent>
        </Card>

        <ManagerJobReviewPanel isSessionActive={ownsActiveSession} />

        <ReportsRiskPanel role="manager" projects={projects} />
      </main>

      <CreateProjectDialog
        open={isCreateProjectOpen}
        onOpenChange={setIsCreateProjectOpen}
        onProjectCreated={fetchProjects}
      />
      <ManagerMaterialDeliveryDialog
        open={isMaterialDeliveryOpen}
        onOpenChange={setIsMaterialDeliveryOpen}
        projects={projects}
      />
      <ManagerRubbishDialog
        open={isRubbishDialogOpen}
        onOpenChange={setIsRubbishDialogOpen}
        projects={projects}
      />
      <ManagerInvoicesDialog
        open={isInvoicesDialogOpen}
        onOpenChange={setIsInvoicesDialogOpen}
      />
      <SupplierCatalogDialog
        open={isSupplierCatalogOpen}
        onOpenChange={setIsSupplierCatalogOpen}
      />
      <JobImportDialog
        open={isJobImportOpen}
        onOpenChange={setIsJobImportOpen}
        projects={projects}
        userId={userId}
      />
    </div>
  );
};

export default ManagerDashboard;
