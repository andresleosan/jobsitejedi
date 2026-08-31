type FirebaseEnv = Record<string, string | undefined>;

const env = import.meta.env as FirebaseEnv;
const useEmulators = env.VITE_FIREBASE_USE_EMULATORS === "true";
const emulatorProjectId = "demo-jobsite-jedi";

const requiredProductionValue = (name: string) => {
  const value = env[name]?.trim();

  if (!value || value === name) {
    throw new Error(
      `Firebase client configuration is invalid: ${name} must be set by the deployment environment.`,
    );
  }

  return value;
};

export const firebaseConfig = {
  apiKey: useEmulators
    ? "demo-api-key"
    : requiredProductionValue("VITE_FIREBASE_API_KEY"),
  authDomain: useEmulators
    ? "demo-jobsite-jedi.firebaseapp.com"
    : requiredProductionValue("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: useEmulators
    ? emulatorProjectId
    : requiredProductionValue("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: useEmulators
    ? emulatorProjectId
    : requiredProductionValue("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: useEmulators
    ? "000000000000"
    : requiredProductionValue("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: useEmulators
    ? "demo-app-id"
    : requiredProductionValue("VITE_FIREBASE_APP_ID"),
  functionsRegion: "europe-west1",
  emulators: {
    auth: 9099,
    firestore: 8080,
    storage: 9199,
    functions: 5001,
    ui: 4000,
  },
} as const;

export const firebaseAppCheckSiteKey = env.VITE_FIREBASE_APPCHECK_SITE_KEY?.trim() || null;
