import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CheckCircle, Clock, Loader2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  returnTool,
  subscribeToStorageTools,
  subscribeToToolCheckouts,
  type StorageToolRecord,
  type ToolCheckoutRecord,
} from "@/lib/firebase/repositories/inventory";
import { listProjects, type ProjectRecord } from "@/lib/firebase/repositories/projects";

type CheckoutFilter = "active" | "returned" | "all";

const formatDateTime = (value: Date | null) => value ? format(value, "MMM d, yyyy h:mm a") : "-";
const shortUserId = (value: string) => value.length > 12 ? `${value.slice(0, 8)}…` : value;

const ToolCheckoutsTab = () => {
  const [checkouts, setCheckouts] = useState<ToolCheckoutRecord[]>([]);
  const [tools, setTools] = useState<StorageToolRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyCheckoutId, setBusyCheckoutId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CheckoutFilter>("active");
  const { toast } = useToast();

  useEffect(() => {
    let disposed = false;
    let unsubscribeCheckouts = () => undefined;
    const unsubscribeTools = subscribeToStorageTools(
      setTools,
      () => toast({ title: "Error", description: "Failed to load tool details", variant: "destructive" }),
    );

    void listProjects()
      .then((records) => {
        if (!disposed) setProjects(records);
      })
      .catch(() => toast({ title: "Error", description: "Failed to load project details", variant: "destructive" }));

    void subscribeToToolCheckouts(
      (records) => {
        if (!disposed) {
          setCheckouts(records);
          setIsLoading(false);
        }
      },
      () => {
        if (!disposed) setIsLoading(false);
        toast({ title: "Error", description: "Failed to fetch checkouts", variant: "destructive" });
      },
    ).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else unsubscribeCheckouts = unsubscribe;
    }).catch(() => {
      if (!disposed) setIsLoading(false);
      toast({ title: "Error", description: "Failed to fetch checkouts", variant: "destructive" });
    });

    return () => {
      disposed = true;
      unsubscribeTools();
      unsubscribeCheckouts();
    };
  }, [toast]);

  const toolById = useMemo(() => new Map(tools.map((tool) => [tool.id, tool])), [tools]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const visibleCheckouts = checkouts.filter((checkout) =>
    filter === "all" || (filter === "active" ? !checkout.returnedAt : Boolean(checkout.returnedAt)));
  const activeCount = checkouts.filter((checkout) => !checkout.returnedAt).length;

  const handleReturn = async (checkout: ToolCheckoutRecord) => {
    setBusyCheckoutId(checkout.id);
    try {
      await returnTool({ checkoutId: checkout.id, conditionOnReturn: "good" });
      toast({ title: "Tool returned", description: "The tool is available in storage again." });
    } catch {
      toast({ title: "Return failed", description: "The tool could not be returned.", variant: "destructive" });
    } finally {
      setBusyCheckoutId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Loading tool checkouts">
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
              <Clock className="h-5 w-5" />
              Tool Checkouts
              {activeCount > 0 && <Badge variant="destructive">{activeCount} Active</Badge>}
            </CardTitle>
            <Select value={filter} onValueChange={(value) => setFilter(value as CheckoutFilter)}>
              <SelectTrigger className="w-full sm:w-[150px]" aria-label="Filter tool checkouts">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="returned">Returned</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {visibleCheckouts.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No checkouts found</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Checked Out By</TableHead>
                    <TableHead>Checked Out</TableHead>
                    <TableHead>Expected Return</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleCheckouts.map((checkout) => {
                    const tool = toolById.get(checkout.toolId);
                    const project = projectById.get(checkout.projectId);
                    return (
                      <TableRow key={checkout.id}>
                        <TableCell>
                          <p className="font-medium">{tool?.name || "Unknown tool"}</p>
                          <p className="text-xs text-muted-foreground">
                            {tool?.category || "Uncategorized"}{tool?.serialNumber ? ` · ${tool.serialNumber}` : ""}
                          </p>
                        </TableCell>
                        <TableCell>{project?.name || checkout.projectId}</TableCell>
                        <TableCell>{checkout.checkedOutByName || shortUserId(checkout.checkedOutBy)}</TableCell>
                        <TableCell>{formatDateTime(checkout.checkedOutAt)}</TableCell>
                        <TableCell>
                          {checkout.expectedReturnDate
                            ? format(new Date(`${checkout.expectedReturnDate}T00:00:00`), "MMM d, yyyy")
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {checkout.returnedAt ? (
                            <Badge className="bg-green-600"><CheckCircle className="mr-1 h-3 w-3" />Returned</Badge>
                          ) : (
                            <Badge variant="destructive"><Clock className="mr-1 h-3 w-3" />Checked Out</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!checkout.returnedAt ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busyCheckoutId === checkout.id}
                              onClick={() => void handleReturn(checkout)}
                            >
                              {busyCheckoutId === checkout.id
                                ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                : <RotateCcw className="mr-1 h-4 w-4" />}
                              Return
                            </Button>
                          ) : (
                            <span className="text-sm text-muted-foreground">{formatDateTime(checkout.returnedAt)}</span>
                          )}
                        </TableCell>
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

export default ToolCheckoutsTab;
