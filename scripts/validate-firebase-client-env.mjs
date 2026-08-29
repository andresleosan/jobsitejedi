import process from "node:process";
import { loadEnv } from "vite";

const FIREBASE_PROJECT_ID = "jobsitejedi";

const validators = {
  VITE_FIREBASE_API_KEY: (value) => /^AIza[0-9A-Za-z_-]{20,}$/.test(value),
  VITE_FIREBASE_AUTH_DOMAIN: (value) =>
    /^[a-z0-9-]+\.firebaseapp\.com$/i.test(value),
  VITE_FIREBASE_PROJECT_ID: (value) => value === FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: (value) =>
    /^[a-z0-9._-]+\.(?:appspot\.com|firebasestorage\.app)$/i.test(value),
  VITE_FIREBASE_MESSAGING_SENDER_ID: (value) => /^\d{6,}$/.test(value),
  VITE_FIREBASE_APP_ID: (value) => /^\d+:\d+:web:[0-9a-f]+$/i.test(value),
};

export const validateFirebaseClientEnv = (env) => {
  const invalid = Object.entries(validators)
    .filter(([name, validator]) => {
      const value = env[name]?.trim() ?? "";
      return !value || value === name || !validator(value);
    })
    .map(([name]) => name);

  if (env.VITE_FIREBASE_USE_EMULATORS === "true") {
    invalid.push("VITE_FIREBASE_USE_EMULATORS must not be true for a deployment build");
  }

  return invalid;
};

const mode = process.argv[2] ?? "production";
const fileEnv = loadEnv(mode, process.cwd(), "VITE_FIREBASE_");
const env = { ...fileEnv, ...process.env };
const invalid = validateFirebaseClientEnv(env);

if (invalid.length > 0) {
  console.error("Firebase client environment validation failed.");
  console.error("Invalid or placeholder variables:");
  for (const name of invalid) {
    console.error(`- ${name}`);
  }
  console.error(
    "Set the official Firebase Web SDK values in the deployment environment; values are never printed by this validator.",
  );
  process.exitCode = 1;
} else {
  console.log(`Firebase client environment validated for ${mode}.`);
}
