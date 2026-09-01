import { useCallback, useEffect, useState } from "react";
import { Loader2, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { accessRequestOperations, type PlatformUserRecord } from "@/lib/firebase/functions";
import type { AppRole } from "@/lib/firebase/types";

const roles: AppRole[] = ["admin", "manager", "builder"];
const roleLabel: Record<AppRole, string> = { admin: "Admin", manager: "Manager", builder: "Builder" };

const AdminUsersPanel = ({ adminId, isSessionActive }: { adminId: string; isSessionActive: () => boolean }) => {
  const [users, setUsers] = useState<PlatformUserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { toast } = useToast();

  const loadUsers = useCallback(async () => {
    if (!isSessionActive()) return;
    setIsLoading(true);
    try {
      setUsers(await accessRequestOperations.listPlatformUsers());
    } catch (error) {
      if (isSessionActive()) toast({ title: "No se cargaron las personas", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      if (isSessionActive()) setIsLoading(false);
    }
  }, [isSessionActive, toast]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const updateRole = async (userId: string, role: AppRole) => {
    if (userId === adminId) return;
    setProcessingId(userId);
    try {
      const updated = await accessRequestOperations.updatePlatformUserRole({ userId, role });
      setUsers((current) => current.map((user) => user.id === userId ? updated : user));
      toast({ title: "Rol actualizado", description: `La cuenta ahora tiene rol ${roleLabel[role]}.` });
    } catch (error) {
      toast({ title: "No se pudo cambiar el rol", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
      await loadUsers();
    } finally {
      setProcessingId(null);
    }
  };

  const revokeAccess = async (user: PlatformUserRecord) => {
    if (user.id === adminId || !window.confirm(`¿Quitar el acceso a ${user.email ?? user.displayName ?? "esta cuenta"}? La cuenta no se borrará y podrá solicitar acceso nuevamente.`)) return;
    setProcessingId(user.id);
    try {
      const updated = await accessRequestOperations.revokePlatformUserAccess(user.id);
      setUsers((current) => current.map((item) => item.id === user.id ? updated : item));
      toast({ title: "Acceso revocado", description: "La cuenta quedó sin rol y sus sesiones fueron invalidadas." });
    } catch (error) {
      toast({ title: "No se pudo revocar el acceso", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
      await loadUsers();
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <Card className="admin-panel-card admin-users-card">
      <CardHeader className="admin-panel-header"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="admin-panel-title">Personas y permisos</CardTitle><CardDescription>Cambia roles o revoca accesos. Las cuentas no se eliminan.</CardDescription></div><Badge variant="secondary">{users.length} cuentas</Badge></div></CardHeader>
      <CardContent>{isLoading ? <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Cargando personas…</div> : users.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No hay cuentas registradas.</div> : <div className="space-y-3">{users.map((user) => { const isCurrent = user.id === adminId; const isProcessing = processingId === user.id; return <div key={user.id} className="flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><p className="font-medium">{user.displayName ?? "Sin nombre"}{isCurrent ? " (tú)" : ""}</p><p className="break-all text-sm text-muted-foreground">{user.email ?? "Sin correo"}</p><div className="mt-2 flex flex-wrap gap-2"><Badge variant={user.role ? "default" : "outline"}>{user.role ? roleLabel[user.role] : "Sin rol"}</Badge>{user.disabled && <Badge variant="destructive">Cuenta deshabilitada</Badge>}{!user.emailVerified && <Badge variant="outline">Correo no verificado</Badge>}</div></div><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><select aria-label={`Rol de ${user.email ?? user.displayName ?? user.id}`} value={user.role ?? ""} onChange={(event) => event.target.value && void updateRole(user.id, event.target.value as AppRole)} disabled={isCurrent || isProcessing || user.disabled} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="" disabled>Seleccionar rol</option>{roles.map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}</select><Button size="sm" variant="outline" onClick={() => void revokeAccess(user)} disabled={isCurrent || isProcessing || !user.role}>{isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserX className="mr-2 h-4 w-4" />}Revocar acceso</Button></div></div>; })}</div>}</CardContent>
    </Card>
  );
};

export default AdminUsersPanel;
