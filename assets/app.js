function debounce(fn, wait=500){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }
async function fetchWithTimeout(resource, options={}){ const { timeout = 8000, ...rest } = options; const controller = new AbortController(); const id = setTimeout(()=>controller.abort(), timeout); try{ return await fetch(resource, { ...rest, signal: controller.signal }); } finally { clearTimeout(id); } }

(function initYears(){ const y=document.getElementById('year'); if(!y) return; const thisYear=new Date().getFullYear(); const start=thisYear+1; for(let i=start;i>=1995;i--){ const o=document.createElement('option'); o.value=i; o.textContent=i; y.appendChild(o);} })();

const COMMON_MAKES=['Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Ford','GMC','Genesis','Honda','Hyundai','INFINITI','Jeep','Kia','Lexus','Lincoln','Mazda','Mercedes-Benz','MINI','Mitsubishi','Nissan','Ram','Subaru','Tesla','Toyota','Volkswagen','Volvo','Porsche'];
(function initMakes(){ const m=document.getElementById('make'); COMMON_MAKES.forEach(x=>{ const o=document.createElement('option'); o.value=x; o.textContent=x; m.appendChild(o); }); })();

const makeSel=document.getElementById('make'); const yearSel=document.getElementById('year'); const modelSel=document.getElementById('model'); const modelStatus=document.getElementById('modelStatus');
function resetModels(disable=true){ modelSel.innerHTML='<option value="">Select Model</option>'; modelSel.disabled=disable; modelStatus.textContent=''; }

let modelsAborter=null;
async function loadModels(){ const make=makeSel.value; const year=yearSel.value; resetModels(true); if(!make||!year) return; modelStatus.textContent='Loading models…'; try{ if(modelsAborter){modelsAborter.abort();} modelsAborter=new AbortController(); const url=`https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformakeyear/makeyear/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?format=json`; const res=await fetchWithTimeout(url,{timeout:9000,signal:modelsAborter.signal}); const data=await res.json(); const list=(data.Results||[]).map(r=>r.Model_Name).filter(Boolean).sort((a,b)=>a.localeCompare(b)); if(list.length){ modelSel.disabled=false; list.forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent=m; modelSel.appendChild(o); }); modelStatus.textContent=`${list.length} models found.`; } else { modelStatus.textContent='No models found for that year/make.'; } } catch(e){ modelStatus.textContent='Could not load models (offline or blocked). Try again or type model in Trim field.'; } }
makeSel.addEventListener('change', loadModels); yearSel.addEventListener('change', loadModels);

const vinInput=document.getElementById('vin'); let lastDecodedVin=''; let vinAborter=null;
function canDecode(v){ return v.length>=11; }
async function decodeVin(vin){ if(!canDecode(vin)) return; if(vin===lastDecodedVin) return; if(vinAborter){vinAborter.abort();} vinAborter=new AbortController(); try{ const url=`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${encodeURIComponent(vin)}?format=json`; const r=await fetchWithTimeout(url,{timeout:9000,signal:vinAborter.signal}); const j=await r.json(); const row=(j.Results&&j.Results[0])||{}; if(row.ModelYear){ yearSel.value=row.ModelYear; } if(row.Make){ if(![...makeSel.options].some(o=>o.value.toLowerCase()===String(row.Make).toLowerCase())){ const opt=document.createElement('option'); opt.value=row.Make; opt.textContent=row.Make; makeSel.appendChild(opt);} makeSel.value=row.Make; } await loadModels(); if(row.Model){ modelSel.value=row.Model; } lastDecodedVin=vin; } catch(e){} }
const debouncedAutoDecode=debounce(()=>decodeVin(vinInput.value.trim()),600);
vinInput.addEventListener('input',(e)=>{ const v=e.target.value.toUpperCase().replace(/[IOQ\s]/g,''); e.target.value=v; if(canDecode(v)) debouncedAutoDecode(); });

