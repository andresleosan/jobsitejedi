import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Clock, Loader2, Package, RotateCcw, Truck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  checkOutToolRequest,
  returnTool,
  subscribeToStorageTools,
  subscribeToToolRequests,
  updateToolRequest,
  type StorageToolRecord,
  type ToolRequestRecord,
  type ToolRequestStatus,
} from "@/lib/firebase/repositories/inventory";
import { listProjects, type ProjectRecord } from "@/lib/firebase/repositories/projects";

type RequestFilter = "active" | ToolRequestStatus | "all";

interface ToolRequestsManagementProps {
  managerName: string;
}

const shortUserId = (value: string | null) => {
  if (!value) return "-";
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
};

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

const ToolRequestsManagement = ({ managerName }: ToolRequestsManagementProps) => {
  const [requests, setRequests] = useState<ToolRequestRecord[]>([]);
  const [tools, setTools] = useState<StorageToolRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RequestFilter>("active");
  const { toast } = useToast();

  useEffect(() => {
    let disposed = false;
    let unsubscribeRequests = () => undefined;
    const unsubscribeTools = subscribeToStorageTools(
      setTools,
      () => toast({ title: "Error", description: "Failed to load tool details", variant: "destructive" }),
    );

    void listProjects()
      .then((records) => {
        if (!disposed) setProjects(records);
      })
      .catch(() => toast({ title: "Error", description: "Failed to load project details", variant: "destructive" }));

    void subscribeToToolRequests(
      (records) => {
        if (!disposed) {
          setRequests(records);
          setIsLoading(false);
        }
      },
      () => {
        if (!disposed) setIsLoading(false);
        toast({ title: "Error", description: "Failed to fetch requests", variant: "destructive" });
      },
      { scope: "all" },
    ).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else unsubscribeRequests = unsubscribe;
    }).catch(() => {
      if (!disposed) setIsLoading(false);
      toast({ title: "Error", description: "Failed to fetch requests", variant: "destructive" });
    });

    return () => {
      disposed = true;
      unsubscribeTools();
      unsubscribeRequests();
    };
  }, [toast]);

  const toolById = useMemo(() => new Map(tools.map((tool) => [tool.id, tool])), [tools]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const activeStatuses: ToolRequestStatus[] = ["pending", "approved", "picked_up", "delivered"];
  const visibleRequests = requests.filter((request) =>
    filter === "all" || (filter === "active" ? activeStatuses.includes(request.status) : request.status === filter));
  const pendingCount = requests.filter((request) => request.status === "pending").length;

  const runAction = async (request: ToolRequestRecord, action: () => Promise<unknown>, description: string) => {
    setBusyRequestId(request.id);
    try {
      await action();
      toast({ title: "Request updated", description });
    } catch {
      toast({ title: "Update failed", description: "The request could not be updated.", variant: "destructive" });
    } finally {
      setBusyRequestId(null);
    }
  };

  const actionButtons = (request: ToolRequestRecord) => {
    const busy = busyRequestId === request.id;
    if (request.status === "pending") {
      return (
        <Button size="sm" disabled={busy} onClick={() => void runAction(
          request,
          () => updateToolRequest({ requestId: request.id, status: "approved" }),
          `Approved by ${managerName}.`,
        )}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1 h-4 w-4" />}
          Approve
        </Button>
      );
    }
    if (request.status === "approved") {
      return (
        <Button size="sm" disabled={busy} onClick={() => void runAction(
          request,
          () => checkOutToolRequest({ requestId: request.id }),
          "Tool checked out and assigned to the requester.",
        )}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Truck className="mr-1 h-4 w-4" />}
          Check out
        </Button>
      );
    }
    if (request.status === "picked_up") {
      return (
        <Button size="sm" disabled={busy} onClick={() => void runAction(
          request,
          () => updateToolRequest({ requestId: request.id, status: "delivered" }),
          "Tool marked as delivered.",
        )}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Package className="mr-1 h-4 w-4" />}
          Delivered
        </Button>
      );
    }
    if (request.status === "delivered" && request.checkoutId) {
      return (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void runAction(
          request,
          () => returnTool({ checkoutId: request.checkoutId as string, conditionOnReturn: "good" }),
          "Tool returned to storage and marked as available.",
        )}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
          Back to Yard
        </Button>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Loading tool requests">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Wrench className="h-5 w-5" />
              Requested Tools
              {pendingCount > 0 && <Badge variant="destructive">{pendingCount} Waiting approval</Badge>}
            </CardTitle>
            <Select value={filter} onValueChange={(value) => setFilter(value as RequestFilter)}>
              <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter tool requests">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active Requests</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="picked_up">Picked Up</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="returned">Returned</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {visibleRequests.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No requests found</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Picked Up By</TableHead>
                    <TableHead>Delivered By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRequests.map((request) => {
                    const tool = toolById.get(request.toolId);
                    const project = projectById.get(request.projectId);
                    return (
                      <TableRow key={request.id}>
                        <TableCell>
                          <p className="font-medium">{tool?.name || "Unknown tool"}</p>
                          <p className="text-xs text-muted-foreground">
                            {tool?.category || "Uncategorized"}{tool?.serialNumber ? ` · ${tool.serialNumber}` : ""}
                          </p>
                        </TableCell>
                        <TableCell>{request.requestedByName || shortUserId(request.requestedBy)}</TableCell>
                        <TableCell>{project?.name || request.projectId}</TableCell>
                        <TableCell>{getStatusBadge(request.status)}</TableCell>
                        <TableCell>{shortUserId(request.pickedUpBy)}</TableCell>
                        <TableCell>{shortUserId(request.deliveredBy)}</TableCell>
                        <TableCell className="text-right">{actionButtons(request)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ToolRequestsManagement;
