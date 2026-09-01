import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, Loader2, ShieldCheck, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { accessRequestOperations, type AccessRequestRecord } from "@/lib/firebase/functions";
import type { AppRole } from "@/lib/firebase/types";

const roleLabel: Record<AppRole, string> = { admin: "Admin", manager: "Manager", builder: "Builder" };

const AccessRequestsPanel = ({ isSessionActive }: { isSessionActive: () => boolean }) => {
  const [requests, setRequests] = useState<AccessRequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { toast } = useToast();

  const loadRequests = useCallback(async () => {
    if (!isSessionActive()) return;
    setIsLoading(true);
    try {
      setRequests(await accessRequestOperations.listAccessRequests());
    } catch (error) {
      if (isSessionActive()) {
        toast({
          title: "No se cargaron las solicitudes",
          description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
          variant: "destructive",
        });
      }
    } finally {
      if (isSessionActive()) setIsLoading(false);
    }
  }, [isSessionActive, toast]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const review = async (requestId: string, decision: "approve" | "reject") => {
    if (!isSessionActive()) return;
    setProcessingId(requestId);
    try {
      await accessRequestOperations.reviewAccessRequest({ requestId, decision, reason: null });
      setRequests((current) => current.filter((request) => request.id !== requestId));
      toast({
        title: decision === "approve" ? "Acceso aprobado" : "Solicitud rechazada",
        description: decision === "approve" ? "El usuario ya puede iniciar sesión con el perfil asignado." : "No se concedió acceso al usuario.",
      });
    } catch (error) {
      toast({
        title: "No se pudo revisar la solicitud",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
      await loadRequests();
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Solicitudes de acceso</CardTitle>
            <CardDescription>Revisa quién solicita acceso y qué perfil necesita antes de aprobarlo.</CardDescription>
          </div>
          <Badge variant="secondary">{requests.length} pendientes</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Cargando solicitudes…</div>
        ) : requests.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"><Clock3 className="mx-auto mb-2 h-6 w-6" />No hay solicitudes pendientes.</div>
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <div key={request.id} className="flex flex-col gap-4 rounded-lg border p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-2 font-medium"><UserRound className="h-4 w-4 shrink-0 text-primary" />{request.fullName}</p>
                  <p className="break-all text-sm text-muted-foreground">{request.email}{request.phone ? ` · ${request.phone}` : ""}</p>
                  <p className="text-xs text-muted-foreground">Solicitado {request.requestedAt?.toLocaleString() ?? "recientemente"}</p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Badge variant="outline">{request.requestedRole ? roleLabel[request.requestedRole] : "Perfil inválido"}</Badge>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void review(request.id, "approve")} disabled={processingId !== null || !request.requestedRole}>
                      {processingId === request.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Aprobar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void review(request.id, "reject")} disabled={processingId !== null}>
                      <X className="mr-2 h-4 w-4" />Rechazar
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AccessRequestsPanel;
