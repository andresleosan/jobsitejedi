import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, History, Loader2, ShieldCheck, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { accessRequestOperations, type AccessRequestRecord } from "@/lib/firebase/functions";
import type { AppRole } from "@/lib/firebase/types";

const roles: AppRole[] = ["admin", "manager", "builder"];
const roleLabel: Record<AppRole, string> = { admin: "Admin", manager: "Manager", builder: "Builder" };

const AccessRequestsPanel = ({ isSessionActive }: { isSessionActive: () => boolean }) => {
  const [requests, setRequests] = useState<AccessRequestRecord[]>([]);
  const [history, setHistory] = useState<AccessRequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, AppRole>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const { toast } = useToast();

  const loadRequests = useCallback(async () => {
    if (!isSessionActive()) return;
    setIsLoading(true);
    try {
      const nextRequests = await accessRequestOperations.listAccessRequests();
      setRequests(nextRequests);
      setSelectedRoles((current) => Object.fromEntries(nextRequests.map((request) => [request.id, current[request.id] ?? request.requestedRole ?? "builder"])));
    } catch (error) {
      if (isSessionActive()) toast({ title: "No se cargaron las solicitudes", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      if (isSessionActive()) setIsLoading(false);
    }
  }, [isSessionActive, toast]);

  const loadHistory = useCallback(async () => {
    if (!isSessionActive()) return;
    setIsLoadingHistory(true);
    try {
      setHistory(await accessRequestOperations.listAccessRequestHistory());
    } catch (error) {
      if (isSessionActive()) toast({ title: "No se cargó el historial", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      if (isSessionActive()) setIsLoadingHistory(false);
    }
  }, [isSessionActive, toast]);

  useEffect(() => {
    void Promise.all([loadRequests(), loadHistory()]);
  }, [loadHistory, loadRequests]);

  const review = async (request: AccessRequestRecord, decision: "approve" | "reject") => {
    if (!isSessionActive()) return;
    const reason = rejectionReason.trim();
    if (decision === "reject" && !reason) {
      toast({ title: "Indica un motivo", description: "El motivo es obligatorio para rechazar la solicitud.", variant: "destructive" });
      return;
    }
    setProcessingId(request.id);
    try {
      await accessRequestOperations.reviewAccessRequest({ requestId: request.requestId, decision, reason: decision === "reject" ? reason : null, approvedRole: decision === "approve" ? selectedRoles[request.id] : null });
      setRequests((current) => current.filter((item) => item.id !== request.id));
      setRejectingId(null);
      setRejectionReason("");
      await loadHistory();
      toast({ title: decision === "approve" ? "Acceso aprobado" : "Solicitud rechazada", description: decision === "approve" ? "El usuario ya puede iniciar sesión con el rol asignado." : "La decisión quedó guardada en el historial." });
    } catch (error) {
      toast({ title: "No se pudo revisar la solicitud", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
      await loadRequests();
    } finally {
      setProcessingId(null);
    }
  };

  const clearHistory = async () => {
    if (!history.length || isClearingHistory || !window.confirm("Se eliminará el historial aprobado y rechazado. Las solicitudes pendientes no se tocarán. ¿Continuar?")) return;
    setIsClearingHistory(true);
    try {
      const deletedCount = await accessRequestOperations.clearAccessRequestHistory();
      setHistory([]);
      toast({ title: "Historial limpiado", description: `${deletedCount} registro${deletedCount === 1 ? "" : "s"} eliminado${deletedCount === 1 ? "" : "s"}.` });
    } catch (error) {
      toast({ title: "No se pudo limpiar el historial", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setIsClearingHistory(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Solicitudes de acceso</CardTitle><CardDescription>Revisa quién solicita acceso y decide el rol final que tendrá.</CardDescription></div>
            <Badge variant="secondary">{requests.length} pendientes</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Cargando solicitudes…</div> : requests.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"><Clock3 className="mx-auto mb-2 h-6 w-6" />No hay solicitudes pendientes.</div> : (
            <div className="space-y-3">
              {requests.map((request) => {
                const selectedRole = selectedRoles[request.id] ?? request.requestedRole ?? "builder";
                const isRejecting = rejectingId === request.id;
                return (
                  <div key={request.id} data-testid="access-request" className="rounded-lg border p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-1"><p className="flex items-center gap-2 font-medium"><UserRound className="h-4 w-4 shrink-0 text-primary" />{request.fullName}</p><p className="break-all text-sm text-muted-foreground">{request.email}{request.phone ? ` · ${request.phone}` : ""}</p><p className="text-xs text-muted-foreground">Solicitado {request.requestedAt?.toLocaleString() ?? "recientemente"}</p></div>
                      <div className="flex flex-col gap-3 sm:min-w-72">
                        <label className="text-xs font-medium text-muted-foreground" htmlFor={`role-${request.id}`}>Rol que se asignará</label>
                        <select id={`role-${request.id}`} value={selectedRole} onChange={(event) => setSelectedRoles((current) => ({ ...current, [request.id]: event.target.value as AppRole }))} disabled={processingId !== null} className="h-10 rounded-md border border-input bg-background px-3 text-sm">{roles.map((role) => <option key={role} value={role}>{roleLabel[role]}{role === request.requestedRole ? " (solicitado)" : ""}</option>)}</select>
                        <div className="flex flex-wrap gap-2"><Badge variant="outline">Solicitó: {request.requestedRole ? roleLabel[request.requestedRole] : "Perfil inválido"}</Badge><Button size="sm" onClick={() => void review(request, "approve")} disabled={processingId !== null || !request.requestedRole}>{processingId === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Aprobar como {roleLabel[selectedRole]}</Button><Button size="sm" variant="outline" onClick={() => { setRejectingId(isRejecting ? null : request.id); setRejectionReason(""); }} disabled={processingId !== null}><X className="mr-2 h-4 w-4" />Rechazar</Button></div>
                      </div>
                    </div>
                    {isRejecting && <div className="mt-4 space-y-2 border-t pt-4"><label className="text-sm font-medium" htmlFor={`reason-${request.id}`}>Motivo del rechazo</label><Textarea id={`reason-${request.id}`} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} maxLength={500} placeholder="Explica por qué no se concede el acceso" disabled={processingId !== null} /><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setRejectingId(null)} disabled={processingId !== null}>Cancelar</Button><Button size="sm" variant="destructive" onClick={() => void review(request, "reject")} disabled={processingId !== null || !rejectionReason.trim()}>Confirmar rechazo</Button></div></div>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" />Historial de decisiones</CardTitle><CardDescription>Consulta aprobaciones y rechazos anteriores, incluidos sus motivos.</CardDescription></div><Button variant="outline" size="sm" onClick={() => void clearHistory()} disabled={!history.length || isClearingHistory}>{isClearingHistory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Limpiar historial</Button></div></CardHeader>
        <CardContent>{isLoadingHistory ? <div className="flex items-center justify-center py-6 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Cargando historial…</div> : history.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aún no hay decisiones guardadas.</div> : <div className="space-y-3">{history.map((item) => <div key={item.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-medium">{item.fullName}</p><p className="break-all text-sm text-muted-foreground">{item.email}{item.phone ? ` · ${item.phone}` : ""}</p><p className="text-xs text-muted-foreground">{item.reviewedAt?.toLocaleString() ?? "Sin fecha"}</p>{item.decisionReason && <p className="mt-2 text-sm">Motivo: {item.decisionReason}</p>}</div><div className="flex flex-wrap gap-2"><Badge variant={item.status === "approved" ? "default" : "destructive"}>{item.status === "approved" ? `Aprobado como ${item.approvedRole ? roleLabel[item.approvedRole] : "—"}` : "Rechazado"}</Badge><Badge variant="outline">Solicitó: {item.requestedRole ? roleLabel[item.requestedRole] : "—"}</Badge></div></div>)}</div>}</CardContent>
      </Card>
    </div>
  );
};

export default AccessRequestsPanel;
