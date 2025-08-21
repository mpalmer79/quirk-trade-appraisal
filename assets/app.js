/* assets/app.js
   Quirk Sight-Unseen Trade Tool — core UI logic (drop-in)
   - Populates Year & Make
   - Loads Models based on Make+Year
   - VIN decode (NHTSA VPIC) prefills Year/Make/Model/Trim
   - FIX: Case-insensitive Make selection so it “sticks” after VIN decode
   - LOGO: Inject SVG above title, force letters + underline to brand green
   - I18N: Single, full-form EN <-> ES toggle
*/

/* ------------ Small utilities ------------ */

const $ = (sel) => document.querySelector(sel);

function debounce(fn, wait = 500) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 12000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(resource, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function validVin(v) {
  if (!v) return false;
  const s = v.trim().toUpperCase();
  // 17 chars, excluding I, O, Q
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s);
}

/** Case-insensitive select setter with graceful fallback (adds option if missing). */
function setSelectValueCaseInsensitive(selectEl, value) {
  if (!selectEl || value == null) return false;
  const target = String(value).trim();
  if (!target) return false;

  const lower = target.toLowerCase();
  const opts = Array.from(selectEl.options);
  let opt = opts.find(
    (o) =>
      String(o.value).toLowerCase() === lower ||
      String(o.textContent).toLowerCase() === lower
  );

  if (!opt) {
    // Add the new option so the selection will stick even for unusual makes/models.
    opt = document.createElement("option");
    opt.value = target;
    opt.textContent = target;
    selectEl.appendChild(opt);
  }

  selectEl.value = opt.value;
  return true;
}

/** Strict select setter for numeric years; adds option if missing. */
function setYearSelectValue(selectEl, year) {
  if (!selectEl || !year) return false;
  const y = String(year).trim();
  if (!y) return false;

  const opts = Array.from(selectEl.options);
  let opt = opts.find((o) => String(o.value) === y);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    // Insert in descending order if list looks like years; otherwise append.
    const asNum = Number(y);
    let inserted = false;
    for (let i = 0; i < selectEl.options.length; i++) {
      const n = Number(selectEl.options[i].value);
      if (!Number.isNaN(n) && asNum > n) {
        selectEl.insertBefore(opt, selectEl.options[i]);
        inserted = true;
        break;
      }
    }
    if (!inserted) selectEl.appendChild(opt);
  }
  selectEl.value = y;
  return true;
}

/* ------------ DOM refs (with fallbacks for common IDs/Names) ------------ */

const yearSel =
  document.getElementById("year") ||
  $('[name="year"]') ||
  document.getElementById("Year");

const makeSel =
  document.getElementById("make") ||
  $('[name="make"]') ||
  document.getElementById("Make");

const modelSel =
  document.getElementById("model") ||
  $('[name="model"]') ||
  document.getElementById("Model");

const trimInput =
  document.getElementById("trim") ||
  $('[name="trim"]') ||
  document.getElementById("Trim");

const vinInput =
  document.getElementById("vin") ||
  $('[name="vin"]') ||
  document.getElementById("VIN") ||
  document.getElementById("Vin");

const decodeBtn =
  document.getElementById("decodeVinBtn") ||
  document.getElementById("decode-vin") ||
  $('[data-action="decode-vin"]');

const modelStatus =
  document.getElementById("modelStatus") ||
  document.getElementById("model-status");

/* ------------ Bootstrap: Years & Makes (only if empty) ------------ */

// Populate a sensible Year range if the select is present but empty.
(function initYearsIfEmpty() {
  if (!yearSel) return;
  // If it already has >1 option, assume server/HTML provided them.
  if (yearSel.options && yearSel.options.length > 1) return;

  const now = new Date().getFullYear();
  for (let y = now; y >= 1990; y--) {
    const o = document.createElement("option");
    o.value = String(y);
    o.textContent = String(y);
    yearSel.appendChild(o);
  }
})();

const COMMON_MAKES = [
  "Acura","Audi","BMW","Buick","Cadillac","Chevrolet","Chrysler","Dodge","Ford","GMC","Genesis","Honda","Hyundai","Infiniti","Jeep","Kia","Land Rover","Lexus","Lincoln","Mazda","Mercedes-Benz","MINI","Nissan","RAM","Subaru","Tesla","Toyota","Volkswagen","Volvo","Porsche"
];

(function initMakesIfEmpty() {
  if (!makeSel) return;
  if (makeSel.options && makeSel.options.length > 1) return;
  COMMON_MAKES.forEach((m) => {
    const o = document.createElement("option");
    o.value = m;
    o.textContent = m;
    makeSel.appendChild(o);
  });
})();

