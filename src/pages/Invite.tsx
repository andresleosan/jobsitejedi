import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import AccessRequestsPanel from "@/components/dashboard/AccessRequestsPanel";
import { useAuth } from "@/hooks/useAuth";
import { firebaseAuth } from "@/lib/firebase/client";
import { isManagementRole, roleHomePath } from "@/lib/firebase/types";

const Invite = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (!isManagementRole(user.role)) {
      navigate(user.role ? roleHomePath(user.role) : "/auth?reason=missing-role", { replace: true });
    }
  }, [isLoading, navigate, user]);

  if (isLoading || !user || !isManagementRole(user.role)) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const isAdmin = user.role === "admin";
  const isSessionActive = () => firebaseAuth.currentUser?.uid === user.id;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-card shadow-sm">
        <div className="container mx-auto flex items-center gap-4 px-4 py-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(roleHomePath(user.role))}><ArrowLeft className="mr-2 h-4 w-4" />Volver</Button>
          <div className="flex items-center gap-3"><div className="rounded-lg bg-primary p-2"><ShieldCheck className="h-5 w-5 text-primary-foreground" /></div><div><h1 className="text-xl font-bold">Solicitudes de acceso</h1><p className="text-sm text-muted-foreground">Aprobación de nuevos perfiles sin correos ni códigos QR</p></div></div>
        </div>
      </header>
      <main className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
        {isAdmin ? <AccessRequestsPanel isSessionActive={isSessionActive} /> : (
          <Card><CardHeader><CardTitle>Las solicitudes las aprueba un administrador</CardTitle><CardDescription>Los nuevos usuarios deben registrarse desde “Solicitar acceso”. Un administrador revisará el perfil antes de habilitarlo.</CardDescription></CardHeader><CardContent><Button onClick={() => navigate(roleHomePath(user.role))}>Ir al panel</Button></CardContent></Card>
        )}
      </main>
    </div>
  );
};

export default Invite;
