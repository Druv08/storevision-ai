import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    // Allow phone testing through HTTPS tunnels (Vite blocks unknown
    // Host headers by default).
    allowedHosts: [".ngrok-free.app", ".ngrok.app", ".ngrok.dev", ".trycloudflare.com"]
  }
});