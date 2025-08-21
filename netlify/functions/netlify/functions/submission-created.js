// netlify/functions/submission-created.js
import sg from "@sendgrid/mail";
sg.setApiKey(process.env.SENDGRID_API_KEY || "");

export async function handler(event) {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid webhook payload" };
  }

  const payload = body.payload || {};
  const data = payload.data || {};

  // Honeypot: ignore bots
  if ((data.company || "").trim()) {
    return { statusCode: 200, body: "ok (bot)" };
  }

  // Build ordered table of ALL fields (readable)
  const preferredOrder = [
    "name","email","phone","vin","year","make","model","trim","mileage",
    "extColor","intColor","title","keys","owners","accident","accidentRepair",
    "warnings","mech","cosmetic","interior","mods","smells","service",
    "tires","brakes","wear",
    "utmSource","utmMedium","utmCampaign","utmTerm","utmContent",
    "referrer","landingPage","submittedAt"
  ];

  const htmlEscape = (s) => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== "";

  const included = new Set();
  const rows = [];

  preferredOrder.forEach(k => {
    const v = data[k];
    if (hasVal(v)) {
      rows.push([k, Array.isArray(v) ? v.join(", ") : String(v)]);
      included.add(k);
    }
  });

  Object.keys(data).sort().forEach(k => {
    if (included.has(k)) return;
    const v = data[k];
    if (hasVal(v)) rows.push([k, Array.isArray(v) ? v.join(", ") : String(v)]);
  });

  const prettyHtml = `
    <h2 style="margin:0 0 12px 0;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;">New Trade-In Lead</h2>
    <table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;font-size:14px;">
      ${rows.map(([k,v]) => `
        <tr>
          <th align="left" style="text-transform:capitalize;vertical-align:top;color:#111827;padding:6px 10px 6px 0;">${htmlEscape(k)}</th>
          <td style="vertical-align:top;color:#111827;padding:6px 0;">${htmlEscape(v)}</td>
        </tr>
      `).join("")}
    </table>
  `;
  const prettyText = rows.map(([k,v]) => `${k}: ${v}`).join("\n");

  // Gather file URLs (Netlify stores uploads and provides URLs)
  const possibleFileKeys = ["photoExterior", "photoInterior", "photoDash", "photoDamage"];
  let fileUrls = [];

  for (const key of possibleFileKeys) {
    const val = data[key];
    if (!val) continue;
    if (Array.isArray(val)) fileUrls.push(...val);
    else fileUrls.push(val);
  }
  if (Array.isArray(payload.files)) {
    for (const f of payload.files) if (f && f.url) fileUrls.push(f.url);
  }
  fileUrls = Array.from(new Set(fileUrls)).filter(u => /^https?:\/\//i.test(String(u)));

  // Attach a limited set (size safe) + link to all
  const MAX_ATTACH = 6;
  const MAX_EACH = 5 * 1024 * 1024;      // 5MB each
  const MAX_TOTAL = 15 * 1024 * 1024;    // ~15MB budget for attachments
  const attachments = [];
  let total = 0;

  async function fetchAsAttachment(url, ix) {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const ct = res.headers.get("content-type") || "application/octet-stream";
      const buf = new Uint8Array(await res.arrayBuffer());
      const size = buf.byteLength;
      if (size > MAX_EACH) return;
      if (total + size > MAX_TOTAL) return;

      const nameFromUrl = (u) => {
        try { return decodeURIComponent(new URL(u).pathname.split("/").pop() || `photo-${ix+1}`); }
        catch { return `photo-${ix+1}`; }
      };

      attachments.push({
        content: Buffer.from(buf).toString("base64"),
        filename: nameFromUrl(url),
        type: ct,
        disposition: "attachment",
      });
      total += size;
    } catch {}
  }

  for (let i = 0; i < fileUrls.length && attachments.length < MAX_ATTACH; i++) {
    await fetchAsAttachment(fileUrls[i], i);
  }

  const filesHtml = fileUrls.length
    ? `<ul>${fileUrls.map(u => `<li><a href="${htmlEscape(u)}">${htmlEscape(u)}</a></li>`).join("")}</ul>`
    : "<p>No photos uploaded.</p>";

  const subject = `New Trade-In Lead — ${data.name || ""} — ${[data.year, data.make, data.model].filter(Boolean).join(" ")}`.trim();

  try {
    await sg.send({
      to: ["steve@quirkcars.com", "gmcintosh@quirkcars.com", "lmendez@quirkcars.com"],
      from: process.env.FROM_EMAIL, // must be verified in SendGrid
      subject,
      text: `${prettyText}\n\nPhotos:\n${fileUrls.join("\n") || "No photos uploaded."}\n`,
      html: `${prettyHtml}<h3 style="margin-top:16px;">Photos</h3>${filesHtml}`,
      attachments: attachments.length ? attachments : undefined,
      // replyTo: "sales@quirkcars.com",
    });
  } catch {
    return { statusCode: 502, body: "Failed to send lead" };
  }

  return { statusCode: 200, body: "ok" };
}

