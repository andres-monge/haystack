import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4321", // Must match HAYSTACK_LAB_PORT
        changeOrigin: true,
      },
    },
  },
});