/* ------------ Models loader (Make+Year) ------------ */

let modelsAborter = null;

function resetModels(disable = true) {
  if (!modelSel) return;
  modelSel.innerHTML = '<option value="">Select Model</option>';
  modelSel.disabled = disable;
  if (modelStatus) modelStatus.textContent = "";
}

/** Loads models for current Make+Year. Resolves after the <select> is populated (or reset). */
async function loadModels() {
  if (!makeSel || !yearSel || !modelSel) return;

  const make = makeSel.value?.trim();
  const year = yearSel.value?.trim();

  resetModels(true);
  if (!make || !year) return;

  if (modelStatus) modelStatus.textContent = "Loading models…";

  if (modelsAborter) modelsAborter.abort();
  modelsAborter = new AbortController();

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformakeyear/make/${encodeURIComponent(
      make
    )}/modelyear/${encodeURIComponent(year)}?format=json`;

    const res = await fetchWithTimeout(url, {
      timeout: 12000,
      signal: modelsAborter.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const results = (data && data.Results) || [];
    const models = results
      .map((r) => r.Model_Name || r.Model || "")
      .filter(Boolean)
      .sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
      );

    if (models.length === 0) {
      if (modelStatus)
        modelStatus.textContent =
          "No models returned. You can type Trim instead.";
      resetModels(true);
      return;
    }

    models.forEach((m) => {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      modelSel.appendChild(o);
    });

    modelSel.disabled = false;
    if (modelStatus) modelStatus.textContent = `Loaded ${models.length} models.`;
  } catch (err) {
    if (err.name === "AbortError") return;
    resetModels(true);
    if (modelStatus)
      modelStatus.textContent =
        "Could not load models (network issue). Try again or type Trim.";
  } finally {
    modelsAborter = null;
  }
}

makeSel?.addEventListener("change", () => {
  loadModels();
});
yearSel?.addEventListener("change", () => {
  loadModels();
});

/* ------------ VIN decode & prefill ------------ */

let vinAborter = null;
let lastDecodedVin = "";

/** Decode VIN via VPIC and prefill Year/Make/Model/Trim (where available). */
async function decodeVin(vinRaw) {
  if (!vinRaw || !vinInput) return;
  const vin = String(vinRaw).trim().toUpperCase();

  if (!validVin(vin)) {
    lastDecodedVin = "";
    return;
  }
  if (vin === lastDecodedVin) return;

  if (vinAborter) vinAborter.abort();
  vinAborter = new AbortController();

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${encodeURIComponent(
      vin
    )}?format=json`;

    const res = await fetchWithTimeout(url, {
      timeout: 15000,
      signal: vinAborter.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const row = (data && data.Results && data.Results[0]) || {};

    // Pull fields we care about (strings from VPIC, may be empty)
    const decYear = row.ModelYear || row.Model_Year || "";
    const decMake = row.Make || "";
    const decModel = row.Model || "";
    const decTrim = row.Trim || row.Series || ""; // Trim often empty; Series is a reasonable backup

    // 1) Year
    if (decYear) setYearSelectValue(yearSel, decYear);

    // 2) Make (case-insensitive + fallback add)
    if (decMake) setSelectValueCaseInsensitive(makeSel, decMake);

    // 3) Load models for Make+Year before setting Model
    await loadModels();

    // 4) Model
    if (decModel) setSelectValueCaseInsensitive(modelSel, decModel);

    // 5) Trim
    if (trimInput && decTrim) {
      trimInput.value = decTrim;
    }

    lastDecodedVin = vin;
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("VIN decode failed:", err);
  } finally {
    vinAborter = null;
  }
}

/* ------------ Wire up VIN interactions ------------ */

// Decode on button click (if present)
decodeBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  const v = vinInput?.value || "";
  decodeVin(v);
});

// Also decode on VIN input with a short debounce (optional but nice UX)
if (vinInput) {
  vinInput.addEventListener(
    "input",
    debounce(() => {
      const v = vinInput.value || "";
      if (validVin(v)) decodeVin(v);
    }, 600)
  );
}

/* ------------ Optional: Expose for debugging (can remove) ------------ */
window.__quirk = Object.assign(window.__quirk || {}, {
  decodeVin,
  loadModels,
});

/* ------------ Logo injection & recolor (centered above title) ------------ */
/* Places the SVG into #quirkBrand and forces both the letters and underline
   to the Quirk brand green. */
