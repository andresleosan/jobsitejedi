import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline/promises";

const consoleInputPath = process.platform === "win32" ? "\\\\.\\CONIN$" : "/dev/tty";

const defaultPrompt = async ({ action, challenge }) => {
  console.error(JSON.stringify({
    mode: "confirmation-required",
    action,
    challenge,
    scope: "current-process-only",
  }));

  const consoleInput = createReadStream(consoleInputPath, {
    encoding: "utf8",
    autoClose: true,
  });
  const terminal = createInterface({
    input: consoleInput,
    output: process.stderr,
    terminal: true,
  });
  try {
    return await terminal.question("Escriba el challenge exacto para continuar: ");
  } finally {
    terminal.close();
    consoleInput.destroy();
  }
};

export const requireInteractiveRoleConfirmation = async ({
  action,
  binding,
  environment = process.env,
  prompt = defaultPrompt,
}) => {
  if (typeof binding !== "string" || !/^[a-f0-9]{64}$/.test(binding)) {
    throw new Error("Interactive confirmation binding is invalid.");
  }
  const continuousIntegration = String(environment.CI).trim().toLowerCase();
  if (
    prompt === defaultPrompt
    && ["1", "true", "yes"].includes(continuousIntegration)
  ) {
    throw new Error("Interactive confirmation is unavailable in CI.");
  }

  const nonce = randomBytes(32);
  const challenge = createHmac("sha256", nonce)
    .update(action, "utf8")
    .update("\0", "utf8")
    .update(binding, "utf8")
    .digest("hex")
    .slice(0, 24);
  nonce.fill(0);

  let answer;
  try {
    answer = await prompt({ action, challenge });
  } catch {
    throw new Error("Interactive confirmation is unavailable.");
  }
  const normalizedAnswer = typeof answer === "string" ? answer.trim().toLowerCase() : "";
  const matches = /^[a-f0-9]{24}$/.test(normalizedAnswer)
    && timingSafeEqual(Buffer.from(normalizedAnswer, "hex"), Buffer.from(challenge, "hex"));
  if (!matches) {
    throw new Error("Interactive confirmation did not match the current audited state.");
  }
};
