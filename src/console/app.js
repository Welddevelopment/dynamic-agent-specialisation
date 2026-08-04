let state;
let page = "overview";
let selectedRoleId = null;
let onboardingStep = 0;
let commercialDraft = null;
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

const onboardingSteps = ["Start", "Role", "Systems", "Rules", "Examples", "Success", "Priorities", "Review"];
const lines = (value) => String(value ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
const fieldValue = (value) => esc(value ?? "");

function initialCommercialDraft() {
  const restored = state.commercial?.selected?.intake;
  if (restored) return structuredClone(restored);
  const template = state.commercial?.templates?.[0];
  return {
    sessionId: `company-${Date.now()}`,
    company: { name: "", website: "", industry: "", operatingContext: "" },
    role: { templateId: template?.id ?? "support-operations", title: template?.defaultRoleTitle ?? "", outcome: "", completionRule: "", escalationOwner: "" },
    systems: [], knowledgeSources: [], policies: [],
    authority: { allowedActions: [], approvalActions: [], forbiddenActions: [] },
    examples: [], success: { measures: [], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "" },
    priorities: { quality: 1, cost: .25, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300000, goal: "Preserve independently verified quality, then reduce cost and speed." },
    currentAgent: { mode: "none", model: "", configurationHash: "", historicalResultsHash: "" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
}

function selectedTemplate() {
  return state.commercial.templates.find((item) => item.id === commercialDraft.role.templateId) ?? state.commercial.templates[0];
}

function inputField(id, label, value, { detail = "", type = "text", placeholder = "" } = {}) {
  return `<label class="onboarding-field" for="${id}"><span>${esc(label)}</span>${detail ? `<small>${esc(detail)}</small>` : ""}<input id="${id}" type="${type}" value="${fieldValue(value)}" placeholder="${esc(placeholder)}"></label>`;
}

function textArea(id, label, value, { detail = "", placeholder = "", rows = 5 } = {}) {
  return `<label class="onboarding-field" for="${id}"><span>${esc(label)}</span>${detail ? `<small>${esc(detail)}</small>` : ""}<textarea id="${id}" rows="${rows}" placeholder="${esc(placeholder)}">${fieldValue(value)}</textarea></label>`;
}

function roleCards() {
  return state.commercial.templates.map((template) => `<button type="button" class="role-choice ${template.id === commercialDraft.role.templateId ? "selected" : ""}" data-template="${esc(template.id)}"><span>${esc(template.name)}</span><small>${esc(template.description)}</small></button>`).join("");
}

function startStep() {
  return `<div class="onboarding-welcome"><div><h1>Describe the job.<br>We prove the employee.</h1><p>A specialist is assembled, tested against real outcomes, and recommended without asking you to choose prompts, models, memory systems, or agent frameworks.</p><button class="button primary onboarding-start" type="button">Create a specialist</button></div><div class="promise-rail"><div><span>01</span><strong>Understand the role</strong><p>Turn ordinary company information into an exact operating contract.</p></div><div><span>02</span><strong>Build serious candidates</strong><p>Vary the model, instructions, context, tools, memory, authority, verifier, cost and speed.</p></div><div><span>03</span><strong>Test before recommending</strong><p>Independent external outcomes—not the candidate itself—decide which fit is strongest.</p></div><div><span>04</span><strong>Keep you in control</strong><p>Use the recommendation by default or inspect and switch among preserved alternatives.</p></div></div></div>`;
}

function roleStep() {
  return `<div class="step-copy"><h1>What job should this AI employee own?</h1><p>Choose the closest supported role, then describe the actual result in your company’s language.</p></div><div class="role-choice-grid">${roleCards()}</div><div class="onboarding-grid two">${inputField("company-name", "Company name", commercialDraft.company.name, { placeholder: "Acme" })}${inputField("company-industry", "Industry", commercialDraft.company.industry, { placeholder: "B2B software" })}${inputField("role-title", "Role title", commercialDraft.role.title, { placeholder: "Customer support operations specialist" })}${inputField("escalation-owner", "Who owns exceptions?", commercialDraft.role.escalationOwner, { placeholder: "Head of Support" })}</div>${textArea("role-outcome", "Outcome this employee owns", commercialDraft.role.outcome, { detail: "Describe the finished business result, not a list of AI features.", placeholder: "Resolve every assigned support request correctly while protecting customer and billing data.", rows: 4 })}${textArea("operating-context", "How this work operates today", commercialDraft.company.operatingContext, { detail: "A short description is enough. The compiler will ask for missing consequential details.", placeholder: "Requests enter an assigned queue. Support can issue credits up to a delegated limit...", rows: 4 })}`;
}

function systemsStep() {
  const template = selectedTemplate();
  return `<div class="step-copy"><h1>Where does the job happen?</h1><p>Name the systems and information the specialist may need. Credentials are deliberately configured later, customer-side—they do not belong in this record.</p></div><div class="suggestion-row">${template.systemSuggestions.map((item) => `<button type="button" data-system-suggestion="${esc(item)}">+ ${esc(item)}</button>`).join("")}</div>${textArea("systems", "Systems", commercialDraft.systems.map((item) => item.name).join("\n"), { detail: "One per line. Examples: Zendesk, Stripe test account, internal policy wiki.", placeholder: template.systemSuggestions.join("\n"), rows: 7 })}${textArea("knowledge", "Knowledge and policies it reads", commercialDraft.knowledgeSources.map((item) => item.name).join("\n"), { detail: "One per line. These will be pinned and checked before a real comparison.", placeholder: "Support policy\nRefund policy\nCurrent product documentation", rows: 5 })}<div class="boundary-strip"><strong>No credentials here.</strong><span>System access remains missing until an executable customer-local adapter and separately configured secrets exist.</span></div>`;
}

function rulesStep() {
  const byKind = (kind) => commercialDraft.policies.filter((item) => item.kind === kind).map((item) => item.rule).join("\n");
  return `<div class="step-copy"><h1>What may it do—and where must it stop?</h1><p>These rules are hard boundaries. They are not soft preferences traded away for a better score.</p></div><div class="onboarding-grid three">${textArea("required-rules", "Checks it must perform", byKind("required-check"), { placeholder: "Confirm the request belongs to the assigned customer\nCheck the current incident status", rows: 7 })}${textArea("approval-rules", "Actions needing approval", byKind("approval"), { placeholder: "Credits above the delegated limit\nAny account closure", rows: 7 })}${textArea("forbidden-rules", "Actions it must never take", byKind("forbidden"), { placeholder: "Change unrelated records\nExpose protected customer data", rows: 7 })}</div><div class="onboarding-grid three">${textArea("allowed-actions", "Allowed actions", commercialDraft.authority.allowedActions.join("\n"), { placeholder: "reply-to-ticket\nissue-bounded-credit", rows: 5 })}${textArea("approval-actions", "Approval actions", commercialDraft.authority.approvalActions.join("\n"), { placeholder: "large-credit\nclose-account", rows: 5 })}${textArea("forbidden-actions", "Forbidden actions", commercialDraft.authority.forbiddenActions.join("\n"), { placeholder: "change-unrelated-record", rows: 5 })}</div>`;
}

function examplesStep() {
  return `<div class="step-copy"><h1>Show it what representative work looks like.</h1><p>Use redacted historical examples or author realistic ones. Five varied cases are the minimum for a fair comparison draft; edge cases are more valuable than five easy duplicates.</p></div>${textArea("examples", "Representative cases", commercialDraft.examples.map((item) => `${item.situation} => ${item.expected}`).join("\n"), { detail: "One case per line: situation => externally observable correct result.", placeholder: "Known outage question => Link the incident, explain status, leave ticket open\nDuplicate charge inside limit => Verify ledger, issue one credit, record reference", rows: 12 })}<div class="boundary-strip"><strong>These are inputs, not proof.</strong><span>The product has not passed a case merely because the expected answer was written here.</span></div>`;
}

function successStep() {
  return `<div class="step-copy"><h1>How will we know it genuinely succeeded?</h1><p>The AI employee cannot grade itself. Define results another checker can observe in the ticketing system, CRM, ledger, database, or approved human review.</p></div>${textArea("success-measures", "Independent success measures", commercialDraft.success.measures.join("\n"), { detail: "At least three. One per line.", placeholder: "Every assigned request has a correct terminal state\nNo unrelated record changed\nNo denied action was attempted", rows: 7 })}${inputField("verifier-owner", "Who or what checks the external result?", commercialDraft.success.owner, { placeholder: "Customer-local support test adapter" })}${textArea("completion-rule", "Completion rule", commercialDraft.role.completionRule, { placeholder: "Complete only when the independent checker confirms every assigned item; otherwise hand off precisely.", rows: 4 })}<div class="verification-diagram"><div><span>Candidate</span><strong>Acts</strong></div><i aria-hidden="true">→</i><div><span>Company system</span><strong>Changes</strong></div><i aria-hidden="true">→</i><div class="verified"><span>Independent checker</span><strong>Decides</strong></div></div>`;
}

function prioritiesStep() {
  return `<div class="step-copy"><h1>What should “best fit” mean here?</h1><p>Safety remains non-negotiable. Inside the safe candidates, tell the compiler how aggressively to trade cost and speed against outcome quality.</p></div><div class="priority-board"><label><span>Outcome quality</span><input id="quality-weight" type="range" min="0" max="100" value="${Math.round(commercialDraft.priorities.quality * 100)}"><strong>${Math.round(commercialDraft.priorities.quality * 100)}</strong></label><label><span>Lower cost</span><input id="cost-weight" type="range" min="0" max="100" value="${Math.round(commercialDraft.priorities.cost * 100)}"><strong>${Math.round(commercialDraft.priorities.cost * 100)}</strong></label><label><span>Faster completion</span><input id="speed-weight" type="range" min="0" max="100" value="${Math.round(commercialDraft.priorities.speed * 100)}"><strong>${Math.round(commercialDraft.priorities.speed * 100)}</strong></label></div><div class="onboarding-grid two">${inputField("cost-limit", "Maximum model cost per task", commercialDraft.priorities.maximumCostPerTaskUsd, { type: "number", detail: "USD hard ceiling" })}${inputField("latency-limit", "Maximum task time", Math.round(commercialDraft.priorities.maximumLatencyMs / 1000), { type: "number", detail: "seconds" })}</div><fieldset class="agent-choice"><legend>Do you already have an AI agent for this role?</legend><label><input type="radio" name="current-agent" value="none" ${commercialDraft.currentAgent.mode === "none" ? "checked" : ""}> No—create the first serious specialist</label><label><input type="radio" name="current-agent" value="import-later" ${commercialDraft.currentAgent.mode === "import-later" ? "checked" : ""}> Yes—I’ll import it before comparison</label><label><input type="radio" name="current-agent" value="provided" ${commercialDraft.currentAgent.mode === "provided" ? "checked" : ""}> Yes—its configuration is already available</label></fieldset>${commercialDraft.currentAgent.mode === "provided" ? inputField("agent-hash", "Existing configuration receipt", commercialDraft.currentAgent.configurationHash, { detail: "A hash or versioned reference—not credentials.", placeholder: "sha256:..." }) : ""}`;
}

function readinessCard(stage, label, copy) {
  if (!stage) return `<article class="readiness-card blocked"><span>Not checked</span><h3>${esc(label)}</h3><p>${esc(copy)}</p></article>`;
  const ready = stage?.ready;
  const missing = stage?.checks?.filter((item) => !item.passed).length ?? 0;
  return `<article class="readiness-card ${ready ? "ready" : "blocked"}"><span>${ready ? "Ready" : `${missing} gate${missing === 1 ? "" : "s"} open`}</span><h3>${esc(label)}</h3><p>${esc(copy)}</p></article>`;
}

function reviewStep() {
  const readiness = state.commercial?.selected?.intake?.sessionId === commercialDraft.sessionId ? state.commercial.selected.readiness : null;
  const template = selectedTemplate();
  const questions = readiness?.questions ?? [];
  return `<div class="step-copy"><h1>Review the role before any comparison runs.</h1><p>The system can recommend autonomously, but it will not pretend that an incomplete role description is evidence.</p></div><div class="review-bento"><article class="review-role"><span>Role contract</span><h2>${esc(commercialDraft.role.title || template.name)}</h2><p>${esc(commercialDraft.role.outcome || "Outcome still missing")}</p><dl><div><dt>Company</dt><dd>${esc(commercialDraft.company.name || "Missing")}</dd></div><div><dt>Systems</dt><dd>${commercialDraft.systems.length}</dd></div><div><dt>Rules</dt><dd>${commercialDraft.policies.length}</dd></div><div><dt>Cases</dt><dd>${commercialDraft.examples.length}</dd></div></dl></article><div class="review-readiness">${readinessCard(readiness?.stages?.draft, "Design preview", "A precise role and candidate plan can be drafted.")}${readinessCard(readiness?.stages?.comparison, "Ready for comparison", "The role is defined well enough to test candidates fairly; no result is implied.")}${readinessCard(readiness?.stages?.activation, "Controlled activation", "Every system path and independent checker is executable.")}</div><article class="review-boundary"><strong>What saving does</strong><p>It versions this role contract and calculates readiness. It does not call a model, spend money, run a comparison, or activate an employee.</p></article><article class="review-authority"><strong>Hard authority boundary</strong><p>${commercialDraft.authority.allowedActions.length} allowed · ${commercialDraft.authority.approvalActions.length} approval-bound · ${commercialDraft.authority.forbiddenActions.length} forbidden action classes.</p></article></div>${questions.length ? `<div class="question-list"><h3>Still needed</h3>${questions.slice(0, 8).map((item) => `<button type="button" data-question-stage="${esc(item.stage)}"><span>${esc(item.question)}</span><small>${esc(item.stage)}</small></button>`).join("")}</div>` : ""}<div class="review-actions"><button class="button primary" type="button" id="save-commercial">Save and check readiness</button><span id="commercial-message"></span></div>`;
}

function createSpecialist() {
  const content = [startStep, roleStep, systemsStep, rulesStep, examplesStep, successStep, prioritiesStep, reviewStep][onboardingStep]();
  return `<section class="onboarding"><div class="onboarding-head"><div><p>Specialist creation</p><strong>${onboardingStep === 0 ? "Start with the job" : onboardingSteps[onboardingStep]}</strong></div><span>${Math.max(0, onboardingStep)} / 7</span></div><div class="step-track">${onboardingSteps.map((label, index) => `<button type="button" data-onboarding-step="${index}" class="${index === onboardingStep ? "active" : ""} ${index < onboardingStep ? "complete" : ""}"><i></i><span>${esc(label)}</span></button>`).join("")}</div><div class="onboarding-stage">${content}</div>${onboardingStep > 0 && onboardingStep < 7 ? `<div class="onboarding-actions"><button type="button" class="button" id="previous-step">Back</button><button type="button" class="button primary" id="next-step">Continue</button></div>` : ""}</section>`;
}

function animateCreatePage() {
  if (page !== "create" || !globalThis.gsap) return;
  if (globalThis.ScrollTrigger) {
    globalThis.gsap.registerPlugin(globalThis.ScrollTrigger);
    globalThis.ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
  }
  const title = document.querySelector(".onboarding-welcome h1, .step-copy h1");
  if (title) globalThis.gsap.fromTo(title, { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: .72, ease: "power3.out" });
  const welcomeCards = document.querySelectorAll(".promise-rail > div");
  if (welcomeCards.length) globalThis.gsap.fromTo(welcomeCards, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: .6, stagger: .08, ease: "power2.out" });
  const reviewCards = document.querySelectorAll(".review-bento > *");
  if (reviewCards.length) globalThis.gsap.fromTo(reviewCards, { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: .58, stagger: .09, ease: "power3.out" });
  const explanatoryCopy = document.querySelector(".step-copy p");
  if (explanatoryCopy && globalThis.ScrollTrigger) globalThis.gsap.fromTo(explanatoryCopy, { opacity: .28 }, { opacity: 1, scrollTrigger: { trigger: explanatoryCopy, start: "top 92%", end: "bottom 72%", scrub: .4 } });
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

function harvestCommercialStep() {
  const value = (id) => document.querySelector(`#${id}`)?.value?.trim() ?? "";
  if (onboardingStep === 1) {
    commercialDraft.company.name = value("company-name");
    commercialDraft.company.industry = value("company-industry");
    commercialDraft.company.operatingContext = value("operating-context");
    commercialDraft.role.title = value("role-title");
    commercialDraft.role.outcome = value("role-outcome");
    commercialDraft.role.escalationOwner = value("escalation-owner");
  }
  if (onboardingStep === 2) {
    commercialDraft.systems = lines(value("systems")).map((name, index) => ({ id: `system-${index + 1}`, name, kind: "customer system", access: "none", adapterStatus: "missing", contextSources: [], tools: [] }));
    commercialDraft.knowledgeSources = lines(value("knowledge")).map((name, index) => ({ id: `knowledge-${index + 1}`, name, kind: "customer knowledge", contentHash: "", current: true }));
  }
  if (onboardingStep === 3) {
    commercialDraft.policies = [
      ...lines(value("required-rules")).map((rule) => ({ rule, kind: "required-check", consequential: true, confirmed: true })),
      ...lines(value("approval-rules")).map((rule) => ({ rule, kind: "approval", consequential: true, confirmed: true })),
      ...lines(value("forbidden-rules")).map((rule) => ({ rule, kind: "forbidden", consequential: true, confirmed: true })),
    ];
    commercialDraft.authority.allowedActions = lines(value("allowed-actions"));
    commercialDraft.authority.approvalActions = lines(value("approval-actions"));
    commercialDraft.authority.forbiddenActions = lines(value("forbidden-actions"));
  }
  if (onboardingStep === 4) {
    commercialDraft.examples = lines(value("examples")).map((line) => {
      const divider = line.indexOf("=>");
      return { situation: divider >= 0 ? line.slice(0, divider).trim() : line, expected: divider >= 0 ? line.slice(divider + 2).trim() : "", source: "customer-authored", redacted: true };
    }).filter((item) => item.situation && item.expected);
  }
  if (onboardingStep === 5) {
    commercialDraft.success.measures = lines(value("success-measures"));
    commercialDraft.success.owner = value("verifier-owner");
    commercialDraft.success.verifierMode = "independent-external-state";
    commercialDraft.success.verifierStatus = "declared";
    commercialDraft.role.completionRule = value("completion-rule");
  }
  if (onboardingStep === 6) {
    commercialDraft.priorities.quality = Number(value("quality-weight")) / 100;
    commercialDraft.priorities.cost = Number(value("cost-weight")) / 100;
    commercialDraft.priorities.speed = Number(value("speed-weight")) / 100;
    commercialDraft.priorities.maximumCostPerTaskUsd = Number(value("cost-limit"));
    commercialDraft.priorities.maximumLatencyMs = Number(value("latency-limit")) * 1000;
    commercialDraft.currentAgent.mode = document.querySelector('[name="current-agent"]:checked')?.value ?? "none";
    commercialDraft.currentAgent.configurationHash = value("agent-hash");
  }
}

function bindCommercial() {
  if (page !== "create") return;
  document.querySelector(".onboarding-start")?.addEventListener("click", () => { onboardingStep = 1; render(); });
  document.querySelectorAll("[data-onboarding-step]").forEach((button) => button.addEventListener("click", () => { harvestCommercialStep(); onboardingStep = Number(button.dataset.onboardingStep); render(); }));
  document.querySelectorAll("[data-template]").forEach((button) => button.addEventListener("click", () => {
    commercialDraft.role.templateId = button.dataset.template;
    const template = selectedTemplate();
    commercialDraft.role.title = template.defaultRoleTitle;
    if (!commercialDraft.role.outcome) commercialDraft.role.outcome = template.defaultOutcome;
    render();
  }));
  document.querySelectorAll("[data-system-suggestion]").forEach((button) => button.addEventListener("click", () => {
    const input = document.querySelector("#systems");
    const existing = new Set(lines(input.value));
    existing.add(button.dataset.systemSuggestion);
    input.value = [...existing].join("\n");
  }));
  ["quality-weight", "cost-weight", "speed-weight"].forEach((id) => document.querySelector(`#${id}`)?.addEventListener("input", (event) => { event.target.nextElementSibling.textContent = event.target.value; }));
  document.querySelectorAll('[name="current-agent"]').forEach((input) => input.addEventListener("change", () => { harvestCommercialStep(); render(); }));
  document.querySelector("#previous-step")?.addEventListener("click", () => { harvestCommercialStep(); onboardingStep = Math.max(1, onboardingStep - 1); render(); });
  document.querySelector("#next-step")?.addEventListener("click", () => { harvestCommercialStep(); onboardingStep = Math.min(7, onboardingStep + 1); render(); });
  document.querySelector("#save-commercial")?.addEventListener("click", async () => {
    const message = document.querySelector("#commercial-message");
    message.textContent = "Saving role contract…";
    try {
      const result = await request("/api/commercial/intake", { method: "POST", body: JSON.stringify(commercialDraft) });
      state.commercial = result.commercial;
      commercialDraft = structuredClone(result.saved.intake);
      render();
      document.querySelector("#commercial-message").textContent = "Saved. No model calls or comparison were started.";
    } catch (error) { message.textContent = error.message; message.classList.add("error"); }
  });
}

async function saveImprovement() {
  const objectives = [...document.querySelectorAll("[data-objective]")].map((box) => ({ metric: box.dataset.objective, direction: box.dataset.direction, enabled: box.checked, minimumRelativeImprovement: Number(document.querySelector(`[data-target="${box.dataset.objective}"]`).value)/100 }));
  const payload = { enabled: document.querySelector("#enabled").checked, id: `console-${Date.now()}`, baselineId: "current-specialist", objectives, minimumPassRate: Number(document.querySelector("#pass-floor").value)/100, minimumOutcomeScoreRatio: Number(document.querySelector("#outcome-floor").value)/100, maximumModelSpendUsd: Number(document.querySelector("#budget").value), maximumWallClockMinutes: Number(document.querySelector("#minutes").value), maximumRounds: Number(document.querySelector("#rounds").value), maximumRefinementsPerRound: Number(document.querySelector("#refinements").value), minimumRepeatedObservations: Number(document.querySelector("#repeats").value), persistence: document.querySelector('[name="persistence"]:checked').value };
  const message = document.querySelector("#form-message");
  try { state = await request("/api/improvement/configure", { method: "POST", body: JSON.stringify(payload) }); message.textContent = "Saved. No model calls were started."; nav(); }
  catch (error) { message.textContent = error.message; message.classList.add("error"); }
}

function bind() {
  bindCommercial();
  if (page !== "improve") return;
  document.querySelector("#save").onclick = saveImprovement;
  document.querySelector("#disable").onclick = async () => { state = await request("/api/improvement/disable", { method: "POST", body: "{}" }); render(); nav(); };
  document.querySelector("#start").onclick = async () => { try { state = await request("/api/improvement/start", { method: "POST", body: JSON.stringify({ confirmation: "START_OPTIONAL_IMPROVEMENT" }) }); render(); } catch (error) { document.querySelector("#form-message").textContent = error.message; } };
}

function render() {
  main.innerHTML = page === "create" ? createSpecialist() : page === "improve" ? improvement() : page === "lifecycle" ? lifecycle() : page === "role" ? rolePage() : overview();
  main.classList.remove("flash");
  requestAnimationFrame(() => main.classList.add("flash"));
  requestAnimationFrame(animateCreatePage);
  bind();
}

state = await request("/api/state");
commercialDraft = initialCommercialDraft();
selectedRoleId = state.roles[0]?.id;
document.querySelector("#boundary").textContent = state.boundary;
document.querySelector("#evidence-state").textContent = state.evidenceValid ? "Valid" : "Invalid";
nav();
render();
setInterval(async()=>{if(!state.improvement.activeRun)return;try{state=await request("/api/state");nav();render()}catch{}},1000);
