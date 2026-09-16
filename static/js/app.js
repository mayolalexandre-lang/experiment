const STAGES = [
  "language", "consent", "eligibility", "consumption_survey", "consumption_estimate",
  "tariff_hypo_intro", "tariff_hypo_elec", "tariff_hypo_water",
  "behavior_current", "behavior_adopt", "recap",
  "tariff_real_elec", "tariff_real_water",
  "preferences", "demographics",
  "crt", "crt_check", "lottery", "done",
];

const state = { code: null, participant: null, full: null, t: null, tariffStep: 0, tariffChoices: [] };
const root = document.getElementById("app");

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Server error");
  return data;
}

function renderProgress(stage) {
  const idx = STAGES.indexOf(stage);
  const segs = STAGES.map((s, i) => `<div class="seg ${i <= idx ? "done" : ""}"></div>`).join("");
  return `<div class="progress">${segs}</div>`;
}

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

function fmt(n) {
  return Number(n).toLocaleString(state.participant.lang === "en" ? "en-GB" : "fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt1(n) {
  return Number(n).toLocaleString(state.participant.lang === "en" ? "en-GB" : "fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function tpl(str, vars) {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), str);
}

// ---------------------------------------------------------------- tariff description helpers

function planDescriptionHtml(domain, plan) {
  const tar = state.t.tariffs[domain];
  const ui = state.t.tariffs.ui;
  const unit = tar.unit;
  const p = tar[plan];
  const hasSubscription = plan === "avec_abonnement";
  const subIconHtml = hasSubscription
    ? `<img src="/static/img/icon_abonnement.png" class="tariff-icon" alt="">`
    : `<span class="icon-crossed"><img src="/static/img/icon_abonnement.png" class="tariff-icon" alt=""></span>`;

  let priceHtml;
  if (plan === "progressif") {
    priceHtml = `<p>${ui.progressive_intro.replace("{unit}", unit)}</p>
      <ul class="tranche-list">
        <li>${tpl(ui.tranche1, { seuil: fmt1(p.seuil), unit, prix: fmt(p.prix_tranche1) })}</li>
        <li>${tpl(ui.tranche2, { seuil: fmt1(p.seuil), unit, prix: fmt(p.prix_tranche2) })}</li>
      </ul>`;
  } else {
    const sub = hasSubscription ? tpl(ui.annual_subscription, { amount: fmt(p.part_fixe) }) : ui.no_subscription;
    priceHtml = `<p>${sub}</p><p>${tpl(ui.constant_price, { unit, price: fmt(p.prix) })}</p>`;
  }

  return `
    <div class="tariff-icons">
      ${subIconHtml}
      <img src="/static/img/${tar.icon_variable}" class="tariff-icon" alt="">
    </div>
    ${priceHtml}
  `;
}

async function boot() {
  state.full = await api("/api/config");
  const saved = localStorage.getItem("participant_code");
  root.appendChild(renderLogin(saved || ""));
}

function renderLogin(prefill) {
  const view = el(`
    <div class="card">
      <h1>Expérience d'économie / Economics experiment</h1>
      <p class="lead">Entrez le code participant / Enter your participant code.</p>
      <label for="code">Code participant / Participant code</label>
      <input type="text" id="code" value="${prefill}" placeholder="ex : ETU-042" autocomplete="off">
      <label for="session">Libellé de session <span class="hint">(optionnel)</span></label>
      <input type="text" id="session" placeholder="ex : Master Exed - groupe A">
      <button class="btn" id="go">Commencer / reprendre — Start / resume</button>
      <div class="error" id="err"></div>
    </div>
  `);
  view.querySelector("#go").addEventListener("click", async () => {
    const code = view.querySelector("#code").value.trim();
    const session_label = view.querySelector("#session").value.trim();
    const errBox = view.querySelector("#err");
    errBox.textContent = "";
    if (!code) { errBox.textContent = "Merci de saisir un code participant. / Please enter a participant code."; return; }
    try {
      const data = await api("/api/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, session_label }) });
      localStorage.setItem("participant_code", code);
      state.code = code;
      state.participant = data.participant;
      if (state.participant.lang) state.t = state.full[state.participant.lang];
      renderStage();
    } catch (e) { errBox.textContent = e.message; }
  });
  return view;
}

function renderStage() {
  root.innerHTML = "";
  state.tariffStep = 0;
  state.tariffChoices = [];
  const renderers = {
    language: renderLanguage,
    consent: renderConsent,
    eligibility: renderEligibility,
    consumption_survey: renderConsumptionSurvey,
    consumption_estimate: renderConsumptionEstimate,
    tariff_hypo_intro: renderTariffHypoIntro,
    tariff_hypo_elec: () => renderTariffSequential("electricite", "tariff_hypo_elec", false),
    tariff_hypo_water: () => renderTariffSequential("eau", "tariff_hypo_water", false),
    behavior_current: renderBehaviorCurrent,
    behavior_adopt: renderBehaviorAdopt,
    recap: renderRecap,
    tariff_real_elec: () => renderTariffSequential("electricite", "tariff_real_elec", true),
    tariff_real_water: () => renderTariffSequential("eau", "tariff_real_water", true),
    preferences: renderPreferences,
    demographics: renderDemographics,
    crt: renderCrt,
    crt_check: renderCrtCheck,
    lottery: renderLottery,
    done: renderDone,
  };
  root.appendChild(renderers[state.participant.stage]());
}

// ---------------------------------------------------------------- language

function renderLanguage() {
  const lp = state.full.language_picker;
  const view = el(`
    <div class="card">
      <h1>${lp.fr.title} / ${lp.en.title}</h1>
      <div style="display:flex; gap:14px; margin-top:20px;">
        <button class="btn" id="pick-fr" style="flex:1">${lp.fr.button}</button>
        <button class="btn" id="pick-en" style="flex:1">${lp.en.button}</button>
      </div>
    </div>
  `);
  async function pick(lang) {
    const res = await api("/api/language", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, lang }) });
    state.participant = res.participant;
    state.t = state.full[lang];
    renderStage();
  }
  view.querySelector("#pick-fr").addEventListener("click", () => pick("fr"));
  view.querySelector("#pick-en").addEventListener("click", () => pick("en"));
  return view;
}

