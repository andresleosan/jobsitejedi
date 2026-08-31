const SAFE_CHILD_ENVIRONMENT_KEYS = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "FORCE_COLOR",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NO_COLOR",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XAUTHORITY",
]);

const isDebugOrQaSecretKey = (key) => {
  const normalized = key.toUpperCase();
  return normalized === "DEBUG"
    || normalized === "PWDEBUG"
    || normalized === "NODE_DEBUG"
    || normalized === "NODE_OPTIONS"
    || normalized === "FIREBASE_QA_PASSWORD"
    || normalized.startsWith("PLAYWRIGHT_");
};

export const clearQaDebugEnvironment = (environment = process.env) => {
  for (const key of Object.keys(environment)) {
    if (isDebugOrQaSecretKey(key)) delete environment[key];
  }
};

export const createSafeQaChildEnvironment = (environment = process.env) => {
  const safeEnvironment = {};
  for (const [key, value] of Object.entries(environment)) {
    if (
      typeof value === "string"
      && SAFE_CHILD_ENVIRONMENT_KEYS.has(key.toUpperCase())
    ) {
      safeEnvironment[key] = value;
    }
  }
  safeEnvironment.VITE_FIREBASE_USE_EMULATORS = "false";
  return safeEnvironment;
};
