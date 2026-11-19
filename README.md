# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ankith-m1006/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ankith-m1006/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that prices every DeFi protocol recording no token **by comparables**. The snapshot's own 128 live tokens give each category a market-cap-to-TVL multiple (median, at least 3 comps, else the global median, clamped to 0.03–3×), tilted by 7-day TVL momentum and by how long the protocol has run with no token:

```
implied = TVL × category comp multiple × growth tilt × maturity tilt
```

The board ranks 198 pre-token protocols, all 40 watchlist protocols plus every candidate below the $50M floor that passes the same wrapper/exchange/version rule. Traded tokens (the comparables) and wrapper records sit in their own tabs. Every row carries a 5-step farm plan priced on the cheapest chain the protocol runs on. The dashboard is static HTML/CSS/JS with no network and no framework, a light glass design, with search, a category filter, sortable columns and a detail drawer that shows the valuation math, the live comparables and the farm plan.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Node 22.18+, standard library only. Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`; open `out/dashboard/index.html`. URL parameters: `?open=<slug>`, `?cat=<category>`, `?tab=comps|aside`, `?q=<text>`, `?wl=1`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
