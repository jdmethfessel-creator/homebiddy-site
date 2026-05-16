import { createClient } from "@supabase/supabase-js";

let _client;

export function getSupabaseClient() {
  if (typeof window === "undefined") return null;
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      console.warn("Supabase public env vars missing");
      return null;
    }
    _client = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _client;
}
