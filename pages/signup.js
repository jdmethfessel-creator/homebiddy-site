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
  const [pendingEmail, setPendingEmail] = useState(null);
  const [resending, setResending] = useState(false);
  const [resentNote, setResentNote] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setResentNote("");
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
    const redirectTo = `${window.location.origin}/dashboard`;
    const { data, error: signErr } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    });
    if (signErr) {
      setError(signErr.message);
      setLoading(false);
      return;
    }
    if (data.session) {
      // Email confirmation disabled in this Supabase project — go straight in.
      router.replace("/dashboard");
      return;
    }
    // Email confirmation required (default). Show the pending screen.
    setPendingEmail(email);
    setLoading(false);
  }

  async function resendConfirmation() {
    if (!pendingEmail || resending) return;
    setResending(true);
    setResentNote("");
    const sb = getSupabaseClient();
    if (!sb) {
      setResending(false);
      return;
    }
    const redirectTo = `${window.location.origin}/dashboard`;
    const { error: resendErr } = await sb.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: redirectTo },
    });
    setResending(false);
    if (resendErr) {
      setResentNote(`Couldn't resend: ${resendErr.message}`);
    } else {
      setResentNote("Confirmation email resent. Check your inbox.");
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
          {pendingEmail ? (
            <>
              <h1 className="authTitle">Confirm your email</h1>
              <p className="authSub">
                We sent a confirmation link to <strong>{pendingEmail}</strong>. Click
                it to activate your account — you&rsquo;ll land back here on your dashboard.
              </p>
              <div className="authInfo">
                Didn&rsquo;t get it? Check spam, or resend below.
              </div>
              <button
                type="button"
                className="goButton"
                onClick={resendConfirmation}
                disabled={resending}
                style={{ marginTop: 14 }}
              >
                {resending ? "Sending…" : "Resend confirmation email"}
              </button>
              {resentNote && <div className="authInfo" style={{ marginTop: 10 }}>{resentNote}</div>}
              <div className="authFooter" style={{ marginTop: 18 }}>
                Already confirmed? <Link href="/login">Sign in</Link>
              </div>
              <div className="authBack">
                <button
                  type="button"
                  className="dashLink"
                  onClick={() => {
                    setPendingEmail(null);
                    setResentNote("");
                  }}
                >
                  Use a different email
                </button>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </main>
    </>
  );
}
