import sg from "@sendgrid/mail";
sg.setApiKey(process.env.SENDGRID_API_KEY || "");

export async function handler(event) {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "ok" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  let data; try { data = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, headers, body: "Invalid JSON" }; }
  if ((data.company||'').trim()) return { statusCode: 200, headers, body: JSON.stringify({ok:true,silent:true}) };

  const safe = (v)=> typeof v === 'string' ? v.trim() : '';
  const lead = {
    name: safe(data.name), email: safe(data.email),
    phone: (safe(data.phoneRaw||data.phone).replace(/\D/g,'').slice(0,15)),
    vin: safe(data.vin).toUpperCase(), year: safe(data.year), make: safe(data.make), model: safe(data.model),
    trim: safe(data.trim), mileage: safe(data.mileage), extColor: safe(data.extColor), intColor: safe(data.intColor),
    submittedAt: new Date().toISOString(), referrer: safe(data.referrer), landingPage: safe(data.landingPage)
  };
  if (!lead.name || !lead.email || !lead.phone || !lead.vin) return { statusCode: 400, headers, body: "Missing required fields" };

  const adfXml = `<?xml version="1.0"?>
<adf>
  <prospect status="new">
    <requestdate>${lead.submittedAt}</requestdate>
    <vehicle interest="trade-in">
      ${lead.year?`<year>${lead.year}</year>`:''}
      ${lead.make?`<make>${lead.make}</make>`:''}
      ${lead.model?`<model>${lead.model}</model>`:''}
      ${lead.trim?`<trim>${lead.trim}</trim>`:''}
      <vin>${lead.vin}</vin>
    </vehicle>
    <customer>
      <contact>
        <name part="full">${lead.name}</name>
        <phone>+1${lead.phone}</phone>
        <email>${lead.email}</email>
      </contact>
    </customer>
    <vendor><contact><name part="full">Quirk Auto</name></contact></vendor>
    <provider><name part="full">Quirk Trade Appraisal</name><url>https://www.quirkcars.com/</url><email>no-reply@quirkcars.com</email></provider>
    <comments>${lead.referrer?`Referrer: ${lead.referrer} `:''}${lead.landingPage?`Landing Page: ${lead.landingPage}`:''}</comments>
  </prospect>
</adf>`;

  try { await sg.send({ to: process.env.VINSOLUTIONS_TO, from: process.env.FROM_EMAIL, subject: `Lead: Sight Unseen Trade — ${lead.name} — ${lead.year} ${lead.make} ${lead.model}`.trim(), text: adfXml, html: `<pre style="white-space:pre-wrap">${adfXml.replace(/[&<>]/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[s]))}</pre>` }); }
  catch (e) { return { statusCode: 502, headers, body: "Failed to send lead" }; }

  // Optional Google Sheets backup
  try {
    if (process.env.SHEETS_WEBHOOK_URL) {
      const u = process.env.SHEETS_SHARED_SECRET ? `${process.env.SHEETS_WEBHOOK_URL}?secret=${encodeURIComponent(process.env.SHEETS_SHARED_SECRET)}` : process.env.SHEETS_WEBHOOK_URL;
      await fetch(u, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(lead) });
    }
  } catch(e) {}

  return { statusCode: 200, headers, body: JSON.stringify({ ok:true }) };
}