const phone=document.getElementById('phone'); const phoneRaw=document.getElementById('phoneRaw');
phone.addEventListener('input',()=>{ const d=phone.value.replace(/\D/g,'').slice(0,10); let out=d; if(d.length>6){ out=`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`; } else if(d.length>3){ out=`(${d.slice(0,3)}) ${d.slice(3)}`; } phone.value=out; phoneRaw.value=d; });

const form=document.getElementById('tradeForm'); const submitBtn=document.getElementById('submitBtn'); const agree=document.getElementById('agree'); function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); } function updateSubmitState(){ submitBtn.disabled=!agree.checked; }
form.noValidate=true; updateSubmitState(); agree.addEventListener('change',updateSubmitState);

form.addEventListener('submit', async (e)=>{ e.preventDefault();
  if(!agree.checked){ showToast('Please confirm the final disclaimer.'); return; }
  const vinVal=vinInput.value.trim(); if(!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vinVal)){ showToast('Please enter a valid 17‑character VIN.'); vinInput.focus(); return; }
  const digits=(phoneRaw.value||'').replace(/\D/g,''); if(digits.length!==10){ showToast('Please enter a valid 10‑digit US phone.'); phone.focus(); return; }
  const companyEl=document.getElementById('company'); if(companyEl && (companyEl.value||'').trim()){ showToast('Submitted.'); return; }
  submitBtn.disabled=true; submitBtn.textContent='Submitting…'; form.setAttribute('aria-busy','true');
  const fd=new FormData(form); const payload={}; fd.forEach((v,k)=>payload[k]=v); payload.phoneRaw=(payload.phoneRaw||(payload.phone||'').replace(/\D/g,'')).slice(0,10);
  try{ const res=await fetchWithTimeout('/.netlify/functions/trade-appraisal',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload),timeout:15000}); if(!res.ok) throw new Error('Network'); showToast('Submitted! A specialist will contact you shortly.'); setTimeout(()=>{ window.location.href='/success/'; },400); }
  catch(err){ showToast('Could not submit right now. Please try again.'); }
  finally{ submitBtn.disabled=false; submitBtn.textContent='Get My Trade Appraisal'; form.removeAttribute('aria-busy'); }
});


