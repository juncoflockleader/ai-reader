import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.HOST || "127.0.0.1";
const apiPort = process.env.PORT || "3127";

export default defineConfig({
  plugins: [react()],
  root: "src/frontend",
  publicDir: "../../public",
  server: {
    host,
    port: 5173,
    proxy: {
      "^/api/.*": `http://127.0.0.1:${apiPort}`
    }
  },
  preview: {
    host,
    port: 4173
  },
  build: {
    outDir: "../../dist/frontend",
    emptyOutDir: true
  }
});
