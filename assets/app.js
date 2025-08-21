/* assets/app.js
   Quirk Sight-Unseen Trade Tool — VIN decode + Netlify Forms submit
   - Robust VIN decode (NHTSA VPIC) prefills Year/Make/Model/Trim
   - Case-insensitive Make/Model selection; adds option if missing so selection “sticks”
   - Year list & common Make bootstrap if HTML left blank
   - Model loader for Make+Year
   - Spanish toggle (reads/writes localStorage 'quirk_lang')
   - Logo SVG injection + recolor
   - Netlify Forms submit (multipart) + redirect to confirmation.html
*/

/* -------------------- Small utilities -------------------- */
const $ = (sel) => document.querySelector(sel);

function debounce(fn, wait = 500) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 15000, ...rest } = options;
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
  const s = String(v).trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s);
}

/** Adds/sets select value case-insensitively; creates option if missing */
function setSelectValueCaseInsensitive(selectEl, value) {
  if (!selectEl || value == null) return false;
  const target = String(value).trim();
  if (!target) return false;

  const lower = target.toLowerCase();
  const opts = Array.from(selectEl.options || []);
  let opt = opts.find(
    (o) =>
      String(o.value).toLowerCase() === lower ||
      String(o.textContent).toLowerCase() === lower
  );
  if (!opt) {
    opt = document.createElement("option");
    opt.value = target;
    opt.textContent = target;
    selectEl.appendChild(opt);
  }
  selectEl.value = opt.value;
  return true;
}

