import Link from "next/link";
import { useRouter } from "next/router";
import { getSupabaseClient } from "../lib/supabase-client";

function HouseIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export default function DashboardHeader({ email, subnav = null }) {
  const router = useRouter();

  async function signOut() {
    const sb = getSupabaseClient();
    if (sb) await sb.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="dashHeader">
      <div className="dashHeaderRow">
        <Link href="/dashboard" className="dashLogo">
          <span className="dashLogoIcon"><HouseIcon size={14} color="#fff" /></span>
          HomeBiddy
        </Link>
        <div className="dashHeaderRight">
          {email && <span className="dashEmail">{email}</span>}
          <button onClick={signOut} className="dashSignOut" type="button">Sign out</button>
        </div>
      </div>
      {subnav && <div className="dashSubnav">{subnav}</div>}
    </div>
  );
}
