import { test, expect } from "@playwright/test";
import { createStorageHelpers, getStoragePath } from "../src/lib/storage-core";

test("extracts a storage path from a Supabase object URL", () => {
  expect(
    getStoragePath(
      "https://example.supabase.co/storage/v1/object/public/job-photos/job%2Fphoto.jpg",
      "job-photos",
    ),
  ).toBe("job/photo.jpg");
});

test("uploads through the selected bucket and returns the upload data", async () => {
  const uploaded: Array<{ bucket: string; path: string }> = [];
  const helpers = createStorageHelpers({
    from(bucket: string) {
      return {
        async upload(path: string) {
          uploaded.push({ bucket, path });
          return { data: { path }, error: null };
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `https://cdn.example/${bucket}/${path}` } };
        },
        async createSignedUrl() {
          return { data: { signedUrl: "https://signed.example/photo" }, error: null };
        },
        async download() {
          return { data: new Blob(["photo"]), error: null };
        },
      };
    },
  });

  const result = await helpers.upload("job-photos", "job/photo.jpg", new Blob(["photo"]));

  expect(result).toEqual({ path: "job/photo.jpg" });
  expect(uploaded).toEqual([{ bucket: "job-photos", path: "job/photo.jpg" }]);
});

test("reads public URLs, signed URLs, and downloads through the selected bucket", async () => {
  const helpers = createStorageHelpers({
    from() {
      return {
        async upload() {
          return { data: null, error: null };
        },
        getPublicUrl() {
          return { data: { publicUrl: "https://cdn.example/photo.jpg" } };
        },
        async createSignedUrl() {
          return { data: { signedUrl: "https://signed.example/photo" }, error: null };
        },
        async download() {
          return { data: new Blob(["photo"]), error: null };
        },
      };
    },
  });

  expect(helpers.getPublicUrl("job-photos", "photo.jpg")).toBe("https://cdn.example/photo.jpg");
  expect(await helpers.createSignedUrl("job-photos", "photo.jpg", 3600)).toBe(
    "https://signed.example/photo",
  );
  expect(await helpers.download("job-photos", "photo.jpg")).toBeInstanceOf(Blob);
});
