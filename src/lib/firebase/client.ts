import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { firebaseConfig } from "./config";

const env = import.meta.env as Record<string, string | undefined>;
const useEmulators = env.VITE_FIREBASE_USE_EMULATORS === "true";

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = getFirestore(firebaseApp);
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