// ---------------------------------------------------------------- consent

function renderConsent() {
  const view = el(`
    <div class="card">
      ${renderProgress("consent")}
      <h2>${state.t === state.full.en ? "Economics experiment" : "Expérience d'économie"}</h2>
      <p>${state.t.welcome.text}</p>
      <button class="btn" id="accept">${state.t === state.full.en ? "I agree to participate" : "J'accepte de participer"}</button>
    </div>
  `);
  view.querySelector("#accept").addEventListener("click", async () => {
    const data = await api("/api/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code }) });
    state.participant = data.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- eligibility

function renderEligibility() {
  const qs = state.t.eligibility.questions;
  const rows = qs.map((q, i) => `
    <label>${q.texte}</label>
    <div class="radio-row">
      ${q.options.map((o) => `<label><input type="radio" name="elig_${i}" value="${o}"> ${o}</label>`).join("")}
    </div>
  `).join("<hr>");
  const view = el(`
    <div class="card">
      ${renderProgress("eligibility")}
      <h2>${state.t === state.full.en ? "A few questions about your home" : "Quelques questions sur votre logement"}</h2>
      ${rows}
      <button class="btn" id="next" disabled>${btnNext()}</button>
    </div>
  `);
  function check() { view.querySelector("#next").disabled = !qs.every((_, i) => view.querySelector(`input[name=elig_${i}]:checked`)); }
  qs.forEach((_, i) => view.querySelectorAll(`input[name=elig_${i}]`).forEach((r) => r.addEventListener("change", check)));
  view.querySelector("#next").addEventListener("click", async () => {
    const data = {};
    qs.forEach((q, i) => { data[q.key] = view.querySelector(`input[name=elig_${i}]:checked`).value; });
    const res = await api("/api/eligibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, data }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

function btnNext() { return state.t === state.full.en ? "Continue" : "Continuer"; }

// ---------------------------------------------------------------- consumption survey

function renderConsumptionSurvey() {
  const s = state.t.consumption_survey;
  function fieldHtml(q) {
    if (q.type === "bool") {
      const yn = state.t === state.full.en ? ["Yes", "No"] : ["Oui", "Non"];
      return `<select id="q_${q.key}"><option value="">--</option><option value="1">${yn[0]}</option><option value="0">${yn[1]}</option></select>`;
    }
    return `<input type="number" min="0" id="q_${q.key}" value="0">`;
  }
  function rowHtml(q) {
    const icon = q.icon ? `<img src="/static/img/${q.icon}" alt="" class="survey-icon">` : "";
    return `<div class="survey-row">${icon}<div style="flex:1"><label for="q_${q.key}">${q.texte}</label>${fieldHtml(q)}</div></div>`;
  }
  const rows = [...s.eau_questions, ...s.elec_questions].map(rowHtml).join("");

  const view = el(`
    <div class="card">
      ${renderProgress("consumption_survey")}
      <h2>${state.t === state.full.en ? "Your home and appliances" : "Votre logement et vos équipements"}</h2>
      <p class="lead">${state.t === state.full.en ? "These questions help estimate your usual water and electricity consumption." : "Ces questions permettent d'estimer votre consommation habituelle d'eau et d'électricité."}</p>
      ${rows}
      <button class="btn" id="next">${btnNext()}</button>
    </div>
  `);
  view.querySelector("#next").addEventListener("click", async () => {
    const answers = {};
    [...s.eau_questions, ...s.elec_questions].forEach((q) => {
      const e2 = view.querySelector(`#q_${q.key}`);
      answers[q.key] = q.type === "bool" ? e2.value === "1" : Number(e2.value || 0);
    });
    const res = await api("/api/consumption_survey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, answers }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- consumption estimate

function renderConsumptionEstimate() {
  const e = state.participant.consumption_estimate_json;
  const t = state.t.consumption_survey.estimate_text;
  function fill(text, min, max, avg, unit) {
    return tpl(text, { min: `<strong>${fmt1(min)} ${unit}</strong>`, max: `<strong>${fmt1(max)} ${unit}</strong>`, avg: `<strong>${fmt1(avg)} ${unit}</strong>` });
  }
  const view = el(`
    <div class="card">
      ${renderProgress("consumption_estimate")}
      <h2>${state.t === state.full.en ? "Your estimated consumption" : "Votre consommation estimée"}</h2>
      <p>${t.intro}</p>
      <div class="estimate-grid">
        <div class="estimate-box domain-eau"><img src="/static/img/eausymb.png" class="domain-icon" alt="">
          <p>${fill(t.eau_annuelle, e.m3_annuel_min, e.m3_annuel_max, e.m3_annuel_avg, "m³")}</p>
          <p>${fill(t.eau_mensuelle, e.m3_mensuel_min, e.m3_mensuel_max, e.m3_mensuel_avg, "m³")}</p>
        </div>
        <div class="estimate-box domain-elec"><img src="/static/img/elecsymb.png" class="domain-icon" alt="">
          <p>${fill(t.elec_annuelle, e.kwh_annuel_min, e.kwh_annuel_max, e.kwh_annuel_avg, "kWh")}</p>
          <p>${fill(t.elec_mensuelle, e.kwh_mensuel_min, e.kwh_mensuel_max, e.kwh_mensuel_avg, "kWh")}</p>
        </div>
      </div>
      <button class="btn" id="next">${btnNext()}</button>
    </div>
  `);
  view.querySelector("#next").addEventListener("click", async () => {
    const res = await api("/api/consumption_estimate_ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- hypothetical intro (dedicated page)

function renderTariffHypoIntro() {
  const tar = state.t.tariffs;
  const view = el(`
    <div class="card">
      ${renderProgress("tariff_hypo_intro")}
      <h2>${tar.hypo_intro_title}</h2>
      <p class="lead" style="font-size:1.1em">${tar.hypo_intro_body}</p>
      <button class="btn" id="next">${btnNext()}</button>
    </div>
  `);
  view.querySelector("#next").addEventListener("click", async () => {
    const res = await api("/api/tariff_hypo_intro_ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- tariff choices, ONE comparison per screen, two columns

function renderTariffSequential(domain, apiStage, incentivized) {
  const tar = state.t.tariffs;
  const comparisons = tar.comparisons;
  const step = state.tariffStep;
  const [a, b] = comparisons[step];
  const domainLabel = tar[domain].label;
  const domainClass = domain === "electricite" ? "domain-elec" : "domain-eau";
  const domainIcon = domain === "electricite" ? "elecsymb.png" : "eausymb.png";
  const banner = incentivized ? tar.banner_incentivized : tar.banner_hypothetical;
  const bannerClass = incentivized ? "tariff-banner tariff-banner-hot" : "tariff-banner tariff-banner-cool";

  const savingsPct = domain === "electricite" ? state.participant.est_pct_elec : state.participant.est_pct_eau;
  const savingsBox = incentivized ? `
    <div class="savings-highlight ${domainClass}">
      <img src="/static/img/economie.png" alt="">
      <div>${tar.savings_reminder_label}<br><span class="savings-pct">${savingsPct || 0}%</span></div>
    </div>
  ` : "";

  const reminders = `
    <details class="reminder"><summary>${tar.reminder_label_instructions}</summary><p>${tar.reminder_instructions}</p></details>
    <details class="reminder"><summary>${tar.reminder_label_progressive}</summary><p>${tar.progressive_example[domain]}</p></details>
    <details class="reminder"><summary>${tar.reminder_label_consumption}</summary><p>${renderMyConsumptionReminder()}</p></details>
  `;

  const view = el(`
    <div class="card">
      ${renderProgress(apiStage)}
      <h2 class="domain-title ${domainClass}"><img src="/static/img/${domainIcon}" alt="" class="domain-icon"> ${domainLabel} — ${step + 1}/${comparisons.length}</h2>
      <p class="${bannerClass}">${banner}</p>
      ${savingsBox}
      <div class="reminder-group">${reminders}</div>
      <p class="lead" style="text-align:center; font-weight:600;">${state.t === state.full.en ? "Choose a tariff between the two options below:" : "Choisissez un tarif parmi les deux propositions suivantes :"}</p>
      <div class="tariff-columns">
        <label class="tariff-option" for="opt_A">
          <div class="tariff-option-head ${domainClass}">${tar.plan_labels[a]}</div>
          ${planDescriptionHtml(domain, a)}
          <div class="tariff-pick"><input type="radio" name="cmp" id="opt_A" value="A"> ${state.t === state.full.en ? "Choose option A" : "Je choisis l'option A"}</div>
        </label>
        <label class="tariff-option" for="opt_B">
          <div class="tariff-option-head ${domainClass}">${tar.plan_labels[b]}</div>
          ${planDescriptionHtml(domain, b)}
          <div class="tariff-pick"><input type="radio" name="cmp" id="opt_B" value="B"> ${state.t === state.full.en ? "Choose option B" : "Je choisis l'option B"}</div>
        </label>
      </div>
      <button class="btn" id="next" disabled>${step + 1 < comparisons.length ? (state.t === state.full.en ? "Next decision" : "Décision suivante") : btnNext()}</button>
      <div class="error" id="err"></div>
    </div>
  `);

  view.querySelectorAll("input[name=cmp]").forEach((r) => r.addEventListener("change", () => { view.querySelector("#next").disabled = false; }));

  view.querySelector("#next").addEventListener("click", async () => {
    const choice = view.querySelector("input[name=cmp]:checked").value;
    state.tariffChoices.push(choice);
    if (state.tariffStep + 1 < comparisons.length) {
      state.tariffStep += 1;
      root.innerHTML = "";
      root.appendChild(renderTariffSequential(domain, apiStage, incentivized));
      return;
    }
    try {
      const res = await api(`/api/${apiStage}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, choices: state.tariffChoices }) });
      state.participant = res.participant;
      renderStage();
    } catch (e) { view.querySelector("#err").textContent = e.message; }
  });

  return view;
}

function renderMyConsumptionReminder() {
  const e = state.participant.consumption_estimate_json;
  const pctElec = state.participant.est_pct_elec || 0;
  const pctEau = state.participant.est_pct_eau || 0;
  if (state.t === state.full.en) {
    return `Average electricity consumption: <strong>${fmt1(e.kwh_annuel_avg)} kWh/year</strong> (reduced by ${pctElec}% based on your commitments). Average water consumption: <strong>${fmt1(e.m3_annuel_avg)} m³/year</strong> (reduced by ${pctEau}%).`;
  }
  return `Consommation électrique moyenne : <strong>${fmt1(e.kwh_annuel_avg)} kWh/an</strong> (réduite de ${pctElec}% selon vos engagements). Consommation d'eau moyenne : <strong>${fmt1(e.m3_annuel_avg)} m³/an</strong> (réduite de ${pctEau}%).`;
}

// ---------------------------------------------------------------- behavior current

function renderBehaviorCurrent() {
  const b = state.t.behavior_current;
  const rows = b.items.map((it) => `
    <div class="behavior-item">
      <img src="/static/img/${it.icon}" alt="" class="behavior-icon">
      <div>
        <label>${it.texte}</label>
        <div class="radio-row">
          ${b.scale.map((s) => `<label><input type="radio" name="bc_${it.key}" value="${s}"> ${s}</label>`).join("")}
        </div>
      </div>
    </div>
  `).join("<hr>");
  const view = el(`
    <div class="card">
      ${renderProgress("behavior_current")}
      <h2>${state.t === state.full.en ? "Changing your behaviour" : "Je change de comportement"}</h2>
      <p class="lead">${b.instruction}</p>
      ${rows}
      <button class="btn" id="next" disabled>${btnNext()}</button>
    </div>
  `);
  function check() { view.querySelector("#next").disabled = !b.items.every((it) => view.querySelector(`input[name=bc_${it.key}]:checked`)); }
  b.items.forEach((it) => view.querySelectorAll(`input[name=bc_${it.key}]`).forEach((r) => r.addEventListener("change", check)));
  view.querySelector("#next").addEventListener("click", async () => {
    const answers = {};
    b.items.forEach((it) => { answers[it.key] = view.querySelector(`input[name=bc_${it.key}]:checked`).value; });
    const res = await api("/api/behavior_current", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, answers }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- behavior adopt

function renderBehaviorAdopt() {
  const b = state.t.behavior_adopt;
  const rows = b.items.map((it) => `
    <div class="behavior-item">
      <img src="/static/img/${it.icon}" alt="" class="behavior-icon">
      <div>
        <label>${it.texte}</label>
        <div class="radio-row">
          ${it.scale.map((s, i) => `<label><input type="radio" name="ba_${it.key}" value="${i}"> ${s.label}</label>`).join("")}
        </div>
      </div>
    </div>
  `).join("<hr>");
  const view = el(`
    <div class="card">
      ${renderProgress("behavior_adopt")}
      <h2>${state.t === state.full.en ? "Your capacity to adopt energy-saving behaviours" : "Votre capacité à adopter des comportements économes"}</h2>
      <p class="lead">${b.instruction}</p>
      ${rows}
      <button class="btn" id="next" disabled>${btnNext()}</button>
    </div>
  `);
  function check() { view.querySelector("#next").disabled = !b.items.every((it) => view.querySelector(`input[name=ba_${it.key}]:checked`)); }
  b.items.forEach((it) => view.querySelectorAll(`input[name=ba_${it.key}]`).forEach((r) => r.addEventListener("change", check)));
  view.querySelector("#next").addEventListener("click", async () => {
    const choices = {};
    b.items.forEach((it) => { choices[it.key] = Number(view.querySelector(`input[name=ba_${it.key}]:checked`).value); });
    const res = await api("/api/behavior_adopt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, choices }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- recap (Phase 3)

function renderRecap() {
  const p = state.participant;
  const e = p.consumption_estimate_json;
  const r = state.t.recap_phase3;
  const view = el(`
    <div class="card">
      ${renderProgress("recap")}
      <h2><img src="/static/img/economie.png" alt="" class="domain-icon"> Phase 3</h2>
      <p>${r.intro}</p>
      <p><strong>${fmt1(e.kwh_mensuel_avg)} kWh/${state.t === state.full.en ? "month" : "mois"}</strong> &nbsp;|&nbsp; <strong>${fmt1(e.m3_mensuel_avg)} m³/${state.t === state.full.en ? "month" : "mois"}</strong></p>
      <p>${r.estimation_text}</p>
      <p><img src="/static/img/elecsymb.png" class="inline-icon" alt=""> <strong class="pct-badge domain-elec">${p.est_pct_elec}%</strong> &nbsp; <img src="/static/img/eausymb.png" class="inline-icon" alt=""> <strong class="pct-badge domain-eau">${p.est_pct_eau}%</strong></p>
      <p class="lead" style="font-weight:600; margin-top:20px;">${r.instruction_couples}</p>
      <div class="bubble-row">
        <div class="bubble bubble-green">
          <div class="bubble-title">${r.bonus_text_correct}</div>
          <div class="bubble-amount">+${r.bonus_correct_eur}€</div>
          <div class="bubble-detail">${r.bonus_detail_correct}</div>
        </div>
        <div class="bubble bubble-red">
          <div class="bubble-title">${r.bonus_text_incorrect}</div>
          <div class="bubble-amount">+${r.bonus_incorrect_eur}€</div>
          <div class="bubble-detail">${r.bonus_detail_incorrect}</div>
        </div>
      </div>
      <button class="btn" id="next">${btnNext()}</button>
    </div>
  `);
  view.querySelector("#next").addEventListener("click", async () => {
    const res = await api("/api/recap_ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- preferences

function renderPreferences() {
  const p = state.t.preferences;
  const rows = p.items.map((it) => `
    <label>${it.texte}</label>
    <div class="radio-row">
      ${p.scale_5.map((s, i) => `<label><input type="radio" name="pr_${it.key}" value="${i + 1}"> ${s}</label>`).join("")}
    </div>
  `).join("<hr>");
  const view = el(`
    <div class="card">
      ${renderProgress("preferences")}
      <h2>${state.t === state.full.en ? "Your opinion" : "Votre avis"}</h2>
      <p class="lead">${state.t === state.full.en ? "For each question, choose an answer between 1 (not at all agree) and 5 (fully agree)." : "Pour chacune des questions suivantes, merci de choisir une réponse entre 1 (pas du tout d'accord) et 5 (tout à fait d'accord)."}</p>
      ${rows}
      <button class="btn" id="next" disabled>${btnNext()}</button>
    </div>
  `);
  function check() { view.querySelector("#next").disabled = !p.items.every((it) => view.querySelector(`input[name=pr_${it.key}]:checked`)); }
  p.items.forEach((it) => view.querySelectorAll(`input[name=pr_${it.key}]`).forEach((r) => r.addEventListener("change", check)));
  view.querySelector("#next").addEventListener("click", async () => {
    const data = {};
    p.items.forEach((it) => { data[it.key] = Number(view.querySelector(`input[name=pr_${it.key}]:checked`).value); });
    const res = await api("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, data }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- demographics

function renderDemographics() {
  const qs = state.t.demographics.questions;
  function fieldHtml(q) {
    const saved = state._demogValues[q.key];
    if (q.type === "radio") return `<div class="radio-row">${q.options.map((o) => `<label><input type="radio" name="dg_${q.key}" value="${o}" ${saved === o ? "checked" : ""}> ${o}</label>`).join("")}</div>`;
    if (q.type === "select") return `<select id="dg_${q.key}"><option value="">--</option>${q.options.map((o) => `<option value="${o}" ${saved === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
    if (q.type === "int") return `<input type="number" id="dg_${q.key}" value="${saved || ""}">`;
    return `<input type="text" id="dg_${q.key}" value="${saved || ""}">`;
  }
  function passesCondition(q) {
    if (!q.condition) return true;
    const [key, val] = q.condition.split("=");
    return state._demogValues && state._demogValues[key] === val;
  }
  state._demogValues = state._demogValues || {};

  function renderRows() {
    return qs.filter(passesCondition).map((q) => `<div data-key="${q.key}"><label>${q.texte}</label>${fieldHtml(q)}</div>`).join("");
  }

  const view = el(`
    <div class="card">
      ${renderProgress("demographics")}
      <h2>${state.t === state.full.en ? "A few questions about you" : "Quelques informations sur vous"}</h2>
      <div id="rows">${renderRows()}</div>
      <button class="btn" id="next">${btnNext()}</button>
      <div class="error" id="err"></div>
    </div>
  `);

  function attachConditionalListeners() {
    view.querySelectorAll("#rows input[type=radio]").forEach((r) => {
      r.addEventListener("change", () => {
        const key = r.closest("[data-key]").dataset.key;
        state._demogValues[key] = r.value;
        view.querySelector("#rows").innerHTML = renderRows();
        attachConditionalListeners();
      });
    });
  }
  attachConditionalListeners();

  view.querySelector("#next").addEventListener("click", async () => {
    const data = {};
    qs.filter(passesCondition).forEach((q) => {
      if (q.type === "radio") {
        const checked = view.querySelector(`input[name=dg_${q.key}]:checked`);
        data[q.key] = checked ? checked.value : null;
      } else {
        const elx = view.querySelector(`#dg_${q.key}`);
        data[q.key] = elx ? elx.value : null;
      }
    });
    const res = await api("/api/demographics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, data }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- CRT

function renderCrt() {
  const c = state.t.crt_items;
  const rows = c.items.map((it) => `
    <label for="crt_${it.key}">${it.titre}</label>
    <p class="lead" style="margin-top:0">${it.texte}</p>
    <input type="number" step="any" id="crt_${it.key}"> <span class="muted">${it.unite}</span>
  `).join("<hr>");
  const view = el(`
    <div class="card">
      ${renderProgress("crt")}
      <h2>${state.t === state.full.en ? "Three short questions" : "Trois petites questions"}</h2>
      <p class="lead">${c.instruction}</p>
      ${rows}
      <button class="btn" id="next">${btnNext()}</button>
    </div>
  `);
  view.querySelector("#next").addEventListener("click", async () => {
    const answers = {};
    c.items.forEach((it) => {
      const v = view.querySelector(`#crt_${it.key}`).value;
      answers[it.key] = v === "" ? null : Number(v);
    });
    const res = await api("/api/crt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, answers }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

function renderCrtCheck() {
  const c = state.t.crt_items;
  const rows = c.items.map((it) => `<label class="radio-row"><input type="checkbox" id="seen_${it.key}"> ${it.titre}</label>`).join("<br>");
  const view = el(`
    <div class="card">
      ${renderProgress("crt_check")}
      <h2>${state.t === state.full.en ? "One last thing about these questions" : "Une dernière chose sur ces questions"}</h2>
      <p class="lead">${c.check_instruction}</p>
      ${rows}
      <button class="btn" id="next">${btnNext()}</button>
    </div>
  `);
  view.querySelector("#next").addEventListener("click", async () => {
    const seen = {};
    c.items.forEach((it) => { seen[it.key] = view.querySelector(`#seen_${it.key}`).checked; });
    const res = await api("/api/crt_check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, seen }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- lottery

function pieSvg() {
  return `<svg viewBox="0 0 100 100" class="lot-pie">
    <path d="M50,50 L50,0 A50,50 0 0 1 50,100 Z" fill="#1d6f42"/>
    <path d="M50,50 L50,100 A50,50 0 0 1 50,0 Z" fill="#c9e8d4"/>
  </svg>`;
}

function renderLottery() {
  const l = state.t.lottery_task;
  const options = l.options;
  const rows = options.map((o, i) => `
    <label class="lot-card" for="lot_${i}">
      <input type="radio" name="lot" id="lot_${i}" value="${i}">
      ${pieSvg()}
      <div class="lot-amounts">
        <span class="lot-amount lot-amount-high">${fmt(o.high)} €</span>
        <span class="lot-amount lot-amount-low">${fmt(o.low)} €</span>
      </div>
    </label>
  `).join("");
  const view = el(`
    <div class="card">
      ${renderProgress("lottery")}
      <h2>${state.t === state.full.en ? "Lottery choice" : "Choix de loterie"}</h2>
      <p>${l.intro}</p>
      <p class="muted">${l.example}</p>
      <div class="lot-grid">${rows}</div>
      <button class="btn" id="next" disabled>${btnNext()}</button>
    </div>
  `);
  view.querySelectorAll("input[name=lot]").forEach((inp) => inp.addEventListener("change", () => { view.querySelector("#next").disabled = false; }));
  view.querySelector("#next").addEventListener("click", async () => {
    const choice_index = Number(view.querySelector("input[name=lot]:checked").value);
    const res = await api("/api/lottery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, choice_index }) });
    state.participant = res.participant;
    renderStage();
  });
  return view;
}

// ---------------------------------------------------------------- done

function renderDone() {
  const p = state.participant;
  const g = state.t.final_gain;
  const lot = p.lottery_json.option;
  const view = el(`
    <div class="card">
      ${renderProgress("done")}
      <div style="text-align:center"><img src="/static/img/dollar_goute.gif" alt="" style="width:80px;height:80px;"></div>
      <h2 style="text-align:center">${g.thanks}</h2>
      <p>${tpl(g.tariff_text, { n_correct: p.n_correct_tariff, n_total: 6, bonus: fmt(p.bonus_eur) })}</p>
      <p>${tpl(g.lottery_text, { low: fmt(lot.low), high: fmt(lot.high), gain: fmt(p.lottery_gain_eur) })}</p>
      <p>${tpl(g.base_text, { base: fmt(p.base_gain_eur) })}</p>
      <div class="gain-box">
        <div>${state.t === state.full.en ? "Your total payment" : "Votre gain total"}</div>
        <div class="amount">${fmt(p.rounded_gain_eur)} €</div>
        <div class="muted">${tpl(g.final_text, { total: fmt(p.total_gain_eur), rounded: fmt(p.rounded_gain_eur) })}</div>
      </div>
      <p style="margin-top:20px">${state.t === state.full.en ? "Keep this code as proof of participation:" : "Conservez ce code comme preuve de participation :"}</p>
      <div class="code-box">${p.code}</div>
    </div>
  `);
  return view;
}

boot();
