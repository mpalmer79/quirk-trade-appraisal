// netlify/functions/submission-created.js
import sg from "@sendgrid/mail";
sg.setApiKey(process.env.SENDGRID_API_KEY || "");

export async function handler(event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: "Invalid webhook payload" }; }

  const payload = body.payload || {};
  const data = payload.data || {};

  // ignore obvious bots if you use a honeypot
  if (data.botField || data.honeypot) return { statusCode: 200, body: "ok" };

  // file URLs supplied by Netlify Forms
  let fileUrls = [];
  try { fileUrls = (payload.files || []).map(f => f.url).filter(Boolean); } catch {}

  // build rows for email body
  const included = new Set(["form-name","botField","honeypot"]);
  const rows = [];
  const hasVal = v => v !== undefined && v !== null && String(v).trim() !== "";
  Object.keys(data).sort().forEach(k => {
    if (included.has(k)) return;
    const v = data[k];
    if (hasVal(v)) rows.push([k, Array.isArray(v) ? v.join(", ") : String(v)]);
  });
  const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const prettyHtml = `
    <h2 style="margin:0 0 12px 0;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;">
      New Trade-In Lead
    </h2>
    <table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;">
      ${rows.map(([k,v]) => `
        <tr>
          <th align="left" style="text-transform:capitalize;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;font-size:14px;color:#111827;padding:6px 10px 6px 0;">${esc(k)}</th>
          <td style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;font-size:14px;color:#111827;padding:6px 0;">${esc(v)}</td>
        </tr>`).join("")}
    </table>`;
  const prettyText = rows.map(([k,v]) => `${k}: ${v}`).join("\n");
  const subject = `New Trade-In Lead – ${data.year || ""} ${data.make || ""} ${data.model || ""}`.replace(/\s+/g," ").trim();

  // fetch limited attachments
  fileUrls = Array.from(new Set(fileUrls)).filter(u => /^https?:\/\//i.test(String(u)));
  const MAX_ATTACH = 6, MAX_EACH = 5 * 1024 * 1024, MAX_TOTAL = 15 * 1024 * 1024;
  const attachments = []; let total = 0;
  async function fetchAsAttachment(url, ix) {
    try {
      const res = await fetch(url); if (!res.ok) return;
      const ct = res.headers.get("content-type") || "application/octet-stream";
      const buf = Buffer.from(await res.arrayBuffer());
      const size = buf.byteLength; if (size > MAX_EACH || total + size > MAX_TOTAL) return;
      const nameFromUrl = (u) => { try { return decodeURIComponent(new URL(u).pathname.split("/").pop() || `photo-${ix+1}`); } catch { return `photo-${ix+1}`; } };
      attachments.push({ content: Buffer.from(buf).toString("base64"), filename: nameFromUrl(url), type: ct, disposition: "attachment" });
      total += size;
    } catch {}
  }
  for (let i = 0; i < fileUrls.length && attachments.length < MAX_ATTACH; i++) await fetchAsAttachment(fileUrls[i], i);

  const filesHtml = fileUrls.length ? `<ul>${fileUrls.map(u => `<li><a href="${esc(u)}">${esc(u)}</a></li>`).join("")}</ul>` : `<p>No photos uploaded.</p>`;

  try {
    await sg.send({
      to: ["steve@quirkcars.com", "gmcintosh@quirkcars.com", "lmendez@quirkcars.com"],
      from: process.env.FROM_EMAIL, // must be verified in SendGrid
      subject,
      text: `${prettyText}\n\nPhotos:\n${fileUrls.join("\n") || "No photos uploaded."}\n`,
      html: `${prettyHtml}<h3 style="margin-top:16px;">Photos</h3>${filesHtml}`,
      attachments: attachments.length ? attachments : undefined,
    });
  } catch (err) {
    console.error("SendGrid error:", err?.response?.body || err);
    return { statusCode: 502, body: "Failed to send lead" };
  }

  // optional Sheets backup
  try {
    if (process.env.SHEETS_WEBHOOK_URL) {
      const lead = { ...data, fileUrls, _ts: new Date().toISOString() };
      const u = process.env.SHEETS_SHARED_SECRET
        ? `${process.env.SHEETS_WEBHOOK_URL}?secret=${encodeURIComponent(process.env.SHEETS_SHARED_SECRET)}`
        : process.env.SHEETS_WEBHOOK_URL;
      await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead) });
    }
  } catch {}

  return { statusCode: 200, body: "ok" };
}
