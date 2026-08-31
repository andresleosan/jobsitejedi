import { describe, expect, test, vi } from "vitest";
import { runActiveSessionTask } from "@/components/dashboard/active-session-task";

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("active-session async tasks", () => {
  test("discards a rejected request after its owning session closes", async () => {
    const request = deferred<string[]>();
    let active = true;
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    const result = runActiveSessionTask({
      task: () => request.promise,
      isTaskCurrent: () => true,
      isSessionActive: () => active,
      onSuccess,
      onError,
      onSettled,
    });

    active = false;
    request.reject(new Error("permission-denied after sign-out"));
    await result;

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  test("discards a successful request after its owning session closes", async () => {
    const request = deferred<string[]>();
    let active = true;
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    const result = runActiveSessionTask({
      task: () => request.promise,
      isTaskCurrent: () => true,
      isSessionActive: () => active,
      onSuccess,
      onError,
      onSettled,
    });

    active = false;
    request.resolve(["stale-job"]);
    await result;

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  test("still reports a rejected request while its session is active", async () => {
    const error = new Error("active session failure");
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    await runActiveSessionTask({
      task: async () => { throw error; },
      isTaskCurrent: () => true,
      isSessionActive: () => true,
      onSuccess,
      onError,
      onSettled,
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  test("applies a successful result only to its active session", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    await runActiveSessionTask({
      task: async () => ["job-1"],
      isTaskCurrent: () => true,
      isSessionActive: () => true,
      onSuccess,
      onError,
      onSettled,
    });

    expect(onSuccess).toHaveBeenCalledWith(["job-1"]);
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  test("does not let an older request settle a newer request", async () => {
    const request = deferred<string[]>();
    let current = true;
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    const result = runActiveSessionTask({
      task: () => request.promise,
      isTaskCurrent: () => current,
      isSessionActive: () => true,
      onSuccess,
      onError,
      onSettled,
    });

    current = false;
    request.resolve(["outdated-job"]);
    await result;

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  test("does not reclassify a success-handler defect as a request error", async () => {
    const programmingError = new Error("success handler defect");
    const onError = vi.fn();
    const onSettled = vi.fn();

    await expect(runActiveSessionTask({
      task: async () => ["job-1"],
      isTaskCurrent: () => true,
      isSessionActive: () => true,
      onSuccess: () => { throw programmingError; },
      onError,
      onSettled,
    })).rejects.toBe(programmingError);

    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
