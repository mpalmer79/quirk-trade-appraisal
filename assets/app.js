/* assets/app.js
   Quirk Sight-Unseen Trade Tool — core UI logic (drop-in)
   Fixes VIN decode + ensures Make “sticks” (case-insensitive), then loads Models for Make+Year.
   Robust to VPIC casing, missing options, and programmatic changes triggering duplicate loads.
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
  // When user changes Make, reload models.
  loadModels();
});
yearSel?.addEventListener("change", () => {
  // When user changes Year, reload models.
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
    let makeWasSet = false;
    if (decMake) makeWasSet = setSelectValueCaseInsensitive(makeSel, decMake);

    // 3) Load models for Make+Year before setting Model
    //    We call it regardless if Make/Year changed, to ensure fresh list.
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
    // Soft failure: leave fields as-is; optionally you could surface a message if you have a status area.
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

/* ------------ Optional: Expose for debugging (remove in production) ------------ */
window.__quirk = Object.assign(window.__quirk || {}, {
  decodeVin,
  loadModels,
});
