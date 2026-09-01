import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, HardHat, Loader2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { MISSING_ROLE_MESSAGE } from "@/lib/firebase/auth";
import type { AppRole } from "@/lib/firebase/types";

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address").max(255, "Email is too long"),
  password: z.string().min(1, "Password is required").max(72, "Password is too long"),
});

const roleLabel: Record<AppRole, string> = { admin: "Admin", manager: "Manager", builder: "Builder" };

type AccessRequestViewState =
  | { status: "loading" | "none" | "unavailable"; userId: string | null }
  | { status: "pending" | "approving"; requestedRole: AppRole; userId: string };

const GoogleMark = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
    <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
    <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.3L6.5 14Z" />
    <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.4l3.4 2.7A5.9 5.9 0 0 1 12 6Z" />
  </svg>
);

const RoleSelect = ({ id, value, onChange, disabled }: {
  id: string;
  value: AppRole;
  onChange: (role: AppRole) => void;
  disabled: boolean;
}) => (
  <select
    id={id}
    value={value}
    onChange={(event) => onChange(event.target.value as AppRole)}
    disabled={disabled}
    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
  >
    <option value="builder">Builder — ejecución en obra</option>
    <option value="manager">Manager — gestión de proyectos</option>
    <option value="admin">Admin — administración completa</option>
  </select>
);

