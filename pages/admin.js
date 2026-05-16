import Head from "next/head";
import { useEffect, useState } from "react";

const PW_KEY = "homebiddy_admin_pw";

export default function Admin() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [address, setAddress] = useState("");
  const [raw, setRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(PW_KEY);
    if (saved) {
      setPassword(saved);
      setAuthed(true);
    }
  }, []);

  function tryAuth(e) {
    e.preventDefault();
    if (!password) return;
    window.sessionStorage.setItem(PW_KEY, password);
    setAuthed(true);
  }

  function signOut() {
    window.sessionStorage.removeItem(PW_KEY);
    setPassword("");
    setAuthed(false);
    setResult(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!address || !raw) return;
    setSubmitting(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/admin/save-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ address, raw_report: raw }),
      });
      const json = await r.json();
      if (!r.ok) {
        if (r.status === 401) {
          setError("Bad password.");
          signOut();
        } else {
          setError(json.error || "Failed");
        }
      } else {
        setResult(json);
        setAddress("");
        setRaw("");
      }
    } catch (err) {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>Admin · HomeBiddy</title>
      </Head>
      <div className="topStripe" />
      <main className="adminPage">
        <div className="adminCard">
          <div className="adminTitleRow">
            <h1 className="authTitle">Admin · Save Report</h1>
            {authed && (
              <button type="button" className="dashSignOut" onClick={signOut}>
                Lock
              </button>
            )}
          </div>

          {!authed ? (
            <form onSubmit={tryAuth} className="authForm">
              <p className="authSub">Enter the admin password to continue.</p>
              <label className="formLabel" htmlFor="pw">Password</label>
              <input
                id="pw"
                type="password"
                className="formInput"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <button type="submit" className="goButton">Unlock</button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="authForm">
              <p className="authSub">
                Paste a Claude-generated report below. We&rsquo;ll parse it and unlock it
                for every paying user who saved this address.
              </p>
              <label className="formLabel" htmlFor="address">Address</label>
              <input
                id="address"
                type="text"
                className="formInput"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="442 28th St, West Palm Beach FL 33407"
                required
              />
              <label className="formLabel" htmlFor="raw" style={{ marginTop: 12 }}>
                Report text
              </label>
              <textarea
                id="raw"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                className="adminTextarea"
                placeholder="Paste the full Claude-generated report here…"
                required
              />
              {error && <div className="authError">{error}</div>}
              {result && (
                <div className="authInfo">
                  Report saved for <strong>{result.address}</strong>.{" "}
                  <strong>{result.unlocked_count}</strong> user
                  {result.unlocked_count === 1 ? "" : "s"} unlocked.
                  {result.typed_address && (
                    <div style={{ marginTop: 6, fontSize: 12 }}>
                      Note: stored canonical form differs from what you typed
                      (“{result.typed_address}”). The canonical form is what
                      saved-home addresses are matched against.
                    </div>
                  )}
                  {result.extracted_summary && (
                    <div style={{ marginTop: 6, fontSize: 12 }}>
                      Asking ${result.extracted_summary.asking?.toLocaleString()} · Offer{" "}
                      {result.extracted_summary.offer} · {result.extracted_summary.neighborhood}
                    </div>
                  )}
                </div>
              )}
              <button type="submit" className="goButton" disabled={submitting} style={{ marginTop: 14 }}>
                {submitting ? "Parsing with Claude…" : "Save report"}
              </button>
            </form>
          )}
        </div>
      </main>
    </>
  );
}
