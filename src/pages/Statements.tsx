import { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfDay, startOfMonth, subDays } from "date-fns";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Clock3,
  Download,
  FileText,
  Loader2,
  Package,
  ReceiptText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { listInvoices, type InvoiceRecord } from "@/lib/firebase/repositories/invoices";
import { listMaterialUsage, type MaterialUsageRecord } from "@/lib/firebase/repositories/inventory";
import { listJobsForManager, type JobRecord } from "@/lib/firebase/repositories/jobs";
import { listProjects, type ProjectRecord } from "@/lib/firebase/repositories/projects";
import { listTimeEntries, type TimeEntry } from "@/lib/firebase/repositories/timeTracking";

type Period = "today" | "last7" | "month" | "all";

interface LedgerRow {
  id: string;
  date: Date;
  category: "Time" | "Invoice" | "Material" | "Job";
  projectId: string;
  projectName: string;
  builderId: string;
  builderName: string;
  description: string;
  value: string;
}

const shortIdentity = (id: string) => id ? `${id.slice(0, 8)}…` : "Unknown";

const closedHours = (entry: TimeEntry): number => {
  if (!entry.clockIn || !entry.clockOut) return 0;
  return Math.max(0, (entry.clockOut.getTime() - entry.clockIn.getTime()) / 3_600_000);
};

const invoiceDate = (invoice: InvoiceRecord): Date =>
  new Date(`${invoice.invoiceDate}T00:00:00`);

const usageDate = (usage: MaterialUsageRecord): Date =>
  new Date(`${usage.date}T00:00:00`);

const withinPeriod = (date: Date, period: Period): boolean => {
  if (Number.isNaN(date.getTime())) return false;
  if (period === "all") return true;
  const now = new Date();
  const start = period === "today"
    ? startOfDay(now)
    : period === "last7"
      ? startOfDay(subDays(now, 6))
      : startOfMonth(now);
  return date >= start && date <= now;
};

