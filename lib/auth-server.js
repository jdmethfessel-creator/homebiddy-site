import { createClient } from "@supabase/supabase-js";

// Validates a Supabase access token on an API request.
// Returns { user } on success or null on failure.
export async function getUserFromRequest(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  // Reject unconfirmed accounts — dashboard requires verified email.
  // Supabase won't issue a session for an unconfirmed user when email
  // confirmation is enabled, but this is a belt-and-suspenders check.
  if (!data.user.email_confirmed_at && !data.user.confirmed_at) return null;
  return { user: data.user, accessToken: token };
}
