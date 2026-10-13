import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devApi } from "./dev/vite-dev-api";

/** Chave secreta/service_role numa variável VITE_* iria parar no navegador: barra o build antes disso. */
function assertNoSecretInBrowserEnv(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_")) continue;
    const v = value.trim().replace(/^["']|["']$/g, "");
    let role: string | undefined;
    if (v.startsWith("eyJ")) {
      try {
        role = JSON.parse(
          Buffer.from(v.split(".")[1] ?? "", "base64url").toString(),
        ).role;
      } catch {
        role = undefined;
      }
    }
    if (v.startsWith("sb_secret_") || role === "service_role") {
      throw new Error(
        `${name} contém a chave SECRETA do Supabase, que ficaria pública no navegador. ` +
          "Use a chave publishable (sb_publishable_…) ou anon nas variáveis VITE_*, e troque a chave secreta no Supabase.",
      );
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  assertNoSecretInBrowserEnv(loadEnv(mode, process.cwd(), "VITE_"));
  return {
    plugins: [react(), tailwindcss(), devApi()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            data: [
              "@tanstack/react-query",
              "@supabase/supabase-js",
              "zod",
              "react-hook-form",
            ],
          },
        },
      },
    },
    // Somente variáveis VITE_* chegam ao bundle. SUPABASE_SERVICE_ROLE_KEY nunca deve ter esse prefixo.
    envPrefix: "VITE_",
  };
});
