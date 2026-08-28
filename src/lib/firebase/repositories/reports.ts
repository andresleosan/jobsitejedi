import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type DocumentData,
} from "firebase/firestore";
import { getCurrentRole } from "@/lib/firebase/auth";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import {
  buildPrivateStoragePath,
  createPrivateObjectUrl,
  deletePrivateFile,
  uploadPrivateFile,
} from "@/lib/firebase/storage";

export interface DailyReportRecord {
  id: string;
  builderId: string;
  projectId: string;
  date: string;
  description: string;
  photoPaths: string[];
  createdAt: Date | null;
}

export interface DailyReportInput {
  projectId: string;
  date: string;
  description: string;
  photoPaths?: string[];
}

export interface RiskAssessmentRecord {
  id: string;
  projectId: string;
  title: string;
  filePath: string;
  fileName: string;
  contentType: "application/pdf";
  fileSize: number;
  uploadedBy: string;
  createdAt: Date | null;
}

export interface RiskAssessmentInput {
  projectId: string;
  title: string;
  file: File;
}

export interface RiskAssessmentSignatureRecord {
  id: string;
  riskAssessmentId: string;
  userId: string;
  signedAt: Date | null;
}

const dailyReportsCollection = collection(firebaseDb, "dailyReports");
const riskAssessmentsCollection = collection(firebaseDb, "riskAssessments");
const signaturesCollection = collection(firebaseDb, "riskAssessmentSignatures");
const projectsCollection = collection(firebaseDb, "projects");

const toDate = (value: unknown): Date | null => {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as Timestamp).toDate();
  }
  return value instanceof Date ? value : null;
};

const requireCurrentUser = () => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Authentication is required");
  return user;
};

const requireManager = async () => {
  requireCurrentUser();
  if ((await getCurrentRole()) !== "manager") throw new Error("Manager access is required");
};

const isValidCivilDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const safeFileName = (name: string): string => {
  const candidate = name.split(/[\\/]/).pop()?.trim() ?? "";
  const normalized = candidate.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("Risk assessment file name is required");
  }
  return normalized.slice(0, 180);
};

const toDailyReport = (snapshot: { id: string; data: () => DocumentData }): DailyReportRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    builderId: String(data.builderId ?? ""),
    projectId: String(data.projectId ?? ""),
    date: String(data.date ?? ""),
    description: String(data.description ?? ""),
    photoPaths: Array.isArray(data.photoPaths)
      ? data.photoPaths.filter((path: unknown): path is string => typeof path === "string")
      : [],
    createdAt: toDate(data.createdAt),
  };
};

const toRiskAssessment = (snapshot: { id: string; data: () => DocumentData }): RiskAssessmentRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    projectId: String(data.projectId ?? ""),
    title: String(data.title ?? ""),
    filePath: String(data.filePath ?? ""),
    fileName: String(data.fileName ?? ""),
    contentType: "application/pdf",
    fileSize: Number(data.fileSize ?? 0),
    uploadedBy: String(data.uploadedBy ?? ""),
    createdAt: toDate(data.createdAt),
  };
};

const toSignature = (snapshot: { id: string; data: () => DocumentData }): RiskAssessmentSignatureRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    riskAssessmentId: String(data.riskAssessmentId ?? ""),
    userId: String(data.userId ?? ""),
    signedAt: toDate(data.signedAt),
  };
};

const requireProject = async (projectId: string) => {
  const normalized = projectId.trim();
  if (!normalized) throw new Error("Project id is required");
  const snapshot = await getDoc(doc(projectsCollection, normalized));
  if (!snapshot.exists()) throw new Error("Project was not found");
  return { id: snapshot.id, data: snapshot.data() };
};

const validateDailyReport = (input: DailyReportInput) => {
  if (!input || typeof input.projectId !== "string" || !input.projectId.trim()) {
    throw new Error("Project id is required");
  }
  if (typeof input.date !== "string" || !isValidCivilDate(input.date)) {
    throw new Error("Report date is invalid");
  }
  if (typeof input.description !== "string" || !input.description.trim()) {
    throw new Error("Report description is required");
  }
  if (input.description.trim().length > 5_000) {
    throw new Error("Report description must be 5,000 characters or fewer");
  }
  if (input.photoPaths && (
    !Array.isArray(input.photoPaths)
    || input.photoPaths.length > 10
    || input.photoPaths.some((path) => typeof path !== "string" || path.length > 500)
  )) {
    throw new Error("Report photos are invalid");
  }
};

