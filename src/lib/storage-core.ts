export interface StorageUploadOptions {
  cacheControl?: string;
  contentType?: string;
  upsert?: boolean;
}

export interface StorageUploadData {
  path: string;
}

interface StorageBucketClient {
  upload(
    path: string,
    file: Blob | File,
    options?: StorageUploadOptions,
  ): Promise<{ data: StorageUploadData | null; error: unknown | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{ data: { signedUrl: string } | null; error: unknown | null }>;
  download(path: string): Promise<{ data: Blob | null; error: unknown | null }>;
}

export interface StorageClient {
  from(bucket: string): StorageBucketClient;
}

export const createStorageHelpers = (client: StorageClient) => ({
  async upload(
    bucket: string,
    path: string,
    file: Blob | File,
    options?: StorageUploadOptions,
  ): Promise<StorageUploadData | null> {
    const { data, error } = await client.from(bucket).upload(path, file, options);
    if (error) throw error;
    return data;
  },

  getPublicUrl(bucket: string, path: string): string {
    return client.from(bucket).getPublicUrl(path).data.publicUrl;
  },

  async createSignedUrl(
    bucket: string,
    path: string,
    expiresIn: number,
  ): Promise<string | null> {
    const { data } = await client.from(bucket).createSignedUrl(path, expiresIn);
    return data?.signedUrl ?? null;
  },

  async download(bucket: string, path: string): Promise<Blob> {
    const { data, error } = await client.from(bucket).download(path);
    if (error) throw error;
    if (!data) throw new Error("Storage download returned no data");
    return data;
  },
});

export const getStoragePath = (value: string, bucket: string): string => {
  const objectMarker = "/storage/v1/object/";
  const bucketMarker = `/${bucket}/`;
  const bucketIndex = value.indexOf(bucketMarker);

  if (!value.includes(objectMarker) || bucketIndex === -1) return value;

  const path = value.slice(bucketIndex + bucketMarker.length);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};
