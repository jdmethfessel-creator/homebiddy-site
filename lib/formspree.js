export const FORMSPREE_ENDPOINT = "https://formspree.io/f/mgodjjpl";

export async function submitToFormspree({ listing_url, email }) {
  const fd = new URLSearchParams();
  fd.append("listing_url", listing_url);
  fd.append("email", email);
  try {
    const r = await fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      body: fd,
      headers: { Accept: "application/json" },
    });
    return r.ok;
  } catch (err) {
    console.error("Formspree submission failed:", err);
    return false;
  }
}
