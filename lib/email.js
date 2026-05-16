import { Resend } from "resend";

const DEFAULT_FROM = "HomeBiddy <onboarding@resend.dev>";

export async function sendReportEmail({ to, address, pdfBuffer }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const safeAddress = address || "your home";
  const safeSlug = String(safeAddress)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `Your HomeBiddy Report — ${safeAddress}`,
    text:
      `Hi,\n\n` +
      `Your HomeBiddy offer report for ${safeAddress} is attached. ` +
      `Inside you'll find a recommended offer range backed by real closed comps, ` +
      `negotiability signals, a script you can use, and questions to ask the listing agent.\n\n` +
      `No gut feelings — just real data.\n\n` +
      `— The HomeBiddy team\n` +
      `homebiddy.com`,
    attachments: [
      {
        filename: `HomeBiddy-Report-${safeSlug}.pdf`,
        content: pdfBuffer,
      },
    ],
  });
  if (error) {
    throw new Error(`Resend error: ${error.message || JSON.stringify(error)}`);
  }
  return data;
}
