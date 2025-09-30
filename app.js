// Minimal NL-to-MDP heuristic, DP solver, and optional OpenAI assistant
const $ = id => document.getElementById(id);

// ====== Utilities ======
function splitCSV(s) { return (s||'').split(',').map(x=>x.trim()).filter(Boolean); }
function pretty(obj) { return JSON.stringify(obj, null, 2); }
function parseJSONorReuse(txt, fallback) {
  if (!txt || !txt.trim()) return fallback;
  try { return JSON.parse(txt); } catch(e) { throw new Error("Invalid JSON: " + e.message); }
}
function normalizeRow(row) {
  const keys = Object.keys(row);
  const sum = keys.reduce((acc,k)=>acc+Number(row[k]||0),0);
  if (sum<=0) return keys.forEach(k=>row[k]= (1/keys.length));
  keys.forEach(k=>row[k]= Number(row[k])/sum);
}

// ====== Heuristic parser from natural language ======
function parseNaturalLanguage(text) {
  const lower = text.toLowerCase();
  let states = [], actions = [];

  // Enumerations in parentheses: (A,B,C)
  const parenEnum = text.match(/\(([A-Za-z0-9_,\-\s]+)\)/);
  if (parenEnum) {
    const cand = parenEnum[1].split(',').map(s=>s.trim()).filter(Boolean);
    if (cand.length >= 2 && cand.length <= 12) states = cand;
  }

  // "actions: a,b,c" or "may/can ... or ..."
  const actionsMatch = lower.match(/actions?\s*[:\-]\s*([^\n]+)/);
  if (actionsMatch) {
    actions = actionsMatch[1].split(/,|;|\bor\b/).map(s=>s.trim()).filter(Boolean);
  } else {
    const mayCan = text.match(/may\s+([^.]+)|can\s+([^.]+)/i);
    if (mayCan) {
      const list = (mayCan[1]||mayCan[2]||'').split(/,|;|\bor\b/).map(s=>s.trim());
      actions = list.filter(w => w.length && !w.match(/\b(be|is|are|was|were)\b/i));
    }
  }

  if (!states.length) states = ['s1','s2','s3'];
  if (!actions.length) actions = ['a1','a2'];

  // Horizon
  let T = 4;
  const hor = lower.match(/horizon\s*[:=\-]?\s*(\d+)/) || lower.match(/for\s*(\d+)\s*(steps|stages|hours|days)/);
  if (hor) T = Math.max(1, parseInt(hor[1],10));

  // Defaults
  const costs = {};
  for (const s of states) { costs[s] = {}; for (const a of actions) costs[s][a] = 0; }

  const P = {};
  for (const s of states) {
    P[s] = {};
    for (const a of actions) {
      P[s][a] = {};
      for (const sp of states) P[s][a][sp] = (s===sp ? 1.0 : 0.0);
    }
  }

  const salvage = {}; for (const s of states) salvage[s]=0;

  return { states, actions, T, costs, P, salvage };
}

