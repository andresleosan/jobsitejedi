import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, HardHat, QrCode, AlertTriangle, Camera } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { QRScannerDialog } from "@/components/auth/QRScannerDialog";
import { useAuth } from "@/hooks/useAuth";
import { invitationOperations } from "@/lib/firebase/functions";
import type { AppRole } from "@/lib/firebase/types";
import { MISSING_ROLE_MESSAGE } from "@/lib/firebase/auth";

// Validation schemas
const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address").max(255, "Email is too long"),
  password: z.string().min(1, "Password is required").max(72, "Password is too long"),
});

const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address").max(255, "Email is too long"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password is too long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  fullName: z.string().trim().min(1, "Full name is required").max(100, "Name is too long"),
  phone: z.string().trim().regex(/^(\+?[0-9\s\-()]+)?$/, "Please enter a valid phone number").max(20, "Phone number is too long").optional().or(z.literal("")),
});

interface InvitationData {
  valid: boolean;
  role: AppRole;
  invitationId: string;
  errorMessage: string | null;
}

const GoogleMark = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
    <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
    <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.3L6.5 14Z" />
    <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.4l3.4 2.7A5.9 5.9 0 0 1 12 6Z" />
  </svg>
);

const Auth = () => {
  const [searchParams] = useSearchParams();
  const invitationCodeFromUrl = searchParams.get("code");
  
  const [isLoading, setIsLoading] = useState(false);
  const [isValidatingCode, setIsValidatingCode] = useState(!!invitationCodeFromUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [invitationCode, setInvitationCode] = useState(invitationCodeFromUrl || "");
  const [invitationData, setInvitationData] = useState<InvitationData | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(invitationCodeFromUrl ? "signup" : "signin");
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"password" | "google" | "signup" | "signout" | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const {
    user,
    isLoading: isAuthLoading,
    signIn,
    signInWithGoogle,
    signOut,
    registerWithInvitation,
  } = useAuth();

  const hasMissingRole =
    searchParams.get("reason") === "missing-role" ||
    Boolean(user && !user.role) ||
    accessError === MISSING_ROLE_MESSAGE;

  useEffect(() => {
    if (!isAuthLoading && user?.role) navigate("/dashboard", { replace: true });
  }, [isAuthLoading, navigate, user]);

  // Validate invitation code from URL
  useEffect(() => {
    if (invitationCodeFromUrl) {
      validateInvitationCode(invitationCodeFromUrl);
    }
  }, [invitationCodeFromUrl]);

  const validateInvitationCode = async (code: string) => {
    if (!code.trim()) {
      setInvitationData(null);
      setCodeError(null);
      return;
    }

    setIsValidatingCode(true);
    setCodeError(null);

    try {
      const result = await invitationOperations.validateInvitationCode(code.trim().toUpperCase());

      if (result?.valid) {
        setInvitationData(result);
        setCodeError(null);
      } else {
        setInvitationData(null);
        setCodeError(result?.errorMessage || "Invalid invitation code");
      }
    } catch {
      setInvitationData(null);
      setCodeError("Failed to validate invitation code");
    } finally {
      setIsValidatingCode(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Must have valid invitation
    if (!invitationData?.valid) {
      toast({
        title: "Invalid Invitation",
        description: "You need a valid QR code invitation to sign up. Please contact an administrator.",
        variant: "destructive",
      });
      return;
    }

    // Validate input with Zod
    const validationResult = signUpSchema.safeParse({ email, password, fullName, phone });
    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0];
      toast({
        title: "Validation Error",
        description: firstError.message,
        variant: "destructive",
      });
      return;
    }

    const validatedData = validationResult.data;

    setIsLoading(true);
    setPendingAction("signup");
    try {
      await registerWithInvitation({
        email: validatedData.email,
        password: validatedData.password,
        fullName: validatedData.fullName,
        invitationId: invitationData.invitationId,
      });

      toast({
        title: "Account created!",
        description: `Welcome to BuildTrack Pro as a ${invitationData.role}`,
      });
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: "Sign up failed",
        description: error instanceof Error ? error.message : "Unable to create account",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setPendingAction(null);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccessError(null);
    
    // Validate input with Zod
    const validationResult = signInSchema.safeParse({ email, password });
    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0];
      toast({
        title: "Validation Error",
        description: firstError.message,
        variant: "destructive",
      });
      return;
    }

    const validatedData = validationResult.data;

    setIsLoading(true);
    setPendingAction("password");
    try {
      await signIn(validatedData.email, validatedData.password);

      toast({
        title: "Welcome back!",
        description: "Successfully signed in",
      });
      navigate("/dashboard");
    } catch (error) {
      setPassword("");
      const message = error instanceof Error ? error.message : "Unable to sign in";
      if (message === MISSING_ROLE_MESSAGE) setAccessError(message);
      toast({
        title: "Sign in failed",
        description: message,
        variant: "destructive",
      });
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
      await signInWithGoogle();
      toast({
        title: "Welcome back!",
        description: "Successfully signed in with Google",
      });
      navigate("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in with Google";
      if (message === MISSING_ROLE_MESSAGE) setAccessError(message);
      toast({
        title: "Google sign-in failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setPendingAction(null);
    }
  };

  const clearBlockedSession = async (focusForm: boolean) => {
    setIsLoading(true);
    setPendingAction("signout");
    try {
      await signOut();
      setEmail("");
      setPassword("");
      setAccessError(null);
      navigate("/auth", { replace: true });
      if (focusForm) requestAnimationFrame(() => emailInputRef.current?.focus());
    } catch {
      toast({
        title: "No se pudo cerrar la sesión",
        description: "Verifica la conexión e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setPendingAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-primary p-3">
              <HardHat className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">BuildTrack Pro</CardTitle>
          <CardDescription>
            Professional construction project management
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin" className="space-y-4">
              {hasMissingRole && (
                <div role="alert" className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <p className="font-medium text-foreground">La cuenta no tiene un rol asignado</p>
                    <p className="text-muted-foreground">Un administrador debe asignar el rol admin, manager o builder antes de ingresar.</p>
                  </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pl-7">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isLoading}
                      aria-label={"Cerrar sesi\u00f3n"}
                      onClick={() => void clearBlockedSession(false)}
                    >
                      {"Cerrar sesi\u00f3n"}
                    </Button>
                    <Button type="button" size="sm" disabled={isLoading} onClick={() => void clearBlockedSession(true)}>
                      {pendingAction === "signout" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Reintentar
                    </Button>
                  </div>
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
              >
                {pendingAction === "google" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <span className="mr-2"><GoogleMark /></span>
                )}
                Continue with Google
              </Button>

              <div className="flex items-center gap-3" aria-hidden="true">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">Or continue with email</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    ref={emailInputRef}
                    id="signin-email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    required
                    maxLength={255}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    required
                    maxLength={72}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {pendingAction === "password" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign In
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                {/* Invitation Code Input */}
                <div className="space-y-2">
                  <Label htmlFor="signup-invitation-code" className="flex items-center gap-2">
                    <QrCode className="h-4 w-4" />
                    Invitation Code *
                  </Label>
                  <div className="relative">
                    <Input
                      id="signup-invitation-code"
                      type="text"
                      placeholder="Enter code from QR scan"
                      value={invitationCode}
                      onChange={(e) => {
                        setInvitationCode(e.target.value.toUpperCase());
                        if (e.target.value.length >= 12) {
                          validateInvitationCode(e.target.value);
                        } else {
                          setInvitationData(null);
                          setCodeError(null);
                        }
                      }}
                      onBlur={() => validateInvitationCode(invitationCode)}
                      disabled={isLoading}
                      required
                      maxLength={12}
                      className="font-mono tracking-wider uppercase"
                    />
                    {isValidatingCode && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  
                  {/* Validation Status */}
                  {invitationData?.valid && (
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <Badge variant="outline" className="border-green-500 text-green-600">
                        ✓ Valid invitation for {invitationData.role}
                      </Badge>
                    </div>
                  )}
                  {codeError && (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      {codeError}
                    </div>
                  )}
                  {!invitationData && !codeError && !isValidatingCode && (
                    <p className="text-xs text-muted-foreground">
                      Scan the QR code from a manager to get your invitation code
                    </p>
                  )}
                </div>

                {/* Only show rest of form if invitation is valid */}
                {invitationData?.valid && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Full Name *</Label>
                      <Input
                        id="signup-name"
                        type="text"
                        placeholder="John Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        disabled={isLoading}
                        required
                        maxLength={100}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email *</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={isLoading}
                        required
                        maxLength={255}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-phone">Phone</Label>
                      <Input
                        id="signup-phone"
                        type="tel"
                        placeholder="+1 (555) 000-0000"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        disabled={isLoading}
                        maxLength={20}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password *</Label>
                      <Input
                        id="signup-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading}
                        required
                        maxLength={72}
                      />
                      <p className="text-xs text-muted-foreground">
                        Min 8 characters with uppercase, lowercase, and number
                      </p>
                    </div>
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create Account as {invitationData.role.charAt(0).toUpperCase() + invitationData.role.slice(1)}
                    </Button>
                  </>
                )}

                {/* QR Scanner Button */}
                {!invitationData?.valid && !isValidatingCode && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowQRScanner(true)}
                    className="w-full h-auto py-6 flex flex-col items-center gap-3 border-2 border-dashed border-primary/50 hover:border-primary hover:bg-primary/5 transition-all"
                  >
                    <div className="rounded-full bg-primary/10 p-3">
                      <Camera className="h-8 w-8 text-primary" />
                    </div>
                    <div className="text-center">
                      <p className="text-base font-semibold text-foreground">
                        Touch here to scan the QR code
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Ask a manager for an invitation QR code
                      </p>
                    </div>
                  </Button>
                )}

                {/* QR Scanner Dialog */}
                <QRScannerDialog
                  open={showQRScanner}
                  onClose={() => setShowQRScanner(false)}
                  onScan={(code) => {
                    setInvitationCode(code.toUpperCase());
                    validateInvitationCode(code);
                  }}
                />
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
