import {
  provisionEmulatorUser,
  seedEmulatorJob,
  seedEmulatorProject,
  seedEmulatorTimeEntry,
} from "../../scripts/lib/firebase-auth-emulator.mjs";

const AUTH_EMULATOR_BASE_URL = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";

export interface EmulatorAuthSession {
  idToken: string;
  localId: string;
}

const requestJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body}`);
  return body ? (JSON.parse(body) as T) : ({} as T);
};

export const signInToAuthEmulator = (email: string, password: string) =>
  requestJson<EmulatorAuthSession>(
    `${AUTH_EMULATOR_BASE_URL}/accounts:signInWithPassword?key=demo-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );

export const provisionAndSignInToAuthEmulator = async (input: {
  email: string;
  password: string;
  displayName: string;
  role: "admin" | "manager" | "builder";
}) => {
  await provisionEmulatorUser(input);
  return signInToAuthEmulator(input.email, input.password);
};

export {
  provisionEmulatorUser,
  seedEmulatorJob,
  seedEmulatorProject,
  seedEmulatorTimeEntry,
};
