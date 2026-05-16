import Head from "next/head";
import { useEffect, useRef, useState } from "react";

const STEPS = [
  "Fetching listing details",
  "Pulling nearby closed sales",
  "Analyzing comp features",
  "Building your offer report",
];

const PRICING = [
  {
    id: "single",
    label: "Single Report",
    price: "$19.99",
    hint: "One full offer report",
  },
  {
    id: "pack5",
    label: "5 Reports",
    price: "$49.99",
    hint: "Just $10 per report",
    badge: "Best value",
  },
  {
    id: "unlimited",
    label: "Unlimited",
    price: "$69.99",
    hint: "Unlimited reports — one-time payment",
  },
];

function HouseIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="checkSvg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [overlayState, setOverlayState] = useState("idle"); // idle | submitting | processing | success | error
  const [activeStep, setActiveStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [showPricing, setShowPricing] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const [returnNotice, setReturnNotice] = useState(null); // "paid" | "canceled" | null
  const timeouts = useRef([]);

  // Handle return from Stripe Checkout
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") === "1") {
      setReturnNotice("paid");
      runProcessingThenSuccess();
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("canceled") === "1") {
      setReturnNotice("canceled");
      window.history.replaceState({}, document.title, window.location.pathname);
      const t = setTimeout(() => setReturnNotice(null), 4500);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    return () => timeouts.current.forEach(clearTimeout);
  }, []);

  function runProcessingThenSuccess() {
    setOverlayState("processing");
    setActiveStep(0);
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
    STEPS.forEach((_, i) => {
      timeouts.current.push(
        setTimeout(() => setActiveStep(i + 1), (i + 1) * 900)
      );
    });
    timeouts.current.push(
      setTimeout(() => setOverlayState("success"), STEPS.length * 900 + 350)
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url || !email || overlayState === "submitting" || overlayState === "processing") return;

    setErrorMessage("");
    setOverlayState("submitting");

    let json;
    try {
      const r = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_url: url, email }),
      });
      json = await r.json();
      if (!r.ok) {
        setErrorMessage(json?.error || "Something went wrong. Try again.");
        setOverlayState("error");
        return;
      }
    } catch (err) {
      setErrorMessage("Network error. Try again.");
      setOverlayState("error");
      return;
    }

    if (json.status === "submitted") {
      runProcessingThenSuccess();
      return;
    }

    if (json.status === "payment_required") {
      setOverlayState("idle");
      setShowPricing(true);
      return;
    }

    setErrorMessage("Unexpected response. Try again.");
    setOverlayState("error");
  }

  async function pickPlan(planId) {
    if (checkoutLoading) return;
    setCheckoutLoading(planId);
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_url: url, email, plan: planId }),
      });
      const json = await r.json();
      if (r.ok && json.url) {
        window.location.href = json.url;
        return;
      }
      setErrorMessage(json?.error || "Could not start checkout.");
      setShowPricing(false);
      setOverlayState("error");
    } catch (err) {
      setErrorMessage("Network error starting checkout.");
      setShowPricing(false);
      setOverlayState("error");
    } finally {
      setCheckoutLoading(null);
    }
  }

  function resetForm() {
    setOverlayState("idle");
    setActiveStep(0);
    setUrl("");
    setEmail("");
    setShowPricing(false);
    setErrorMessage("");
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }

  const showOverlay = overlayState !== "idle";
  const progressPct =
    overlayState === "success"
      ? 100
      : overlayState === "processing"
      ? Math.min(100, (activeStep / STEPS.length) * 100)
      : overlayState === "submitting"
      ? 10
      : 0;

  return (
    <>
      <Head>
        <title>HomeBiddy — Your home buying buddy</title>
        <meta
          name="description"
          content="Paste any Zillow or Realtor.com link. We analyze closed sales, listing data and nearby comps to tell you exactly what to offer."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta property="og:title" content="HomeBiddy — Stop guessing. Bid with proof." />
        <meta
          property="og:description"
          content="Free comp-backed offer reports in under 2 minutes."
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="topStripe" />

      <main className="page">
        <header className="header">
          <div className="logo">
            <span className="logoIcon">
              <HouseIcon size={18} />
            </span>
            HomeBiddy
          </div>
          <div className="tagline">Your home buying buddy.</div>
        </header>

        <section className="hero" aria-label="Landing">
          <h1 className="heroHeading">
            Stop guessing. <em>Bid&nbsp;with&nbsp;proof.</em>
          </h1>
          <p className="heroSub">
            Paste any Zillow or Realtor.com link. We analyze closed sales,
            listing data, market dynamics and nearby comps to tell you exactly
            what to offer and why. Backed by real data, not gut feeling.
          </p>

          {returnNotice === "canceled" && (
            <div className="canceledNote" role="status">
              Payment canceled. Pick a plan to continue when you&rsquo;re ready.
            </div>
          )}

          <form className="formCard" onSubmit={handleSubmit} noValidate>
            <div className="formField">
              <label className="formLabel" htmlFor="listing_url">
                Listing URL
              </label>
              <input
                id="listing_url"
                name="listing_url"
                type="url"
                inputMode="url"
                required
                placeholder="https://www.zillow.com/homedetails/..."
                className="formInput"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="formField">
              <label className="formLabel" htmlFor="email">
                Your Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                required
                placeholder="you@example.com"
                className="formInput"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              className="goButton"
              disabled={overlayState === "submitting" || overlayState === "processing"}
            >
              {overlayState === "submitting" ? "Checking…" : <>Go <ArrowRight /></>}
            </button>
          </form>

          <div className="freeNote">
            <span className="freeBadge">FREE</span>
            <span>
              The first report is on us. Delivered to your inbox in under 2
              minutes.
            </span>
          </div>

          <div className="seeMore">
            <a href="#sample-report" className="seeMoreLink">
              See what you&rsquo;ll receive <ArrowDown />
            </a>
          </div>
        </section>

        <section id="sample-report" className="divider" aria-label="Sample report intro">
          <div className="dividerKicker">Sample Report</div>
          <div className="dividerAddress">442 28th St, West Palm Beach FL 33407</div>
        </section>

        <article className="report" aria-label="Sample offer report">
          <div className="reportHeader">
            <div className="reportLogo">
              <span className="reportLogoIcon">
                <HouseIcon size={15} color="#fff" />
              </span>
              HomeBiddy
            </div>
            <div className="reportTitle">Offer Report</div>
            <div className="reportSub">442 28th St, West Palm Beach FL 33407 · 4 bd · 3 ba · 2,610 sqft</div>
          </div>

          <div className="askingRow">
            <div className="askingBlock">
              <div className="label">Asking</div>
              <div className="askingValue">$1,995,000</div>
            </div>
            <div className="offerBlock">
              <div className="label">Recommended Offer</div>
              <div className="offerRange">$1,780,000&mdash;$1,850,000</div>
            </div>
          </div>

          <div className="statGrid">
            <div className="statCard">
              <div className="statLabel">Negotiability</div>
              <div className="statValue">8.2 / 10</div>
              <div className="statHint">High — seller motivated</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Days on Market</div>
              <div className="statValue">136</div>
              <div className="statHint">vs. 41-day median</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Price Cuts</div>
              <div className="statValue">2</div>
              <div className="statHint">$155K total reduction</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Zestimate Gap</div>
              <div className="statValue">$110K</div>
              <div className="statHint">Asking over estimate</div>
            </div>
          </div>

          <h2 className="sectionH">What the Data Tells You</h2>
          <ol className="insights">
            <li className="insight">
              <span className="insightNum">1</span>
              <div className="insightBody">
                <strong>Closed comps say $1.78M&ndash;$1.85M.</strong> Five
                nearby 4-bed sales in the last 6 months landed at
                $682&ndash;$720/sqft &mdash; this listing is priced at
                $764/sqft, roughly 9% above the comp band.
              </div>
            </li>
            <li className="insight">
              <span className="insightNum">2</span>
              <div className="insightBody">
                <strong>Time is on your side.</strong> 136 days on market is
                more than 3&times; the 41-day neighborhood median. After two
                cuts totaling $155K, the seller has already signaled clear
                flexibility.
              </div>
            </li>
            <li className="insight">
              <span className="insightNum">3</span>
              <div className="insightBody">
                <strong>The Zestimate agrees.</strong> Zillow pegs fair value
                at $1.885M &mdash; $110K below ask. A mid-$1.8s offer lands
                comfortably inside the algorithm&rsquo;s confidence band.
              </div>
            </li>
            <li className="insight">
              <span className="insightNum">4</span>
              <div className="insightBody">
                <strong>Negotiability score is 8.2/10.</strong> Long DOM, two
                price cuts, a Zestimate gap, and softening neighborhood demand
                all point to a seller who will engage on a sub-ask offer
                rather than wait for another buyer.
              </div>
            </li>
          </ol>

          <h2 className="sectionH">Negotiation Script</h2>
          <div className="scriptBox">
            &ldquo;Our offer is $1,820,000. Comparable 4-beds on 27th and 29th
            closed between $1.78M and $1.85M in the last quarter, and this home
            has been listed 136 days with two reductions. We&rsquo;re ready to
            move quickly with proof of funds &mdash; we&rsquo;d love to find a
            number that works for both sides.&rdquo;
          </div>

          <h2 className="sectionH">3 Questions to Ask the Listing Agent</h2>
          <ol className="questions">
            <li>
              <span className="qNum">1</span>
              <span>Why has the home sat for 136 days &mdash; any specific deal-killers in past offers?</span>
            </li>
            <li>
              <span className="qNum">2</span>
              <span>Is the seller willing to credit closing costs in lieu of further price reductions?</span>
            </li>
            <li>
              <span className="qNum">3</span>
              <span>What&rsquo;s the seller&rsquo;s timeline &mdash; do they have a contingent purchase in motion?</span>
            </li>
          </ol>

          <h2 className="sectionH">Recent Closed Comps</h2>
          <div className="compTableWrap">
            <table className="compTable">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Beds</th>
                  <th>Sqft</th>
                  <th>Sold</th>
                  <th>$/Sqft</th>
                  <th>DOM</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>411 29th St</td>
                  <td className="num">4</td>
                  <td className="num">2,540</td>
                  <td className="num">$1,820K</td>
                  <td className="num">$717</td>
                  <td className="num">42</td>
                </tr>
                <tr>
                  <td>518 27th St</td>
                  <td className="num">4</td>
                  <td className="num">2,610</td>
                  <td className="num">$1,795K</td>
                  <td className="num">$688</td>
                  <td className="num">58</td>
                </tr>
                <tr>
                  <td>329 28th St</td>
                  <td className="num">4</td>
                  <td className="num">2,720</td>
                  <td className="num">$1,855K</td>
                  <td className="num">$682</td>
                  <td className="num">71</td>
                </tr>
                <tr>
                  <td>624 26th St</td>
                  <td className="num">5</td>
                  <td className="num">2,820</td>
                  <td className="num">$1,925K</td>
                  <td className="num">$683</td>
                  <td className="num">39</td>
                </tr>
                <tr>
                  <td>207 30th St</td>
                  <td className="num">4</td>
                  <td className="num">2,480</td>
                  <td className="num">$1,785K</td>
                  <td className="num">$720</td>
                  <td className="num">33</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="tileGrid">
            <div className="tile">
              <div className="tileValue">$702</div>
              <div className="tileLabel">Comp avg $/sqft</div>
            </div>
            <div className="tile">
              <div className="tileValue">$1.83M</div>
              <div className="tileLabel">Comp median sale</div>
            </div>
            <div className="tile">
              <div className="tileValue">7.5%</div>
              <div className="tileLabel">Suggested under ask</div>
            </div>
            <div className="tile">
              <div className="tileValue">41</div>
              <div className="tileLabel">Median days on market</div>
            </div>
          </div>
        </article>
      </main>

      {/* ============ PRICING MODAL ============ */}
      {showPricing && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="pricing-title">
          <div className="overlayCard pricingCard">
            <div className="overlayHeader">
              <h2 className="overlayTitle" id="pricing-title">You&rsquo;ve used your free report</h2>
              <p className="overlaySub">Pick a plan to keep going. One-time payments — no subscriptions.</p>
            </div>
            <div className="planList">
              {PRICING.map((p) => (
                <button
                  key={p.id}
                  className={`plan ${p.badge ? "planFeatured" : ""}`}
                  type="button"
                  onClick={() => pickPlan(p.id)}
                  disabled={!!checkoutLoading}
                >
                  {p.badge && <span className="planBadge">{p.badge}</span>}
                  <div className="planRow">
                    <div className="planLeft">
                      <div className="planLabel">{p.label}</div>
                      <div className="planHint">{p.hint}</div>
                    </div>
                    <div className="planRight">
                      <div className="planPrice">{p.price}</div>
                      {checkoutLoading === p.id ? (
                        <span className="planSpinner" />
                      ) : (
                        <span className="planArrow"><ArrowRight /></span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="dismissLink"
              onClick={() => setShowPricing(false)}
              disabled={!!checkoutLoading}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* ============ PROCESSING / SUCCESS / ERROR OVERLAY ============ */}
      {showOverlay && (
        <div className="overlay" role="dialog" aria-live="polite" aria-modal="true">
          <div className="overlayCard">
            {(overlayState === "submitting" || overlayState === "processing") && (
              <>
                <div className="overlayHeader">
                  <h2 className="overlayTitle">Building your report</h2>
                  <p className="overlaySub">Hang tight — this takes about 10 seconds.</p>
                </div>
                <div className="progressTrack">
                  <div className="progressFill" style={{ width: `${progressPct}%` }} />
                </div>
                <ul className="stepList" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {STEPS.map((label, i) => {
                    const done = overlayState === "processing" && i < activeStep;
                    const active = overlayState === "processing" && i === activeStep;
                    return (
                      <li
                        key={label}
                        className={`step${done ? " done" : ""}${active ? " active" : ""}`}
                      >
                        <span className="stepIcon">
                          {done ? (
                            <CheckIcon />
                          ) : active ? (
                            <span className="spinner" />
                          ) : (
                            <span className="stepDot" />
                          )}
                        </span>
                        <span>{label}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {overlayState === "success" && (
              <div className="success">
                <div className="successIcon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2 className="successTitle">Report on its way!</h2>
                <p className="successSub">
                  Check {email || "your inbox"} in the next couple of minutes.
                </p>
                <button type="button" className="submitAnother" onClick={resetForm}>
                  + Submit another listing
                </button>
              </div>
            )}

            {overlayState === "error" && (
              <div className="success">
                <h2 className="successTitle">Hmm, that didn&rsquo;t work</h2>
                <p className="successSub">{errorMessage || "Something went wrong. Please try again."}</p>
                <button type="button" className="submitAnother" onClick={() => { setOverlayState("idle"); setErrorMessage(""); }}>
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
