import { buildAssistedOnboardingProjection } from "./assisted-onboarding-projection.js";

let state;
let page = "overview";
let selectedRoleId = null;
let onboardingStep = 0;
let commercialDraft = null;
let selectedCommercialRoleId = "support";
let systemImportResult = null;
let systemImportReviewResult = null;
let systemImportDraft = null;
let roleDiscoveryDraft = { description: "", companyName: "", industry: "", operatingContext: "", includeRecordedSystemProposals: true };
let roleDiscoveryResult = null;
let roleDiscoveryHandoffNotice = null;
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
  return `<p class="kicker">Autonomous recommendation · human control on demand</p><h1 class="page-title">Build the strongest specialist you can actually prove.</h1><p class="lede">The compiler designs candidates, tests them against external outcomes, recommends the strongest measured fit, and keeps every serious alternative inspectable. Further self-improvement is optional and budget-bound.</p><div class="metric-row"><div class="metric"><span>Reference roles</span><strong>${state.roles.length}</strong></div><div class="metric"><span>Evidence chain</span><strong>${state.evidenceValid ? "Valid" : "Invalid"}</strong></div><div class="metric"><span>Latest paid experiment</span><strong>${historical ? `$${historical.spendUsd.toFixed(2)}` : "None"}</strong></div></div>${level1Decisions()}${scoreboards()}${historical ? `<div class="card"><p class="kicker">Latest honest decision</p><h2>${esc(historical.label)}</h2><p>${esc(String(historical.result).replace(/\.\s*$/, ""))}. ${esc(String(historical.stopReason).replace(/\.\s*$/, ""))}.</p><p class="explain">${esc(historical.boundary)}</p></div>` : ""}`;
}


function level1Decisions() {
  const closeout = state.product?.level1;
  if (!closeout?.selections?.length) return "";
  const label = { "activate-compiler-specialist": ["Activated", "activated"], "retain-existing-specialist": ["Kept existing", "retained"], "retain-existing-unproved-upgrade": ["Kept existing", "retained"] };
  const roleName = (id) => String(id).replace(/^realistic-/, "").replace(/-specialist$/, "").replaceAll("-", " ");
  const rows = closeout.selections.map((s) => {
    const [text, cls] = label[s.decision] ?? [s.decision, "other"];
    return `<article class="decision-row ${cls}"><div class="decision-role"><span class="kicker">Role</span><strong>${esc(roleName(s.roleId))}</strong></div><div class="decision-outcome"><span class="kicker">Decision</span><strong>${esc(text)}</strong><small>${esc(s.candidateId)} · v${esc(s.candidateVersion)}</small></div><div class="decision-alts"><span class="kicker">Alternatives kept</span><strong>${s.alternativesPreserved}</strong></div><code title="Record hash">${esc(String(s.recordHash).slice(0, 16))}…</code></article>`;
  }).join("");
  const activated = closeout.selections.filter((s) => s.decision === "activate-compiler-specialist").length;
  return `<section class="decisions"><div class="decisions-head"><p class="kicker">Level 1 decisions · from the sealed closeout record</p><h2>${activated} activated. ${closeout.selections.length - activated} kept the existing agent.</h2><p class="explain">"Keep what you have" is a first-class outcome. Each row is bound to a hashed selection record; the exact numbers behind each decision are in <code>reports/</code>.</p></div>${rows}</section>`;
}

function scoreboards() {
  const boards = (state.product?.scoreboards ?? []).filter((b) => b.available);
  if (!boards.length) return "";
  const usd = (v) => v == null ? "—" : `$${Number(v).toFixed(4)}`;
  const cards = boards.map((b) => {
    const rows = [...b.arms].sort((x, y) => (y.passed / y.total) - (x.passed / x.total) || (x.costUsd ?? 0) - (y.costUsd ?? 0)).map((a) => `<div class="sb-row ${a.kind}"><span class="sb-name" title="${esc(a.candidateId)}">${esc(String(a.candidateId).replace(/^(support-|revops-|rps-)/, "").slice(0, 44))}</span><strong>${a.passed}/${a.total}</strong><span>${a.unsafeAttempts ?? "—"} unsafe</span><span>${usd(a.costUsd)}</span></div>`).join("");
    return `<article class="sb-card"><header><strong>${esc(b.label)}</strong><small>${esc(b.stage)}</small></header><div class="sb-rows"><div class="sb-row sb-head"><span>Arm</span><strong>Pass</strong><span>Safety</span><span>Cost</span></div>${rows}</div><footer><code>${esc(b.source)}</code><span>${esc(b.report)}</span></footer></article>`;
  }).join("");
  return `<section class="scoreboards"><div class="decisions-head"><p class="kicker">Head-to-head · one artifact per role, rendered verbatim</p><h2>The numbers behind each decision.</h2><p class="explain">Compiler arms are marked green, baselines grey. Each card names its exact source file and stage. Report totals that sum across stages (e.g. a 13/13) are deliberately not recomputed here.</p></div><div class="sb-grid">${cards}</div></section>`;
}

function comparisonStage(label, count, copy, stateClass = "") {
  return `<article class="comparison-stage ${stateClass}"><span>${count}</span><div><strong>${esc(label)}</strong><p>${esc(copy)}</p></div></article>`;
}

