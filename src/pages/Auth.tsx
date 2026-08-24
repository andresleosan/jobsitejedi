import { useState, useEffect } from "react";
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
import type { InvitationOperations } from "@/lib/firebase/types";

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
  role: "builder" | "manager";
  invitationId: string;
  errorMessage: string | null;
}

// Task 7 will provide the Cloud Functions-backed implementation.
const invitationOperations: InvitationOperations | null = null;

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
  const { toast } = useToast();
  const navigate = useNavigate();
  const {
    user,
    isLoading: isAuthLoading,
    signIn,
    registerBuilder,
  } = useAuth();

  useEffect(() => {
    if (!isAuthLoading && user) navigate("/dashboard");
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

    if (!invitationOperations) {
      setInvitationData(null);
      setCodeError("Invitation validation will be available after the Firebase Function migration.");
      setIsValidatingCode(false);
      return;
    }
    
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
        description: "You need a valid QR code invitation to sign up. Please contact a manager.",
        variant: "destructive",
      });
      return;
    }

    if (invitationData.role !== "builder") {
      toast({
        title: "Manager registration unavailable",
        description: "Manager accounts remain behind the Firebase Function workflow.",
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
    try {
      await registerBuilder({
        email: validatedData.email,
        password: validatedData.password,
        fullName: validatedData.fullName,
      });

      toast({
        title: "Account created!",
        description: "Welcome to BuildTrack Pro as a builder",
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
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
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
    try {
      await signIn(validatedData.email, validatedData.password);

      toast({
        title: "Welcome back!",
        description: "Successfully signed in",
      });
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: "Sign in failed",
        description: error instanceof Error ? error.message : "Unable to sign in",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
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
            
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
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
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
