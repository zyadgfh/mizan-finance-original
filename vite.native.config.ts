import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  root: resolve(projectRoot, "native"),
  base: "./",
  resolve: {
    alias: { "@": resolve(projectRoot, "src") },
  },
  plugins: [tailwindcss(), react()],
  build: {
    outDir: resolve(projectRoot, "native-dist"),
    emptyOutDir: true,
    target: "es2020",
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@supabase/")) return "supabase-vendor";
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-vendor";
          }
        },
      },
    },
  },
});