function comparisonPage() {
  const products = state.commercialProducts?.length ? state.commercialProducts : [state.commercialProduct].filter(Boolean);
  const product = products.find((item) => item.id === selectedCommercialRoleId) ?? products[0];
  if (!product?.contract || !product.receipt) return `<p class="kicker">Commercial comparison</p><h1 class="page-title">No executable role pack is prepared.</h1><p class="lede">Complete onboarding and connect a bounded test environment before a comparison can be frozen.</p>`;
  const contract = product.contract;
  const receipt = product.receipt;
  const selected = product.bundle?.selected;
  const statusTitle = product.status === "controlled-active" ? "Controlled activation recorded" : product.status === "recommended" ? "Recommendation ready" : product.status === "comparison-complete" ? "Comparison complete" : "Ready for a model campaign";
  const roleTabs = products.map((item) => `<button type="button" class="comparison-role-tab ${item.id === product.id ? "active" : ""}" data-commercial-role="${esc(item.id)}"><span>${esc(item.name)}</span><small>${esc(item.status.replaceAll("-", " "))}</small></button>`).join("");
  const candidates = product.participants.map((item) => `<article class="candidate-slice" tabindex="0"><div><span>${esc(item.type.replaceAll("-", " "))}</span><strong>${esc(item.label)}</strong></div><div class="candidate-detail"><p>${esc(item.model?.family ?? "Configuration frozen")}</p><code>${esc(item.configurationHash.slice(0, 16))}…</code></div></article>`).join("");
  const controls = receipt.shortcutControls.map((item) => `<article><span>${Math.round(item.successRate * 100)}%</span><strong>${esc(item.strategyId.replaceAll("-", " "))}</strong><p>${item.passed}/${item.total} cases passed. The verifier rejected the shortcut.</p></article>`).join("");
  return `<section class="comparison-workspace">
    <header class="comparison-hero"><div><p class="kicker">Commercial comparison</p><h1>Proof before replacement.</h1></div><div><p>The current agent, serious manual baselines and compiler candidates face the same frozen job. The candidate cannot grade itself, and an upgrade is recommended only when the agreed improvement is proved.</p><strong>${esc(statusTitle)}</strong></div></header>
    <nav class="comparison-role-tabs" aria-label="Executable commercial role packs">${roleTabs}</nav>
    <div class="comparison-bento">
      <article class="comparison-role"><span>Frozen role</span><h2>${esc(product.title)}</h2><p>${esc(product.outcome)}</p><dl><div><dt>Driver</dt><dd>${esc(contract.driver.id)}</dd></div><div><dt>Verifier</dt><dd>Independent external state</dd></div></dl></article>
      <article class="comparison-status"><span>${esc(product.status.replaceAll("-", " "))}</span><strong>${receipt.deterministicReference.passed}/${receipt.deterministicReference.total}</strong><p>Deterministic reference cases passed before model spend.</p><small>Unseen release count ${receipt.unseenReleaseCount}</small></article>
      ${comparisonStage("Development", contract.cases.development, "Candidates may learn only from these released cases.", "released")}
      ${comparisonStage("Validation", contract.cases.validation, "Safe complete performance is required to advance.")}
      ${comparisonStage("Adversarial", contract.cases.adversarial, "Incorrect side effects eliminate a candidate immediately.")}
    </div>
    <section class="candidate-section"><div class="comparison-section-copy"><p class="kicker">Serious alternatives</p><h2>The system chooses.<br>You can inspect.</h2><p>Every candidate is preserved with its exact model and configuration receipt. Hover or focus to expand; no manual selection is required.</p></div><div class="candidate-accordion">${candidates}</div></section>
    <section class="comparison-evidence"><div class="comparison-section-copy sticky-copy"><p class="kicker">Independent test-world check</p><h2>Easy-looking shortcuts fail.</h2><p>A realistic environment is useful only if it can reject plausible but wrong behavior.</p></div><div class="evidence-stack"><article class="evidence-lead"><span>Reference path</span><strong>${receipt.deterministicReference.passed}/${receipt.deterministicReference.total}</strong><p>All intended cases passed with no model call and no unseen release.</p></article>${controls}</div></section>
    <section class="comparison-action"><div><span>Frozen improvement promise</span><h2>Match verified quality. Reduce cost and speed by 10%.</h2><p>Safety and incorrect-side-effect limits remain zero. Three fresh repeat runs are required before activation.</p></div><div class="comparison-actions"><button class="button primary" disabled>${selected ? "Recommendation prepared" : "Paid comparison not authorized"}</button><a class="button" href="/api/commercial/${esc(product.id)}/contract" target="_blank" rel="noreferrer">Open frozen contract</a><a class="button" href="/api/commercial/${esc(product.id)}/participants" target="_blank" rel="noreferrer">Inspect participants</a></div></section>
    <p class="comparison-boundary">${esc(product.boundary)}</p>
  </section>`;
}

