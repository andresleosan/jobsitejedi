type FirebaseEnv = Record<string, string | undefined>;

const env = import.meta.env as FirebaseEnv;
const useEmulators = env.VITE_FIREBASE_USE_EMULATORS === "true";
const emulatorProjectId = "demo-jobsite-jedi";

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    env.VITE_FIREBASE_AUTH_DOMAIN ?? "demo-jobsite-jedi.firebaseapp.com",
  projectId: useEmulators
    ? emulatorProjectId
    : (env.VITE_FIREBASE_PROJECT_ID ?? emulatorProjectId),
  storageBucket: useEmulators
    ? emulatorProjectId
    : (env.VITE_FIREBASE_STORAGE_BUCKET ?? "demo-jobsite-jedi.appspot.com"),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "000000000000",
  appId: env.VITE_FIREBASE_APP_ID ?? "demo-app-id",
  emulators: {
    auth: 9099,
    firestore: 8080,
    storage: 9199,
    functions: 5001,
    ui: 4000,
  },
} as const;
