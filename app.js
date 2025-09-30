// Minimal MDP finite-horizon (undiscounted) DP solver
const $ = id => document.getElementById(id);

// ---------- Helpers ----------
function csvToList(s){
  return (s||'').split(',').map(x=>x.trim()).filter(Boolean);
}

function parseJSON(txt, fallback={}){
  if(!txt || !txt.trim()) return fallback;
  try { return JSON.parse(txt); }
  catch(e){ throw new Error("Invalid JSON: " + e.message); }
}

function normalizeRow(row){
  const keys = Object.keys(row||{});
  const sum = keys.reduce((acc,k)=> acc + Number(row[k]||0), 0);
  if (sum <= 0) {
    const p = 1 / (keys.length || 1);
    keys.forEach(k => row[k] = p);
  } else {
    keys.forEach(k => row[k] = Number(row[k]) / sum);
  }
}

function getTransition(Trans, t, s, a, states){
  // time-varying: Trans[t][s][a] if exists
  if (Trans && Object.prototype.hasOwnProperty.call(Trans, String(t))) {
    const layer = Trans[String(t)];
    if (layer && layer[s] && layer[s][a]) return layer[s][a];
  }
  // stationary: Trans[s][a]
  if (Trans && Trans[s] && Trans[s][a]) return Trans[s][a];
  // fallback: identity
  const row = {};
  (states||[]).forEach(sp => row[sp] = (sp===s ? 1 : 0));
  return row;
}

function getCost(Costs, t, s, a){
  // time-varying: Costs[t][s][a]
  if (Costs && Object.prototype.hasOwnProperty.call(Costs, String(t))) {
    const layer = Costs[String(t)];
    if (layer && layer[s] && Object.prototype.hasOwnProperty.call(layer[s], a))
      return Number(layer[s][a]);
  }
  // stationary: Costs[s][a]
  if (Costs && Costs[s] && Object.prototype.hasOwnProperty.call(Costs[s], a))
    return Number(Costs[s][a]);
  return 0;
}

function pretty(obj){ return JSON.stringify(obj, null, 2); }

// ---------- DP Solver ----------
function solveFiniteHorizon({states, actions, T, Costs, Trans, Salvage}){
  // Normalize transitions for each stage or stationary
  const normalizeStationary = (obj)=>{
    Object.keys(obj||{}).forEach(s=>{
      Object.keys(obj[s]||{}).forEach(a=> normalizeRow(obj[s][a]));
    });
  };
  const isLayered = (Trans && Object.keys(Trans).some(k => !isNaN(parseInt(k,10))));
  if (isLayered){
    Object.keys(Trans||{}).forEach(t => normalizeStationary(Trans[t]));
  } else {
    normalizeStationary(Trans||{});
  }

  // V[T] = salvage
  const V = Array(T+1).fill(null).map(()=> ({}));
  states.forEach(s => V[T][s] = Number((Salvage||{})[s] ?? 0));
  const Pi = Array(T).fill(null).map(()=> ({}));

  // Backward recursion: undiscounted
  for (let t = T-1; t >= 0; --t){
    for (const s of states){
      let bestA = null;
      let bestVal = +Infinity;
      for (const a of actions){
        const c = getCost(Costs, t, s, a);
        const row = getTransition(Trans, t, s, a, states);
        let expNext = 0;
        for (const sp of states) expNext += (row[sp] || 0) * V[t+1][sp];
        const q = c + expNext;
        if (q < bestVal){ bestVal = q; bestA = a; }
      }
      V[t][s] = bestVal;
      Pi[t][s] = bestA;
    }
  }
  return { V, Pi };
}

// ---------- Example filler ----------
function fillExample(){
  const exampleProblem =
`A delivery robot navigates zones (A,B,C). Each hour it may wait, charge, or deliver.
Delivering from A tends to move to B, and from B to C. Charging tends to keep it in place.
Horizon T = 4. Costs: deliver is 2 in A/B, 4 in C; wait is 1; charge is 3. Salvage is 0.`;

  const transitions = {
    "A":{"wait":{"A":0.8,"B":0.2},"charge":{"A":0.9,"B":0.1},"deliver":{"B":0.7,"C":0.3}},
    "B":{"wait":{"B":0.8,"C":0.2},"charge":{"A":0.4,"B":0.6},"deliver":{"C":0.8,"B":0.2}},
    "C":{"wait":{"C":1.0},"charge":{"B":1.0},"deliver":{"C":1.0}}
  };
  const costs = {
    "A":{"wait":1,"charge":3,"deliver":2},
    "B":{"wait":1,"charge":3,"deliver":2},
    "C":{"wait":1,"charge":3,"deliver":4}
  };
  const salvage = {"A":0,"B":0,"C":0};

  $('problem').value = exampleProblem;
  $('states').value = "A,B,C";
  $('stages').value = 4;
  $('actions').value = "wait,charge,deliver";
  $('constraints').value = "—";
  $('transitions').value = pretty(transitions);
  $('costs').value = pretty(costs);
  $('salvage').value = pretty(salvage);
  $('valueFn').textContent = "(click Solve)";
}

// ---------- Wire up UI ----------
function $(id){ return document.getElementById(id); }

window.addEventListener('DOMContentLoaded', ()=>{
  // Placeholder already fades; no extra code needed.

  $('exampleBtn').addEventListener('click', fillExample);

  $('solveBtn').addEventListener('click', ()=>{
    try{
      const states = csvToList($('states').value);
      const actions = csvToList($('actions').value);
      const T = Math.max(1, parseInt($('stages').value || '1', 10));
      const Costs = parseJSON($('costs').value, {});
      const Trans = parseJSON($('transitions').value, {});
      const Salvage = parseJSON($('salvage').value, {});

      if (!states.length) throw new Error("States are required (comma-separated).");
      if (!actions.length) throw new Error("Actions are required (comma-separated).");

      const { V, Pi } = solveFiniteHorizon({states, actions, T, Costs, Trans, Salvage});
      $('valueFn').textContent = pretty({ V, policy: Pi });
    } catch(err){
      $('valueFn').textContent = "Error: " + err.message;
    }
  });
});