// ====== DP Solver (finite horizon, discounted) ======
function getTransition(Trans, t, s, a, states) {
  if (Trans && typeof Trans === 'object' && (t in Trans)) {
    if (Trans[t][s] && Trans[t][s][a]) return Trans[t][s][a];
  }
  if (Trans && Trans[s] && Trans[s][a]) return Trans[s][a];
  const row = {}; for (const sp of states) row[sp] = (s===sp?1:0); // identity fallback
  return row;
}
function getCost(Costs, t, s, a) {
  if (Costs && (t in Costs)) {
    if (Costs[t][s] && (a in Costs[t][s])) return Number(Costs[t][s][a]);
  }
  if (Costs && Costs[s] && (a in Costs[s])) return Number(Costs[s][a]);
  return 0;
}
function solveDP({states, actions, T, gamma, Costs, Trans, Salvage}) {
  // Normalize transitions (stationary and time-varying)
  const normStationary = (obj)=>{ for (const s of Object.keys(obj)) for (const a of Object.keys(obj[s]||{})) normalizeRow(obj[s][a]); };
  if (Trans && !('0' in Trans)) normStationary(Trans);
  else if (Trans) for (const t of Object.keys(Trans)) normStationary(Trans[t]);

  const V = Array(T+1).fill(null).map(()=>({}));
  const Pi = Array(T).fill(null).map(()=>({}));

  for (const s of states) V[T][s] = Number((Salvage||{})[s] ?? 0);

  for (let t=T-1; t>=0; --t) {
    for (const s of states) {
      let bestA = null, bestVal = +Infinity;
      for (const a of actions) {
        const c = getCost(Costs, t, s, a);
        const row = getTransition(Trans, t, s, a, states);
        let expNext = 0;
        for (const sp of states) expNext += (row[sp] || 0) * V[t+1][sp];
        const q = c + gamma * expNext;
        if (q < bestVal) { bestVal=q; bestA=a; }
      }
      V[t][s] = bestVal;
      Pi[t][s] = bestA;
    }
  }
  return { V, Pi };
}

// ====== OpenAI Assistant (optional) ======
async function askAssistant() {
  const key = $('oaikey').value.trim();
  const model = $('model').value.trim() || 'gpt-4o-mini';
  const nlp = $('nlpInput').value.trim();
  const prompt = $('assistantPrompt').value.trim();
  if (!key) { $('assistantOut').textContent = 'Provide an API key.'; return; }

  const sys = `You are a decision analytics assistant. Given a natural-language problem and current fields, propose a minimal JSON with:
{
  "states": [...],
  "actions": [...],
  "T": <int>,
  "costs": { "state": {"action": number, ...}, ... } OR { "t": { "state": {"action": number} } },
  "transitions": { "state": {"action": {"next_state": prob}}, ... } OR time-varying under "t",
  "salvage": {"state": number}
}
Do not include prose, only JSON.`;

  const current = {
    states: splitCSV($('states').value),
    actions: splitCSV($('actions').value),
    T: Number($('horizon').value||4),
    costs: parseSafely($('costs').value),
    transitions: parseSafely($('transitions').value),
    salvage: parseSafely($('salvage').value)
  };

  const user = [
    `Problem:\n${nlp}`,
    `Current fields (may be empty):\n${pretty(current)}`,
    `Instruction:\n${prompt || 'Extract or refine to consistent JSON; ensure transition rows sum to 1.'}`
  ].join('\n\n');

  try {
    // Chat Completions style request
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ],
        temperature: 0.2
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      $('assistantOut').textContent = `Error ${res.status}:\n${errText}`;
      return;
    }
    const data = await res.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    $('assistantOut').textContent = text;
    // Remember key (optional)
    if ($('rememberKey').checked) localStorage.setItem('MDP_BUILDER_OAIKEY', key);
    else localStorage.removeItem('MDP_BUILDER_OAIKEY');
  } catch (e) {
    $('assistantOut').textContent = 'Request failed: ' + e.message;
  }
}
function parseSafely(txt) { try { return txt ? JSON.parse(txt) : {}; } catch { return {}; } }
function applyAssistantJSON() {
  let txt = $('assistantOut').textContent || '';
  // Try to find the first JSON block if assistant added prose
  const firstBrace = txt.indexOf('{');
  const lastBrace = txt.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    $('assistantOut').textContent = 'No JSON found to apply.';
    return;
  }
  try {
    const js = JSON.parse(txt.slice(firstBrace, lastBrace+1));
    if (js.states) $('states').value = js.states.join(',');
    if (js.actions) $('actions').value = js.actions.join(',');
    if (Number.isFinite(js.T)) $('horizon').value = js.T;
    if (js.costs) $('costs').value = pretty(js.costs);
    if (js.transitions) $('transitions').value = pretty(js.transitions);
    if (js.salvage) $('salvage').value = pretty(js.salvage);
    $('diag').textContent = 'Applied assistant JSON to fields.';
  } catch(e) {
    $('assistantOut').textContent = 'Failed to parse JSON from assistant output: ' + e.message;
  }
}

