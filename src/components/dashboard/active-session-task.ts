export interface ActiveSessionTaskOptions<Result> {
  task: () => Promise<Result>;
  isTaskCurrent: () => boolean;
  isSessionActive: () => boolean;
  onSuccess: (result: Result) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
}

export const runActiveSessionTask = async <Result>({
  task,
  isTaskCurrent,
  isSessionActive,
  onSuccess,
  onError,
  onSettled,
}: ActiveSessionTaskOptions<Result>): Promise<void> => {
  if (!isTaskCurrent() || !isSessionActive()) return;

  let outcome:
    | { status: "success"; result: Result }
    | { status: "error"; error: unknown };

  try {
    outcome = { status: "success", result: await task() };
  } catch (error) {
    outcome = { status: "error", error };
  }

  try {
    if (!isTaskCurrent() || !isSessionActive()) return;
    if (outcome.status === "success") {
      onSuccess(outcome.result);
    } else {
      onError(outcome.error);
    }
  } finally {
    if (isTaskCurrent()) onSettled();
  }
};
