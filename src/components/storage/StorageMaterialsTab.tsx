import { useState, useCallback, useEffect, useRef } from "react";
import {
  createStorageMaterial,
  deleteStorageMaterial,
  listStorageMaterials,
  updateStorageMaterial,
  type StorageMaterialRecord,
} from "@/lib/firebase/repositories/inventory";
import {
  buildPrivateStoragePath,
  createPrivateObjectUrl,
  uploadPrivateFile,
} from "@/lib/firebase/storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2, Search, Package, Camera, Upload, X, Image } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CameraCapture } from "@/components/jobs/CameraCapture";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface StorageMaterial {
  id: string;
  name: string;
  category: string;
  section: string | null;
  quantity: number;
  unit: string;
  min_stock_level: number;
  notes: string | null;
  photo_url: string | null;
  photo_display_url?: string | null;
  created_at: string;
}

const toStorageMaterial = (material: StorageMaterialRecord): StorageMaterial => ({
  id: material.id,
  name: material.name,
  category: material.category,
  section: material.section,
  quantity: material.quantity,
  unit: material.unit,
  min_stock_level: material.minStockLevel,
  notes: material.notes,
  photo_url: material.photoUrl,
  created_at: material.createdAt?.toISOString() ?? "",
});

interface StorageMaterialsTabProps {
  userId: string;
}

const CATEGORIES = ["Building Materials", "Electrical", "Plumbing", "Hardware", "Finishing", "Safety", "Other"];
const DEFAULT_SECTIONS = ["Section A", "Section B", "Section C", "Section D", "Section E", "Outdoor Storage"];
const UNITS = ["units", "kg", "liters", "meters", "pieces", "bags", "boxes", "rolls", "sheets", "sqm", "pallets"];