// ====== Event wiring ======
window.addEventListener('DOMContentLoaded', ()=>{
  // Persist key if requested
  const saved = localStorage.getItem('MDP_BUILDER_OAIKEY');
  if (saved) { $('oaikey').value = saved; $('rememberKey').checked = true; }

  $('loadExampleBtn').addEventListener('click', ()=>{
    const ex = {
      text: "A delivery robot navigates zones (A,B,C). Each hour it may wait, charge, or deliver. Delivering from A tends to move to B, and from B to C. Charging tends to keep it in place. Horizon 4. Costs: deliver is 2 in A/B, 4 in C; wait is 1; charge is 3. Salvage 0.",
      T: 4,
      states: ["A","B","C"],
      actions: ["wait","charge","deliver"],
      costs: {"A":{"wait":1,"charge":3,"deliver":2},"B":{"wait":1,"charge":3,"deliver":2},"C":{"wait":1,"charge":3,"deliver":4}},
      P: {
        "A":{"wait":{"A":0.8,"B":0.2},"charge":{"A":0.9,"B":0.1},"deliver":{"B":0.7,"C":0.3}},
        "B":{"wait":{"B":0.8,"C":0.2},"charge":{"A":0.4,"B":0.6},"deliver":{"C":0.8,"B":0.2}},
        "C":{"wait":{"C":1.0},"charge":{"B":1.0},"deliver":{"C":1.0}}
      },
      salvage: {"A":0,"B":0,"C":0}
    };
    $('nlpInput').value = ex.text;
    $('horizon').value = ex.T;
    $('states').value = ex.states.join(',');
    $('actions').value = ex.actions.join(',');
    $('costs').value = pretty(ex.costs);
    $('transitions').value = pretty(ex.P);
    $('salvage').value = pretty(ex.salvage);
  });

  $('parseBtn').addEventListener('click', ()=>{
    const text = $('nlpInput').value.trim();
    const draft = parseNaturalLanguage(text);
    $('horizon').value = draft.T;
    $('states').value = draft.states.join(',');
    $('actions').value = draft.actions.join(',');
    $('costs').value = pretty(draft.costs);
    $('transitions').value = pretty(draft.P);
    $('salvage').value = pretty(draft.salvage);
  });

  $('solveBtn').addEventListener('click', ()=>{
    try{
      const states = splitCSV($('states').value);
      const actions = splitCSV($('actions').value);
      const gamma = Math.max(0, Math.min(0.9999, Number($('gamma').value || 0.95)));
      const T = Math.max(1, parseInt($('horizon').value || '1', 10));
      const Costs = parseJSONorReuse($('costs').value, {});
      const Trans = parseJSONorReuse($('transitions').value, {});
      const Salvage = parseJSONorReuse($('salvage').value, {});
      const {V, Pi} = solveDP({states, actions, T, gamma, Costs, Trans, Salvage});
      $('valueFn').textContent = pretty(V);
      $('policy').textContent = pretty(Pi);
      $('diag').textContent = `States=${states.length}, Actions=${actions.length}, Horizon=${T}, gamma=${gamma}`;
      window.__lastResults__ = {V, Pi};
      window.__lastConfig__ = {states, actions, T, gamma, Costs, Trans, Salvage};
    } catch(err){
      $('diag').textContent = 'Error: ' + err.message;
    }
  });

  $('exportBtn').addEventListener('click', ()=>{
    if (!window.__lastConfig__) { $('diag').textContent = 'Solve first to export.'; return; }
    const blob = new Blob([pretty({config: window.__lastConfig__, results: window.__lastResults__})], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mdp_build.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('askBtn').addEventListener('click', askAssistant);
  $('applySuggestionBtn').addEventListener('click', applyAssistantJSON);
});
