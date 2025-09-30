# [MDP Builder Tool](https://robert-z-lehr.github.io/MDP-Tool/)

A small GitHub Pages app that:
- takes a natural-language problem,
- drafts MDP/POMDP elements (editable),
- solves a finite-horizon, discounted DP (value function and optimal policy as outputs),
- optionally calls the OpenAI API to help extract a JSON skeleton for states/actions/costs/transitions/salvage.

**Value Function is an output** computed by backward DP. Inputs: States, Actions, Costs, Transitions, Salvage `V_T`, Horizon `T`, Discount `γ`.

## Files
- `index.html` — UI (Assistant panel, Problem textbox, Invariants, MDP inputs, Results)
- `styles.css` — minimal styles
- `app.js` — parser, DP solver, and optional OpenAI integration

## Quick Start (GitHub Pages)
1. Create a repo (e.g., `mdp-builder`).
2. Add `index.html`, `styles.css`, `app.js` at the repo root (or in `/docs`).
3. In **Settings → Pages**, set:
   - Source: `main`
   - Folder: `/` (root) or `/docs`
4. Open the published URL.

## How to Use
1. Paste a natural-language problem in **1) Describe the problem**.
2. Click **Draft MDP from text** to seed fields. Edit States, Actions, Costs, Transitions, Salvage.
3. Set **Horizon T** and **Discount γ**.
4. Click **Solve DP**. The app outputs:
   - `V_t(s)` for `t=T,...,0`
   - policy `π_t(s)` for `t=0,...,T-1`
5. Use **Export JSON** to download `{config, results}`.

## Optional: OpenAI Assistant
**Warning:** Putting API keys in client-side code is not secure. For demonstrations only.

- Enter your key and model (`gpt-4o-mini` by default).
- Describe what you want (e.g., “extract JSON for states, actions, transitions, salvage; ensure rows sum to 1”).
- Click **Ask Assistant**. Review the JSON in **Assistant Output**.
- Click **Apply JSON** to populate app fields.

### Safer Setup (Serverless Proxy)
Deploy a minimal proxy that holds your API key:

**Cloudflare Workers (TypeScript/JS)**
```js
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method !== 'POST') return new Response('POST only', {status:405});
    const body = await req.text();
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`
      },
      body
    });
    return new Response(await r.text(), {status:r.status, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  }
};