/** Ensures numeric year exists in the list; inserts in descending order if needed */
function setYearSelectValue(selectEl, year) {
  if (!selectEl || !year) return false;
  const y = String(year).trim();
  if (!y) return false;

  let opt = Array.from(selectEl.options || []).find((o) => String(o.value) === y);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
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

/* -------------------- DOM refs -------------------- */
const yearSel  = document.getElementById("year")  || $('[name="year"]');
const makeSel  = document.getElementById("make")  || $('[name="make"]');
const modelSel = document.getElementById("model") || $('[name="model"]');
const trimInput = document.getElementById("trim") || $('[name="trim"]');

const vinInput  = document.getElementById("vin")  || $('[name="vin"]');
const decodeBtn = document.getElementById("decodeVinBtn") || $('[data-i18n="decodeVinBtn"]');

const modelStatus = document.getElementById("modelStatus") || document.getElementById("model-status");

const form = document.getElementById("tradeForm");

/* -------------------- Bootstrap years & makes if empty -------------------- */
(function initYearsIfEmpty() {
  if (!yearSel) return;
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
  "Acura","Audi","BMW","Buick","Cadillac","Chevrolet","Chrysler","Dodge","Ford","GMC",
  "Genesis","Honda","Hyundai","Infiniti","Jeep","Kia","Land Rover","Lexus","Lincoln",
  "Mazda","Mercedes-Benz","MINI","Nissan","RAM","Subaru","Tesla","Toyota","Volkswagen",
  "Volvo","Porsche"
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

/* -------------------- Model loader (Make + Year) -------------------- */
let modelsAborter = null;

function resetModels(disable = true) {
  if (!modelSel) return;
  modelSel.innerHTML = '<option value="">Select Model</option>';
  modelSel.disabled = disable;
  if (modelStatus) modelStatus.textContent = "";
}

async function loadModels() {
  if (!makeSel || !yearSel || !modelSel) return;

  const make = (makeSel.value || "").trim();
  const year = (yearSel.value || "").trim();

  resetModels(true);
  if (!make || !year) return;

  if (modelStatus) modelStatus.textContent = "Loading models…";

  if (modelsAborter) modelsAborter.abort();
  modelsAborter = new AbortController();

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformakeyear/make/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?format=json`;

    const res = await fetchWithTimeout(url, { timeout: 15000, signal: modelsAborter.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const models = ((data && data.Results) || [])
      .map((r) => r.Model_Name || r.Model || "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    if (models.length === 0) {
      if (modelStatus) modelStatus.textContent = "No models returned. You can type Trim instead.";
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
    if (modelStatus) modelStatus.textContent = "Could not load models (network issue). Try again or type Trim.";
  } finally {
    modelsAborter = null;
  }
}

makeSel?.addEventListener("change", loadModels);
yearSel?.addEventListener("change", loadModels);

/* -------------------- VIN decode (VPIC) -------------------- */
let vinAborter = null;
let lastDecodedVin = "";

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
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${encodeURIComponent(vin)}?format=json`;
    const res = await fetchWithTimeout(url, { timeout: 15000, signal: vinAborter.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const row = (data && data.Results && data.Results[0]) || {};
    const decYear  = row.ModelYear || row.Model_Year || "";
    const decMake  = row.Make || "";
    const decModel = row.Model || "";
    const decTrim  = row.Trim || row.Series || "";

    // 1) Year
    if (decYear) setYearSelectValue(yearSel, decYear);

    // 2) Make (case-insensitive + fallback add)
    if (decMake) setSelectValueCaseInsensitive(makeSel, decMake);

    // 3) Load models for Make+Year before setting Model
    await loadModels();

    // 4) Model
    if (decModel) setSelectValueCaseInsensitive(modelSel, decModel);

    // 5) Trim
    if (trimInput && decTrim) trimInput.value = decTrim;

    lastDecodedVin = vin;
  } catch (err) {
    console.error("VIN decode failed:", err);
  } finally {
    vinAborter = null;
  }
}

/* Hook up decode actions */
decodeBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  const v = vinInput?.value || "";
  decodeVin(v);
});

vinInput?.addEventListener(
  "input",
  debounce(() => {
    const v = vinInput.value || "";
    if (validVin(v)) decodeVin(v);
  }, 600)
);

/* -------------------- Netlify Forms submit + redirect -------------------- */
(function wireSubmit(){
  if (!form) return;
  // Ensure the submit button doesn’t get blocked silently by invalid fields
  form.addEventListener("submit", async (e) => {
    if (!form.checkValidity()) return; // let browser show native messages
    e.preventDefault();

    try {
      const fd = new FormData(form);
      if (!fd.get("form-name")) fd.set("form-name", "trade-appraisal");
      await fetch("/", { method: "POST", body: fd }); // Netlify Forms captures ALL fields + photos
      window.location.href = "confirmation.html";
    } catch (err) {
      console.error("Submit failed:", err);
      alert("Sorry—there was a problem sending your info. Please try again.");
    }
  });
})();

/* -------------------- Logo injection & recolor -------------------- */
(async function injectAndRecolorQuirkLogo(){
  const slot = document.getElementById('quirkBrand');
  if (!slot) return;

  const BRAND_GREEN = '#0b7d2e'; // official green; adjust if needed

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

/* -------------------- Minimal i18n toggle (persisted) -------------------- */
(function i18nInit(){
  const LANG_KEY = "quirk_lang";
  const dict = {
    en: {
      title: "Sight Unseen Trade-In Appraisal",
      welcome: "Welcome to the Quirk Auto Dealers Sight Unseen Appraisal Program",
      instructions: "Please fill out this form with accurate and complete details about your vehicle. The trade-in value we provide will be honored as long as the vehicle condition matches your answers. We'll verify everything when you bring the vehicle in. If the condition differs, the offer will be adjusted accordingly.",
      aboutYou: "Tell us about Yourself",
      vehDetails: "Vehicle Details",
      photos: "Photo Uploads (Optional)",
      finalDisclaimerTitle: "Final Disclaimer",
      submit: "Get My Trade Appraisal",
      decodeVinBtn: "Decode VIN & Prefill",
      clearBtn: "Clear Form",
      es_toggle: "versión en español",
      en_toggle: "English version",
      selectModel: "Select Model"
    },
    es: {
      title: "Formulario de Tasación de Intercambio sin Inspección",
      welcome: "Bienvenido al Programa de Tasación sin Inspección de Quirk Auto Dealers",
      instructions: "Complete este formulario con información precisa y completa sobre su vehículo. El valor de intercambio que proporcionamos se respetará siempre que la condición del vehículo coincida con sus respuestas. Verificaremos todo cuando traiga el vehículo. Si la condición difiere, la oferta se ajustará en consecuencia.",
      aboutYou: "Cuéntenos sobre usted",
      vehDetails: "Detalles del Vehículo",
      photos: "Cargas de Fotos (Opcional)",
      finalDisclaimerTitle: "Descargo de Responsabilidad Final",
      submit: "Obtener mi tasación",
      decodeVinBtn: "Decodificar VIN y autocompletar",
      clearBtn: "Limpiar formulario",
      es_toggle: "versión en español",
      en_toggle: "Versión en inglés",
      selectModel: "Seleccione modelo"
    }
  };

  function applyLang(lang){
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const src = (dict[lang] && dict[lang][key]);
      if (src) {
        if (el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea") {
          el.setAttribute("placeholder", src);
        } else {
          el.textContent = src;
        }
      }
    });
    const toggle = document.getElementById("langToggle");
    if (toggle) {
      toggle.textContent = (lang === "en") ? dict.en.es_toggle : dict.es.en_toggle;
      toggle.setAttribute("aria-pressed", String(lang === "es"));
    }
    try { localStorage.setItem("quirk_lang", lang); } catch (_){}
  }

  const toggle = document.getElementById("langToggle");
  if (toggle) {
    if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      const curr = (localStorage.getItem("quirk_lang") || "en");
      applyLang(curr === "en" ? "es" : "en");
    });
  }

  applyLang(localStorage.getItem("quirk_lang") || "en");
})();