const csvCell = (value: string | number): string => {
  let text = String(value);
  if (/^[\t\r\n ]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const Statements = () => {
  const { user, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [materialUsage, setMaterialUsage] = useState<MaterialUsageRecord[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [period, setPeriod] = useState<Period>("last7");
  const [selectedProject, setSelectedProject] = useState("all");
  const [selectedBuilder, setSelectedBuilder] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!user) navigate("/auth");
    else if (user.role !== "manager") navigate("/builders");
  }, [isAuthLoading, navigate, user]);

  const loadLedger = useCallback(async () => {
    if (!user || user.role !== "manager") return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [nextProjects, nextTime, nextInvoices, nextUsage, nextJobs] = await Promise.all([
        listProjects(),
        listTimeEntries(),
        listInvoices(),
        listMaterialUsage(),
        listJobsForManager([]),
      ]);
      setProjects(nextProjects);
      setTimeEntries(nextTime);
      setInvoices(nextInvoices);
      setMaterialUsage(nextUsage);
      setJobs(nextJobs);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Statements could not be loaded");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!isAuthLoading && user?.role === "manager") void loadLedger();
  }, [isAuthLoading, loadLedger, user]);

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const builders = useMemo(() => {
    const names = new Map<string, string>();
    timeEntries.forEach((entry) => names.set(entry.builderId, shortIdentity(entry.builderId)));
    invoices.forEach((invoice) => names.set(invoice.uploadedBy, invoice.uploadedByName || shortIdentity(invoice.uploadedBy)));
    materialUsage.forEach((usage) => names.set(usage.usedBy, usage.usedByName || shortIdentity(usage.usedBy)));
    jobs.forEach((job) => names.set(job.builderId, names.get(job.builderId) || shortIdentity(job.builderId)));
    return [...names.entries()].sort(([, left], [, right]) => left.localeCompare(right));
  }, [invoices, jobs, materialUsage, timeEntries]);

  const rowMatches = useCallback((date: Date, projectId: string, builderId: string) =>
    withinPeriod(date, period)
      && (selectedProject === "all" || selectedProject === projectId)
      && (selectedBuilder === "all" || selectedBuilder === builderId),
  [period, selectedBuilder, selectedProject]);

  const filteredTime = useMemo(() => timeEntries.filter((entry) =>
    entry.clockIn && rowMatches(entry.clockIn, entry.projectId, entry.builderId)), [rowMatches, timeEntries]);
  const filteredInvoices = useMemo(() => invoices.filter((invoice) =>
    rowMatches(invoiceDate(invoice), invoice.projectId, invoice.uploadedBy)), [invoices, rowMatches]);
  const filteredUsage = useMemo(() => materialUsage.filter((usage) =>
    rowMatches(usageDate(usage), usage.projectId, usage.usedBy)), [materialUsage, rowMatches]);
  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const date = job.reviewedAt ?? job.updatedAt ?? job.createdAt;
    return job.status === "completed" && Boolean(date) && rowMatches(date as Date, job.projectId, job.builderId);
  }), [jobs, rowMatches]);

  const rows = useMemo<LedgerRow[]>(() => [
    ...filteredTime.filter((entry) => entry.clockIn).map((entry) => ({
      id: `time-${entry.id}`,
      date: entry.clockIn as Date,
      category: "Time" as const,
      projectId: entry.projectId,
      projectName: projectNames.get(entry.projectId) ?? shortIdentity(entry.projectId),
      builderId: entry.builderId,
      builderName: builders.find(([id]) => id === entry.builderId)?.[1] ?? shortIdentity(entry.builderId),
      description: entry.notes || "Site time entry",
      value: `${closedHours(entry).toFixed(2)} h`,
    })),
    ...filteredInvoices.map((invoice) => ({
      id: `invoice-${invoice.id}`,
      date: invoiceDate(invoice),
      category: "Invoice" as const,
      projectId: invoice.projectId,
      projectName: invoice.projectName || projectNames.get(invoice.projectId) || shortIdentity(invoice.projectId),
      builderId: invoice.uploadedBy,
      builderName: invoice.uploadedByName || shortIdentity(invoice.uploadedBy),
      description: `${invoice.invoiceNumber} · ${invoice.supplierName}`,
      value: new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(invoice.totalAmountMinor / 100),
    })),
    ...filteredUsage.map((usage) => ({
      id: `material-${usage.id}`,
      date: usageDate(usage),
      category: "Material" as const,
      projectId: usage.projectId,
      projectName: usage.projectName || projectNames.get(usage.projectId) || shortIdentity(usage.projectId),
      builderId: usage.usedBy,
      builderName: usage.usedByName || shortIdentity(usage.usedBy),
      description: usage.materialName || shortIdentity(usage.materialId),
      value: `${usage.quantityUsed} ${usage.materialUnit || "units"}`,
    })),
    ...filteredJobs.map((job) => ({
      id: `job-${job.id}`,
      date: (job.reviewedAt ?? job.updatedAt ?? job.createdAt) as Date,
      category: "Job" as const,
      projectId: job.projectId,
      projectName: projectNames.get(job.projectId) ?? shortIdentity(job.projectId),
      builderId: job.builderId,
      builderName: builders.find(([id]) => id === job.builderId)?.[1] ?? shortIdentity(job.builderId),
      description: job.title,
      value: "Completed",
    })),
  ].sort((left, right) => right.date.getTime() - left.date.getTime()), [builders, filteredInvoices, filteredJobs, filteredTime, filteredUsage, projectNames]);

  const totalHours = filteredTime.reduce((total, entry) => total + closedHours(entry), 0);
  const totalInvoiceMinor = filteredInvoices.reduce((total, invoice) => total + invoice.totalAmountMinor, 0);

  const exportCsv = () => {
    const header = ["Date", "Category", "Project", "Builder", "Description", "Value"];
    const csv = [header, ...rows.map((row) => [
      format(row.date, "yyyy-MM-dd HH:mm"),
      row.category,
      row.projectName,
      row.builderName,
      row.description,
      row.value,
    ])].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jobsite-statements-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (isAuthLoading || isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-muted/30"><Loader2 className="h-8 w-8 animate-spin text-primary motion-reduce:animate-none" /></div>;
  }
  if (!user || user.role !== "manager") return null;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-card/95 shadow-sm backdrop-blur">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" aria-label="Back to manager dashboard" onClick={() => navigate("/managers")}><ArrowLeft className="h-5 w-5" /></Button>
            <div className="rounded-lg bg-primary p-2"><FileText className="h-5 w-5 text-primary-foreground" /></div>
            <div><h1 className="text-xl font-bold">Site statements</h1><p className="text-sm text-muted-foreground">Firebase activity ledger</p></div>
          </div>
          <Button variant="outline" disabled={rows.length === 0} onClick={exportCsv}><Download />Export CSV</Button>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-6">
        {errorMessage && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><span>{errorMessage}</span><Button size="sm" variant="outline" onClick={() => void loadLedger()}>Retry</Button></div>}

        <Card>
          <CardHeader><CardTitle>Ledger filters</CardTitle><CardDescription>Filter canonical Firebase records before exporting.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Select value={period} onValueChange={(value) => setPeriod(value as Period)}><SelectTrigger aria-label="Statement period"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="last7">Last 7 days</SelectItem><SelectItem value="month">This month</SelectItem><SelectItem value="all">All records</SelectItem></SelectContent></Select>
            <Select value={selectedProject} onValueChange={setSelectedProject}><SelectTrigger aria-label="Statement project"><SelectValue placeholder="All projects" /></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select>
            <Select value={selectedBuilder} onValueChange={setSelectedBuilder}><SelectTrigger aria-label="Statement builder"><SelectValue placeholder="All builders" /></SelectTrigger><SelectContent><SelectItem value="all">All builders</SelectItem>{builders.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select>
          </CardContent>
        </Card>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Statement totals">
          <Card><CardContent className="flex items-center gap-3 p-4"><Clock3 className="text-primary" /><div><p className="text-2xl font-bold tabular-nums">{totalHours.toFixed(2)} h</p><p className="text-xs text-muted-foreground">Closed time</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><ReceiptText className="text-primary" /><div><p className="text-2xl font-bold tabular-nums">{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(totalInvoiceMinor / 100)}</p><p className="text-xs text-muted-foreground">Invoices</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><Package className="text-primary" /><div><p className="text-2xl font-bold tabular-nums">{filteredUsage.length}</p><p className="text-xs text-muted-foreground">Material records</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><BriefcaseBusiness className="text-primary" /><div><p className="text-2xl font-bold tabular-nums">{filteredJobs.length}</p><p className="text-xs text-muted-foreground">Jobs completed</p></div></CardContent></Card>
        </section>

        <Card>
          <CardHeader><CardTitle>Activity ledger</CardTitle><CardDescription>{rows.length} matching record{rows.length === 1 ? "" : "s"}</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            {rows.length === 0 ? <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">No activity matches these filters.</div> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Project</TableHead><TableHead>Builder</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                <TableBody>{rows.map((row) => <TableRow key={row.id} data-testid="statement-row"><TableCell className="whitespace-nowrap">{format(row.date, "dd MMM yyyy HH:mm")}</TableCell><TableCell>{row.category}</TableCell><TableCell>{row.projectName}</TableCell><TableCell>{row.builderName}</TableCell><TableCell>{row.description}</TableCell><TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{row.value}</TableCell></TableRow>)}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Statements;
