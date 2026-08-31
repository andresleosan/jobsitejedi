import { useState, useEffect } from "react";
import {
  createStorageTool,
  deleteStorageTool,
  subscribeToStorageTools,
  updateStorageTool,
  type StorageToolRecord,
  type ToolStatus,
} from "@/lib/firebase/repositories/inventory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2, Search, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface StorageTool {
  id: string;
  name: string;
  category: string;
  section: string | null;
  serial_number: string | null;
  condition: string;
  status: string;
  notes: string | null;
  created_at: string;
}

const toStorageTool = (tool: StorageToolRecord): StorageTool => ({
  id: tool.id,
  name: tool.name,
  category: tool.category,
  section: tool.section,
  serial_number: tool.serialNumber,
  condition: tool.condition ?? "good",
  status: tool.status,
  notes: tool.notes,
  created_at: tool.createdAt?.toISOString() ?? "",
});

interface StorageToolsTabProps {
  userId: string;
}

const CATEGORIES = ["Power Tools", "Hand Tools", "Measuring", "Safety Equipment", "Scaffolding", "Heavy Equipment", "Other"];
const SECTIONS = ["Section A", "Section B", "Section C", "Section D", "Section E", "Outdoor Storage"];
const CONDITIONS = ["new", "good", "fair", "needs_repair"];
const STATUSES = ["available", "checked_out", "maintenance", "retired"];

const StorageToolsTab = ({ userId }: StorageToolsTabProps) => {
  const [tools, setTools] = useState<StorageTool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<StorageTool | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const [formData, setFormData] = useState({
    name: "",
    category: "Power Tools",
    section: "",
    serial_number: "",
    condition: "good",
    status: "available",
    notes: "",
  });
  
  const { toast } = useToast();

  useEffect(() => {
    if (!userId.trim()) {
      setIsLoading(false);
      return;
    }
    const unsubscribe = subscribeToStorageTools(
      (records) => {
        setTools(records.map(toStorageTool));
        setIsLoading(false);
      },
      () => {
        toast({ title: "Error", description: "Failed to fetch tools", variant: "destructive" });
        setIsLoading(false);
      },
    );

    return unsubscribe;
  }, [toast, userId]);

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Tool name is required", variant: "destructive" });
      return;
    }

    if (editingTool) {
      try {
        await updateStorageTool(editingTool.id, {
          name: formData.name,
          category: formData.category,
          section: formData.section || null,
          serialNumber: formData.serial_number || null,
          condition: formData.condition || null,
          status: formData.status as ToolStatus,
          notes: formData.notes || null,
        });
        toast({ title: "Success", description: "Tool updated" });
        resetForm();
      } catch {
        toast({ title: "Error", description: "Failed to update tool", variant: "destructive" });
      }
    } else {
      try {
        await createStorageTool({
          name: formData.name,
          category: formData.category,
          section: formData.section || null,
          serialNumber: formData.serial_number || null,
          condition: formData.condition || null,
          status: formData.status as ToolStatus,
          notes: formData.notes || null,
        });
        toast({ title: "Success", description: "Tool added to storage" });
        resetForm();
      } catch {
        toast({ title: "Error", description: "Failed to add tool", variant: "destructive" });
      }
    }
  };

  const handleEdit = (tool: StorageTool) => {
    setEditingTool(tool);
    setFormData({
      name: tool.name,
      category: tool.category,
      section: tool.section || "",
      serial_number: tool.serial_number || "",
      condition: tool.condition,
      status: tool.status,
      notes: tool.notes || "",
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteStorageTool(id);
      toast({ title: "Success", description: "Tool deleted" });
    } catch {
      toast({ title: "Error", description: "Failed to delete tool", variant: "destructive" });
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      category: "Power Tools",
      section: "",
      serial_number: "",
      condition: "good",
      status: "available",
      notes: "",
    });
    setEditingTool(null);
    setIsDialogOpen(false);
  };

  const filteredTools = tools.filter((t) => {
    const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.serial_number?.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = categoryFilter === "all" || t.category === categoryFilter;
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const groupedTools = filteredTools.reduce((acc, tool) => {
    const section = tool.section || "Unassigned";
    if (!acc[section]) acc[section] = [];
    acc[section].push(tool);
    return acc;
  }, {} as Record<string, StorageTool[]>);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "available":
        return <Badge className="bg-green-500">Available</Badge>;
      case "checked_out":
        return <Badge variant="destructive">Checked Out</Badge>;
      case "maintenance":
        return <Badge className="bg-yellow-500">Maintenance</Badge>;
      case "retired":
        return <Badge variant="secondary">Retired</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getConditionBadge = (condition: string) => {
    switch (condition) {
      case "new":
        return <Badge className="bg-blue-500">New</Badge>;
      case "good":
        return <Badge variant="secondary">Good</Badge>;
      case "fair":
        return <Badge className="bg-yellow-500">Fair</Badge>;
      case "needs_repair":
        return <Badge variant="destructive">Needs Repair</Badge>;
      default:
        return <Badge>{condition}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Storage Tools
            </CardTitle>
            <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setIsDialogOpen(open); }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Tool
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingTool ? "Edit Tool" : "Add New Tool"}</DialogTitle>
                  <DialogDescription>
                    {editingTool
                      ? "Update the selected tool inventory record."
                      : "Register a tool in the shared inventory."}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Tool name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Section</Label>
                      <Select value={formData.section} onValueChange={(v) => setFormData({ ...formData, section: v })}>
                        <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                        <SelectContent>
                          {SECTIONS.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Serial Number</Label>
                    <Input
                      value={formData.serial_number}
                      onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                      placeholder="Optional serial number"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Condition</Label>
                      <Select value={formData.condition} onValueChange={(v) => setFormData({ ...formData, condition: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONDITIONS.map((c) => (
                            <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Input
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Optional notes"
                    />
                  </div>
                  <div className="flex gap-2 pt-4">
                    <Button variant="outline" onClick={resetForm} className="flex-1">Cancel</Button>
                    <Button onClick={handleSubmit} className="flex-1">
                      {editingTool ? "Update" : "Add Tool"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tools or serial numbers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {Object.keys(groupedTools).length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No tools found</p>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedTools).map(([section, sectionTools]) => (
                <div key={section}>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Badge variant="outline">{section}</Badge>
                    <span className="text-sm text-muted-foreground">({sectionTools.length} items)</span>
                  </h3>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Serial #</TableHead>
                          <TableHead>Condition</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sectionTools.map((tool) => (
                          <TableRow key={tool.id}>
                            <TableCell className="font-medium">{tool.name}</TableCell>
                            <TableCell>{tool.category}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {tool.serial_number || "-"}
                            </TableCell>
                            <TableCell>{getConditionBadge(tool.condition)}</TableCell>
                            <TableCell>{getStatusBadge(tool.status)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="icon" onClick={() => handleEdit(tool)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDelete(tool.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StorageToolsTab;
