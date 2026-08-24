import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { storage } from "@/lib/storage";
import { Loader2, ExternalLink, Download, FileText, User, Calendar, Building2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Invoice {
  id: string;
  invoice_number: string;
  date: string;
  total_amount: number;
  notes: string | null;
  image_url: string | null;
  project_id: string;
  uploaded_by: string;
  profiles: { full_name: string };
  projects: { name: string };
  suppliers: { name: string } | null;
}

interface ProjectInvoiceData {
  projectName: string;
  invoices: Invoice[];
  totalAmount: number;
}

interface InvoicesDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const InvoicesDetailDialog = ({ open, onOpenChange }: InvoicesDetailDialogProps) => {
  const [projectsData, setProjectsData] = useState<ProjectInvoiceData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchInvoices();
    }
  }, [open]);

  const fetchInvoices = async () => {
    setIsLoading(true);
    try {
      // Get invoices from last 60 days
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      
      const { data, error } = await supabase
        .from("invoices")
        .select(`
          *,
          projects(name),
          suppliers(name)
        `)
        .gte("date", sixtyDaysAgo.toISOString().split('T')[0])
        .order("date", { ascending: false });

      if (error) {
        console.error("Error fetching invoices:", error);
        setIsLoading(false);
        return;
      }

      if (!data || data.length === 0) {
        setProjectsData([]);
        setIsLoading(false);
        return;
      }

      // Fetch all unique uploader profiles
      const uploaderIds = [...new Set(data.map(inv => inv.uploaded_by))];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", uploaderIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p.full_name]) || []);

      // Group by project
      const grouped = data.reduce((acc, invoice) => {
        const projectName = invoice.projects?.name || "Unknown Project";
        if (!acc[projectName]) {
          acc[projectName] = {
            projectName,
            invoices: [],
            totalAmount: 0,
          };
        }
        acc[projectName].invoices.push({
          ...invoice,
          profiles: { full_name: profilesMap.get(invoice.uploaded_by) || "Unknown" }
        });
        acc[projectName].totalAmount += Number(invoice.total_amount || 0);
        return acc;
      }, {} as Record<string, ProjectInvoiceData>);

      setProjectsData(Object.values(grouped));
    } catch (err) {
      console.error("Error in fetchInvoices:", err);
    }
    setIsLoading(false);
  };

  const getSignedUrl = async (path: string) => {
    return storage.createSignedUrl("invoices", path, 3600);
  };

  const handleViewImage = async (imageUrl: string) => {
    const url = await getSignedUrl(imageUrl);
    if (url) {
      setSelectedImage(url);
    }
  };

  const handleDownloadImage = async (imageUrl: string, invoiceNumber: string) => {
    try {
      const url = await getSignedUrl(imageUrl);
      if (!url) return;

      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `invoice-${invoiceNumber}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      toast({
        title: "Download started",
        description: "Invoice image is being downloaded",
      });
    } catch (error) {
      console.error("Error downloading image:", error);
      toast({
        title: "Download failed",
        description: "Failed to download invoice image",
        variant: "destructive",
      });
    }
  };

  const InvoiceCard = ({ invoice }: { invoice: Invoice }) => (
    <Card className="mb-3">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">#{invoice.invoice_number}</span>
          </div>
          <Badge variant="secondary" className="text-sm font-bold">
            £{Number(invoice.total_amount).toFixed(2)}
          </Badge>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{invoice.suppliers?.name || "No supplier"}</span>
          </div>
          
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{new Date(invoice.date).toLocaleDateString()}</span>
          </div>
          
          <div className="flex items-center gap-2 text-muted-foreground">
            <User className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{invoice.profiles.full_name}</span>
          </div>

          {invoice.notes && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground italic line-clamp-2">
                {invoice.notes}
              </p>
            </div>
          )}
        </div>

        {invoice.image_url && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-border">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => handleViewImage(invoice.image_url!)}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              View
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => handleDownloadImage(invoice.image_url!, invoice.invoice_number)}
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg w-[95vw] h-[85vh] max-h-[85vh] p-0 flex flex-col overflow-hidden">
          <DialogHeader className="p-4 pb-2 flex-shrink-0 border-b border-border">
            <DialogTitle className="text-lg">Invoices Details</DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 overflow-hidden">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : projectsData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mb-2" />
                <p>No invoices found</p>
              </div>
            ) : (
              <Tabs defaultValue={projectsData[0]?.projectName || "all"} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <div className="flex-shrink-0 overflow-x-auto py-2">
                  <TabsList className="inline-flex w-full justify-start h-auto p-1 flex-wrap gap-1">
                    {projectsData.map((project) => (
                      <TabsTrigger 
                        key={project.projectName} 
                        value={project.projectName} 
                        className="text-xs px-2 py-1.5 whitespace-nowrap"
                      >
                        {project.projectName.length > 12 
                          ? `${project.projectName.substring(0, 12)}...` 
                          : project.projectName
                        }
                        <span className="ml-1 text-[10px] opacity-75">
                          (£{project.totalAmount.toFixed(0)})
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden">
                  {projectsData.map((project) => (
                    <TabsContent 
                      key={project.projectName} 
                      value={project.projectName}
                      className="h-full mt-0 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden"
                    >
                      <div className="flex items-center justify-between mb-3 px-1 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {project.invoices.length} invoice{project.invoices.length !== 1 ? 's' : ''}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          Total: £{project.totalAmount.toFixed(2)}
                        </Badge>
                      </div>
                      <ScrollArea className="flex-1 min-h-0">
                        <div className="pr-3 pb-6 space-y-3">
                          {project.invoices.map((invoice) => (
                            <InvoiceCard key={invoice.id} invoice={invoice} />
                          ))}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                  ))}
                </div>
              </Tabs>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {selectedImage && (
        <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
          <DialogContent className="max-w-[95vw] w-auto p-2">
            <DialogHeader className="p-2">
              <DialogTitle className="text-base">Invoice Image</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[75vh]">
              <img src={selectedImage} alt="Invoice" className="w-full h-auto rounded" />
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default InvoicesDetailDialog;
