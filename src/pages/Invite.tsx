import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, QrCode, Users, HardHat, Clock, Loader2, Copy, Check, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { invitationOperations } from "@/lib/firebase/functions";
import { isManagementRole, roleHomePath, type AppRole } from "@/lib/firebase/types";
import QRCode from "qrcode";

const Invite = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [role, setRole] = useState<AppRole>("builder");
  const [invitationCode, setInvitationCode] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user, isLoading: isAuthLoading } = useAuth();

  // Check auth and role
  useEffect(() => {
    if (isAuthLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    if (!isManagementRole(user.role)) {
      if (user.role) navigate(roleHomePath(user.role), { replace: true });
      return;
    }

    setIsLoading(false);
  }, [isAuthLoading, navigate, user]);

  // Timer countdown
  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0) {
        setInvitationCode(null);
        setQrCodeDataUrl(null);
        setExpiresAt(null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const generateInvitation = async () => {
    setIsGenerating(true);
    try {
      const invitation = await invitationOperations.createInvitation({ role });
      const signupUrl = `${window.location.origin}/auth?code=${encodeURIComponent(invitation.code)}`;
      const qrDataUrl = await QRCode.toDataURL(signupUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 300,
      });

      setInvitationCode(invitation.code);
      setQrCodeDataUrl(qrDataUrl);
      setExpiresAt(invitation.expiresAt);
      setTimeRemaining(300); // 5 minutes in seconds

      toast({
        title: "Invitation created!",
        description: `Valid for 5 minutes for ${role} role`,
      });
    } catch (error) {
      toast({
        title: "Failed to generate invitation",
        description: error instanceof Error ? error.message : "Unable to generate invitation",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (!invitationCode) return;
    
    const signupUrl = `${window.location.origin}/auth?code=${invitationCode}`;
    await navigator.clipboard.writeText(signupUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    
    toast({
      title: "Copied!",
      description: "Invitation link copied to clipboard",
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => user?.role && navigate(roleHomePath(user.role))}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <QrCode className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Invite Team Members</h1>
              <p className="text-sm text-muted-foreground">Generate QR codes for secure invitations</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <QrCode className="h-6 w-6 text-primary" />
              Generate Invitation QR Code
            </CardTitle>
            <CardDescription>
              Create a secure, single-use invitation that expires in 5 minutes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Role Selection */}
            <div className="space-y-2">
              <Label>Invite as</Label>
              <Select 
                value={role} 
                onValueChange={(value: AppRole) => setRole(value)}
                disabled={!!invitationCode}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builder">
                    <div className="flex items-center gap-2">
                      <HardHat className="h-4 w-4" />
                      Builder
                    </div>
                  </SelectItem>
                  {user?.role === "admin" && (
                    <>
                      <SelectItem value="manager">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Manager
                        </div>
                      </SelectItem>
                      <SelectItem value="admin">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Admin
                        </div>
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* QR Code Display */}
            {invitationCode ? (
              <div className="space-y-6">
                {/* Timer */}
                <div className="flex items-center justify-center gap-2">
                  <Clock className={`h-5 w-5 ${timeRemaining <= 60 ? 'text-destructive' : 'text-primary'}`} />
                  <span className={`text-2xl font-mono font-bold ${timeRemaining <= 60 ? 'text-destructive' : 'text-primary'}`}>
                    {formatTime(timeRemaining)}
                  </span>
                  <Badge variant={timeRemaining <= 60 ? "destructive" : "secondary"}>
                    {timeRemaining <= 60 ? "Expiring soon!" : "Active"}
                  </Badge>
                </div>

                {/* QR Code */}
                <div className="flex justify-center">
                  <div className="relative p-4 bg-white rounded-2xl shadow-lg">
                    <img
                      src={qrCodeDataUrl ?? ""}
                      alt="Invitation QR Code"
                      className="w-64 h-64"
                    />
                    {/* Overlay when expired */}
                    {timeRemaining === 0 && (
                      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center rounded-2xl">
                        <span className="text-destructive font-semibold">Expired</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Invitation Code Display */}
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">Invitation Code</p>
                  <div className="flex items-center justify-center gap-2">
                    <code className="px-4 py-2 bg-muted rounded-lg font-mono text-lg tracking-wider">
                      {invitationCode}
                    </code>
                    <Button variant="outline" size="icon" onClick={copyToClipboard}>
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Role Badge */}
                <div className="flex justify-center">
                  <Badge variant="outline" className="text-base px-4 py-2">
                    {role === "builder" ? <HardHat className="mr-2 h-4 w-4" /> : <Users className="mr-2 h-4 w-4" />}
                    {role[0].toUpperCase() + role.slice(1)} Invitation
                  </Badge>
                </div>

                {/* Generate New Button */}
                <Button 
                   onClick={() => {
                     setInvitationCode(null);
                     setQrCodeDataUrl(null);
                     setExpiresAt(null);
                  }}
                  variant="outline"
                  className="w-full"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Generate New Code
                </Button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Instructions */}
                <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                  <h4 className="font-medium">How it works:</h4>
                  <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                    <li>Select the role for the new team member</li>
                    <li>Generate a QR code invitation</li>
                    <li>Share the QR code with the new member</li>
                    <li>They scan it to sign up within 5 minutes</li>
                    <li>Each code can only be used once</li>
                  </ol>
                </div>

                {/* Generate Button */}
                <Button 
                  onClick={generateInvitation} 
                  className="w-full h-12 text-lg"
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  ) : (
                    <QrCode className="h-5 w-5 mr-2" />
                  )}
                  Generate QR Code
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Invite;
