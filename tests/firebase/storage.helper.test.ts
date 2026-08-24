import { beforeAll, describe, expect, test, vi } from "vitest";

let buildPrivateStoragePath: typeof import("@/lib/firebase/storage").buildPrivateStoragePath;
let getThumbnailPath: typeof import("@/lib/firebase/storage").getThumbnailPath;

beforeAll(async () => {
  vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
  ({ buildPrivateStoragePath, getThumbnailPath } = await import("@/lib/firebase/storage"));
});

describe("Firebase Storage path helpers", () => {
  test("builds normalized private paths and thumbnails", () => {
    const path = buildPrivateStoragePath("jobs", "job-1", "builder-1", "photo.jpg");
    expect(path).toBe("jobs/job-1/builder-1/photo.jpg");
    expect(getThumbnailPath(path)).toBe("jobs/job-1/builder-1/thumbnails/photo.jpg");
  });

  test("rejects traversal and empty path segments", () => {
    expect(() => buildPrivateStoragePath("jobs", "..", "photo.jpg")).toThrow(
      "invalid segment",
    );
    expect(() => getThumbnailPath("jobs//photo.jpg")).toThrow("invalid segment");
  });
});
