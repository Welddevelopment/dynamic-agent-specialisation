let state;
let page = "overview";
let selectedRoleId = null;
const main = document.querySelector("main");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`);
  return body;
}

function nav() {
  document.querySelectorAll("[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  document.querySelector("#roles").innerHTML = state.roles.map((role) => `<button class="role ${selectedRoleId === role.id && page === "role" ? "active" : ""}" data-role="${esc(role.id)}">${esc(role.name)}</button>`).join("");
  document.querySelectorAll("[data-role]").forEach((button) => button.onclick = () => { selectedRoleId = button.dataset.role; page = "role"; nav(); render(); });
  document.querySelectorAll("[data-page]").forEach((button) => button.onclick = () => { page = button.dataset.page; nav(); render(); });
}

function overview() {
  const historical = state.historicalImprovementRuns[0];
  return `<p class="kicker">Autonomous recommendation · human control on demand</p><h1 class="page-title">Build the strongest specialist you can actually prove.</h1><p class="lede">The compiler designs candidates, tests them against external outcomes, recommends the strongest measured fit, and keeps every serious alternative inspectable. Further self-improvement is optional and budget-bound.</p><div class="metric-row"><div class="metric"><span>Reference roles</span><strong>${state.roles.length}</strong></div><div class="metric"><span>Evidence chain</span><strong>${state.evidenceValid ? "Valid" : "Invalid"}</strong></div><div class="metric"><span>Latest paid experiment</span><strong>${historical ? `$${historical.spendUsd.toFixed(2)}` : "None"}</strong></div></div>${historical ? `<div class="card"><p class="kicker">Latest honest decision</p><h2>${esc(historical.label)}</h2><p>${esc(historical.result)}. ${esc(historical.stopReason)}.</p><p class="explain">${esc(historical.boundary)}</p></div>` : ""}`;
}

function lifecycle() {
  const registry = state.product?.registry;
  const rehearsal = state.product?.lifecycle;
  if (!registry) return `<p class="kicker">Specialist lifecycle</p><h1 class="page-title">No durable specialist registry is loaded.</h1><p class="lede">Complete and verify the bounded Level 1 export before lifecycle controls become available.</p>`;
  const names = { "realistic-procurement-specialist": "Procurement", "realistic-support-operations-specialist": "SaaS support", "realistic-revenue-operations-specialist": "CRM / RevOps" };
  const selected = registry.selections.map((selection) => `<article class="lifecycle-card"><div class="lifecycle-card-head"><h2>${esc(names[selection.roleId] ?? selection.roleId)}</h2><span class="decision ${selection.decision.includes("retain") ? "retained" : "activated"}">${selection.decision.includes("retain") ? "Existing fit retained" : "Compiler fit activated"}</span></div><p class="candidate-name">${esc(selection.candidateId)}</p><div class="lifecycle-meta"><span>Package ${esc(selection.candidateVersion)}</span><span>${selection.alternativesPreserved} alternatives preserved</span></div><code>${esc(selection.recordHash)}</code></article>`).join("");
  const roleEvents = rehearsal ? [
    ["Healthy evidence", "Continue", rehearsal.roles.procurement, "No search was started when the active specialist remained inside its contract."],
    ["Measured drift", "Bounded search", rehearsal.roles.support, "A capped request stayed unstarted until explicit approval; the trial challenger later regressed and rolled back."],
    ["Unsafe outcome", "Halt", rehearsal.roles.revops, "Safety bypassed the ordinary drift window and stopped the active specialist immediately."],
  ] : [];
  return `<p class="kicker">Continuous specialisation</p><h1 class="page-title">Improve the specialist without gambling live work.</h1><p class="lede">Independent outcomes decide whether the active package continues, asks for a bounded search, or halts. Development winners still pass offline, shadow and canary gates before promotion.</p><div class="lifecycle-grid">${selected}</div><section class="lifecycle-rail"><div class="panel-head"><div><h2>Lifecycle rehearsal</h2><p class="explain">Constructed local fixtures verify the control machinery. They are not customer or model-performance evidence.</p></div><span class="evidence-chip">${rehearsal?.status === "completed" ? "All checks passed" : "Not run"}</span></div><div class="path-rail">${roleEvents.map(([signal,action,detail,copy])=>`<article class="path-step"><span>${esc(signal)}</span><strong>${esc(action)}</strong><p>${esc(copy)}</p><code>${esc(detail?.branch ?? "No fixture")}</code></article>`).join("")}</div></section><section class="boundary-note"><strong>The boundary is deliberate.</strong><p>Monitoring and lifecycle state are durable and tamper-evident. Further optimisation remains optional, model spend requires explicit start, canaries require accountable authorization, and no synthetic result is presented as production reliability.</p></section>`;
}

function improvement() {
  const draft = state.improvement.draft;
  const contract = draft?.contract;
  const enabled = state.improvement.enabled;
  const values = Object.fromEntries((contract?.objectives ?? []).map((item) => [item.metric, item.minimumRelativeImprovement]));
  const minutes = contract ? Math.round(contract.limits.maximumWallClockMs / 60_000) : 90;
  const budget = contract?.limits.maximumModelSpendUsd ?? 5;
  const rounds = contract?.limits.maximumRounds ?? 6;
  const refinements = contract?.limits.maximumRefinementsPerRound ?? 2;
  const repeats = contract?.limits.minimumRepeatedObservations ?? 3;
  const passFloor = Math.round((contract?.qualityFloor.minimumPassRate ?? 1) * 100);
  const outcomeFloor = Math.round((contract?.qualityFloor.minimumOutcomeScoreRatio ?? 1) * 100);
  const persistence = draft?.persistence ?? "balanced";
  const history = [...state.improvement.completedRuns, ...state.historicalImprovementRuns];
  return `<p class="kicker">Optional optimisation</p><h1 class="page-title">Ask for better. Decide when the search should stop.</h1><p class="lede">The default recommendation remains usable without this mode. Turn it on only when further measured improvement is worth additional model spend and evaluation time.</p><div class="split"><section class="panel"><div class="panel-head"><div><h2>Improvement contract</h2><p class="explain">Nothing runs when this switch is off.</p></div><label class="switch"><input id="enabled" type="checkbox" ${enabled ? "checked" : ""}><span></span></label></div><p class="field-label"><span>Improvement metrics</span><small>Minimum target</small></p>${objective("modelCostUsd","Model cost","Average paid-model cost per completed case",values.modelCostUsd)}${objective("medianElapsedMs","Completion speed","Median wall-clock time",values.medianElapsedMs)}${objective("toolCalls","Tool use","Average tool calls per completed case",values.toolCalls)}${objective("outcomeScore","Outcome quality","Independently measured external result",values.outcomeScore,"increase")}${objective("humanInterventions","Human intervention","Required approvals or corrections",values.humanInterventions)}<div class="section-rule"></div><p class="field-label"><span>Proof required</span><small>Cannot be silently weakened</small></p><div class="control-grid">${numberField("pass-floor","Minimum pass rate","%",passFloor,0,100,1)}${numberField("outcome-floor","Minimum quality retained","% of current",outcomeFloor,0,200,1)}${numberField("repeats","Repeated observations","per candidate",repeats,1,100,1)}${numberField("refinements","Candidates refined","per round",refinements,1,10,1)}</div><div class="safety-lock"><strong>Safety gate locked</strong><span>Zero unsafe attempts permitted. This cannot be relaxed from the console.</span></div><div class="section-rule"></div><p class="field-label"><span>Hard stopping limits</span><small>Whichever arrives first</small></p><div class="control-grid">${numberField("budget","Model budget","USD",budget,0,100000,.5)}${numberField("minutes","Search time","minutes",minutes,1,10080,1)}${numberField("rounds","Redesign rounds","maximum",rounds,1,50,1)}</div><div class="field"><span class="field-label">When should it give up?</span><div class="segmented">${profile("early","Give up early",persistence)}${profile("balanced","Balanced",persistence)}${profile("persistent","Keep searching",persistence)}</div>${profileExplanation(persistence)}</div><div class="actions"><button class="button primary" id="save">Save settings</button><button class="button" id="disable">Turn off</button></div><p id="form-message" class="notice"></p></section><section class="panel"><div class="panel-head"><div><h2>Run visibility</h2><p class="explain">Every design, measurement, rejection and stop reason is retained.</p></div></div><div class="run-state">${activeRun()}</div><div class="actions"><button class="button primary" id="start" ${!enabled || !state.improvementRunnerAvailable || state.improvement.activeRun ? "disabled" : ""}>Start optional search</button></div>${!state.improvementRunnerAvailable ? `<p class="notice">Configuration and evidence review are ready. Starting remains locked until the harder second-role runner is attached and locally verified.</p>` : ""}<h3 class="history-title">Completed searches</h3><div>${history.length ? history.map(receipt).join("") : `<p class="explain">No completed searches yet.</p>`}</div></section></div>`;
}

function objective(metric, label, detail, value, direction = "decrease") {
  const checked = value !== undefined;
  return `<label class="objective"><input data-objective="${metric}" data-direction="${direction}" type="checkbox" ${checked ? "checked" : ""}><span class="objective-copy"><strong>${label}</strong><small>${detail}</small></span><input data-target="${metric}" aria-label="${label} target percentage" type="number" min="0" max="95" value="${checked ? Math.round(value * 100) : 10}"></label>`;
}
function numberField(id,label,unit,value,min,max,step){return `<div class="field compact"><label for="${id}"><span>${label}</span><small>${unit}</small></label><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></div>`}
function profile(value,label,current){return `<label><input type="radio" name="persistence" value="${value}" ${current===value?"checked":""}>${label}</label>`}
function profileExplanation(value){const copy={early:"Stops after one round without at least 2% material progress; requires at least a 35% estimated chance of success.",balanced:"Allows two weak rounds; requires at least a 15% estimated chance of success.",persistent:"Allows four weak rounds and follows paths with a 3% estimated chance, but hard money, time and round limits still win."};return `<small class="profile-copy">${copy[value]}</small>`}
function activeRun(){const run=state.improvement.activeRun;if(!run)return `<div class="run-empty"><strong>Nothing is running.</strong><p>Save a contract, then explicitly start a search. Existing specialists continue operating while alternatives are evaluated.</p></div>`;return `<div class="receipt live"><div class="receipt-top"><strong>${esc(run.status)}</strong><span>${run.events.length} events</span></div><p>Started ${esc(run.startedAt)}. This view refreshes while the bounded search works.</p><div class="event-log">${run.events.map(eventRow).join("")||`<p class="explain">Preparing the baseline measurement.</p>`}</div></div>`}
function eventRow(event){return `<div class="event-row"><span>${esc(event.status??event.type??"event")}</span><code>${esc(event.candidateId??event.message??"")}</code><small>${event.spendUsd===undefined?"":`$${Number(event.spendUsd).toFixed(4)}`}</small></div>`}
function receipt(run){const result=run.result??run;const best=result.bestCandidateFound;const rounds=result.rounds??[];return `<article class="receipt"><div class="receipt-top"><strong>${esc(run.label??run.id)}</strong><span>${esc(run.status)}</span></div><p>${esc(result.stopReason??run.stopReason??"No stop reason recorded")}</p>${result.spentUsd!==undefined?`<p><strong>$${Number(result.spentUsd).toFixed(4)}</strong> spent in this optional search.</p>`:""}${run.selectionHash?`<code>${esc(run.selectionHash)}</code>`:""}${best?`<p>Best retained alternative: <strong>${esc(best.candidate?.id??best.summary?.candidateId)}</strong>.</p>`:""}${rounds.length?`<details><summary>Inspect ${rounds.length} search round${rounds.length===1?"":"s"}</summary>${rounds.map(roundDetail).join("")}</details>`:""}${result.contract?`<details><summary>Inspect exact contract</summary><pre>${esc(JSON.stringify(result.contract,null,2))}</pre></details>`:""}</article>`}
function roundDetail(round){return `<div class="round"><strong>Round ${round.round}</strong>${round.results.map(item=>`<div class="candidate-row"><span>${esc(item.candidateId)}</span><span>${item.assessment.targetAchieved?"Target met":item.assessment.eligible?"Eligible near-miss":"Rejected"}</span><small>${Math.round(item.summary.passRate*100)}% pass · $${Number(item.summary.modelCostUsd).toFixed(4)}/case · ${Math.round(item.summary.medianElapsedMs)}ms median</small></div>`).join("")}</div>`}

function rolePage() {
  const role = state.roles.find((item) => item.id === selectedRoleId) ?? state.roles[0];
  const winner = role.recommendation;
  return `<p class="kicker">Verified recommendation</p><h1 class="page-title">${esc(role.name)}</h1><p class="lede">Recommended automatically from safe finalists using the declared quality, cost, speed and escalation preferences.</p><div class="metric-row"><div class="metric"><span>Selected candidate</span><strong>${esc(winner.candidateId.split(":").at(-1))}</strong></div><div class="metric"><span>Synthetic unseen result</span><strong>${Math.round(winner.successRate*100)}%</strong></div><div class="metric"><span>Unsafe effects</span><strong>0</strong></div></div><div class="card-grid">${role.candidates.map((candidate)=>`<article class="card"><p class="kicker">${esc(candidate.id)}</p><pre>${esc(JSON.stringify(candidate,null,2))}</pre></article>`).join("")}</div>`;
}

async function saveImprovement() {
  const objectives = [...document.querySelectorAll("[data-objective]")].map((box) => ({ metric: box.dataset.objective, direction: box.dataset.direction, enabled: box.checked, minimumRelativeImprovement: Number(document.querySelector(`[data-target="${box.dataset.objective}"]`).value)/100 }));
  const payload = { enabled: document.querySelector("#enabled").checked, id: `console-${Date.now()}`, baselineId: "current-specialist", objectives, minimumPassRate: Number(document.querySelector("#pass-floor").value)/100, minimumOutcomeScoreRatio: Number(document.querySelector("#outcome-floor").value)/100, maximumModelSpendUsd: Number(document.querySelector("#budget").value), maximumWallClockMinutes: Number(document.querySelector("#minutes").value), maximumRounds: Number(document.querySelector("#rounds").value), maximumRefinementsPerRound: Number(document.querySelector("#refinements").value), minimumRepeatedObservations: Number(document.querySelector("#repeats").value), persistence: document.querySelector('[name="persistence"]:checked').value };
  const message = document.querySelector("#form-message");
  try { state = await request("/api/improvement/configure", { method: "POST", body: JSON.stringify(payload) }); message.textContent = "Saved. No model calls were started."; nav(); }
  catch (error) { message.textContent = error.message; message.classList.add("error"); }
}

function bind() {
  if (page !== "improve") return;
  document.querySelector("#save").onclick = saveImprovement;
  document.querySelector("#disable").onclick = async () => { state = await request("/api/improvement/disable", { method: "POST", body: "{}" }); render(); nav(); };
  document.querySelector("#start").onclick = async () => { try { state = await request("/api/improvement/start", { method: "POST", body: JSON.stringify({ confirmation: "START_OPTIONAL_IMPROVEMENT" }) }); render(); } catch (error) { document.querySelector("#form-message").textContent = error.message; } };
}

function render() {
  main.innerHTML = page === "improve" ? improvement() : page === "lifecycle" ? lifecycle() : page === "role" ? rolePage() : overview();
  main.classList.remove("flash");
  requestAnimationFrame(() => main.classList.add("flash"));
  bind();
}

state = await request("/api/state");
selectedRoleId = state.roles[0]?.id;
document.querySelector("#boundary").textContent = state.boundary;
document.querySelector("#evidence-state").textContent = state.evidenceValid ? "Valid" : "Invalid";
nav();
render();
setInterval(async()=>{if(!state.improvement.activeRun)return;try{state=await request("/api/state");nav();render()}catch{}},1000);
