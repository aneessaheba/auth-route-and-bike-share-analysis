# Bike-Share Pass Optimizer

Single-agent ReAct + MRKL workflow that evaluates whether a rider should purchase a Divvy (Chicago) bike-share membership or remain on pay-per-ride pricing. The agent reads public trip data (CSV) and the official pricing page, invokes tool calls to analyze rides and scrape policy text, and produces a transparent Thought → Action → Observation → Final Answer trace with citations.

## Project Layout

```
bike-analysis/
├── agent/                    # ReAct agent, tool wrappers, and pricing parser
├── public/                   # Front-end (static HTML/CSS/JS) served by Express
├── data/
│   ├── 202401-divvy-tripdata.csv (downloaded dataset)
│   ├── 202403-divvy-tripdata.csv (downloaded dataset)
│   └── samples/              # Trimmed CSVs used for acceptance runs
├── scripts/                  # Utility runners (e.g., acceptance scenarios)
├── server.js                 # Express server + API
├── package.json
└── README.md
```

## Getting Started

1. Install dependencies
   ```bash
   cd bike-analysis
   npm install
   ```

2. Start the web experience
   ```bash
   npm start
   ```
   Navigate to `http://localhost:4000`, upload a Divvy trip CSV (one month) and provide the pricing URL (`https://divvybikes.com/pricing`). The UI shows:
   - ReAct timeline (Thought, Action, Observation, Final Answer)
   - Cost comparison with membership vs pay-per-use
   - Weekly rollup table with spend per plan
   - Tool-call log (tool, argument hash, latency, success/error) and policy citations

3. Sample data is included under `data/samples` (≈500–800 rides each). Use those files to exercise the workflow without downloading the full monthly CSVs.

## MRKL Tooling

| Tool               | Input schema                                   | Behavior |
| ------------------ | ----------------------------------------------- | -------- |
| `csv_sql`          | `{ "sql": string }`                             | Executes read-only SQL via DuckDB against the uploaded CSV. Returns `{ success, data: { rows, row_count, source }, ts }`. |
| `policy_retriever` | `{ "url": string, "query": string, "k"?: number }` | Fetches the pricing page, extracts textual snippets, scores by keyword match, and returns passages with source + score. |
| `calculator`       | `{ "expression": string, "units"?: string }`    | Safe arithmetic using MathJS. Only digits and + - * / ( ) allowed. |

The agent loops via a ReAct controller: generate Thought → choose Action/tool → capture Observation → repeat until it constructs the Final Answer. Every action is logged with latency, deterministic `argsHash`, success flag, and stop reason (e.g., `Completed`, `tool_error`). Clause-level pricing citations are persisted for downstream justification.

## Acceptance Scenarios

Run both sample months programmatically:
```bash
npm run example
```
Results (Divvy pricing as of 2025-10-27, scraped live with stored citations):

1. **Divvy March 2024 subset (800 rides, heavy e-bike minutes)**  
   Decision: **Pay Per Ride/Minute** — pay-per-use \$2,373.62 vs. membership \$2,385.43.  
   Membership adds \$11.99 (converted monthly from \$143.90/year) while unlock + \$0.19/min pricing already covers these trips efficiently, so the agent favors staying à la carte.  
   Run stats: 14 steps, stop reason `Completed`.

2. **Divvy January 2024 subset (500 rides, more classic time)**  
   Decision: **Buy Monthly Membership** — membership \$1,552.56 vs. pay-per-use \$1,591.12.  
   The rider pays the same \$0.19/min surcharges but the membership (converted \$11.99/month) trims total cost below the unlock-heavy pay-per-use plan, so the agent recommends the pass.  
   Run stats: 14 steps, stop reason `Completed`.

Both paragraphs satisfy the acceptance criteria: one case where membership wins, one where paying per ride wins. Each run includes the full reasoning trace, weekly comparison table, and policy citations surfaced in the UI and JSON response.

## Implementation Notes & Assumptions

- Pricing parser converts annual membership figures to monthly equivalents when only yearly rates are published (`Converted published annual membership price to a monthly equivalent.` appears in assumptions).
- Divvy single-ride pricing is modeled as \$1 unlock + \$0.19/min; no flat fare is double-counted.
- If pricing text lacks explicit minutes or surcharges, the agent defaults conservatively (e.g., 30-minute inclusion) and records the assumption.
- CSV SQL is strictly read-only; attempting DDL/DML will return a tool error.
- Policy retrieval relies on publicly accessible content; for other cities, point the UI at the relevant pricing URL and supply the matching trip CSV.

## Troubleshooting

- **Pricing page blocked / changed**: rerun with `npm run example` to confirm scraping still surfaces the required snippets. Update `agent/utils/policyParser.js` keyword heuristics if the layout evolves.
- **Large CSVs**: DuckDB streams the data; however, selecting a filtered monthly subset (≈500–1000 rides) keeps UI responses fast.
- **Network failures**: The agent surfaces tool errors in the timeline. Retry, or provide an offline snapshot of the pricing text if necessary.
