import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://kpgszjnjmmosvrlujvkj.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_PuG_SXdV-T2d4y_o-gEE5g_jbg2XgU7";

function readPublicEnv(key: string): string | undefined {
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const fromMeta = metaEnv?.[key]?.trim();
    if (fromMeta) return fromMeta;
  } catch {
    /* ignore */
  }
  if (typeof process !== "undefined") {
    const fromProcess = process.env?.[key]?.trim();
    if (fromProcess) return fromProcess;
  }
  return undefined;
}

export const SUPABASE_URL = readPublicEnv("VITE_SUPABASE_URL") ?? DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = readPublicEnv("VITE_SUPABASE_ANON_KEY") ?? DEFAULT_SUPABASE_ANON_KEY;

let cachedClient: SupabaseClient | null = null;

export const SUPABASE_AUTH_STORAGE_KEY = "mizan.supabase.auth.v1";

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const hasStorage = typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  const isNodeDomTest =
    typeof navigator !== "undefined" && /HappyDOM|jsdom/i.test(navigator.userAgent ?? "");
  cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "pkce",
      persistSession: hasStorage && !isNodeDomTest,
      autoRefreshToken: hasStorage && !isNodeDomTest,
      detectSessionInUrl: typeof window !== "undefined" && !isNodeDomTest,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
      storage: hasStorage ? window.localStorage : undefined,
    },
  });
  return cachedClient;
}
