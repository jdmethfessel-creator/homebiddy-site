import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { getSupabaseClient } from "../lib/supabase-client";

export default function Signup() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    const sb = getSupabaseClient();
    if (!sb) {
      setError("Auth is not configured. Add Supabase keys on Vercel.");
      setLoading(false);
      return;
    }
    const { data, error: signErr } = await sb.auth.signUp({ email, password });
    if (signErr) {
      setError(signErr.message);
      setLoading(false);
      return;
    }
    if (data.session) {
      router.replace("/dashboard");
    } else {
      // Email confirmation required.
      setError("Check your email to confirm your account, then sign in.");
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Sign up · HomeBiddy</title>
      </Head>
      <div className="topStripe" />
      <main className="authPage">
        <div className="authCard">
          <h1 className="authTitle">Create your account</h1>
          <p className="authSub">Save homes. Compare offers. Build your shortlist.</p>
          <form onSubmit={handleSubmit} className="authForm" noValidate>
            <label className="formLabel" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="formInput"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            <label className="formLabel" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="formInput"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
            {error && <div className="authError">{error}</div>}
            <button type="submit" className="goButton" disabled={loading}>
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>
          <div className="authFooter">
            Already have an account? <Link href="/login">Sign in</Link>
          </div>
          <div className="authBack">
            <Link href="/">← Back to home</Link>
          </div>
        </div>
      </main>
    </>
  );
}
