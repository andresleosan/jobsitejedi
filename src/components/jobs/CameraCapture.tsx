import { useState, useRef, useEffect } from "react";
import { Camera, X, FlipHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}

export const CameraCapture = ({ onCapture, onClose }: CameraCaptureProps) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = mediaStream;
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (error) {
        console.error("Error accessing camera:", error);
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setStream(null);
    };
  }, [facingMode]);

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            onCapture(blob);
            if (stream) {
            stream.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            }
          }
        }, "image/jpeg", 0.95);
      }
    }
  };

  const switchCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setFacingMode(prev => prev === "user" ? "environment" : "user");
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Take a Photo</DialogTitle>
        </DialogHeader>
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
            <Button
              variant="secondary"
              size="icon"
              onClick={switchCamera}
              className="rounded-full w-12 h-12"
            >
              <FlipHorizontal className="h-5 w-5" />
            </Button>
            <Button
              onClick={capturePhoto}
              className="rounded-full w-16 h-16 bg-white hover:bg-white/90"
            >
              <Camera className="h-8 w-8 text-primary" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
