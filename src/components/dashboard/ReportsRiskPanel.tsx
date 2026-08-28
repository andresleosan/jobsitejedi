import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardPenLine, FileText, Loader2, LockKeyhole, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  createDailyReport,
  createRiskAssessment,
  createRiskAssessmentObjectUrl,
  listDailyReports,
  listRiskAssessmentSignatures,
  listRiskAssessments,
  signRiskAssessment,
  type DailyReportRecord,
  type RiskAssessmentRecord,
  type RiskAssessmentSignatureRecord,
} from "@/lib/firebase/repositories/reports";
import type { ProjectRecord } from "@/lib/firebase/repositories/projects";

interface ReportsRiskPanelProps {
  role: "builder" | "manager";
  projects: ProjectRecord[];
  selectedProjectId?: string;
}

const formatDate = (value: Date | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value)
  : "Pending timestamp";

const today = () => new Date().toISOString().slice(0, 10);

const ReportsRiskPanel = ({ role, projects, selectedProjectId }: ReportsRiskPanelProps) => {
  const [managerProjectId, setManagerProjectId] = useState("");
  const [reports, setReports] = useState<DailyReportRecord[]>([]);
  const [assessments, setAssessments] = useState<RiskAssessmentRecord[]>([]);
  const [signatures, setSignatures] = useState<Record<string, RiskAssessmentSignatureRecord[]>>({});
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentFile, setAssessmentFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReportSubmitting, setIsReportSubmitting] = useState(false);
  const [isAssessmentSubmitting, setIsAssessmentSubmitting] = useState(false);
  const [signingAssessmentId, setSigningAssessmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const activeProjectId = role === "manager" ? managerProjectId : (selectedProjectId ?? "");
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId),
    [activeProjectId, projects],
  );

  const loadData = useCallback(async () => {
    if (!activeProjectId) {
      setReports([]);
      setAssessments([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [nextReports, nextAssessments] = await Promise.all([
        listDailyReports(activeProjectId),
        listRiskAssessments(activeProjectId),
      ]);
      setReports(nextReports);
      setAssessments(nextAssessments);
      if (role === "builder") {
        const signatureEntries = await Promise.all(nextAssessments.map(async (assessment) => [
          assessment.id,
          await listRiskAssessmentSignatures(assessment.id),
        ] as const));
        setSignatures(Object.fromEntries(signatureEntries));
      } else {
        setSignatures({});
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The reports could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [activeProjectId, role]);

  useEffect(() => {
    if (role === "manager" && !managerProjectId && projects.length > 0) {
      setManagerProjectId(projects[0].id);
      return;
    }
    void loadData();
  }, [loadData, managerProjectId, projects, role]);

  const loadSignatures = async (assessmentId: string) => {
    try {
      const result = await listRiskAssessmentSignatures(assessmentId);
      setSignatures((current) => ({ ...current, [assessmentId]: result }));
    } catch (signatureError) {
      setError(signatureError instanceof Error ? signatureError.message : "Signatures could not be loaded.");
    }
  };

  const handleReportSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeProjectId) return;
    setIsReportSubmitting(true);
    setError(null);
    try {
      const created = await createDailyReport({ projectId: activeProjectId, date, description });
      setReports((current) => [created, ...current]);
      setDescription("");
      toast({ title: "Report saved", description: "The daily report is now available to the project team." });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The daily report could not be saved.");
    } finally {
      setIsReportSubmitting(false);
    }
  };

  const handleAssessmentSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeProjectId || !assessmentFile) return;
    setIsAssessmentSubmitting(true);
    setError(null);
    try {
      const created = await createRiskAssessment({
        projectId: activeProjectId,
        title: assessmentTitle,
        file: assessmentFile,
      });
      setAssessments((current) => [created, ...current]);
      setAssessmentTitle("");
      setAssessmentFile(null);
      toast({ title: "Assessment uploaded", description: "The private PDF is ready for builder sign-off." });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The risk assessment could not be uploaded.");
    } finally {
      setIsAssessmentSubmitting(false);
    }
  };

  const handleOpenAssessment = async (assessment: RiskAssessmentRecord) => {
    try {
      const url = await createRiskAssessmentObjectUrl(assessment);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "The private document could not be opened.");
    }
  };

  const handleSign = async (assessment: RiskAssessmentRecord) => {
    setSigningAssessmentId(assessment.id);
    setError(null);
    try {
      const signature = await signRiskAssessment(assessment.id);
      setSignatures((current) => ({ ...current, [assessment.id]: [signature] }));
      toast({ title: "Assessment signed", description: "Your signature has been recorded." });
    } catch (signError) {
      setError(signError instanceof Error ? signError.message : "The assessment could not be signed.");
    } finally {
      setSigningAssessmentId(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="reports-risk-title">
      <div>
        <h2 id="reports-risk-title" className="text-lg font-semibold">Reports and risk</h2>
        <p className="text-sm text-muted-foreground">
          Keep daily site activity and private safety documents together for {activeProject?.name ?? "the selected project"}.
        </p>
      </div>

      {role === "manager" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Project context</CardTitle>
            <CardDescription>Choose the project whose reports and safety documents you want to review.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="reports-project">Project</Label>
            <Select value={managerProjectId} onValueChange={setManagerProjectId} disabled={projects.length === 0}>
              <SelectTrigger id="reports-project" aria-label="Project for reports and risk">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name} · {project.clientName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not complete the request</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!activeProjectId ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Choose a project to view reports and risk documents.</CardContent></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {role === "builder" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ClipboardPenLine className="h-5 w-5 text-primary" />Daily report</CardTitle>
                <CardDescription>Record what happened on site. The report is visible to the project manager.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleReportSubmit}>
                  <div className="space-y-2"><Label htmlFor="daily-report-date">Date</Label><Input id="daily-report-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={isReportSubmitting} required /></div>
                  <div className="space-y-2"><Label htmlFor="daily-report-description">What happened?</Label><Textarea id="daily-report-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} placeholder="Describe progress, blockers or handover notes." disabled={isReportSubmitting} required /></div>
                  <Button type="submit" disabled={isReportSubmitting || !description.trim()}>{isReportSubmitting ? <Loader2 className="animate-spin" /> : <ClipboardPenLine />}Save report</Button>
                </form>
              </CardContent>
            </Card>
          )}

          {role === "manager" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary" />Upload risk assessment</CardTitle>
                <CardDescription>Share one private PDF with the builder assigned to this project.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleAssessmentSubmit}>
                  <div className="space-y-2"><Label htmlFor="risk-assessment-title">Document title</Label><Input id="risk-assessment-title" value={assessmentTitle} onChange={(event) => setAssessmentTitle(event.target.value)} maxLength={180} placeholder="Site risk assessment" disabled={isAssessmentSubmitting} required /></div>
                  <div className="space-y-2"><Label htmlFor="risk-assessment-file">Private PDF</Label><Input id="risk-assessment-file" type="file" accept="application/pdf,.pdf" onChange={(event) => setAssessmentFile(event.target.files?.[0] ?? null)} disabled={isAssessmentSubmitting} required /><p className="text-xs text-muted-foreground">PDF only, maximum 10 MB.</p></div>
                  <Button type="submit" disabled={isAssessmentSubmitting || !assessmentTitle.trim() || !assessmentFile}>{isAssessmentSubmitting ? <Loader2 className="animate-spin" /> : <Upload />}Upload assessment</Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card className={role === "builder" ? "xl:col-span-2" : ""}>
            <CardHeader>
              <CardTitle>Daily activity</CardTitle>
              <CardDescription>{reports.length ? `${reports.length} report${reports.length === 1 ? "" : "s"} for this project.` : "No daily reports have been recorded yet."}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading project activity…</p> : reports.length === 0 ? <p className="text-sm text-muted-foreground">Reports will appear here after the first site update.</p> : <div className="space-y-3">{reports.slice(0, 8).map((report) => <article key={report.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{report.date}</p><Badge variant="secondary">Private project record</Badge></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{report.description}</p></article>)}</div>}
            </CardContent>
          </Card>

          <Card className={role === "builder" ? "xl:col-span-2" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-primary" />Risk assessments</CardTitle>
              <CardDescription>{assessments.length ? `${assessments.length} private document${assessments.length === 1 ? "" : "s"} for this project.` : "No risk assessments have been uploaded yet."}</CardDescription>
            </CardHeader>
            <CardContent>
              {assessments.length === 0 ? <p className="text-sm text-muted-foreground">Private safety documents will appear here.</p> : <div className="space-y-3">{assessments.map((assessment) => { const assessmentSignatures = signatures[assessment.id]; const signedByCurrentUser = role === "builder" && assessmentSignatures?.some((signature) => signature.userId); return <article key={assessment.id} className="rounded-lg border p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="font-medium">{assessment.title}</p><p className="truncate text-xs text-muted-foreground">{assessment.fileName} · {formatDate(assessment.createdAt)}</p></div><Badge variant={signedByCurrentUser ? "default" : "secondary"}>{signedByCurrentUser ? "Signed" : "Awaiting sign-off"}</Badge></div><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => void handleOpenAssessment(assessment)}><FileText />Open private PDF</Button>{role === "builder" && !signedByCurrentUser && <Button type="button" size="sm" onClick={() => void handleSign(assessment)} disabled={signingAssessmentId === assessment.id}>{signingAssessmentId === assessment.id ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Sign assessment</Button>}{role === "manager" && <Button type="button" variant="ghost" size="sm" onClick={() => void loadSignatures(assessment.id)}>{assessmentSignatures ? `${assessmentSignatures.length} signature${assessmentSignatures.length === 1 ? "" : "s"}` : "View signatures"}</Button>}</div>{assessmentSignatures && <p className="mt-2 text-xs text-muted-foreground">{assessmentSignatures.length ? assessmentSignatures.map((signature) => `${signature.userId} · ${formatDate(signature.signedAt)}`).join("; ") : "No signatures recorded yet."}</p>}</article>; })}</div>}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
};

export default ReportsRiskPanel;
