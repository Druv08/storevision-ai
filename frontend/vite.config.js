import fs from "fs";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Optional HTTPS for phone testing over the local network (self-signed).
// Enabled only when both env vars point at a key/cert; otherwise plain HTTP.
const httpsKey = process.env.VITE_HTTPS_KEY;
const httpsCert = process.env.VITE_HTTPS_CERT;
const https =
  httpsKey && httpsCert
    ? { key: fs.readFileSync(httpsKey), cert: fs.readFileSync(httpsCert) }
    : undefined;

// When serving the app over HTTPS to a phone, the page and the API must share
// one origin (no mixed content) — so the dev server proxies the backend paths
// to the local HTTP backend. Off by default; enabled with VITE_PROXY_BACKEND.
const backend = process.env.VITE_PROXY_BACKEND; // e.g. http://localhost:8000
const proxy = backend
  ? Object.fromEntries(
      ["/detect", "/health", "/upload-image", "/results", "/smart-suggestions"].map(
        (p) => [p, { target: backend, changeOrigin: true, secure: false }]
      )
    )
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    https,
    proxy,
    // Allow phone testing through HTTPS tunnels or the LAN IP (Vite blocks
    // unknown Host headers by default).
    allowedHosts: [
      ".ngrok-free.app",
      ".ngrok.app",
      ".ngrok.dev",
      ".trycloudflare.com",
      ".pinggy.link",
      ".lhr.life",
    ],
  },
});