// === Quirk Enhancements v2.8 ===
// Global i18n for English <-> Español and VIN (Year/Make/Model)
(function(){
  const btn = document.getElementById('langToggle');
  if(!btn) return;
  const htmlEl = document.documentElement;

  const en = {
    title: "Sight Unseen Trade-In Appraisal Form",
    welcome: "Welcome to the Quirk Auto Dealers Sight Unseen Appraisal Program",
    instructions: "Please fill out this form with accurate and complete details. Attach clear photos of the vehicle, including exterior, interior, odometer, and any damage. We’ll respond with an offer based on the information provided. If the actual condition differs, the offer will be adjusted accordingly.",
    decodeVinBtn: "Decode VIN & Prefill",
    clearBtn: "Clear Form",
    aboutYou: "Tell us about Yourself",
    nameLabel: "Full Name",
    phoneLabel: "Phone Number",
    phoneHint: "US format only. Numbers only; we'll format it.",
    emailLabel: "Email Address",
    vehDetails: "Vehicle Details",
    vinLabel: "VIN (required)",
    vinHint: "VIN auto-capitalizes; letters I, O, Q are invalid.",
    mileageLabel: "Current Mileage",
    yearLabel: "Year",
    selectYear: "Select Year",
    makeLabel: "Make",
    selectMake: "Select Make",
    modelLabel: "Model",
    selectModel: "Select Model",
    trimLabel: "Trim Level (if known)",
    extColorLabel: "Exterior Color",
    intColorLabel: "Interior Color",
    keysLabel: "Number of Keys Included",
    titleStatus: "Title Status",
    titleClean: "Clean",
    titleLien: "Lien",
    titleRebuilt: "Rebuilt",
    titleSalvage: "Salvage",
    ownersLabel: "Number of Owners (estimate OK)",
    accidentLabel: "Has the vehicle ever been in an accident?",
    accidentRepair: "If yes, was it professionally repaired?",
    vehCondition: "Vehicle Condition",
    warnings: "Any warning lights on dashboard?",
    mech: "Mechanical issues",
    cosmetic: "Cosmetic issues",
    interior: "Interior clean and damage-free?",
    aftermarket: "Aftermarket parts or modifications?",
    smells: "Unusual smells?",
    service: "Routine services up to date?",
    wearables: "Wearable Items Check",
    tires: "Tire Condition",
    brakes: "Brake Condition",
    wearOther: "Other Wear Items (issues?)",
    photos: "Photo Uploads (Optional)",
    photosExterior: "Exterior Photos",
    photosInterior: "Interior Photos",
    photosDash: "Dashboard / Odometer",
    photosDamage: "Damage / Flaws",
    photoHint: "Max 10MB per file; 24 files total.",
    finalDisclaimerTitle: "Final Disclaimer",
    finalDisclaimer: "I confirm the information provided is accurate to the best of my knowledge. I understand that the offer is based on the details submitted and may change after physical inspection if the vehicle's actual condition does not match the details above.",
    agreeLabel: "I agree and confirm",
    submit: "Get My Trade Appraisal"
  };

  const es = {
    title: "Formulario de Tasación sin Inspección",
    welcome: "Bienvenido al Programa de Tasación sin Inspección de Quirk Auto",
    instructions: "Complete este formulario con datos precisos y completos. Adjunte fotos claras del vehículo, incluyendo exterior, interior, odómetro y cualquier daño. Responderemos con una oferta basada en la información proporcionada. Si la condición real difiere, la oferta se ajustará en consecuencia.",
    decodeVinBtn: "Decodificar VIN y Autocompletar",
    clearBtn: "Limpiar formulario",
    aboutYou: "Cuéntenos sobre usted",
    nameLabel: "Nombre completo",
    phoneLabel: "Número de teléfono",
    phoneHint: "Solo formato de EE. UU. Ingrese solo números; nosotros lo formatearemos.",
    emailLabel: "Correo electrónico",
    vehDetails: "Detalles del vehículo",
    vinLabel: "VIN (obligatorio)",
    vinHint: "El VIN se pone en mayúsculas automáticamente; las letras I, O y Q no son válidas.",
    mileageLabel: "Kilometraje actual",
    yearLabel: "Año",
    selectYear: "Seleccione año",
    makeLabel: "Marca",
    selectMake: "Seleccione marca",
    modelLabel: "Modelo",
    selectModel: "Seleccione modelo",
    trimLabel: "Versión/Acabado (si lo sabe)",
    extColorLabel: "Color exterior",
    intColorLabel: "Color interior",
    keysLabel: "Número de llaves incluidas",
    titleStatus: "Estado del título",
    titleClean: "Limpio",
    titleLien: "Gravamen",
    titleRebuilt: "Reconstruido",
    titleSalvage: "Salvamento",
    ownersLabel: "Número de dueños (aprox. está bien)",
    accidentLabel: "¿Ha estado el vehículo en algún accidente?",
    accidentRepair: "Si respondió sí, ¿fue reparado profesionalmente?",
    vehCondition: "Condición del vehículo",
    warnings: "¿Alguna luz de advertencia en el tablero?",
    mech: "Problemas mecánicos",
    cosmetic: "Problemas cosméticos",
    interior: "¿Interior limpio y sin daños?",
    aftermarket: "¿Piezas o modificaciones no originales?",
    smells: "¿Olores inusuales?",
    service: "¿Mantenimientos al día?",
    wearables: "Revisión de elementos desgastables",
    tires: "Condición de los neumáticos",
    brakes: "Condición de los frenos",
    wearOther: "Otros elementos desgastables (¿problemas?)",
    photos: "Cargas de fotos (opcional)",
    photosExterior: "Fotos del exterior",
    photosInterior: "Fotos del interior",
    photosDash: "Tablero / Odómetro",
    photosDamage: "Daños / Defectos",
    photoHint: "Máx. 10 MB por archivo; 24 archivos en total.",
    finalDisclaimerTitle: "Descargo de responsabilidad final",
    finalDisclaimer: "Confirmo que la información proporcionada es precisa según mi leal saber y entender. Entiendo que la oferta se basa en los datos enviados y puede cambiar después de la inspección si la condición real del vehículo no coincide con los detalles anteriores.",
    agreeLabel: "Acepto y confirmo",
    submit: "Obtener mi tasación"
  };

  const all = { en, es };
  const els = Array.from(document.querySelectorAll('[data-i18n]'));

  function apply(lang){
    const dict = all[lang] || en;
    els.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if(dict[key]) el.textContent = dict[key];
    });
    const zip = document.getElementById('zipcode');
    if(zip) zip.setAttribute('placeholder', lang==='es' ? 'p. ej., 03103' : 'e.g., 03103');
    const vin = document.getElementById('vin');
    if(vin) vin.setAttribute('placeholder', lang==='es' ? 'Ingrese VIN de 17 dígitos' : 'Enter 17 digit VIN');
    // button label itself
    if(btn) btn.textContent = lang==='es' ? 'English version' : 'versión en español';
    htmlEl.setAttribute('lang', lang==='es' ? 'es' : 'en');
  }

  let spanish=false;
  btn.addEventListener('click', ()=>{ spanish=!spanish; apply(spanish?'es':'en'); });
  apply('en');
})();

