# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mangkarones3-afk/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mangkarones3-afk/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over the frozen DefiLlama snapshot sealed with the bounty: every protocol in the snapshot that records no token is ranked by an implied launch value fitted from the snapshot's own tokenized protocols — the median market-cap/TVL multiple of its category, shrunk toward the global median — with an out-of-sample test of that model reported on the dashboard itself, and a concrete farm plan (actions, costs, durations) for every ranked protocol. All 40 watchlist protocols are covered, plus every other rankable pre-token protocol the model finds in the snapshot.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. The program writes `board.json` (the ranked board), `data.js` (the same board for the page), `dashboard/` and `screenshots/` into the output directory, and `dossier.json` last.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ram1fzcx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
