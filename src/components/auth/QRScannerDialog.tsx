import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Loader2 } from "lucide-react";

interface QRScannerDialogProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

export const QRScannerDialog = ({ open, onClose, onScan }: QRScannerDialogProps) => {
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const hasStartedRef = useRef(false);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner || !hasStartedRef.current) return;

    try {
      await scanner.stop();
    } catch {
      // ignore
    }

    try {
      scanner.clear();
    } catch {
      // ignore
    }

    hasStartedRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    void stopScanner();
    setError(null);
    setIsStarting(true);
    onClose();
  }, [onClose, stopScanner]);

  const handleScan = useCallback(
    (decodedText: string) => {
      // Extract code from URL if it's a full URL
      let code = decodedText;
      try {
        if (decodedText.includes("code=")) {
          const url = new URL(decodedText);
          code = url.searchParams.get("code") || decodedText;
        }
      } catch {
        // Not a URL, use as-is
      }
      onScan(code);
      handleClose();
    },
    [onScan, handleClose]
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    // Small delay to ensure DOM is ready
    const initTimer = setTimeout(() => {
      const containerId = "qr-reader";
      const container = document.getElementById(containerId);

      if (!container) {
        if (!cancelled) {
          setError("Scanner container not found");
          setIsStarting(false);
        }
        return;
      }

      // Clear any existing content
      container.innerHTML = "";

      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;

      const scanConfig = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      };

      const attemptStart = async (cameraIdOrConfig: string | MediaTrackConstraints) => {
        await scanner.start(cameraIdOrConfig, scanConfig, handleScan, () => {
          // Ignore scan errors (no QR found yet)
        });
      };

      (async () => {
        try {
          if (!cancelled) {
            setError(null);
            setIsStarting(true);
          }

          let lastErr: unknown;

          const tryAttempt = async (cameraIdOrConfig: string | MediaTrackConstraints) => {
            try {
              await attemptStart(cameraIdOrConfig);
              return true;
            } catch (e) {
              lastErr = e;
              return false;
            }
          };

          const cameras = await Html5Qrcode.getCameras().catch(() => []);
          const preferred =
            cameras.find((c) => /back|rear|environment/i.test(c.label)) ??
            (cameras.length ? cameras[cameras.length - 1] : undefined);

          const started =
            (preferred?.id ? await tryAttempt(preferred.id) : false) ||
            (await tryAttempt({ facingMode: { ideal: "environment" } })) ||
            (await tryAttempt({ facingMode: { ideal: "user" } }));

          if (!started) {
            throw lastErr ?? new Error("Failed to start camera");
          }

          hasStartedRef.current = true;
          if (!cancelled) setIsStarting(false);
        } catch (err) {
          console.error("QR Scanner error:", err);
          const name =
            typeof err === "object" && err && "name" in err
              ? String(err.name)
              : "";

          if (!cancelled) {
            if (name === "NotFoundError") {
              setError(
                "No camera was found. If you're on a desktop preview, try on a phone (or connect a camera) and close any other app using the camera."
              );
            } else if (name === "NotAllowedError" || name === "SecurityError") {
              setError(
                "Camera permission is blocked. Please allow camera access in your browser settings and try again."
              );
            } else {
              setError("Unable to access camera. Please check permissions and try again.");
            }
            setIsStarting(false);
          }
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(initTimer);
      void stopScanner();
    };
  }, [open, handleScan, stopScanner]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Scan QR Code
          </DialogTitle>
        </DialogHeader>
        
        <div className="px-4 pb-4 space-y-4">
          {error ? (
            <div className="text-center py-8 space-y-4">
              <div className="rounded-full bg-destructive/10 p-4 w-fit mx-auto">
                <Camera className="h-8 w-8 text-destructive" />
              </div>
              <p className="text-destructive text-sm">{error}</p>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
            </div>
          ) : (
            <>
              {/* Camera container with fixed aspect ratio */}
              <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '1' }}>
                {isStarting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted z-10">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                    <p className="text-sm text-muted-foreground">Starting camera...</p>
                  </div>
                )}
                <div 
                  id="qr-reader" 
                  className="w-full h-full"
                  style={{ minHeight: '300px' }}
                />
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Point your camera at the QR code
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
