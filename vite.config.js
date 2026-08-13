import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA. We use hash-based routing (#/e/<id>), so no server rewrite
// rules are needed on any host.
export default defineConfig({
  plugins: [react()],
});
