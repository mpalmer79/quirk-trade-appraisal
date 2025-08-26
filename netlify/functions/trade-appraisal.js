// netlify/functions/trade-appraisal.js
import sg from "@sendgrid/mail";
import Busboy from "busboy";

sg.setApiKey(process.env.SENDGRID_API_KEY || "");

/** ---------- helpers ---------- **/
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

const safe = (v) => (typeof v === "string" ? v.trim() : "");
const digits = (v) => safe(v).replace(/\D/g, "");
const htmlEscape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Parse multipart/form-data into { fields, files[] } */
async function parseMultipart(event) {
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  const busboy = Busboy({ headers: { "content-type": contentType } });

  const fields = {};
  const files = []; // { field, filename, mimetype, buffer }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");

  return new Promise((resolve, reject) => {
    busboy.on("field", (name, val) => { fields[name] = val; });
    busboy.on("file", (name, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        files.push({
          field: name,
          filename: filename || "upload",
          mimetype: mimeType || "application/octet-stream",
          buffer: Buffer.concat(chunks),
        });
      });
    });
    busboy.on("error", reject);
    busboy.on("finish", () => resolve({ fields, files }));
    busboy.end(body);
  });
}

/** Build your nice HTML table + text body from a flat object */
function buildEmailBodies(lead, rawData) {
  const preferredOrder = [
    "name","email","phone","vin","year","make","model","trim","mileage",
    "extColor","intColor","title","keys","owners","accident","accidentRepair",
    "warnings","mech","cosmetic","interior","mods","smells","service",
    "tires","brakes","wear","utmSource","utmMedium","utmCampaign","utmTerm","utmContent",
    "referrer","landingPage","submittedAt"
  ];

  const merged = { ...rawData, ...lead }; // keep normalized over raw
  const included = new Set();
  const rows = [];

  preferredOrder.forEach((k) => {
    const v = merged[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      rows.push([k, String(v)]);
      included.add(k);
    }
  });

  Object.keys(merged)
    .filter((k) => !included.has(k))
    .sort()
    .forEach((k) => {
      const v = merged[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        rows.push([k, String(v)]);
      }
    });

  const htmlTable = `
    <h2 style="margin:0 0 12px;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;">New Trade-In Lead</h2>
    <p style="margin:0 0 16px;color:#374151;">
      ${[lead.year, lead.make, lead.model].filter(Boolean).join(" ")}${lead.trim ? ` – ${htmlEscape(lead.trim)}` : ""}
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

  const textLines = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  return { htmlTable, textLines };
}

/** Normalize fields to your schema */
function normalizeLead(src) {
  return {
    name: safe(src.name),
    email: safe(src.email),
    phone: digits(src.phoneRaw || src.phone).slice(0, 15),
    vin: safe((src.vin || "").toUpperCase()),
    year: safe(src.year),
    make: safe(src.make),
    model: safe(src.model),
    trim: safe(src.trim),
    mileage: safe(src.mileage),
    extColor: safe(src.extColor),
    intColor: safe(src.intColor),
    referrer: safe(src.referrer),
    landingPage: safe(src.landingPage),
    submittedAt: new Date().toISOString(),
  };
}

/** Convert files -> SendGrid attachments (cap to 8) */
function toAttachments(files) {
  return files.slice(0, 8).map((f) => ({
    content: f.buffer.toString("base64"),
    filename: f.filename,
    type: f.mimetype,
    disposition: "attachment",
  }));
}

/** ---------- handler ---------- **/
export async function handler(event) {
  // CORS / method guard
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "ok" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  const ct = event.headers["content-type"] || event.headers["Content-Type"] || "";
  const isMultipart = ct.startsWith("multipart/form-data");

  let rawData = {};
  let uploads = [];

  try {
    if (isMultipart) {
      // Parse multipart form-data (photos included)
      const { fields, files } = await parseMultipart(event);
      rawData = fields;
      uploads = files;
    } else {
      // Fallback: JSON body (keeps your current behavior for JSON posts)
      rawData = JSON.parse(event.body || "{}");
    }
  } catch {
    return { statusCode: 400, headers, body: "Invalid request body" };
  }

  // Honeypot (silent success)
  if ((safe(rawData.company) || "").trim()) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, silent: true }) };
  }

  // Normalize + required fields
  const lead = normalizeLead(rawData);
  if (!lead.name || !lead.email || !lead.phone || !lead.vin) {
    return { statusCode: 400, headers, body: "Missing required fields" };
  }

  // Build email bodies
  const { htmlTable, textLines } = buildEmailBodies(lead, rawData);

  // Prepare attachments if any files were uploaded
  const attachments = uploads.length ? toAttachments(uploads) : undefined;

  // Subject (keep your style)
  const subjectLine = `New Trade-In Lead — ${lead.name} — ${[lead.year, lead.make, lead.model].filter(Boolean).join(" ")}`.trim();

  // Send via SendGrid (to Steve)
  try {
    await sg.send({
      to: "steve@quirkcars.com",
      from: process.env.FROM_EMAIL, // must be verified in SendGrid
      subject: subjectLine,
      text: textLines,
      html: htmlTable,
      attachments, // <— photos ride along if present
      // replyTo: "sales@quirkcars.com", // optional
    });
  } catch (e) {
    return { statusCode: 502, headers, body: "Failed to send lead" };
  }

  // Optional Google Sheets backup (unchanged in spirit)
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
  } catch {
    // ignore backup errors
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
}
