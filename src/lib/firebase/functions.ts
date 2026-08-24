import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "./client";
import type { AppRole } from "./types";

type RoleResponse = { role: AppRole };

const ensureBuilderRoleCallable = httpsCallable<
  { role: "builder" },
  RoleResponse
>(firebaseFunctions, "ensureBuilderRole");

const setUserRoleCallable = httpsCallable<
  { userId: string; role: AppRole },
  { userId: string; role: AppRole }
>(firebaseFunctions, "setUserRole");

export const ensureBuilderRole = async (): Promise<void> => {
  const result = await ensureBuilderRoleCallable({ role: "builder" });

  if (result.data.role !== "builder") {
    throw new Error("Unable to assign the builder role");
  }
};

export const assignUserRole = async (input: {
  userId: string;
  role: AppRole;
}): Promise<void> => {
  await setUserRoleCallable(input);
};