// VIN decode: fill Year, Make, and Model; trim fallback
(function(){
  const vinInput = document.getElementById('vin');
  if(!vinInput) return;
  const yearSel = document.getElementById('year');
  const makeSel = document.getElementById('make');
  const modelSel = document.getElementById('model');
  const trimInput = document.getElementById('trim');
  let inFlight = null;
  const validVin = v => /^[A-HJ-NPR-Z0-9]{17}$/i.test(v||'');

  async function decode(vin){
    if(!validVin(vin)) return;
    if(inFlight) inFlight.abort();
    const ctl = new AbortController(); inFlight = ctl;
    try{
      const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`;
      const res = await fetch(url, { signal: ctl.signal });
      const data = await res.json();
      const row = (data.Results && data.Results[0]) || {};
      const year = row.ModelYear || row.Model_Year || "";
      const make = row.Make || "";
      const model = row.Model || row.Model_Name || "";
      const trim = row.Trim || row.Series || "";

      if(yearSel && year){ yearSel.value=String(year); yearSel.dispatchEvent(new Event('change')); }
      if(makeSel && make){
        const lower = String(make).toLowerCase();
        let opt = Array.from(makeSel.options).find(o=>o.value.toLowerCase()===lower);
        if(!opt){ opt=document.createElement('option'); opt.value=make; opt.textContent=make; makeSel.appendChild(opt); }
        makeSel.value = opt.value; makeSel.dispatchEvent(new Event('change'));
      }
      if(modelSel){
        await new Promise(r=>setTimeout(r,700));
        const lower = String(model).toLowerCase();
        let mopt = Array.from(modelSel.options).find(o=>o.value.toLowerCase()===lower || o.textContent.toLowerCase()===lower);
        if(mopt){ modelSel.value=mopt.value; } else if(model){ const o=document.createElement('option'); o.value=model; o.textContent=model; modelSel.appendChild(o); modelSel.value=o.value; }
      }
      if(trimInput && !trimInput.value && (trim||model)){ trimInput.value = trim || model; }
    }catch(e){ } finally{ if(inFlight===ctl) inFlight=null; }
  }

  const btn = document.getElementById('decodeVinBtn');
  if(btn){ btn.addEventListener('click', ()=> decode(vinInput.value.trim())); }
  vinInput.addEventListener('input', debounce(()=> decode(vinInput.value.trim()), 500));
  if(validVin(vinInput.value)) decode(vinInput.value.trim());
})();
