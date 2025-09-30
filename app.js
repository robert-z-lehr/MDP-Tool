// Simple NL-to-MDP heuristic + dynamic programming solver
const $ = id => document.getElementById(id);

function splitCSV(s) {
  return (s||'').split(',').map(x=>x.trim()).filter(Boolean);
}

function parseNaturalLanguage(text) {
  const lower = text.toLowerCase();
  let states = [];
  let actions = [];

  const parenEnum = text.match(/\(([A-Za-z0-9_,\-\s]+)\)/);
  if (parenEnum) {
    const cand = parenEnum[1].split(',').map(s=>s.trim()).filter(Boolean);
    if (cand.length <= 12 && cand.length >= 2) states = cand;
  }

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

  if (states.length === 0) states = ['s1','s2','s3'];
  if (actions.length === 0) actions = ['a1','a2'];

  let T = 4;
  const hor = lower.match(/horizon\s*[:=\-]?\s*(\d+)/) || lower.match(/for\s*(\d+)\s*(steps|stages|hours|days)/);
  if (hor) T = Math.max(1, parseInt(hor[1],10));

  const costs = {};
  for (const s of states) {
    costs[s] = {};
    for (const a of actions) costs[s][a] = 0;
  }

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

function normalizeRow(row) {
  const keys = Object.keys(row);
  const sum = keys.reduce((acc,k)=>acc+Number(row[k]||0),0);
  if (sum<=0) return keys.forEach(k=>row[k]= (1/keys.length));
  keys.forEach(k=>row[k]= Number(row[k])/sum);
}

function parseJSONorReuse(txt, fallback) {
  if (!txt || !txt.trim()) return fallback;
  try { return JSON.parse(txt); }
  catch(e) { throw new Error("Invalid JSON: " + e.message); }
}

function getTransition(Trans, t, s, a, states) {
  if (Trans && typeof Trans === 'object' && (t in Trans)) {
    if (Trans[t][s] && Trans[t][s][a]) return Trans[t][s][a];
  }
  if (Trans && Trans[s] && Trans[s][a]) return Trans[s][a];
  const row = {}; for (const sp of states) row[sp] = (s===sp?1:0);
  return row;
}

function getCost(Costs, t, s, a) {
  if (Costs && (t in Costs)) {
    if (Costs[t][s] && (a in Costs[t][s])) return Number(Costs[t][s][a]);
  }
  if (Costs && Costs[s] && (a in Costs[s])) return Number(Costs[s][a]);
  return 0;
}

function solveDP(params) {
  const { states, actions, T, gamma, Costs, Trans, Salvage } = params;

  const normStationary = (obj)=>{
    for (const s of Object.keys(obj)) for (const a of Object.keys(obj[s]||{})) normalizeRow(obj[s][a]);
  };
  if (Trans && !('0' in Trans)) { normStationary(Trans); }
  else if (Trans) {
    for (const t of Object.keys(Trans)) normStationary(Trans[t]);
  }

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

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function exportConfig(config, results) {
  const blob = new Blob([pretty({config, results})], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'mdp_build.json';
  a.click();
  URL.revokeObjectURL(url);
}

function loadExample() {
  const ex = {
    text: "A delivery robot navigates zones (A,B,C). Each hour it may wait, charge, or deliver. Delivering from A tends to move to B, and from B to C. Charging tends to keep it in place. Horizon 4. Costs: deliver is 2 in A/B, 4 in C; wait is 1; charge is 3. Salvage is 0 everywhere.",
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
}

window.addEventListener('DOMContentLoaded', ()=>{
  $('loadExampleBtn').addEventListener('click', loadExample);

  $('parseBtn').addEventListener('click', ()=>{
    const text = $('nlpInput').value.trim();
    const draft = parseNaturalLanguage(text);
    $('horizon').value = draft.T;
    $('states').value = draft.states.join(',');
    $('actions').value = draft.actions.join(',');
    $('costs').value = JSON.stringify(draft.costs, null, 2);
    $('transitions').value = JSON.stringify(draft.P, null, 2);
    $('salvage').value = JSON.stringify(draft.salvage, null, 2);
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
    if (!window.__lastConfig__) {
      $('diag').textContent = 'Solve first to export.';
      return;
    }
    exportConfig(window.__lastConfig__, window.__lastResults__);
  });
});