(async function injectAndRecolorQuirkLogo(){
  const slot = document.getElementById('quirkBrand');
  if (!slot) return;

  const BRAND_GREEN = '#00bf6f'; // official underline green from your SVG

  try {
    const res = await fetch('assets/quirk-logo.svg', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Logo HTTP ${res.status}`);
    const svgText = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;

    // Force all fills to brand green (letters + underline)
    svg.querySelectorAll('[fill]').forEach(node => {
      node.setAttribute('fill', BRAND_GREEN);
    });

    // Ensure visible size if SVG lacks intrinsic sizing
    if (!svg.getAttribute('viewBox')) {
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      if (!svg.getAttribute('width'))  svg.setAttribute('width', 260);
      if (!svg.getAttribute('height')) svg.setAttribute('height', 64);
    }

    slot.innerHTML = '';
    slot.appendChild(svg);
  } catch (err) {
    console.error('Logo load/recolor failed:', err);
    const img = document.createElement('img');
    img.src = 'assets/quirk-logo.svg';
    img.alt = 'Quirk Auto';
    img.style.height = '64px';
    img.style.width  = 'auto';
    slot.innerHTML = '';
    slot.appendChild(img);
  }
})();

/* ------------ i18n: Single FULL-FORM English <-> Spanish toggle ------------ */
/* DELETE any older i18n blocks; keep ONLY this one. */
(function i18nInit(){
  const LANG_KEY   = "quirk_lang";
  const TOGGLE_ID  = "langToggle";
  const ROOT       = document.getElementById("tradeForm") || document.body;

  // Normalize keys: trim, collapse whitespace, drop trailing/leading ":" and "*"
  const norm = (s) => String(s || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*[:*]\s*/g, "")
    .replace(/\s*[:*]\s*$/g, "")
    .trim();

  // English -> Spanish dictionary (keys are normalized EN strings)
  const D = new Map([
    // Top
    ["Sight Unseen Trade-In Appraisal Form", "Formulario de Tasación de Intercambio sin Inspección"],
    ["Welcome to the Quirk Auto Dealers Sight Unseen Appraisal Program", "Bienvenido al Programa de Tasación sin Inspección de Quirk Auto Dealers"],
    ["Please fill out this form with accurate and complete details about your vehicle. The trade-in value we provide will be honored as long as the vehicle condition matches your answers. We'll verify everything when you bring the vehicle in. If the condition differs, the offer will be adjusted accordingly.",
     "Complete este formulario con información precisa y completa sobre su vehículo. El valor de intercambio que proporcionamos se respetará siempre que la condición del vehículo coincida con sus respuestas. Verificaremos todo cuando traiga el vehículo. Si la condición difiere, la oferta se ajustará en consecuencia."],
    ["Tell us about Yourself", "Cuéntenos sobre usted"],
    ["Vehicle Details", "Detalles del Vehículo"],
    ["Photos", "Fotos"],
    ["Upload Photos", "Subir fotos"],

    // Buttons
    ["Decode VIN & Prefill", "Decodificar VIN y autocompletar"],
    ["Decode VIN & Prefill", "Decodificar VIN y autocompletar"], // duplicate keeps casing
    ["Clear Form", "Limpiar formulario"],
    ["Submit", "Enviar"],
    ["English version", "Versión en inglés"],
    ["versión en español", "versión en español"],

    // Person info
    ["Full Name", "Nombre completo"],
    ["Email Address", "Correo electrónico"],
    ["Phone Number", "Número de teléfono"],
    ["Street Address", "Dirección"],
    ["City", "Ciudad"],
    ["State", "Estado"],
    ["ZIP Code", "Código postal"],
    ["Preferred Contact Method", "Método de contacto preferido"],
    ["Comments", "Comentarios"],

    // Vehicle info
    ["VIN (required)", "VIN (obligatorio)"],
    ["VIN", "VIN"],
    ["Current Mileage", "Kilometraje actual"],
    ["Year", "Año"],
    ["Make", "Marca"],
    ["Model", "Modelo"],
    ["Trim", "Versión (Trim)"],
    ["Transmission", "Transmisión"],
    ["Drivetrain", "Tren de tracción"],
    ["Exterior Color", "Color exterior"],
    ["Interior Color", "Color interior"],
    ["Condition", "Condición"],
    ["Accident History", "Historial de accidentes"],
    ["Has the vehicle been in any accidents?", "¿El vehículo ha tenido accidentes?"],
    ["Does the vehicle have a clean title?", "¿El vehículo tiene título limpio?"],

    // Helper text / smallprint
    ["Attach clear photos of the exterior, interior, and odometer.", "Adjunte fotos claras del exterior, interior y odómetro."],
    ["By submitting, you agree that the information provided is accurate.", "Al enviar, usted acepta que la información proporcionada es precisa."],

    // Placeholders
    ["(###) ###-####", "(###) ###-####"],
    ["e.g. 45,000", "p. ej., 45,000"],
    ["Start typing your address", "Empiece a escribir su dirección"],

    // Select options
    ["Select Model", "Seleccione modelo"],
    ["Automatic", "Automática"],
    ["Manual", "Manual"],
    ["CVT", "CVT"],
    ["Dual-Clutch", "Doble embrague"],
    ["FWD", "Tracción delantera"],
    ["RWD", "Tracción trasera"],
    ["AWD", "Tracción total (AWD)"],
    ["4WD", "4x4 (4WD)"],
    ["Unknown", "Desconocido"],
    ["Yes", "Sí"],
    ["No", "No"],
  ]);

  // Build reverse for ES -> EN
  const D_REV = new Map(Array.from(D.entries()).map(([en, es]) => [norm(es), en]));

  function translateString(s, targetLang){
    const key = norm(s);
    if (!key) return s;
    if (targetLang === "es") return D.get(key) || s;
    return D_REV.get(key) || s;
  }

  // Translate inner text (preserving trailing "*")
  function translateTextNode(el, targetLang){
    const raw = el.textContent;
    if (!raw) return;
    const hadStar = /\*/.test(raw);
    const next = translateString(raw, targetLang);
    if (next && next !== raw) {
      el.textContent = hadStar && !/\*/.test(next) ? `${next} *` : next;
    }
  }

  function translateAll(targetLang){
    const scope = ROOT;

    // 1) Explicit keys (data-i18n)
    scope.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const val = translateString(key, targetLang);
      if (val && val !== key) {
        const hadStar = /\*/.test(el.textContent || "");
        el.textContent = hadStar && !/\*/.test(val) ? `${val} *` : val;
      } else {
        translateTextNode(el, targetLang);
      }
    });

    // 2) Common text elements without data-i18n
    scope.querySelectorAll("label,legend,h1,h2,h3,h4,button,a.btn,span,p,small,strong,em,th,td")
      .forEach(el => {
        if (el.hasAttribute("data-i18n")) return;
        translateTextNode(el, targetLang);
      });

    // 3) Placeholders
    scope.querySelectorAll("input[placeholder], textarea[placeholder]").forEach(el => {
      const ph = el.getAttribute("placeholder") || "";
      const next = translateString(ph, targetLang);
      if (next && next !== ph) el.setAttribute("placeholder", next);
    });

    // 4) Options in selects
    scope.querySelectorAll("select option").forEach(opt => {
      const txt = opt.textContent || "";
      const next = translateString(txt, targetLang);
      if (next && next !== txt) opt.textContent = next;
    });

    // 5) Toggle label text
    const toggle = document.getElementById(TOGGLE_ID);
    if (toggle) {
      toggle.textContent = (targetLang === "es") ? "Versión en inglés" : "versión en español";
      if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
      toggle.setAttribute("aria-pressed", String(targetLang === "es"));
    }

    // Persist
    try { localStorage.setItem(LANG_KEY, targetLang); } catch(_) {}
  }

  function setLang(lang){
    translateAll(lang === "es" ? "es" : "en");
  }

  // Wire the single toggle (ensure not submit)
  const toggle = document.getElementById(TOGGLE_ID);
  if (toggle) {
    if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
    // Remove any previous handlers by replacing the node (in case old code was left in cache)
    const clone = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(clone, toggle);
    clone.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const curr = (localStorage.getItem(LANG_KEY) || "en");
      const next = curr === "en" ? "es" : "en";
      setLang(next);
    });
  }

  // Initial render
  setLang(localStorage.getItem(LANG_KEY) || "en");
})();
(function wireSubmit(){
  const form = document.getElementById('tradeForm');
  if (!form) return;

  const notice = document.createElement('div');
  notice.id = 'submitNotice';
  notice.style.margin = '10px 0';
  form.parentNode.insertBefore(notice, form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    notice.textContent = 'Sending…';
    notice.style.color = '#1f2937';

    try {
      const fd = new FormData(form);
      const res = await fetch('/.netlify/functions/trade-appraisal', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      notice.textContent = 'Thanks! Your info was sent. We’ll be in touch shortly.';
      notice.style.color = '#065f46';
      form.reset();
      // (optional) reset selects after VIN auto-fill etc.
    } catch (err) {
      console.error(err);
      notice.textContent = 'Sorry—there was a problem sending your info. Please try again.';
      notice.style.color = '#b91c1c';
    }
  });
})();
