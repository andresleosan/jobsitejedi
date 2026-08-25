import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Package, Wrench, Loader2, Plus, ClipboardList } from "lucide-react";
import StorageMaterialsTab from "@/components/storage/StorageMaterialsTab";
import StorageToolsTab from "@/components/storage/StorageToolsTab";
import ToolCheckoutsTab from "@/components/storage/ToolCheckoutsTab";
import ToolRequestsManagement from "@/components/storage/ToolRequestsManagement";
import { useAuth } from "@/hooks/useAuth";

const Storage = () => {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    if (user.role !== "manager") {
      toast({
        title: "Access Denied",
        description: "Only managers can access storage management",
        variant: "destructive",
      });
      navigate("/builders");
    }
  }, [isLoading, navigate, toast, user]);

  if (isLoading || !user || user.role !== "manager") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/managers")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="rounded-lg bg-primary p-2">
              <Package className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Storage Management</h1>
              <p className="text-sm text-muted-foreground">Manage materials and tools inventory</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="materials" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 max-w-xl">
            <TabsTrigger value="materials" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Materials
            </TabsTrigger>
            <TabsTrigger value="tools" className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Tools
            </TabsTrigger>
            <TabsTrigger value="requests" className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Requests
            </TabsTrigger>
            <TabsTrigger value="checkouts" className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Checkouts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="materials">
            <StorageMaterialsTab userId={user.id} />
          </TabsContent>

          <TabsContent value="tools">
            <StorageToolsTab userId={user.id} />
          </TabsContent>

          <TabsContent value="requests">
            <ToolRequestsManagement managerName={user.fullName || "Manager"} />
          </TabsContent>

          <TabsContent value="checkouts">
            <ToolCheckoutsTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Storage;
