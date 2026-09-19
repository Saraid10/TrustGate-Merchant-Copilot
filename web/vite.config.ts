import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The demo serves the built app from the backend at /app, same origin: Paytm's callback is a
// browser POST to the backend that redirects to /app. `npm run dev` stays at the root and
// proxies API calls to the backend.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/app/" : "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.TG_BACKEND ?? "http://127.0.0.1:8000" },
  },
}));