function animateComparisonPage() {
  if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (page !== "comparison" || !globalThis.gsap) return;
  gsap.from(".comparison-hero > *", { y: 24, opacity: 0, duration: .75, stagger: .1, ease: "power3.out" });
  gsap.from(".comparison-bento > *", { y: 20, opacity: 0, duration: .65, stagger: .07, delay: .12, ease: "power3.out" });
  if (globalThis.ScrollTrigger) {
    gsap.utils.toArray(".evidence-stack > article").forEach((card, index) => gsap.from(card, { y: 34 + index * 8, scrollTrigger: { trigger: card, start: "top 88%", end: "top 58%", scrub: .45 } }));
  }
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

function discoveryValue(value) {
  if (value === null || value === undefined || value === "") return "Unknown — not invented";
  if (Array.isArray(value)) return value.join(" · ");
  if (typeof value === "object") return Object.entries(value).map(([key, child]) => `${key}: ${Array.isArray(child) ? child.join(", ") : child}`).join(" · ");
  return String(value);
}

function discoveryFactGroup(title, tone, facts) {
  return `<article class="discovery-fact-group ${tone}"><header><span>${esc(title)}</span><strong>${facts.length}</strong></header><div>${facts.map((fact) => `<section><div><strong>${esc(fact.label)}</strong><small>${esc(fact.status.replaceAll("-", " "))}</small></div><p>${esc(discoveryValue(fact.value))}</p><footer><span>${fact.provenance.map((item) => `${item.sourceKind} · ${item.label}`).map(esc).join(" / ")}</span>${fact.customerConfirmationRequired ? "<b>Customer confirmation required</b>" : fact.independentVerificationRequired ? "<b>Independent evidence required</b>" : fact.reviewRequired ? "<b>Review required</b>" : ""}</footer></section>`).join("")}</div></article>`;
}

function roleDiscoveryResultSurface(result) {
  if (!result) return "";
  const confidence = result.roleFamily.confidence == null ? "Unscored" : `${Math.round(result.roleFamily.confidence * 100)}% structural match`;
  const recorded = result.recordedSystemProposals.included ? `${result.recordedSystemProposals.count} recorded schema proposal${result.recordedSystemProposals.count === 1 ? "" : "s"} included server-side` : "No recorded schema proposals included";
  const additionalWarnings = result.warnings.filter((warning) => warning !== result.previewWarning);
  const handoffLabel = result.safeHandoff.permitted ? "Continue to structured setup" : result.roleFamily.supported ? "Clarification required before handoff" : "Unsupported preview · structured choice required";
  return `<section class="discovery-result" aria-live="polite"><header class="discovery-result-head"><div><p>Provisional role family</p><h3>${esc(result.roleFamily.label)}</h3><span>${esc(result.status.replaceAll("-", " "))} · ${esc(confidence)}</span></div><div class="discovery-usage"><strong>0</strong><span>model calls<br>external requests<br>dollars spent</span></div></header><div class="discovery-preview-warning"><strong>Deterministic preview</strong><span>${esc(result.previewWarning)}</span></div>${additionalWarnings.length ? `<div class="discovery-warning-list">${additionalWarnings.map((warning) => `<p>${esc(warning)}</p>`).join("")}</div>` : ""}<div class="discovery-fact-grid">${discoveryFactGroup("Safely proposable", "proposable", result.factGroups.safelyProposable)}${discoveryFactGroup("Needs your confirmation", "consequential", result.factGroups.consequentialConfirmation)}${discoveryFactGroup("Needs executable evidence", "evidence", result.factGroups.executableEvidence)}</div><div class="discovery-next-grid"><article><header><span>Prioritized clarification queue</span><strong>${result.clarificationQueue.length}</strong></header><ol>${result.clarificationQueue.map((item) => `<li><span>${String(item.rank).padStart(2, "0")}</span><div><strong>${esc(item.question)}</strong><small>Blocks ${item.blocks.map((block) => esc(block.replaceAll("-", " "))).join(" · ")}</small></div></li>`).join("")}</ol></article><article><header><span>Engineering blockers</span><strong>${result.engineeringBlockers.length}</strong></header><ul>${result.engineeringBlockers.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></article></div><div class="discovery-boundary"><div><strong>Zero authority · non-executable</strong><p>${esc(result.evidenceBoundary)}</p><small>${esc(recorded)}. ${esc(result.recordedSystemProposals.boundary)}</small></div><button class="button primary" id="continue-discovery" type="button" ${result.safeHandoff.permitted ? "" : "disabled"}>${esc(handoffLabel)}</button></div></section>`;
}

function startStep() {
  const recordedProposalCount = state.commercial?.assistedOnboarding?.generated?.systemImportProposals ?? 0;
  return `<div class="onboarding-welcome"><div><h1>Describe the job.<br>We prove the employee.</h1><p>A specialist is assembled, tested against real outcomes, and recommended without asking you to choose prompts, models, memory systems, or agent frameworks.</p><div class="assisted-mode-note"><strong>Assisted pilot</strong><span>You supply business truth and sandbox or schema material. DAS prepares the bounded setup and makes the remaining engineering work explicit. This is not self-serve activation.</span></div><button class="button onboarding-start" type="button">Use the structured 8-step setup</button></div><div class="promise-rail"><div><span>01</span><strong>Understand the role</strong><p>Turn ordinary company information into an exact operating contract.</p></div><div><span>02</span><strong>Build serious candidates</strong><p>Vary the model, instructions, context, tools, memory, authority, verifier, cost and speed.</p></div><div><span>03</span><strong>Test before recommending</strong><p>Independent external outcomes—not the candidate itself—decide which fit is strongest.</p></div><div><span>04</span><strong>Keep you in control</strong><p>Use the recommendation by default or inspect and switch among preserved alternatives.</p></div></div></div><section class="plain-discovery"><header><div><p>Local role discovery preview</p><h2>Start in ordinary language.</h2><span>Describe the work as you would to a new colleague. This zero-cost preview proposes structure and asks what matters next; it does not understand arbitrary roles or skip the trusted setup gates.</span></div><strong>Preview<br>not proof</strong></header><div class="plain-discovery-form"><label class="onboarding-field discovery-description"><span>What should this AI employee own?</span><textarea id="discovery-description" rows="7" placeholder="Handle assigned customer support tickets, resolve routine billing and incident questions, and escalate anything outside its authority.">${fieldValue(roleDiscoveryDraft.description)}</textarea><small>Ordinary language only. Do not paste credentials, secrets, or unapproved customer data.</small></label><div class="discovery-context-grid">${inputField("discovery-company", "Company name (optional)", roleDiscoveryDraft.companyName, { placeholder: "Acme" })}${inputField("discovery-industry", "Industry (optional)", roleDiscoveryDraft.industry, { placeholder: "B2B software" })}${textArea("discovery-context", "How this work operates today (optional)", roleDiscoveryDraft.operatingContext, { placeholder: "Requests arrive in an assigned queue and routine cases follow an approved policy…", rows: 4 })}</div></div>${recordedProposalCount ? `<label class="discovery-recorded-proposals"><input id="discovery-use-recorded" type="checkbox" ${roleDiscoveryDraft.includeRecordedSystemProposals ? "checked" : ""}><span>Include ${recordedProposalCount} integrity-checked OpenAPI/MCP proposal${recordedProposalCount === 1 ? "" : "s"} already recorded in the selected local session.</span></label>` : ""}<div class="plain-discovery-actions"><button class="button primary" id="preview-discovery" type="button">Generate zero-cost preview</button><span id="discovery-message">No model call, network request, authority, save, comparison, or activation.</span></div>${roleDiscoveryResultSurface(roleDiscoveryResult)}</section>`;
}

function roleStep() {
  const discoveryNotice = roleDiscoveryHandoffNotice ? `<div class="discovery-handoff-notice"><strong>Editable preview draft</strong><span>${esc(roleDiscoveryHandoffNotice)} Review every populated field below. Continuing does not confirm the proposal, grant authority, save a role, or make any system executable.</span></div>` : "";
  return `<div class="step-copy"><h1>What job should this AI employee own?</h1><p>Choose the closest supported role, then describe the actual result in your company’s language.</p></div>${discoveryNotice}<div class="role-choice-grid">${roleCards()}</div><div class="onboarding-grid two">${inputField("company-name", "Company name", commercialDraft.company.name, { placeholder: "Acme" })}${inputField("company-industry", "Industry", commercialDraft.company.industry, { placeholder: "B2B software" })}${inputField("role-title", "Role title", commercialDraft.role.title, { placeholder: "Customer support operations specialist" })}${inputField("escalation-owner", "Who owns exceptions?", commercialDraft.role.escalationOwner, { placeholder: "Head of Support" })}</div>${textArea("role-outcome", "Outcome this employee owns", commercialDraft.role.outcome, { detail: "Describe the finished business result, not a list of AI features.", placeholder: "Resolve every assigned support request correctly while protecting customer and billing data.", rows: 4 })}${textArea("operating-context", "How this work operates today", commercialDraft.company.operatingContext, { detail: "A short description is enough. The compiler will ask for missing consequential details.", placeholder: "Requests enter an assigned queue. Support can issue credits up to a delegated limit...", rows: 4 })}`;
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
  return `<article class="readiness-card ${ready ? "ready" : "blocked"}"><span>${ready ? "Complete" : `${missing} gate${missing === 1 ? "" : "s"} open`}</span><h3>${esc(label)}</h3><p>${esc(copy)}</p></article>`;
}

function setupStage(stage, index) {
  const evidence = stage.evidence.length ? `<ul>${stage.evidence.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "";
  const blockers = stage.blockers.length ? `<div class="setup-stage-blockers">${stage.blockers.map((item) => `<span>${esc(item)}</span>`).join("")}</div>` : "";
  return `<article class="setup-stage setup-stage-${esc(stage.status)}" data-setup-stage="${esc(stage.id)}"><div class="setup-stage-index"><span>${String(index + 1).padStart(2, "0")}</span><i aria-hidden="true"></i></div><div class="setup-stage-copy"><div><strong>${esc(stage.label)}</strong><small>${esc(stage.owner)}</small></div><p>${esc(stage.summary)}</p>${evidence}${blockers}${stage.nextAction ? `<footer><b>Next</b><span>${esc(stage.nextAction)}</span></footer>` : ""}</div></article>`;
}

function responsibilityLane(title, ownerClass, rows) {
  return `<article class="setup-lane ${ownerClass}"><header><span>${esc(title)}</span><strong>${rows.length}</strong></header><div>${rows.map((item) => `<p><span>${esc(item.label)}</span><small>${esc(item.status)}</small></p>`).join("")}</div></article>`;
}

function systemImportPanel(selected, projection) {
  const systems = selected?.intake?.systems ?? [];
  const selectedSessionMatches = selected?.sessionId === commercialDraft.sessionId;
  const unavailable = !selectedSessionMatches || systems.length === 0;
  const matchingResult = systemImportResult?.sessionId === projection.session.id ? systemImportResult : null;
  const matchingReview = systemImportReviewResult?.sessionId === projection.session.id ? systemImportReviewResult : null;
  const targetOptions = (operation) => matchingResult.review.targetOperations.filter((target) => operation.proposedMode === "review-required" || target.mode === operation.proposedMode).map((target) => `<option value="${esc(target.exposedName)}" ${operation.suggestion.targetExposedName === target.exposedName ? "selected" : ""}>${esc(target.exposedName)} · ${esc(target.mode)}</option>`).join("");
  const authorityOptions = (operation) => `<option value="">No write authority mapping</option>${(matchingResult?.review.authorityActions ?? []).map((item) => `<option value="${esc(item.action)}" ${operation.suggestion.authorityAction === item.action ? "selected" : ""}>${esc(item.action)} · ${esc(item.classification.replaceAll("-", " "))}</option>`).join("")}`;
  const operationReview = (operation) => `<article class="system-import-review-operation" data-import-operation="${esc(operation.sourceName)}"><header><label><input type="checkbox" data-import-approve checked><span>Approve for engineering</span></label><strong>${esc(operation.sourceName)}</strong></header><p class="system-import-assistance">DAS proposal · ${esc(operation.suggestion.targetStatus.replaceAll("-", " "))} · customer confirmation required</p><div class="system-import-review-fields"><label><span>Map to saved role operation</span><select data-import-target>${targetOptions(operation)}</select></label><label><span>Confirm read/write meaning</span><select data-import-mode><option value="read" ${operation.suggestion.confirmedMode === "read" ? "selected" : ""}>read</option><option value="write" ${operation.suggestion.confirmedMode === "write" ? "selected" : ""}>write</option></select></label><label><span>Existing authority boundary</span><select data-import-authority>${authorityOptions(operation)}</select></label><label><span>Required approved context</span><textarea data-import-context rows="3">${esc(operation.suggestion.requiredContextSources.join("\n"))}</textarea></label></div><div class="system-import-safety-proposals"><span>Idempotency: ${esc(operation.suggestion.idempotencyStatus.replaceAll("-", " "))}</span><span>Read-back: ${esc(operation.suggestion.reconciliationStatus.replaceAll("-", " "))}</span></div><label class="system-import-rejection"><span>If rejected, why?</span><input data-import-rejection placeholder="Not needed for this bounded role"></label></article>`;
  const reviewMarkup = matchingResult && !matchingReview ? `<section class="system-import-review" aria-label="Review imported operations"><header><div><span>Consequential review</span><h4>Map source operations to the saved role.</h4><p>Every approval is bound to this schema and this intake. A write can map only to authority already declared in the saved role; this never grants runtime authority.</p></div><strong>Still non-executable</strong></header><div class="system-import-context-review"><strong>Approved context inventory</strong>${matchingResult.review.contextSources.map((sourceId) => `<label><input type="checkbox" data-import-context-approval value="${esc(sourceId)}" checked><span>${esc(sourceId)}</span></label>`).join("")}</div><div class="system-import-review-list">${matchingResult.operations.map(operationReview).join("")}</div><div class="system-import-review-actions"><label><span>Reviewer</span><input id="system-import-reviewer" placeholder="Role owner or accountable reviewer"></label><button class="button primary" id="confirm-system-import" type="button">Confirm review + create work plan</button><span id="system-import-review-message">No credentials, execution, model call, or activation.</span></div></section>` : "";
  const reviewResultMarkup = matchingReview ? `<section class="system-import-work-plan" aria-live="polite"><header><div><span>Reviewed work plan</span><h4>${esc(matchingReview.system.name)}</h4></div><strong>${Math.round(matchingReview.setupCoverage.completionRatio * 100)}% of explicit setup fields generated or confirmed</strong></header><div class="system-import-work-plan-metrics"><article><span>Generated / confirmed</span><strong>${matchingReview.setupCoverage.generatedOrCustomerConfirmed}</strong></article><article><span>Engineering / proof remaining</span><strong>${matchingReview.setupCoverage.remainingEngineerOrIndependentProof}</strong></article><article><span>Executable operations</span><strong>0</strong></article></div><details><summary>Inspect exact remaining work</summary><ol>${matchingReview.exactRemainingWork.map((item) => `<li><span>${esc(item.owner)}</span><p>${esc(item.detail)}</p></li>`).join("")}</ol></details><footer><strong>Execution remains blocked</strong><p>${esc(matchingReview.evidenceBoundary)}</p></footer></section>` : "";
  const resultMarkup = matchingResult ? `<section class="system-import-result" aria-live="polite"><header><div><span>${matchingReview ? "Review confirmed" : "Review required"}</span><h4>${esc(matchingResult.system.name)}</h4></div><strong>${matchingResult.operationCount} operation${matchingResult.operationCount === 1 ? "" : "s"} proposed</strong></header><div class="system-import-operation-list">${matchingResult.operations.map((operation) => `<article><div><strong>${esc(operation.proposedExposedName)}</strong><small>${esc(operation.sourceName)}</small></div><span class="operation-mode">${esc(operation.proposedMode)}</span><dl><div><dt>Authority</dt><dd>${esc(operation.authority)}</dd></div><div><dt>Adapter</dt><dd>${esc(operation.adapter)}</dd></div><div><dt>Verifier</dt><dd>${esc(operation.independentVerification)}</dd></div><div><dt>Executable</dt><dd>${operation.executable ? "yes" : "no"}</dd></div></dl></article>`).join("")}</div><footer><strong>Still blocked</strong><p>${esc(matchingResult.evidenceBoundary)}</p></footer></section>` : "";
  const draft = systemImportDraft ?? {};
  const draftJson = draft.document ? JSON.stringify(draft.document, null, 2) : "";
  return `<section class="system-import" aria-label="Local system schema import"><header class="system-import-head"><div><p>System material</p><h3>Turn a local schema into a bounded engineering work plan.</h3><span>DAS proposes operations, records the customer’s exact review, and generates adapter and independent-verifier scaffolds. It cannot grant authority, collect credentials, fabricate implementation, or make the environment executable.</span></div><div class="zero-authority-seal"><strong>0</strong><span>authority granted</span></div></header>${unavailable ? `<div class="system-import-unavailable"><strong>Save this role first.</strong><span>A schema proposal must bind to one exact saved session and one system already named in that session.</span></div>` : `<div class="system-import-grid"><label class="onboarding-field"><span>Saved customer system</span><select id="system-import-system">${systems.map((system) => `<option value="${esc(system.id)}" ${draft.systemId === system.id ? "selected" : ""}>${esc(system.name)}</option>`).join("")}</select><small>Only this declared system receives the proposal.</small></label><label class="onboarding-field"><span>Local material kind</span><select id="system-import-kind"><option value="openapi" ${draft.sourceKind === "openapi" ? "selected" : ""}>OpenAPI 3.x JSON</option><option value="mcp-tools-list" ${draft.sourceKind === "mcp-tools-list" ? "selected" : ""}>Pinned MCP tools/list JSON</option></select><small>No URL is fetched. Paste or select a local JSON file.</small></label><label class="onboarding-field"><span>Source label</span><input id="system-import-label" value="${fieldValue(draft.sourceLabel)}" placeholder="Customer-local support API schema"><small>A human-readable label only; no filesystem path is retained.</small></label><label class="onboarding-field mcp-import-only" hidden><span>Customer-local MCP server id</span><input id="system-import-server-id" value="${fieldValue(draft.serverId)}" placeholder="support-tools"><small>An identifier, not an endpoint or credential.</small></label><label class="onboarding-field mcp-import-only" hidden><span>Pinned server version</span><input id="system-import-server-version" value="${fieldValue(draft.serverVersion)}" placeholder="1.4.0"><small>Optional version stated by the customer.</small></label><label class="onboarding-field system-import-selection"><span id="system-import-selection-label">Operation IDs to include</span><textarea id="system-import-selection" rows="3" placeholder="Leave blank to review every declared operation">${fieldValue((draft.selectedNames ?? []).join("\n"))}</textarea><small>Optional. One exact operation or tool name per line.</small></label><label class="system-import-file"><input id="system-import-file" type="file" accept=".json,application/json"><span>Choose local JSON</span><small id="system-import-file-name">${draft.document ? "Source retained in this local browser session" : "Nothing selected"}</small></label><label class="onboarding-field system-import-json"><span>Local JSON material</span><textarea id="system-import-json" rows="13" spellcheck="false" placeholder='{ "openapi": "3.1.0", "info": { "title": "…", "version": "1.0.0" }, "paths": { … } }'>${fieldValue(draftJson)}</textarea><small>Parsed locally, then sent only to this customer-local console. Credential material and external schema references fail closed.</small></label></div><div class="system-import-actions"><button class="button primary" id="propose-system-import" type="button">Generate review proposal</button><span id="system-import-message">No model, network request, execution, or spend.</span></div>`}${resultMarkup}${reviewMarkup}${reviewResultMarkup}</section>`;
}

function assistedSetupSurface(projection, selected) {
  const spendLabel = projection.spend.projectedMaximumUsd == null ? "Not calculated" : `$${projection.spend.projectedMaximumUsd.toFixed(2)} maximum`;
  const currentStageIndex = Math.max(0, projection.stages.findIndex((stage) => stage.id === projection.summary.currentStageId));
  const directBlockers = [...new Map(projection.blockers.filter((item) => projection.stages.findIndex((stage) => stage.id === item.stageId) <= currentStageIndex).map((item) => [item.text, item])).values()];
  const blockerRows = directBlockers.length
    ? directBlockers.map((item) => `<li><span>${esc(item.text)}</span><small>${esc(projection.stages.find((stage) => stage.id === item.stageId)?.label ?? item.stageId)}</small></li>`).join("")
    : `<li class="clear"><span>No setup blockers remain.</span><small>Activation still requires a separate authorization.</small></li>`;
  const currentHeadline = {
    "business-draft": "Complete the business role draft",
    "comparison-design": "Complete the comparison design",
    "executable-environment": "Make the comparison environment executable",
    "spend-approval": "Awaiting explicit model-spend approval",
    recommendation: "Complete the frozen comparison",
    "controlled-activation": "Prepare controlled activation",
  }[projection.summary.currentStageId] ?? projection.summary.currentStageLabel;
  const supportLabel = projection.session.roleSupportLevel === "design-and-scaffold-only"
    ? "Design + scaffold supported · execution blocked"
    : projection.session.roleMode === "supported"
      ? "Full assisted lifecycle supported"
      : "Unsupported role preview";
  return `<section class="assisted-setup" aria-label="Authoritative assisted onboarding status"><header class="assisted-setup-head"><div><p>Authoritative setup status</p><h2>${esc(currentHeadline)}</h2><span>${esc(projection.boundary)}</span></div><div class="setup-progress"><strong>${projection.summary.completeStages}<i> / ${projection.summary.totalStages}</i></strong><span>gates complete</span><div><i style="width:${Math.round(projection.summary.completeStages / projection.summary.totalStages * 100)}%"></i></div></div></header><div class="setup-mode-strip"><span>${esc(supportLabel)}</span><span>${projection.summary.systemsDeclared} named system${projection.summary.systemsDeclared === 1 ? "" : "s"}</span><strong>Named does not mean connected</strong></div><div class="setup-timeline">${projection.stages.map(setupStage).join("")}</div>${systemImportPanel(selected, projection)}<section class="setup-responsibilities"><div><p>Who owns what</p><h3>Autonomous where proved.<br>Explicit where human work remains.</h3></div><div class="setup-lane-grid">${responsibilityLane("Customer answers", "customer", projection.responsibilities.customer)}${responsibilityLane("DAS generated", "das", projection.responsibilities.das)}${responsibilityLane("Engineer work", "engineer", projection.responsibilities.engineer)}${responsibilityLane("Independent checks", "verifier", projection.responsibilities.independentlyVerified)}</div></section><div class="setup-footer-grid"><article class="setup-blocker-ledger"><header><span>Current blockers</span><strong>${directBlockers.length}</strong></header><ul>${blockerRows}</ul></article><article class="setup-spend-gate"><span>Separate spend gate</span><strong>${esc(spendLabel)}</strong><p>${esc(projection.spend.boundary)}</p><button class="button primary" type="button" disabled>${projection.spend.status === "awaiting-explicit-approval" ? "Explicit approval required" : projection.spend.approved ? "Approved · comparison not started here" : "Approval unavailable until plan is frozen"}</button></article></div></section>`;
}

function reviewStep() {
  const readiness = state.commercial?.selected?.intake?.sessionId === commercialDraft.sessionId ? state.commercial.selected.readiness : null;
  const template = selectedTemplate();
  const selected = state.commercial?.selected?.intake?.sessionId === commercialDraft.sessionId ? state.commercial.selected : null;
  const setup = state.commercial?.assistedOnboarding?.sessionId === commercialDraft.sessionId ? state.commercial.assistedOnboarding : null;
  const questions = setup?.questions?.filter((item) => item.stage !== "controlled-activation") ?? readiness?.questions?.filter((item) => item.stage !== "controlled-activation") ?? [];
  const setupProjection = buildAssistedOnboardingProjection({ selected, draft: commercialDraft, setup, supportedRoleTemplateIds: state.commercial.templates.map((template) => template.id) });
  return `<div class="step-copy"><h1>Review the role before any comparison runs.</h1><p>The system can recommend autonomously, but it will not pretend that a complete form is an executable environment or performance evidence.</p></div><div class="review-bento"><article class="review-role"><span>Role contract</span><h2>${esc(commercialDraft.role.title || template.name)}</h2><p>${esc(commercialDraft.role.outcome || "Outcome still missing")}</p><dl><div><dt>Company</dt><dd>${esc(commercialDraft.company.name || "Missing")}</dd></div><div><dt>Systems</dt><dd>${commercialDraft.systems.length}</dd></div><div><dt>Rules</dt><dd>${commercialDraft.policies.length}</dd></div><div><dt>Cases</dt><dd>${commercialDraft.examples.length}</dd></div></dl></article><div class="review-readiness">${readinessCard(readiness?.stages?.draft, "Business role draft", "The core role description is complete.")}${readinessCard(readiness?.stages?.comparison, "Comparison design", "Contract information is complete. System bindings and verification remain separate.")}</div><article class="review-boundary"><strong>What saving does</strong><p>It versions this role contract and calculates design readiness. It does not connect systems, call a model, spend money, run a comparison, or activate an employee.</p></article><article class="review-authority"><strong>Hard authority boundary</strong><p>${commercialDraft.authority.allowedActions.length} allowed · ${commercialDraft.authority.approvalActions.length} approval-bound · ${commercialDraft.authority.forbiddenActions.length} forbidden action classes. Schema imports may propose operations but never widen this boundary.</p></article></div>${assistedSetupSurface(setupProjection, selected)}${questions.length ? `<div class="question-list"><h3>Still needed from the role owner</h3>${questions.slice(0, 8).map((item) => `<button type="button" data-question-stage="${esc(item.stage)}"><span>${esc(item.question)}</span><small>${esc(item.stage)}</small></button>`).join("")}</div>` : ""}<div class="review-actions"><button class="button primary" type="button" id="save-commercial">Save and refresh setup status</button><span id="commercial-message"></span></div>`;
}

function createSpecialist() {
  const content = [startStep, roleStep, systemsStep, rulesStep, examplesStep, successStep, prioritiesStep, reviewStep][onboardingStep]();
  return `<section class="onboarding"><div class="onboarding-head"><div><p>Specialist creation</p><strong>${onboardingStep === 0 ? "Start with the job" : onboardingSteps[onboardingStep]}</strong></div><span>${Math.max(0, onboardingStep)} / 7</span></div><div class="step-track">${onboardingSteps.map((label, index) => `<button type="button" data-onboarding-step="${index}" class="${index === onboardingStep ? "active" : ""} ${index < onboardingStep ? "complete" : ""}"><i></i><span>${esc(label)}</span></button>`).join("")}</div><div class="onboarding-stage">${content}</div>${onboardingStep > 0 && onboardingStep < 7 ? `<div class="onboarding-actions"><button type="button" class="button" id="previous-step">Back</button><button type="button" class="button primary" id="next-step">Continue</button></div>` : ""}</section>`;
}

function animateCreatePage() {
  if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (page !== "create" || !globalThis.gsap) return;
  if (globalThis.ScrollTrigger) {
    globalThis.gsap.registerPlugin(globalThis.ScrollTrigger);
    globalThis.ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
  }
  const title = document.querySelector(".onboarding-welcome h1, .step-copy h1");
  if (title) globalThis.gsap.from(title, { y: 26, opacity: 0, duration: .72, ease: "power3.out", clearProps: "all" });
  const welcomeCards = document.querySelectorAll(".promise-rail > div");
  if (welcomeCards.length) globalThis.gsap.from(welcomeCards, { y: 30, opacity: 0, duration: .6, stagger: .08, ease: "power2.out", clearProps: "all" });
  const reviewCards = document.querySelectorAll(".review-bento > *");
  if (reviewCards.length) globalThis.gsap.from(reviewCards, { y: 34, opacity: 0, duration: .58, stagger: .09, ease: "power3.out", clearProps: "all" });
  const setupStages = document.querySelectorAll(".setup-stage");
  if (setupStages.length) globalThis.gsap.from(setupStages, { y: 22, opacity: 0, duration: .52, stagger: .055, ease: "power2.out", clearProps: "all" });
  const explanatoryCopy = document.querySelector(".step-copy p");
  if (explanatoryCopy && globalThis.ScrollTrigger) globalThis.gsap.fromTo(explanatoryCopy, { opacity: .28 }, { opacity: 1, scrollTrigger: { trigger: explanatoryCopy, start: "top 92%", end: "bottom 72%", scrub: .4 } });
}

function lifecycle() {
  const registry = state.product?.registry;
  const rehearsal = state.product?.lifecycle;
  const commercial = state.product?.commercialLifecycle;
  if (!registry) return `<p class="kicker">Specialist lifecycle</p><h1 class="page-title">No durable specialist registry is loaded.</h1><p class="lede">Complete and verify the bounded Level 1 export before lifecycle controls become available.</p>`;
  const names = { "realistic-procurement-specialist": "Procurement", "realistic-support-operations-specialist": "SaaS support", "realistic-revenue-operations-specialist": "CRM / RevOps" };
  const selected = registry.selections.map((selection) => `<article class="lifecycle-card"><div class="lifecycle-card-head"><h2>${esc(names[selection.roleId] ?? selection.roleId)}</h2><span class="decision ${selection.decision.includes("retain") ? "retained" : "activated"}">${selection.decision.includes("retain") ? "Existing fit retained" : "Compiler fit activated"}</span></div><p class="candidate-name">${esc(selection.candidateId)}</p><div class="lifecycle-meta"><span>Package ${esc(selection.candidateVersion)}</span><span>${selection.alternativesPreserved} alternatives preserved</span></div><code>${esc(selection.recordHash)}</code></article>`).join("");
  const roleEvents = rehearsal ? [
    ["Healthy evidence", "Continue", rehearsal.roles.procurement, "No search was started when the active specialist remained inside its contract."],
    ["Measured drift", "Bounded search", rehearsal.roles.support, "A capped request stayed unstarted until explicit approval; the trial challenger later regressed and rolled back."],
    ["Unsafe outcome", "Halt", rehearsal.roles.revops, "Safety bypassed the ordinary drift window and stopped the active specialist immediately."],
  ] : [];
  const commercialRoles = commercial?.roles?.map((role) => `<article class="joined-role"><div class="joined-role-head"><h3>${esc(role.role === "revops" ? "CRM / RevOps" : role.role[0].toUpperCase() + role.role.slice(1))}</h3><span>${esc(role.regressionAction.includes("quarantine") ? "Safety rollback" : "Quality rollback")}</span></div><div class="joined-proof"><div><small>Offline</small><strong>${role.offlineObservations}/2</strong></div><div><small>Shadow writes</small><strong>${role.shadowCustomerWrites}</strong></div><div><small>Canary</small><strong>${role.canaryDispatches}/${role.canaryTotal}</strong></div></div><p>Verified drift → bounded request → offline → zero-authority shadow → ${Math.round(role.canaryFraction * 100)}% canary → promotion → verified regression → rollback.</p><code>${esc(role.branch)}</code></article>`).join("") ?? "";
  const joinedSection = commercial?.status === "completed" ? `<section class="joined-lifecycle"><div class="panel-head"><div><h2>Executable commercial replacement path</h2><p class="explain">The same persisted control path ran against real disposable business-world execution and independent external-state verification in all three supported roles.</p></div><span class="evidence-chip">Integrity valid</span></div><div class="joined-role-grid">${commercialRoles}</div><div class="next-gate"><span>Still unproved</span><strong>${esc(commercial.nextGate)}</strong><p>${esc(commercial.boundary)}</p></div></section>` : `<section class="joined-lifecycle invalid"><h2>Commercial lifecycle evidence unavailable</h2><p>${esc(commercial?.error ?? "The joined commercial rehearsal has not been run.")}</p></section>`;
  return `<p class="kicker">Continuous specialisation</p><h1 class="page-title">Improve the specialist without gambling live work.</h1><p class="lede">Independent outcomes decide whether the active package continues, asks for a bounded search, or halts. Development winners still pass offline, shadow and canary gates before promotion.</p><div class="lifecycle-grid">${selected}</div>${joinedSection}<section class="lifecycle-rail"><div class="panel-head"><div><h2>Earlier control-only rehearsal</h2><p class="explain">Constructed fixtures separately verify continue, request and immediate-halt branches. They remain control tests, not customer or model-performance evidence.</p></div><span class="evidence-chip">${rehearsal?.status === "completed" ? "All checks passed" : "Not run"}</span></div><div class="path-rail">${roleEvents.map(([signal,action,detail,copy])=>`<article class="path-step"><span>${esc(signal)}</span><strong>${esc(action)}</strong><p>${esc(copy)}</p><code>${esc(detail?.branch ?? "No fixture")}</code></article>`).join("")}</div></section><section class="boundary-note"><strong>The boundary is deliberate.</strong><p>Monitoring and lifecycle state are durable and tamper-evident. Further optimisation remains optional, model spend requires explicit start, canaries require accountable authorization, and no synthetic result is presented as production reliability.</p></section>`;
}

function fleet() {
  // Fleet Brain is a separate product direction with its own console (src/fleet-console, port 4392).
  // This page is retained only so a stale deep-link does not 404; it points across.
  return `<p class="kicker">Agent Fleet Brain</p><h1 class="page-title">Fleet Brain has its own console.</h1><p class="lede">Fleet Brain is the destination Capability Factory and DAS converge toward - not a DAS feature. It renders from the same preserved evidence, on its own front door.</p><p><a class="button primary" href="http://127.0.0.1:4392/" target="_blank" rel="noopener">Open Agent Fleet Brain ↗</a></p><p class="notice">Start it with <code>pnpm fleet:console</code> from the DAS repo.</p>`;
}
function fleetLegacyUnused() {
  const fleet = state.product?.fleet;
  if (!fleet || fleet.integrity !== "valid") return `<p class="kicker">Bounded fleet coordination</p><h1 class="page-title">Fleet evidence is unavailable.</h1><p class="lede">The console refuses to summarize a missing or mutated coordination chain.</p><p class="notice error">${esc(fleet?.error ?? "No fleet checkpoint is loaded.")}</p>`;
  const rows = fleet.plan.assignments.map((assignment) => `<article class="fleet-assignment ${assignment.phase}"><div class="fleet-assignment-main"><span>${esc(assignment.workload)}</span><strong>${esc(assignment.specialist)}</strong><small>${assignment.quantity} items · ${esc(assignment.phase === "residual" ? "new specialist" : "verified before gap")}</small></div><dl><div><dt>Outcome</dt><dd>${Math.round(assignment.expectedOutcomeScore * 100)}%</dd></div><div><dt>Estimate</dt><dd>$${Number(assignment.estimatedCostUsd).toFixed(2)}</dd></div><div><dt>Verifier</dt><dd>${esc(assignment.verifier)}</dd></div></dl></article>`).join("");
  const intakeRows = fleet.intake.workloads.map((item) => `<article><span>${esc(item.system)}</span><strong>${esc(item.workload)}</strong><p>${esc(item.outcome)}</p><small>${esc(item.source)}</small></article>`).join("");
  return `<section class="fleet-workspace">
    <header class="fleet-hero"><div><p class="kicker">Bounded fleet coordination</p><h1>One goal.<br>Five specialists.</h1></div><div class="fleet-goal"><span>Trusted broad goal</span><p>${esc(fleet.broadGoal)}</p><strong>${esc(fleet.continuation.finalState.replaceAll("-", " "))}</strong></div></header>
    <section class="fleet-summary" aria-label="Fleet completion summary"><article class="fleet-progress"><span>Verified outcome</span><strong>${fleet.continuation.totalVerified}<i> / ${fleet.continuation.total}</i></strong><div class="fleet-progress-track"><i style="width:${Math.round(fleet.continuation.totalVerified / fleet.continuation.total * 100)}%"></i></div><p>The parent goal completed only after every workload passed its bound external checker.</p></article><article><span>Carried</span><strong>${fleet.continuation.carriedWithoutRerun}</strong><p>Previously verified items preserved without rerun.</p></article><article><span>Residual</span><strong>${fleet.continuation.residualExecuted}</strong><p>Blocked finance items executed after activation.</p></article><article><span>Safety</span><strong>${fleet.continuation.residualSafetyViolations}</strong><p>Residual safety violations detected.</p></article></section>
    <section class="fleet-intake"><div class="fleet-intake-copy"><p class="kicker">Trusted Fleet Intake</p><h2>The work arrives bounded.<br>The planner cannot widen it.</h2><p>Fresh customer-local snapshots reference only pre-verified adapter operations. They can describe current work, but they cannot invent a capability or grant spend, execution, role-creation or activation authority.</p><div><strong>${fleet.intake.adapters} adapters</strong><span>${fleet.intake.snapshots} fresh snapshots · ${fleet.intake.workloads.length} workload classes</span></div></div><div class="fleet-intake-stack">${intakeRows}<footer>${esc(fleet.intake.boundary)}</footer></div></section>
    <section class="fleet-turn"><div class="fleet-turn-copy"><p class="kicker">The decisive return</p><h2>It stopped honestly.<br>Then filled the missing role.</h2><p>The first plan completed every job it could safely route, but did not give finance work to a plausible general agent. A separate comparison produced a bounded finance specialist. Only the ten blocked items were replanned.</p></div><div class="fleet-turn-states"><article><span>Initial state</span><strong>${fleet.initial.assigned} / ${fleet.initial.total}</strong><p>${esc(fleet.initial.roleGap)} had no proved match. Parent goal remained incomplete.</p></article><i aria-hidden="true">→</i><article class="candidate"><span>Level 1 selection</span><strong>${esc(fleet.roleGap.selectedCandidate)}</strong><p>${Math.round(fleet.roleGap.frozenPassRate * 100)}% frozen-case pass · ${fleet.roleGap.safetyViolations} unsafe attempts · exact verifier bound.</p></article><i aria-hidden="true">→</i><article class="complete"><span>Continued state</span><strong>${fleet.continuation.totalVerified} / ${fleet.continuation.total}</strong><p>Prior work carried, residual verified, original broad goal completed.</p></article></div></section>
    <section class="fleet-ledger"><div class="fleet-ledger-copy"><p class="kicker">Allocation ledger</p><h2>The recommendation is automatic.<br>The reasoning stays inspectable.</h2><p>${esc(fleet.plan.strategy)} was selected under the fictional $${fleet.plan.hardCostLimitUsd.toFixed(2)} ceiling. Each assignment remains bound to one workload, specialist and independent checker.</p><dl><div><dt>Estimated total</dt><dd>$${fleet.plan.estimatedCostUsd.toFixed(2)}</dd></div><div><dt>Expected outcome</dt><dd>${(fleet.plan.expectedOutcomeScore * 100).toFixed(1)}%</dd></div></dl></div><div class="fleet-assignment-stack">${rows}</div></section>
    <footer class="fleet-boundary"><div><span>What exists</span><strong>A joined deterministic control mechanism in one fictional four-stream company.</strong></div><div><span>What remains unproved</span><strong>${esc(fleet.nextGate)}</strong></div><p>${esc(fleet.boundary)}</p></footer>
  </section>`;
}

function animateFleetPage() {
  if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (page !== "fleet" || !globalThis.gsap) return;
  gsap.from(".fleet-hero > *", { y: 28, opacity: 0, duration: .75, stagger: .12, ease: "power3.out", clearProps: "all" });
  gsap.from(".fleet-summary > article", { y: 22, opacity: 0, duration: .6, stagger: .07, delay: .12, ease: "power2.out", clearProps: "all" });
  if (globalThis.ScrollTrigger) {
    gsap.utils.toArray(".fleet-assignment").forEach((card, index) => gsap.fromTo(card, { y: 24 + index * 4, opacity: .35 }, { y: 0, opacity: 1, scrollTrigger: { trigger: card, start: "top 92%", end: "top 68%", scrub: .35 } }));
    gsap.fromTo(".fleet-turn-states", { opacity: .35 }, { opacity: 1, scrollTrigger: { trigger: ".fleet-turn", start: "top 82%", end: "center 55%", scrub: .5 } });
  }
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

function bindSystemImport() {
  const kind = document.querySelector("#system-import-kind");
  const material = document.querySelector("#system-import-json");
  const selectionLabel = document.querySelector("#system-import-selection-label");
  const updateKind = () => {
    const isMcp = kind?.value === "mcp-tools-list";
    document.querySelectorAll(".mcp-import-only").forEach((field) => { field.hidden = !isMcp; });
    if (selectionLabel) selectionLabel.textContent = isMcp ? "Tool names to include" : "Operation IDs to include";
    if (material) material.placeholder = isMcp
      ? '{ "tools": [{ "name": "ticket_read", "inputSchema": { "type": "object" } }] }'
      : '{ "openapi": "3.1.0", "info": { "title": "…", "version": "1.0.0" }, "paths": { … } }';
  };
  kind?.addEventListener("change", updateKind);
  updateKind();
  document.querySelector("#system-import-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    const fileName = document.querySelector("#system-import-file-name");
    if (!file) return;
    try {
      material.value = await file.text();
      fileName.textContent = file.name;
    } catch {
      fileName.textContent = "Could not read this local file";
    }
  });
  document.querySelector("#propose-system-import")?.addEventListener("click", async () => {
    const message = document.querySelector("#system-import-message");
    message.classList.remove("error");
    let documentMaterial;
    try {
      documentMaterial = JSON.parse(material?.value || "");
    } catch {
      message.textContent = "Enter valid JSON. Nothing was saved.";
      message.classList.add("error");
      return;
    }
    message.textContent = "Checking local material and generating a review proposal…";
    try {
      const sourceKind = kind.value;
      systemImportDraft = {
        sessionId: commercialDraft.sessionId,
        systemId: document.querySelector("#system-import-system")?.value,
        sourceKind,
        sourceLabel: document.querySelector("#system-import-label")?.value,
        serverId: sourceKind === "mcp-tools-list" ? document.querySelector("#system-import-server-id")?.value : undefined,
        serverVersion: sourceKind === "mcp-tools-list" ? document.querySelector("#system-import-server-version")?.value : undefined,
        selectedNames: lines(document.querySelector("#system-import-selection")?.value),
        document: documentMaterial,
      };
      const result = await request("/api/commercial/system-import", {
        method: "POST",
        body: JSON.stringify(systemImportDraft),
      });
      state.commercial = result.commercial;
      systemImportResult = result.proposal;
      systemImportReviewResult = null;
      render();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
    }
  });
  document.querySelector("#confirm-system-import")?.addEventListener("click", async () => {
    const message = document.querySelector("#system-import-review-message");
    message.classList.remove("error");
    if (!systemImportDraft || !systemImportResult) {
      message.textContent = "Generate the exact review proposal again. Nothing was confirmed.";
      message.classList.add("error");
      return;
    }
    const operationChoices = [...document.querySelectorAll("[data-import-operation]")].map((element) => {
      const approved = element.querySelector("[data-import-approve]").checked;
      const sourceName = element.dataset.importOperation;
      if (!approved) return { sourceName, approved: false, rejectionReason: element.querySelector("[data-import-rejection]").value.trim() };
      return {
        sourceName,
        approved: true,
        targetExposedName: element.querySelector("[data-import-target]").value,
        confirmedMode: element.querySelector("[data-import-mode]").value,
        authorityAction: element.querySelector("[data-import-authority]").value || null,
        requiredContextSources: lines(element.querySelector("[data-import-context]").value),
      };
    });
    const contextChoices = [...document.querySelectorAll("[data-import-context-approval]")].map((element) => ({ sourceId: element.value, approved: element.checked }));
    message.textContent = "Sealing review and generating the non-executable work plan…";
    try {
      const result = await request("/api/commercial/system-import/review", {
        method: "POST",
        body: JSON.stringify({
          ...systemImportDraft,
          confirmedBy: document.querySelector("#system-import-reviewer")?.value,
          decisions: { operationChoices, contextChoices },
        }),
      });
      state.commercial = result.commercial;
      systemImportReviewResult = result.review;
      render();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
    }
  });
}

function bindRoleDiscovery() {
  const preview = document.querySelector("#preview-discovery");
  if (!preview) return;
  preview.addEventListener("click", async () => {
    roleDiscoveryDraft = {
      description: document.querySelector("#discovery-description")?.value ?? "",
      companyName: document.querySelector("#discovery-company")?.value ?? "",
      industry: document.querySelector("#discovery-industry")?.value ?? "",
      operatingContext: document.querySelector("#discovery-context")?.value ?? "",
      includeRecordedSystemProposals: document.querySelector("#discovery-use-recorded")?.checked ?? false,
    };
    const message = document.querySelector("#discovery-message");
    message.classList.remove("error");
    message.textContent = "Building a deterministic structural preview…";
    try {
      const hasRecordedProposals = (state.commercial?.assistedOnboarding?.generated?.systemImportProposals ?? 0) > 0;
      const result = await request("/api/commercial/discover-role", {
        method: "POST",
        body: JSON.stringify({
          description: roleDiscoveryDraft.description,
          companyName: roleDiscoveryDraft.companyName,
          industry: roleDiscoveryDraft.industry,
          operatingContext: roleDiscoveryDraft.operatingContext,
          sessionId: roleDiscoveryDraft.includeRecordedSystemProposals && hasRecordedProposals ? state.commercial.selected?.sessionId : undefined,
        }),
      });
      roleDiscoveryResult = result.preview;
      render();
    } catch (error) {
      roleDiscoveryResult = null;
      message.textContent = error.message;
      message.classList.add("error");
    }
  });
  document.querySelector("#continue-discovery")?.addEventListener("click", () => {
    const handoff = roleDiscoveryResult?.safeHandoff;
    if (!handoff?.permitted) return;
    if (handoff.company.name) commercialDraft.company.name = handoff.company.name;
    if (handoff.company.industry) commercialDraft.company.industry = handoff.company.industry;
    if (handoff.company.operatingContext) commercialDraft.company.operatingContext = handoff.company.operatingContext;
    if (handoff.role.templateId) commercialDraft.role.templateId = handoff.role.templateId;
    if (handoff.role.title) commercialDraft.role.title = handoff.role.title;
    if (handoff.role.outcome) commercialDraft.role.outcome = handoff.role.outcome;
    const existingSystemNames = new Set(commercialDraft.systems.map((system) => system.name.trim().toLowerCase()));
    for (const system of handoff.systems) {
      if (existingSystemNames.has(system.name.trim().toLowerCase())) continue;
      commercialDraft.systems.push({
        id: `discovery-system-${commercialDraft.systems.length + 1}`,
        name: system.name,
        kind: "customer system",
        access: "none",
        adapterStatus: "missing",
        contextSources: [],
        tools: [],
      });
      existingSystemNames.add(system.name.trim().toLowerCase());
    }
    roleDiscoveryHandoffNotice = `${roleDiscoveryResult.roleFamily.label} came from a ${roleDiscoveryResult.provider.kind.replaceAll("-", " ")}.`;
    onboardingStep = 1;
    render();
  });
}

function bindCommercial() {
  if (page !== "create") return;
  bindRoleDiscovery();
  bindSystemImport();
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
      systemImportResult = null;
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
  document.querySelectorAll("[data-commercial-role]").forEach((button) => button.addEventListener("click", () => { selectedCommercialRoleId = button.dataset.commercialRole; render(); }));
  if (page !== "improve") return;
  document.querySelector("#save").onclick = saveImprovement;
  document.querySelector("#disable").onclick = async () => { state = await request("/api/improvement/disable", { method: "POST", body: "{}" }); render(); nav(); };
  document.querySelector("#start").onclick = async () => { try { state = await request("/api/improvement/start", { method: "POST", body: JSON.stringify({ confirmation: "START_OPTIONAL_IMPROVEMENT" }) }); render(); } catch (error) { document.querySelector("#form-message").textContent = error.message; } };
}

function render() {
  main.innerHTML = page === "create" ? createSpecialist() : page === "comparison" ? comparisonPage() : page === "improve" ? improvement() : page === "lifecycle" ? lifecycle() : page === "fleet" ? fleet() : page === "role" ? rolePage() : overview();
  main.classList.remove("flash");
  requestAnimationFrame(() => main.classList.add("flash"));
  requestAnimationFrame(animateCreatePage);
  requestAnimationFrame(animateComparisonPage);
  requestAnimationFrame(animateFleetPage);
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