export const createDailyReport = async (input: DailyReportInput): Promise<DailyReportRecord> => {
  validateDailyReport(input);
  const user = requireCurrentUser();
  if ((await getCurrentRole()) !== "builder") throw new Error("Only builders can submit daily reports");
  const project = await requireProject(input.projectId);
  if (project.data.ownerId !== user.uid) throw new Error("A builder can only report on their own project");

  const report = await addDoc(dailyReportsCollection, {
    builderId: user.uid,
    projectId: project.id,
    date: input.date,
    description: input.description.trim(),
    photoPaths: input.photoPaths ?? [],
    createdAt: serverTimestamp(),
  });
  const created = await getDoc(report);
  if (!created.exists()) throw new Error("Daily report was not created");
  return toDailyReport(created);
};

export const listDailyReports = async (projectId?: string): Promise<DailyReportRecord[]> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = [];
  if (role === "builder") constraints.push(where("builderId", "==", user.uid));
  if (projectId?.trim()) constraints.push(where("projectId", "==", projectId.trim()));
  const snapshot = await getDocs(query(dailyReportsCollection, ...constraints));
  return snapshot.docs
    .map(toDailyReport)
    .sort((left, right) => (right.date + right.id).localeCompare(left.date + left.id));
};

export const createRiskAssessment = async (input: RiskAssessmentInput): Promise<RiskAssessmentRecord> => {
  await requireManager();
  if (!input || typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 180) {
    throw new Error("Risk assessment title is required and must be 180 characters or fewer");
  }
  if (!(input.file instanceof File) || input.file.size <= 0 || input.file.size > 10 * 1024 * 1024) {
    throw new Error("Risk assessment PDF must be smaller than 10 MB");
  }
  if (input.file.type !== "application/pdf") throw new Error("Risk assessment file must be a PDF");
  const project = await requireProject(input.projectId);
  const user = requireCurrentUser();
  const assessment = doc(riskAssessmentsCollection);
  const fileName = safeFileName(input.file.name);
  const filePath = buildPrivateStoragePath("documents", project.id, assessment.id, fileName);
  await uploadPrivateFile(filePath, input.file, { contentType: "application/pdf" });
  try {
    await setDoc(assessment, {
      projectId: project.id,
      title: input.title.trim(),
      filePath,
      fileName,
      contentType: "application/pdf",
      fileSize: input.file.size,
      uploadedBy: user.uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    await Promise.allSettled([deletePrivateFile(filePath)]);
    throw error;
  }
  const created = await getDoc(assessment);
  if (!created.exists()) throw new Error("Risk assessment was not created");
  return toRiskAssessment(created);
};

export const listRiskAssessments = async (projectId?: string): Promise<RiskAssessmentRecord[]> => {
  requireCurrentUser();
  const role = await getCurrentRole();
  const normalizedProjectId = projectId?.trim();
  if (role === "builder" && !normalizedProjectId) {
    throw new Error("A project is required for builder risk assessment access");
  }
  const source = normalizedProjectId
    ? query(riskAssessmentsCollection, where("projectId", "==", normalizedProjectId))
    : riskAssessmentsCollection;
  const snapshot = await getDocs(source);
  return snapshot.docs
    .map(toRiskAssessment)
    .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));
};

export const createRiskAssessmentObjectUrl = (assessment: RiskAssessmentRecord): Promise<string> =>
  createPrivateObjectUrl(assessment.filePath, assessment.contentType);

export const signRiskAssessment = async (riskAssessmentId: string): Promise<RiskAssessmentSignatureRecord> => {
  const user = requireCurrentUser();
  if ((await getCurrentRole()) !== "builder") throw new Error("Only builders can sign risk assessments");
  const assessmentId = riskAssessmentId.trim();
  if (!assessmentId) throw new Error("Risk assessment id is required");
  const assessment = await getDoc(doc(riskAssessmentsCollection, assessmentId));
  if (!assessment.exists()) throw new Error("Risk assessment was not found");
  const signature = doc(signaturesCollection, `${assessmentId}_${user.uid}`);
  try {
    await setDoc(signature, {
      riskAssessmentId: assessmentId,
      userId: user.uid,
      signedAt: Timestamp.now(),
    }, { merge: false });
  } catch (error) {
    const afterRace = await getDoc(signature);
    if (!afterRace.exists()) throw error;
    return toSignature(afterRace);
  }
  const created = await getDoc(signature);
  if (!created.exists()) throw new Error("Risk assessment signature was not created");
  return toSignature(created);
};

export const listRiskAssessmentSignatures = async (
  riskAssessmentId: string,
): Promise<RiskAssessmentSignatureRecord[]> => {
  const user = requireCurrentUser();
  if (!riskAssessmentId.trim()) throw new Error("Risk assessment id is required");
  if ((await getCurrentRole()) === "builder") {
    const snapshot = await getDoc(doc(signaturesCollection, `${riskAssessmentId.trim()}_${user.uid}`));
    return snapshot.exists() ? [toSignature(snapshot)] : [];
  }
  const snapshot = await getDocs(query(
    signaturesCollection,
    where("riskAssessmentId", "==", riskAssessmentId.trim()),
  ));
  return snapshot.docs.map(toSignature);
};