const StorageMaterialsTab = ({ userId }: StorageMaterialsTabProps) => {
  const [materials, setMaterials] = useState<StorageMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<StorageMaterial | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  
  // Section management
  const [sections, setSections] = useState<string[]>(DEFAULT_SECTIONS);
  const [newSectionName, setNewSectionName] = useState("");
  const [showSectionManager, setShowSectionManager] = useState(false);
  
  // Photo management
  const [showCamera, setShowCamera] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<Blob | File | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoObjectUrlsRef = useRef<string[]>([]);
  
  const [formData, setFormData] = useState({
    name: "",
    category: "Building Materials",
    section: "",
    quantity: 0,
    unit: "units",
    min_stock_level: 0,
    notes: "",
  });
  
  const { toast } = useToast();

  useEffect(() => {
    // Extract unique sections from materials and merge with defaults
    const existingSections = materials
      .map(m => m.section)
      .filter((s): s is string => s !== null && s.trim() !== "");
    const allSections = [...new Set([...DEFAULT_SECTIONS, ...existingSections])].sort();
    setSections(allSections);
  }, [materials]);

  const fetchMaterials = useCallback(async () => {
    try {
      const data = await listStorageMaterials();
      photoObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      const materialsWithObjectUrls = await Promise.all(
        data.map(async (material) => {
          const mapped = toStorageMaterial(material);
          if (!mapped.photo_url) return { ...mapped, photo_display_url: null };
          try {
            const objectUrl = await createPrivateObjectUrl(mapped.photo_url, "image/jpeg");
            photoObjectUrlsRef.current.push(objectUrl);
            return { ...mapped, photo_display_url: objectUrl };
          } catch {
            return { ...mapped, photo_display_url: null };
          }
        }),
      );
      setMaterials(materialsWithObjectUrls);
    } catch {
      toast({ title: "Error", description: "Failed to fetch materials", variant: "destructive" });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    void fetchMaterials();
    return () => {
      photoObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      photoObjectUrlsRef.current = [];
    };
  }, [fetchMaterials]);

  const uploadPhoto = async (): Promise<string | null> => {
    if (!photoFile) return null;
    
    setIsUploadingPhoto(true);
    try {
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
      const filePath = buildPrivateStoragePath("materials", userId, fileName);

      await uploadPrivateFile(filePath, photoFile, { contentType: "image/jpeg" });
      
      return filePath;
    } catch (error) {
      console.error("Error uploading photo:", error);
      toast({ title: "Error", description: "Failed to upload photo", variant: "destructive" });
      return null;
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Material name is required", variant: "destructive" });
      return;
    }

    // Upload photo if one is selected
    let photoUrl: string | null = null;
    if (photoFile) {
      photoUrl = await uploadPhoto();
    }

    if (editingMaterial) {
      try {
        await updateStorageMaterial(editingMaterial.id, {
          name: formData.name,
          category: formData.category,
          section: formData.section || null,
          quantity: formData.quantity,
          unit: formData.unit,
          minStockLevel: formData.min_stock_level,
          notes: formData.notes || null,
          photoUrl: photoUrl ?? editingMaterial.photo_url,
        });
        toast({ title: "Success", description: "Material updated" });
        await fetchMaterials();
        resetForm();
      } catch {
        toast({ title: "Error", description: "Failed to update material", variant: "destructive" });
      }
    } else {
      try {
        await createStorageMaterial({
          name: formData.name,
          category: formData.category,
          section: formData.section || null,
          quantity: formData.quantity,
          unit: formData.unit,
          minStockLevel: formData.min_stock_level,
          notes: formData.notes || null,
          photoUrl: photoUrl,
        });
        toast({ title: "Success", description: "Material added to storage" });
        await fetchMaterials();
        resetForm();
      } catch {
        toast({ title: "Error", description: "Failed to add material", variant: "destructive" });
      }
    }
  };

  const handleEdit = (material: StorageMaterial) => {
    setEditingMaterial(material);
    setFormData({
      name: material.name,
      category: material.category,
      section: material.section || "",
      quantity: material.quantity,
      unit: material.unit,
      min_stock_level: material.min_stock_level,
      notes: material.notes || "",
    });
    if (material.photo_url) {
       setPhotoPreview(material.photo_display_url || null);
    }
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteStorageMaterial(id);
      toast({ title: "Success", description: "Material deleted" });
      await fetchMaterials();
    } catch {
      toast({ title: "Error", description: "Failed to delete material", variant: "destructive" });
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      category: "Building Materials",
      section: "",
      quantity: 0,
      unit: "units",
      min_stock_level: 0,
      notes: "",
    });
    setEditingMaterial(null);
    setIsDialogOpen(false);
    setPhotoPreview(null);
    setPhotoFile(null);
    setShowSectionManager(false);
    setNewSectionName("");
  };

  // Section management handlers
  const handleAddSection = () => {
    if (!newSectionName.trim()) {
      toast({ title: "Error", description: "Section name is required", variant: "destructive" });
      return;
    }
    if (sections.includes(newSectionName.trim())) {
      toast({ title: "Error", description: "Section already exists", variant: "destructive" });
      return;
    }
    setSections([...sections, newSectionName.trim()].sort());
    setNewSectionName("");
    toast({ title: "Success", description: "Section added" });
  };

  const handleDeleteSection = (sectionToDelete: string) => {
    // Check if any materials are using this section
    const materialsInSection = materials.filter(m => m.section === sectionToDelete);
    if (materialsInSection.length > 0) {
      toast({ 
        title: "Cannot delete", 
        description: `${materialsInSection.length} material(s) are in this section. Move them first.`, 
        variant: "destructive" 
      });
      return;
    }
    setSections(sections.filter(s => s !== sectionToDelete));
    toast({ title: "Success", description: "Section deleted" });
  };

  // Photo handlers
  const handleCameraCapture = (blob: Blob) => {
    setPhotoFile(blob);
    setPhotoPreview(URL.createObjectURL(blob));
    setShowCamera(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast({ title: "Error", description: "Please select an image file", variant: "destructive" });
        return;
      }
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleRemovePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const filteredMaterials = materials.filter((m) => {
    const matchesSearch = m.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || m.category === categoryFilter;
    const matchesSection = sectionFilter === "all" || m.section === sectionFilter;
    return matchesSearch && matchesCategory && matchesSection;
  });

  const groupedMaterials = filteredMaterials.reduce((acc, material) => {
    const section = material.section || "Unassigned";
    if (!acc[section]) acc[section] = [];
    acc[section].push(material);
    return acc;
  }, {} as Record<string, StorageMaterial[]>);

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
              <Package className="h-5 w-5" />
              Storage Materials
            </CardTitle>
            <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setIsDialogOpen(open); }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Material
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle>{editingMaterial ? "Edit Material" : "Add New Material"}</DialogTitle>
                </DialogHeader>
                <ScrollArea className="flex-1 pr-4">
                  <div className="space-y-4 pt-4">
                    {/* Material Name */}
                    <div className="space-y-2">
                      <Label>Name *</Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Material name"
                      />
                    </div>
                    
                    {/* Category & Section */}
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
                        <div className="flex items-center justify-between">
                          <Label>Section</Label>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 text-xs"
                            onClick={() => setShowSectionManager(!showSectionManager)}
                          >
                            {showSectionManager ? "Hide" : "Manage"}
                          </Button>
                        </div>
                        <Select value={formData.section} onValueChange={(v) => setFormData({ ...formData, section: v })}>
                          <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                          <SelectContent>
                            {sections.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Section Manager */}
                    {showSectionManager && (
                      <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
                        <Label className="text-sm font-medium">Manage Sections</Label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="New section name"
                            value={newSectionName}
                            onChange={(e) => setNewSectionName(e.target.value)}
                            className="flex-1"
                          />
                          <Button size="sm" onClick={handleAddSection}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <Separator />
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {sections.map((section) => (
                            <div key={section} className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted">
                              <span className="text-sm">{section}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => handleDeleteSection(section)}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Quantity, Unit, Min Stock */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Quantity</Label>
                        <Input
                          type="number"
                          value={formData.quantity}
                          onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Unit</Label>
                        <Select value={formData.unit} onValueChange={(v) => setFormData({ ...formData, unit: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {UNITS.map((u) => (
                              <SelectItem key={u} value={u}>{u}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Min Stock</Label>
                        <Input
                          type="number"
                          value={formData.min_stock_level}
                          onChange={(e) => setFormData({ ...formData, min_stock_level: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    
                    {/* Notes */}
                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <Input
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        placeholder="Optional notes"
                      />
                    </div>

                    {/* Photo Section */}
                    <div className="space-y-2">
                      <Label>Photo</Label>
                      <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      
                      {photoPreview ? (
                        <div className="relative rounded-lg overflow-hidden border">
                          <img 
                            src={photoPreview} 
                            alt="Material preview" 
                            className="w-full h-40 object-cover"
                          />
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-2 right-2 h-8 w-8"
                            onClick={handleRemovePhoto}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => setShowCamera(true)}
                          >
                            <Camera className="h-4 w-4 mr-2" />
                            Take Photo
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            Upload Photo
                          </Button>
                        </div>
                      )}
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-4 pb-2">
                      <Button variant="outline" onClick={resetForm} className="flex-1">Cancel</Button>
                      <Button onClick={handleSubmit} className="flex-1" disabled={isUploadingPhoto}>
                        {isUploadingPhoto ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          editingMaterial ? "Update" : "Add Material"
                        )}
                      </Button>
                    </div>
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search materials..."
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
            <Select value={sectionFilter} onValueChange={setSectionFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Sections" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {Object.keys(groupedMaterials).length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No materials found</p>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedMaterials).map(([section, sectionMaterials]) => (
                <div key={section}>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Badge variant="outline">{section}</Badge>
                    <span className="text-sm text-muted-foreground">({sectionMaterials.length} items)</span>
                  </h3>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Min Stock</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sectionMaterials.map((material) => (
                          <TableRow key={material.id}>
                            <TableCell>
                               {material.photo_url && material.photo_display_url ? (
                                 <img
                                   src={material.photo_display_url}
                                  alt={material.name}
                                  className="h-8 w-8 rounded object-cover"
                                />
                              ) : (
                                <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                                  <Image className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{material.name}</TableCell>
                            <TableCell>{material.category}</TableCell>
                            <TableCell className="text-right">
                              {material.quantity} {material.unit}
                            </TableCell>
                            <TableCell className="text-right">
                              {material.min_stock_level} {material.unit}
                            </TableCell>
                            <TableCell>
                              {material.quantity <= material.min_stock_level ? (
                                <Badge variant="destructive">Low Stock</Badge>
                              ) : (
                                <Badge variant="secondary">In Stock</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="icon" onClick={() => handleEdit(material)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDelete(material.id)}>
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

      {/* Camera Capture Dialog */}
      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
};

export default StorageMaterialsTab;
