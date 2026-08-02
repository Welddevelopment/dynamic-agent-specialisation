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

function improvement() {
  const draft = state.improvement.draft;
  const contract = draft?.contract;
  const enabled = state.improvement.enabled;
  const values = Object.fromEntries((contract?.objectives ?? []).map((item) => [item.metric, item.minimumRelativeImprovement]));
  const minutes = contract ? Math.round(contract.limits.maximumWallClockMs / 60_000) : 90;
  const budget = contract?.limits.maximumModelSpendUsd ?? 5;
  const rounds = contract?.limits.maximumRounds ?? 6;
  const persistence = draft?.persistence ?? "balanced";
  const history = [...state.improvement.completedRuns, ...state.historicalImprovementRuns];
  return `<p class="kicker">Optional optimisation</p><h1 class="page-title">Ask for better. Decide when the search should stop.</h1><p class="lede">The default recommendation remains usable without this mode. Turn it on only when further measured improvement is worth additional model spend and evaluation time.</p><div class="split"><section class="panel"><div class="panel-head"><div><h2>Improvement contract</h2><p class="explain">Nothing runs when this switch is off.</p></div><label class="switch"><input id="enabled" type="checkbox" ${enabled ? "checked" : ""}><span></span></label></div><p class="field-label"><span>Improvement metrics</span><small>Target change</small></p>${objective("modelCostUsd","Model cost","Average paid-model cost per completed case",values.modelCostUsd)}${objective("medianElapsedMs","Completion speed","Median wall-clock time",values.medianElapsedMs)}${objective("outcomeScore","Outcome quality","Externally measured result quality",values.outcomeScore,"increase")}${objective("humanInterventions","Human intervention","Required approvals or corrections",values.humanInterventions)}<div class="field"><label for="budget"><span>Hard model budget</span><small>USD</small></label><input id="budget" type="number" min="0" step="0.5" value="${budget}"><small>The controller cannot purchase another call after this limit.</small></div><div class="field"><label for="minutes"><span>Maximum search time</span><small>Minutes</small></label><input id="minutes" type="number" min="1" value="${minutes}"></div><div class="field"><label for="rounds"><span>Maximum redesign rounds</span><small>1–50</small></label><input id="rounds" type="number" min="1" max="50" value="${rounds}"></div><div class="field"><span class="field-label">When should it give up?</span><div class="segmented">${profile("early","Give up early",persistence)}${profile("balanced","Balanced",persistence)}${profile("persistent","Keep searching",persistence)}</div><small>“Keep searching” still stops at the hard budget/time limit or when no reasonable path remains.</small></div><div class="actions"><button class="button primary" id="save">Save settings</button><button class="button" id="disable">Turn off</button></div><p id="form-message" class="notice"></p></section><section class="panel"><div class="panel-head"><div><h2>Run visibility</h2><p class="explain">Every design, measurement, rejection and stop reason is retained.</p></div></div><div class="run-state">${activeRun()}</div><div class="actions"><button class="button primary" id="start" ${!enabled || !state.improvementRunnerAvailable ? "disabled" : ""}>Start optional search</button></div>${!state.improvementRunnerAvailable ? `<p class="notice">The control surface is ready. Starting remains locked until the harder second-role runner is attached and locally verified.</p>` : ""}<h3 style="margin-top:36px">Completed searches</h3><div>${history.length ? history.map(receipt).join("") : `<p class="explain">No completed searches yet.</p>`}</div></section></div>`;
}

function objective(metric, label, detail, value, direction = "decrease") {
  const checked = value !== undefined;
  return `<label class="objective"><input data-objective="${metric}" data-direction="${direction}" type="checkbox" ${checked ? "checked" : ""}><span class="objective-copy"><strong>${label}</strong><small>${detail}</small></span><input data-target="${metric}" aria-label="${label} target percentage" type="number" min="0" max="95" value="${checked ? Math.round(value * 100) : 10}"></label>`;
}
function profile(value,label,current){return `<label><input type="radio" name="persistence" value="${value}" ${current===value?"checked":""}>${label}</label>`}
function activeRun(){const run=state.improvement.activeRun;if(!run)return `<div class="run-empty"><strong>Nothing is running.</strong><p>Save a contract, then explicitly start a search. Existing specialists continue operating while alternatives are evaluated.</p></div>`;return `<div class="receipt"><strong>${esc(run.status)}</strong><p>${run.events.length} recorded events · started ${esc(run.startedAt)}</p>${run.events.map((event)=>`<pre>${esc(JSON.stringify(event,null,2))}</pre>`).join("")}</div>`}
function receipt(run){const result=run.result??run;return `<article class="receipt"><div class="receipt-top"><strong>${esc(run.label??run.id)}</strong><span>${esc(run.status)}</span></div><p>${esc(result.stopReason??run.stopReason??"No stop reason recorded")}</p>${run.selectionHash?`<code>${esc(run.selectionHash)}</code>`:""}</article>`}

function rolePage() {
  const role = state.roles.find((item) => item.id === selectedRoleId) ?? state.roles[0];
  const winner = role.recommendation;
  return `<p class="kicker">Verified recommendation</p><h1 class="page-title">${esc(role.name)}</h1><p class="lede">Recommended automatically from safe finalists using the declared quality, cost, speed and escalation preferences.</p><div class="metric-row"><div class="metric"><span>Selected candidate</span><strong>${esc(winner.candidateId.split(":").at(-1))}</strong></div><div class="metric"><span>Synthetic unseen result</span><strong>${Math.round(winner.successRate*100)}%</strong></div><div class="metric"><span>Unsafe effects</span><strong>0</strong></div></div><div class="card-grid">${role.candidates.map((candidate)=>`<article class="card"><p class="kicker">${esc(candidate.id)}</p><pre>${esc(JSON.stringify(candidate,null,2))}</pre></article>`).join("")}</div>`;
}

async function saveImprovement() {
  const objectives = [...document.querySelectorAll("[data-objective]")].map((box) => ({ metric: box.dataset.objective, direction: box.dataset.direction, enabled: box.checked, minimumRelativeImprovement: Number(document.querySelector(`[data-target="${box.dataset.objective}"]`).value)/100 }));
  const payload = { enabled: document.querySelector("#enabled").checked, id: `console-${Date.now()}`, baselineId: "current-specialist", objectives, maximumModelSpendUsd: Number(document.querySelector("#budget").value), maximumWallClockMinutes: Number(document.querySelector("#minutes").value), maximumRounds: Number(document.querySelector("#rounds").value), minimumRepeatedObservations: 3, persistence: document.querySelector('[name="persistence"]:checked').value };
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
  main.innerHTML = page === "improve" ? improvement() : page === "role" ? rolePage() : overview();
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
