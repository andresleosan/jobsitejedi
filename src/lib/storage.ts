import { supabase } from "@/integrations/supabase/client";
import { createStorageHelpers, type StorageClient } from "./storage-core";

export const storage = createStorageHelpers(
  supabase.storage as unknown as StorageClient,
);

export { getStoragePath } from "./storage-core";
