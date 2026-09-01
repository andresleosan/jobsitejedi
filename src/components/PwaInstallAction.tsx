import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPwaInstallSnapshot, requestPwaInstall, subscribePwaInstall } from "@/lib/pwa-install";

export function PwaInstallAction() {
  const install = useSyncExternalStore(subscribePwaInstall, getPwaInstallSnapshot, getPwaInstallSnapshot);
  const [guidance, setGuidance] = useState<"" | "unavailable" | "dismissed" | "error">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (install.canPrompt) setGuidance("");
  }, [install.canPrompt]);

  if (install.installed) return null;

  async function handleInstall() {
    setBusy(true);
    try {
      const outcome = await requestPwaInstall();
      if (outcome === "unavailable") setGuidance("unavailable");
      else if (outcome === "dismissed") setGuidance("dismissed");
    } catch {
      setGuidance("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void handleInstall()} disabled={busy}>
        {install.canPrompt ? <Download aria-hidden="true" /> : <Smartphone aria-hidden="true" />}
        <span>Instalar app</span>
      </Button>
      {guidance && (
        <p role="status" className="max-w-[22rem] text-xs leading-5 text-muted-foreground">
          {guidance === "dismissed"
            ? "La instalación no se completó. Puedes intentarlo de nuevo desde el menú de Chrome."
            : guidance === "error"
              ? "Chrome no pudo abrir la instalación. Usa el menú y toca “Instalar aplicación”."
              : "En Android, abre el menú de Chrome y toca “Instalar aplicación” o “Añadir a pantalla principal”."}
        </p>
      )}
    </div>
  );
}
