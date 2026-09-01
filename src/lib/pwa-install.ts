export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface PwaInstallSnapshot {
  canPrompt: boolean;
  installed: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const isStandalone = () => typeof window !== "undefined" && (
  window.matchMedia("(display-mode: standalone)").matches
  || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
);
let snapshot: PwaInstallSnapshot = { canPrompt: false, installed: isStandalone() };
const listeners = new Set<() => void>();

function publish(next: PwaInstallSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    publish({ canPrompt: true, installed: false });
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    publish({ canPrompt: false, installed: true });
  });
}

export function getPwaInstallSnapshot(): PwaInstallSnapshot {
  return snapshot;
}

export function subscribePwaInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function requestPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const prompt = deferredPrompt;
  deferredPrompt = null;
  publish({ canPrompt: false, installed: false });
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") publish({ canPrompt: false, installed: true });
    return choice.outcome;
  } catch {
    publish({ canPrompt: false, installed: false });
    throw new Error("The browser installation prompt failed.");
  }
}
