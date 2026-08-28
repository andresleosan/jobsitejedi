import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  buildPrivateStoragePath,
  uploadPrivateFile,
} from "@/lib/firebase/storage";
import { extractJobsFromExcelRecord } from "@/lib/firebase/functions";
import type { ProjectRecord } from "@/lib/firebase/repositories/projects";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["csv", "tsv", "xlsx"] as const;
const ACCEPTED_FILE_TYPES = ".csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CONTENT_TYPES_BY_EXTENSION: Record<(typeof ACCEPTED_EXTENSIONS)[number], string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

interface JobImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectRecord[];
  userId: string;
}

const getExtension = (fileName: string) => fileName.split(".").pop()?.toLowerCase() ?? "";

const getFileError = (file: File): string | null => {
  const extension = getExtension(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
    return "Choose a CSV, TSV or XLSX file.";
  }
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > MAX_FILE_SIZE) return "The file must be 5 MiB or smaller.";
  return null;
};

const createStorageFileName = (file: File) => {
  const extension = getExtension(file.name);
  const token = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`;
  return `${token}.${extension}`;
};

const getSpreadsheetContentType = (file: File) =>
  CONTENT_TYPES_BY_EXTENSION[getExtension(file.name) as (typeof ACCEPTED_EXTENSIONS)[number]];

const JobImportDialog = ({ open, onOpenChange, projects, userId }: JobImportDialogProps) => {
  const [projectId, setProjectId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projectId, projects]);

  const reset = () => {
    setSelectedFile(null);
    setError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isSubmitting) reset();
    onOpenChange(nextOpen);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setResult(null);
    if (!file) {
      setSelectedFile(null);
      setError(null);
      return;
    }

    const fileError = getFileError(file);
    setSelectedFile(fileError ? null : file);
    setError(fileError);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile || !projectId) {
      setError(!projectId ? "Choose a project before importing." : "Choose a valid spreadsheet first.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const storageFileName = createStorageFileName(selectedFile);
      const filePath = buildPrivateStoragePath("job-imports", userId, storageFileName);
      await uploadPrivateFile(filePath, selectedFile, {
        contentType: getSpreadsheetContentType(selectedFile),
      });
      const importResult = await extractJobsFromExcelRecord({ projectId, filePath });
      const message = `${importResult.createdJobIds.length} ${importResult.createdJobIds.length === 1 ? "job was" : "jobs were"} imported successfully.`;
      setResult(message);
      toast({ title: "Jobs imported", description: message });
      window.setTimeout(() => handleOpenChange(false), 500);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "The spreadsheet could not be imported.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import jobs from spreadsheet
          </DialogTitle>
          <DialogDescription>
            Add jobs to a project from a CSV, TSV or XLSX file. The upload stays private to your manager account.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="job-import-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={isSubmitting || projects.length === 0}>
              <SelectTrigger id="job-import-project" aria-label="Project for imported jobs">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name} · {project.clientName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
            <Label htmlFor="job-import-file" className="flex cursor-pointer items-center gap-3">
              <span className="rounded-md bg-primary p-2 text-primary-foreground">
                <Upload className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-medium">Choose a spreadsheet</span>
                <span className="block text-xs font-normal text-muted-foreground">CSV, TSV or XLSX · maximum 5 MiB</span>
              </span>
            </Label>
            <Input
              ref={fileInputRef}
              id="job-import-file"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="mt-3 cursor-pointer bg-background"
              aria-describedby="job-import-file-help"
            />
            <p id="job-import-file-help" className="mt-2 text-xs text-muted-foreground">
              Required columns: Title, Job or Task. Description and Section are optional.
            </p>
            {selectedFile && !error && (
              <p className="mt-2 truncate text-sm font-medium" title={selectedFile.name}>
                Selected: {selectedFile.name}
              </p>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Import not completed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {result && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <AlertTitle>Import complete</AlertTitle>
              <AlertDescription>{result}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !selectedFile || !projectId}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Upload />}
              {isSubmitting ? "Importing…" : "Import jobs"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default JobImportDialog;
