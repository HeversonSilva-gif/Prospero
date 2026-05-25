import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Use relative paths so the build works under Electron's file:// protocol
  base: "./",
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", sourcemap: true },
  test: {
    // react-dom/server works in Node — no jsdom needed for server-render tests
    environment: "node",
  },
});
