import http from "node:http";
import { runDeterministicReference } from "../run.js";

const port = Number(process.env.PORT ?? 4391);
const run = runDeterministicReference();
const data = {
  boundary: "Zero-cost deterministic reference — no model or customer evidence",
  paidModelCostUsd: run.paidModelCostUsd,
  evidenceValid: run.evidenceValid,
  roles: run.results.map(({ role, result, comparison, baselineResults }) => ({
    id: role.id, name: role.brief.role, recommendation: result.tournament.recommendation,
    alternatives: result.tournament.frontier, comparison,
    candidates: result.candidates.map((candidate) => ({ id: candidate.id, model: candidate.model, context: candidate.context, tools: candidate.tools, memory: candidate.memory, authority: candidate.authority, escalation: candidate.escalation, verifier: candidate.verifier, limits: candidate.limits, strategy: candidate.strategy, provenance: candidate.provenance, fingerprint: candidate.fingerprint })),
    baselines: baselineResults,
    freeze: result.freeze,
  })),
  evidence: run.evidence.records(),
};

function html() { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Specialist Compiler</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#090b0e;color:#f5f5f1}*{box-sizing:border-box}body{margin:0}header{padding:36px 5vw 26px;border-bottom:1px solid #292d33;display:flex;justify-content:space-between;gap:24px}h1{font-size:clamp(30px,5vw,68px);line-height:.95;margin:0;letter-spacing:-.055em;max-width:760px}.boundary{color:#f6cb6d;max-width:420px;font:13px/1.5 ui-monospace,monospace}.layout{display:grid;grid-template-columns:300px 1fr;min-height:calc(100vh - 160px)}nav{padding:24px;border-right:1px solid #292d33}.role{display:block;width:100%;text-align:left;background:transparent;color:#999;border:0;border-bottom:1px solid #222;padding:17px 5px;cursor:pointer}.role.active{color:#fff}.main{padding:34px 5vw}.eyebrow{font:12px ui-monospace,monospace;color:#87e5bc;text-transform:uppercase}.hero{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:22px 0}.card{border:1px solid #292d33;padding:22px;background:#0e1115}.metric{font-size:36px;letter-spacing:-.04em}.tabs{display:flex;gap:8px;margin:24px 0}.tabs button{background:#14181e;color:#aaa;border:1px solid #292d33;padding:10px 14px;cursor:pointer}.tabs button.active{background:#edfdf5;color:#07110c}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}pre{white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,monospace;color:#b9c0c7}.hidden{display:none}@media(max-width:800px){.layout{grid-template-columns:1fr}nav{border-right:0}.hero,.grid{grid-template-columns:1fr}}
</style></head><body><header><h1>Specialist Compiler</h1><div class="boundary">${data.boundary}<br>Paid model cost: $0.00 · Evidence chain: valid</div></header><div class="layout"><nav id="roles"></nav><main class="main"><div class="eyebrow">Autonomous recommendation · optional full transparency</div><div id="content"></div></main></div><script>
const DATA=${JSON.stringify(data)};let role=DATA.roles[0],view='executive';
const esc=x=>String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function renderNav(){roles.innerHTML=DATA.roles.map(r=>'<button class="role '+(r.id===role.id?'active':'')+'" data-id="'+r.id+'">'+esc(r.name)+'</button>').join('');document.querySelectorAll('.role').forEach(b=>b.onclick=()=>{role=DATA.roles.find(r=>r.id===b.dataset.id);renderNav();render()})}
function tabs(){return '<div class="tabs">'+['executive','engineering','forensic'].map(x=>'<button class="'+(x===view?'active':'')+'" data-view="'+x+'">'+x+'</button>').join('')+'</div>'}
function render(){const winner=role.recommendation;let body='';if(view==='executive')body='<div class="hero"><div class="card"><div class="eyebrow">Recommended specialist</div><h2>'+esc(winner.candidateId.split(':').at(-1))+'</h2><p>Selected automatically from safe finalists using the declared quality, cost, speed and escalation preferences.</p></div><div class="card"><div class="eyebrow">Synthetic unseen result</div><div class="metric">'+Math.round(winner.successRate*100)+'%</div><p>Zero unsafe external effects in this deterministic reference.</p></div></div><div class="grid"><div class="card"><b>Ordinary manual baseline</b><p>'+Math.round(role.comparison.ordinarySuccessRate*100)+'% synthetic result · human effort not yet measured</p></div><div class="card"><b>Expert manual baseline</b><p>'+Math.round(role.comparison.expertSuccessRate*100)+'% synthetic result · human effort not yet measured</p></div></div><p class="boundary">'+role.comparison.note+'</p>';
if(view==='engineering')body='<div class="grid">'+role.candidates.map(c=>'<div class="card"><div class="eyebrow">'+esc(c.id)+'</div><pre>'+esc(JSON.stringify(c,null,2))+'</pre></div>').join('')+'</div>';
if(view==='forensic')body='<div class="card"><div class="eyebrow">Frozen evaluation receipt</div><pre>'+esc(JSON.stringify(role.freeze,null,2))+'</pre></div><div class="card"><div class="eyebrow">Evidence boundary</div><pre>'+esc(JSON.stringify({records:DATA.evidence.length,chainValid:DATA.evidenceValid,paidModelCostUsd:DATA.paidModelCostUsd},null,2))+'</pre></div>';
content.innerHTML='<h2>'+esc(role.name)+'</h2>'+tabs()+body;document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()})}
renderNav();render();
</script></body></html>`; }

const server = http.createServer((request, response) => {
  if (request.url === "/api/state") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(data)); return; }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html());
});
server.listen(port, "127.0.0.1", () => console.log(`Specialist Compiler console: http://127.0.0.1:${port}`));
