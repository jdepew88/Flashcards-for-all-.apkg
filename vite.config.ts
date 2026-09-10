import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    // jszip + sql.js are only pulled in when a file is actually parsed, so they
    // land in their own async chunks rather than the initial page load.
    chunkSizeWarningLimit: 1200,
  },
});
