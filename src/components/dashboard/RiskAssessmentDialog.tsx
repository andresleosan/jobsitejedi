import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getStoragePath, storage } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FileText, Check, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface RiskAssessment {
  id: string;
  title: string;
  pdf_url: string;
  created_at: string;
  signed?: boolean;
  signed_at?: string;
}

interface RiskAssessmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  userId: string;
}

const RiskAssessmentDialog = ({ open, onOpenChange, projectId, userId }: RiskAssessmentDialogProps) => {
  const [assessments, setAssessments] = useState<RiskAssessment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [signingId, setSigningId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open && projectId) {
      fetchAssessments();
    }
  }, [open, projectId]);

  const fetchAssessments = async () => {
    setIsLoading(true);
    try {
      // Fetch risk assessments for the project
      const { data: assessmentsData, error: assessmentsError } = await supabase
        .from("risk_assessments")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (assessmentsError) throw assessmentsError;

      // Fetch user's signatures
      const { data: signaturesData, error: signaturesError } = await supabase
        .from("risk_assessment_signatures")
        .select("risk_assessment_id, signed_at")
        .eq("user_id", userId);

      if (signaturesError) throw signaturesError;

      // Merge data
      const signatureMap = new Map(
        signaturesData?.map(sig => [sig.risk_assessment_id, sig.signed_at]) || []
      );

      const mergedAssessments = assessmentsData?.map(assessment => ({
        ...assessment,
        signed: signatureMap.has(assessment.id),
        signed_at: signatureMap.get(assessment.id),
      })) || [];

      setAssessments(mergedAssessments);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load risk assessments",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSign = async (assessmentId: string) => {
    setSigningId(assessmentId);
    try {
      const { error } = await supabase
        .from("risk_assessment_signatures")
        .insert({
          risk_assessment_id: assessmentId,
          user_id: userId,
        });

      if (error) throw error;

      toast({
        title: "Signed",
        description: "You have agreed to this risk assessment",
      });

      // Update local state
      setAssessments(prev =>
        prev.map(a =>
          a.id === assessmentId
            ? { ...a, signed: true, signed_at: new Date().toISOString() }
            : a
        )
      );
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to sign assessment",
        variant: "destructive",
      });
    } finally {
      setSigningId(null);
    }
  };

  const openPdf = async (url: string) => {
    const path = getStoragePath(url, "documents");
    const signedUrl = await storage.createSignedUrl("documents", path, 3600);
    if (signedUrl) {
      window.open(signedUrl, "_blank");
    } else {
      toast({
        title: "Error",
        description: "Failed to open risk assessment",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Risk Assessments
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : assessments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No risk assessments for this project</p>
          </div>
        ) : (
          <div className="space-y-3">
            {assessments.map((assessment) => (
              <div
                key={assessment.id}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h4 className="font-medium">{assessment.title}</h4>
                    <p className="text-xs text-muted-foreground">
                      Added {format(new Date(assessment.created_at), "dd MMM yyyy")}
                    </p>
                  </div>
                  {assessment.signed ? (
                    <Badge variant="secondary" className="bg-green-100 text-green-700">
                      <Check className="h-3 w-3 mr-1" />
                      Agreed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-orange-600 border-orange-300">
                      Pending
                    </Badge>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openPdf(assessment.pdf_url)}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View PDF
                  </Button>
                  
                  {!assessment.signed && (
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleSign(assessment.id)}
                      disabled={signingId === assessment.id}
                    >
                      {signingId === assessment.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Check className="h-4 w-4 mr-2" />
                      )}
                      Agree
                    </Button>
                  )}
                </div>

                {assessment.signed && assessment.signed_at && (
                  <p className="text-xs text-muted-foreground">
                    Signed on {format(new Date(assessment.signed_at), "dd MMM yyyy 'at' HH:mm")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RiskAssessmentDialog;
