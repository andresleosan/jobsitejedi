import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
    allowedHosts: ["localhost", "127.0.0.1"],
  },
  preview: {
    host: "127.0.0.1",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "./src"),
    },
  },
});