const Auth = () => {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [requestedRole, setRequestedRole] = useState<AppRole>("builder");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [accessRequestView, setAccessRequestView] = useState<AccessRequestViewState>({ status: "none", userId: null });
  const [pendingAction, setPendingAction] = useState<"password" | "google" | "request" | "signout" | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user, isLoading: isAuthLoading, signIn, signInWithGoogle, signOut, getAccessRequestStatus, submitAccessRequest } = useAuth();

  const hasMissingRole = searchParams.get("reason") === "missing-role"
    || Boolean(user && !user.role)
    || accessError === MISSING_ROLE_MESSAGE;

  useEffect(() => {
    if (!user || user.role) {
      setAccessRequestView({ status: "none", userId: null });
      return;
    }

    let cancelled = false;
    setAccessRequestView({ status: "loading", userId: user.id });
    void getAccessRequestStatus()
      .then((request) => {
        if (cancelled) return;
        if ((request.status === "pending" || request.status === "approving") && request.requestedRole) {
          setAccessRequestView({ status: request.status, requestedRole: request.requestedRole, userId: user.id });
        } else {
          setAccessRequestView({ status: "none", userId: user.id });
        }
      })
      .catch(() => {
        if (!cancelled) setAccessRequestView({ status: "unavailable", userId: user.id });
      });

    return () => {
      cancelled = true;
    };
  }, [getAccessRequestStatus, user]);

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setAccessError(null);
    const validationResult = signInSchema.safeParse({ email, password });
    if (!validationResult.success) {
      toast({ title: "Validation error", description: validationResult.error.errors[0].message, variant: "destructive" });
      return;
    }
    setIsLoading(true);
    setPendingAction("password");
    try {
      const sessionUser = await signIn(validationResult.data.email, validationResult.data.password);
      if (sessionUser.role) {
        toast({ title: "Welcome back!", description: "Successfully signed in" });
        navigate("/dashboard");
      } else {
        setAccessError(MISSING_ROLE_MESSAGE);
        setFullName(sessionUser.fullName);
        toast({ title: "Solicitud pendiente", description: "Selecciona el perfil que deseas solicitar." });
      }
    } catch (error) {
      setPassword("");
      const message = error instanceof Error ? error.message : "Unable to sign in";
      if (message === MISSING_ROLE_MESSAGE) setAccessError(message);
      toast({ title: "Sign in failed", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
      setPendingAction(null);
    }
  };

  const handleGoogleSignIn = async () => {
    setAccessError(null);
    setIsLoading(true);
    setPendingAction("google");
    try {
      const sessionUser = await signInWithGoogle();
      if (sessionUser.role) {
        toast({ title: "Welcome back!", description: "Successfully signed in with Google" });
        navigate("/dashboard");
      } else {
        setAccessError(MISSING_ROLE_MESSAGE);
        setFullName(sessionUser.fullName);
        toast({ title: "Solicitud pendiente", description: "Selecciona el perfil que deseas solicitar." });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in with Google";
      if (message === MISSING_ROLE_MESSAGE) setAccessError(message);
      toast({ title: "Google sign-in failed", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
      setPendingAction(null);
    }
  };

  const handlePendingRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!fullName.trim()) {
      toast({ title: "Nombre requerido", description: "Indica tu nombre completo.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    setPendingAction("request");
    try {
      await submitAccessRequest({ requestedRole, fullName, phone: phone || null });
      setRequestSubmitted(true);
      setAccessError(null);
      setPassword("");
      toast({ title: "Solicitud enviada", description: "Tu acceso quedará pendiente de aprobación." });
    } catch (error) {
      if (error instanceof Error && error.message === "You already have a pending access request") {
        const currentRequest = await getAccessRequestStatus().catch(() => null);
        if (currentRequest && (currentRequest.status === "pending" || currentRequest.status === "approving") && currentRequest.requestedRole) {
          setAccessRequestView({ status: currentRequest.status, requestedRole: currentRequest.requestedRole, userId: user?.id ?? "" });
        }
      }
      toast({ title: "No se pudo enviar la solicitud", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      setPendingAction(null);
    }
  };

  const clearBlockedSession = async () => {
    setIsLoading(true);
    setPendingAction("signout");
    try {
      await signOut();
      setEmail("");
      setPassword("");
      setFullName("");
      setPhone("");
      setAccessError(null);
      setRequestSubmitted(false);
      requestAnimationFrame(() => emailInputRef.current?.focus());
    } catch (error) {
      toast({ title: "No se pudo cerrar la sesión", description: error instanceof Error ? error.message : "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      setPendingAction(null);
    }
  };

  if (isAuthLoading && !user) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="mb-4 flex justify-center"><div className="rounded-full bg-primary p-3"><HardHat className="h-8 w-8 text-primary-foreground" /></div></div>
          <CardTitle className="text-2xl font-bold">BuildTrack Pro</CardTitle>
          <CardDescription>Professional construction project management</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
              {requestSubmitted && <div role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"><p className="font-medium">Solicitud registrada</p><p className="text-muted-foreground">Podrás ingresar cuando un administrador apruebe el perfil solicitado.</p></div>}
              {hasMissingRole && user && accessRequestView.userId === user.id && accessRequestView.status === "loading" && (
                <div role="status" className="rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">
                  Verificando si ya existe una solicitud pendiente…
                </div>
              )}
              {hasMissingRole && user && accessRequestView.userId === user.id && (accessRequestView.status === "pending" || accessRequestView.status === "approving") && (
                <div role="status" className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><p className="font-medium">Solicitud de acceso pendiente</p><p className="text-muted-foreground">Ya solicitaste el perfil {roleLabel[accessRequestView.requestedRole]}. Espera a que un administrador revise la solicitud; no puedes enviar otra mientras siga pendiente.</p></div></div>
                  <Button type="button" size="sm" variant="outline" onClick={() => void clearBlockedSession()} disabled={isLoading}>{pendingAction === "signout" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cerrar sesión</Button>
                </div>
              )}
              {hasMissingRole && user && accessRequestView.userId === user.id && accessRequestView.status === "unavailable" && (
                <div role="alert" className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p>No se pudo verificar el estado de tu solicitud. Por seguridad, vuelve a intentarlo más tarde.</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => void clearBlockedSession()} disabled={isLoading}>Cerrar sesión</Button>
                </div>
              )}
              {hasMissingRole && user && accessRequestView.userId === user.id && accessRequestView.status === "none" && (
                <form onSubmit={handlePendingRequest} className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><p className="font-medium">La cuenta aún no tiene un perfil aprobado</p><p className="text-muted-foreground">Solicita el nivel de acceso que necesitas. Un administrador revisará la solicitud.</p></div></div>
                  <div className="space-y-2"><Label htmlFor="pending-name">Nombre completo</Label><Input id="pending-name" value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={isLoading} maxLength={100} required /></div>
                  <div className="space-y-2"><Label htmlFor="pending-phone">Teléfono (opcional)</Label><Input id="pending-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={isLoading} maxLength={20} /></div>
                  <div className="space-y-2"><Label htmlFor="pending-role">Perfil solicitado</Label><RoleSelect id="pending-role" value={requestedRole} onChange={setRequestedRole} disabled={isLoading} /></div>
                  <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={isLoading}>{pendingAction === "request" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Solicitar acceso</Button><Button type="button" size="sm" variant="outline" onClick={() => void clearBlockedSession()} disabled={isLoading}>{pendingAction === "signout" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cerrar sesión</Button></div>
                </form>
              )}
              <Button type="button" variant="outline" className="w-full" onClick={handleGoogleSignIn} disabled={isLoading}>{pendingAction === "google" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <span className="mr-2"><GoogleMark /></span>}Continue with Google</Button>
              <div className="flex items-center gap-3" aria-hidden="true"><div className="h-px flex-1 bg-border" /><span className="text-xs text-muted-foreground">Or continue with email</span><div className="h-px flex-1 bg-border" /></div>
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2"><Label htmlFor="signin-email">Email</Label><Input ref={emailInputRef} id="signin-email" type="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isLoading} required maxLength={255} /></div>
                <div className="space-y-2"><Label htmlFor="signin-password">Password</Label><Input id="signin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isLoading} required maxLength={72} /></div>
                <Button type="submit" className="w-full" disabled={isLoading}>{pendingAction === "password" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign In</Button>
              </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
