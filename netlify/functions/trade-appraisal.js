// netlify/functions/trade-appraisal.js
import sg from "@sendgrid/mail";
sg.setApiKey(process.env.SENDGRID_API_KEY || "");

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
  };

  // CORS / method guard
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "ok" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  // Parse JSON body
  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: "Invalid JSON" };
  }

  // Honeypot (silent success)
  if ((data.company || "").trim()) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, silent: true }) };
  }

  // Helpers
  const safe = (v) => (typeof v === "string" ? v.trim() : "");
  const digits = (v) => safe(v).replace(/\D/g, "");

  // Normalize the core fields we care about
  const lead = {
    name: safe(data.name),
    email: safe(data.email),
    phone: digits(data.phoneRaw || data.phone).slice(0, 15),
    vin: safe((data.vin || "").toUpperCase()),
    year: safe(data.year),
    make: safe(data.make),
    model: safe(data.model),
    trim: safe(data.trim),
    mileage: safe(data.mileage),
    extColor: safe(data.extColor),
    intColor: safe(data.intColor),
    submittedAt: new Date().toISOString(),
    referrer: safe(data.referrer),
    landingPage: safe(data.landingPage),
  };

  // Required
  if (!lead.name || !lead.email || !lead.phone || !lead.vin) {
    return { statusCode: 400, headers, body: "Missing required fields" };
  }

  // Build a human-readable email containing ALL fields we received.
  // Start with a preferred display order for key fields, then append any extras.
  const preferredOrder = [
    "name","email","phone","vin","year","make","model","trim","mileage",
    "extColor","intColor","title","keys","owners","accident","accidentRepair",
    "warnings","mech","cosmetic","interior","mods","smells","service",
    "tires","brakes","wear","utmSource","utmMedium","utmCampaign","utmTerm","utmContent",
    "referrer","landingPage","submittedAt"
  ];

  // Merge lead (normalized) over raw data so we don’t lose normalized values
  const merged = { ...data, ...lead };

  // Build rows: first preferred fields that exist, then any remaining custom fields
  const included = new Set();
  const rows = [];

  preferredOrder.forEach((k) => {
    if (merged[k] !== undefined && merged[k] !== null && String(merged[k]).trim() !== "") {
      rows.push([k, String(merged[k])]);
      included.add(k);
    }
  });

  Object.keys(merged)
    .filter((k) => !included.has(k))
    .sort()
    .forEach((k) => {
      const val = merged[k];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        rows.push([k, String(val)]);
      }
    });

  const htmlEscape = (s) => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const htmlTable = `
    <h2 style="margin:0 0 12px 0;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;">New Trade-In Lead</h2>
    <p style="margin:0 0 16px 0;color:#374151;">
      ${[lead.year, lead.make, lead.model].filter(Boolean).join(" ")} ${lead.trim ? `– ${htmlEscape(lead.trim)}` : ""}
    </p>
    <table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;font-size:14px;">
      ${rows.map(([k,v]) => `
        <tr>
          <th align="left" style="text-transform:capitalize;vertical-align:top;color:#111827;padding:6px 10px 6px 0;">${htmlEscape(k)}</th>
          <td style="vertical-align:top;color:#111827;padding:6px 0;">${htmlEscape(v)}</td>
        </tr>
      `).join("")}
    </table>
    <p style="margin-top:16px;color:#6B7280;font-size:12px;">Submitted at ${htmlEscape(lead.submittedAt)}</p>
  `;

  const textLines = rows.map(([k,v]) => `${k}: ${v}`).join("\n");
  const subjectLine = `New Trade-In Lead — ${lead.name} — ${[lead.year, lead.make, lead.model].filter(Boolean).join(" ")}`.trim();

  // === Send to Steve only (no VinSolutions) ===
  try {
    await sg.send({
      to: "steve@quirkcars.com",
      from: process.env.FROM_EMAIL, // must be a verified sender/domain in SendGrid
      subject: subjectLine,
      text: textLines,
      html: htmlTable,
      // replyTo: "sales@quirkcars.com", // optional
    });
  } catch (e) {
    return { statusCode: 502, headers, body: "Failed to send lead" };
  }

  // Optional Google Sheets backup (unchanged)
  try {
    if (process.env.SHEETS_WEBHOOK_URL) {
      const u = process.env.SHEETS_SHARED_SECRET
        ? `${process.env.SHEETS_WEBHOOK_URL}?secret=${encodeURIComponent(process.env.SHEETS_SHARED_SECRET)}`
        : process.env.SHEETS_WEBHOOK_URL;

      await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });
    }
  } catch (_) { /* ignore backup errors */ }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
}
