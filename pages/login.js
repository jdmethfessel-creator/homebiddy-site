import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { getSupabaseClient } from "../lib/supabase-client";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resending, setResending] = useState(false);
  const [info, setInfo] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setNeedsConfirm(false);
    setLoading(true);
    const sb = getSupabaseClient();
    if (!sb) {
      setError("Auth is not configured. Add Supabase keys on Vercel.");
      setLoading(false);
      return;
    }
    const { error: signErr } = await sb.auth.signInWithPassword({ email, password });
    if (signErr) {
      const msg = signErr.message || "Could not sign in.";
      if (/confirm/i.test(msg) || /not.*verified/i.test(msg)) {
        setNeedsConfirm(true);
        setError("Your email isn't confirmed yet. Check your inbox for the activation link, or resend it below.");
      } else {
        setError(msg);
      }
      setLoading(false);
      return;
    }
    router.replace("/dashboard");
  }

  async function resendConfirmation() {
    if (!email || resending) return;
    setResending(true);
    setInfo("");
    const sb = getSupabaseClient();
    if (!sb) {
      setResending(false);
      return;
    }
    const redirectTo = `${window.location.origin}/dashboard`;
    const { error: resendErr } = await sb.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: redirectTo },
    });
    setResending(false);
    if (resendErr) {
      setInfo(`Couldn't resend: ${resendErr.message}`);
    } else {
      setInfo("Confirmation email sent. Check your inbox.");
    }
  }

  return (
    <>
      <Head>
        <title>Sign in · HomeBiddy</title>
      </Head>
      <div className="topStripe" />
      <main className="authPage">
        <div className="authCard">
          <h1 className="authTitle">Welcome back</h1>
          <p className="authSub">Sign in to your saved homes.</p>
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
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
            {error && <div className="authError">{error}</div>}
            {needsConfirm && (
              <button
                type="button"
                className="dashLink"
                onClick={resendConfirmation}
                disabled={resending}
                style={{ marginTop: 8 }}
              >
                {resending ? "Sending…" : "Resend confirmation email"}
              </button>
            )}
            {info && <div className="authInfo" style={{ marginTop: 8 }}>{info}</div>}
            <button type="submit" className="goButton" disabled={loading} style={{ marginTop: 14 }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="authFooter">
            New here? <Link href="/signup">Create an account</Link>
          </div>
          <div className="authBack">
            <Link href="/">← Back to home</Link>
          </div>
        </div>
      </main>
    </>
  );
}
