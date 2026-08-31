import { getApp, getApps, initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { firebaseAppCheckSiteKey, firebaseConfig } from "./config";

const env = import.meta.env as Record<string, string | undefined>;
const useEmulators = env.VITE_FIREBASE_USE_EMULATORS === "true";

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

// The deployment validator requires this public site key for production builds.
// Enforcement remains a separately controlled backend rollout so metrics can be
// observed before legitimate requests are rejected.
if (!useEmulators && firebaseAppCheckSiteKey) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(firebaseAppCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = initializeFirestore(
  firebaseApp,
  useEmulators ? { experimentalForceLongPolling: true } : {},
);
export const firebaseFunctions = getFunctions(
  firebaseApp,
  firebaseConfig.functionsRegion,
);

if (useEmulators) {
  connectAuthEmulator(
    firebaseAuth,
    `http://127.0.0.1:${firebaseConfig.emulators.auth}`,
    { disableWarnings: true },
  );
  connectFunctionsEmulator(
    firebaseFunctions,
    "127.0.0.1",
    firebaseConfig.emulators.functions,
  );
  connectFirestoreEmulator(
    firebaseDb,
    "127.0.0.1",
    firebaseConfig.emulators.firestore,
  );
}
