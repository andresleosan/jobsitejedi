import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CheckCircle, Clock, Loader2, Package, Plus, Search, Truck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  createToolRequest,
  subscribeToStorageTools,
  subscribeToToolRequests,
  type StorageToolRecord,
  type ToolRequestRecord,
  type ToolRequestStatus,
} from "@/lib/firebase/repositories/inventory";

interface ToolRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  userId: string;
  projectName?: string;
}

const getStatusBadge = (status: ToolRequestStatus) => {
  switch (status) {
    case "pending":
      return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Pending</Badge>;
    case "approved":
      return <Badge className="bg-sky-600"><CheckCircle className="mr-1 h-3 w-3" />Approved</Badge>;
    case "picked_up":
      return <Badge className="bg-orange-600"><Truck className="mr-1 h-3 w-3" />Picked Up</Badge>;
    case "delivered":
      return <Badge className="bg-blue-600"><Package className="mr-1 h-3 w-3" />Delivered</Badge>;
    case "returned":
      return <Badge className="bg-green-600"><CheckCircle className="mr-1 h-3 w-3" />Returned</Badge>;
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
  }
};

const ToolRequestDialog = ({
  open,
  onOpenChange,
  projectId,
  userId,
  projectName,
}: ToolRequestDialogProps) => {
  const [tools, setTools] = useState<StorageToolRecord[]>([]);
  const [myRequests, setMyRequests] = useState<ToolRequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTool, setSelectedTool] = useState<StorageToolRecord | null>(null);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("request");
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !userId.trim()) return;
    let disposed = false;
    let unsubscribeRequests = () => undefined;
    setIsLoading(true);

    const unsubscribeTools = subscribeToStorageTools(
      (records) => {
        if (!disposed) {
          setTools(records);
          setIsLoading(false);
        }
      },
      () => {
        if (!disposed) setIsLoading(false);
        toast({ title: "Error", description: "Failed to load available tools", variant: "destructive" });
      },
    );

    void subscribeToToolRequests(
      (records) => {
        if (!disposed) setMyRequests(records);
      },
      () => toast({ title: "Error", description: "Failed to load your requests", variant: "destructive" }),
      { scope: "mine" },
    ).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else unsubscribeRequests = unsubscribe;
    }).catch(() => {
      toast({ title: "Error", description: "Failed to load your requests", variant: "destructive" });
    });

    return () => {
      disposed = true;
      unsubscribeTools();
      unsubscribeRequests();
    };
  }, [open, toast, userId]);

  const toolById = useMemo(() => new Map(tools.map((tool) => [tool.id, tool])), [tools]);
  const filteredTools = tools.filter((tool) => tool.status === "available" && (
    tool.name.toLowerCase().includes(searchTerm.toLowerCase())
    || tool.category.toLowerCase().includes(searchTerm.toLowerCase())
  ));
  const activeRequestCount = myRequests.filter((request) =>
    request.status !== "returned" && request.status !== "rejected").length;

  const handleRequestTool = async () => {
    if (!selectedTool) return;
    setIsSubmitting(true);
    try {
      await createToolRequest({ toolId: selectedTool.id, projectId, notes });
      toast({ title: "Tool requested", description: `Request sent for “${selectedTool.name}”.` });
      setSelectedTool(null);
      setNotes("");
      setActiveTab("my-requests");
    } catch {
      toast({ title: "Request failed", description: "The tool request could not be created.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Request Tools - {projectName || "Project"}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="request">Request Tool</TabsTrigger>
            <TabsTrigger value="my-requests">
              My Requests
              {activeRequestCount > 0 && <Badge variant="secondary" className="ml-2">{activeRequestCount}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="request" className="mt-4 flex-1 space-y-4 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8" role="status" aria-label="Loading available tools">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search available tools..."
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-10"
                    aria-label="Search available tools"
                  />
                </div>

                {selectedTool ? (
                  <Card className="border-primary">
                    <CardContent className="space-y-4 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="font-medium">{selectedTool.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {selectedTool.category}{selectedTool.serialNumber ? ` · ${selectedTool.serialNumber}` : ""}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedTool(null)}>Change</Button>
                      </div>
                      <Textarea
                        placeholder="Add notes (optional) - e.g., when you need it, specific requirements..."
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        rows={3}
                      />
                      <Button onClick={() => void handleRequestTool()} disabled={isSubmitting} className="w-full">
                        {isSubmitting
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <Plus className="mr-2 h-4 w-4" />}
                        Request Tool
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid max-h-[400px] gap-2 overflow-auto">
                    {filteredTools.length === 0 ? (
                      <p className="py-8 text-center text-muted-foreground">No available tools found</p>
                    ) : filteredTools.map((tool) => (
                      <Button
                        key={tool.id}
                        type="button"
                        variant="outline"
                        className="h-auto w-full justify-between p-3 text-left hover:border-primary"
                        onClick={() => setSelectedTool(tool)}
                      >
                        <span>
                          <span className="block font-medium">{tool.name}</span>
                          <span className="block text-sm font-normal text-muted-foreground">
                            {tool.category}{tool.section ? ` · ${tool.section}` : ""}
                          </span>
                        </span>
                        <Badge variant="outline" className="text-green-700">Available</Badge>
                      </Button>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="my-requests" className="mt-4 flex-1 space-y-3 overflow-auto">
            {myRequests.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">No tool requests yet</p>
            ) : myRequests.map((request) => {
              const tool = toolById.get(request.toolId);
              return (
                <Card key={request.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-medium">{tool?.name || "Unknown tool"}</h4>
                        <p className="text-sm text-muted-foreground">
                          {tool?.category || "Uncategorized"}{tool?.serialNumber ? ` · ${tool.serialNumber}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          For: {request.projectId === projectId ? projectName || "Current project" : request.projectId}
                        </p>
                      </div>
                      {getStatusBadge(request.status)}
                    </div>
                    {request.notes && <p className="mt-2 rounded bg-muted p-2 text-sm">{request.notes}</p>}
                    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                      <p>Requested: {request.requestedAt ? format(request.requestedAt, "MMM d, yyyy h:mm a") : "Pending sync"}</p>
                      {request.approvedAt && <p>Approved: {format(request.approvedAt, "MMM d, h:mm a")}</p>}
                      {request.pickedUpAt && <p>Picked up: {format(request.pickedUpAt, "MMM d, h:mm a")}</p>}
                      {request.deliveredAt && <p>Delivered: {format(request.deliveredAt, "MMM d, h:mm a")}</p>}
                      {request.returnedAt && <p>Returned: {format(request.returnedAt, "MMM d, h:mm a")}</p>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default ToolRequestDialog;
