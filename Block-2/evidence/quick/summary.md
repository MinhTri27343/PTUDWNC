# Actual browser measurements

Generated 2026-10-08T02:35:52.375Z; 42 measured runs; 1 repetitions per cell. Browser: installed Chrome, headless. Node: v22.16.0; OS: win32/x64.

| Variant/client/dataset/mode/scenario | n | Client req | Product calls/SQL | Median ms | Min–max ms | Median bytes |
|---|---:|---:|---:|---:|---:|---:|
| baseline/web/small/cold/normal | 1 | 7 | 5/5 | 78.00 | 78.00–78.00 | 1058 |
| baseline/web/small/warm/normal | 1 | 7 | 5/5 | 30.60 | 30.60–30.60 | 1058 |
| baseline/mobile/small/cold/normal | 1 | 7 | 5/5 | 28.40 | 28.40–28.40 | 1058 |
| baseline/mobile/small/warm/normal | 1 | 7 | 5/5 | 18.50 | 18.50–18.50 | 1058 |
| naive/web/small/cold/normal | 1 | 1 | 5/5 | 70.20 | 70.20–70.20 | 1183 |
| naive/web/small/warm/normal | 1 | 1 | 5/5 | 29.90 | 29.90–29.90 | 1183 |
| naive/mobile/small/cold/normal | 1 | 1 | 5/5 | 69.50 | 69.50–69.50 | 499 |
| naive/mobile/small/warm/normal | 1 | 1 | 5/5 | 30.50 | 30.50–30.50 | 499 |
| batched/web/small/cold/normal | 1 | 1 | 1/1 | 62.00 | 62.00–62.00 | 1183 |
| batched/web/small/warm/normal | 1 | 1 | 1/1 | 17.10 | 17.10–17.10 | 1183 |
| batched/mobile/small/cold/normal | 1 | 1 | 1/1 | 66.20 | 66.20–66.20 | 499 |
| batched/mobile/small/warm/normal | 1 | 1 | 1/1 | 17.10 | 17.10–17.10 | 499 |
| baseline/web/large/cold/normal | 1 | 102 | 100/100 | 214.90 | 214.90–214.90 | 20815 |
| baseline/web/large/warm/normal | 1 | 102 | 100/100 | 198.00 | 198.00–198.00 | 20815 |
| baseline/mobile/large/cold/normal | 1 | 102 | 100/100 | 194.00 | 194.00–194.00 | 20815 |
| baseline/mobile/large/warm/normal | 1 | 102 | 100/100 | 342.60 | 342.60–342.60 | 20815 |
| naive/web/large/cold/normal | 1 | 1 | 100/100 | 154.70 | 154.70–154.70 | 22745 |
| naive/web/large/warm/normal | 1 | 1 | 100/100 | 65.70 | 65.70–65.70 | 22745 |
| naive/mobile/large/cold/normal | 1 | 1 | 100/100 | 139.40 | 139.40–139.40 | 9507 |
| naive/mobile/large/warm/normal | 1 | 1 | 100/100 | 54.00 | 54.00–54.00 | 9507 |
| batched/web/large/cold/normal | 1 | 1 | 1/1 | 80.30 | 80.30–80.30 | 22745 |
| batched/web/large/warm/normal | 1 | 1 | 1/1 | 32.10 | 32.10–32.10 | 22745 |
| batched/mobile/large/cold/normal | 1 | 1 | 1/1 | 69.90 | 69.90–69.90 | 9507 |
| batched/mobile/large/warm/normal | 1 | 1 | 1/1 | 25.00 | 25.00–25.00 | 9507 |
| baseline/web/small/warm/delay | 1 | 7 | 5/5 | 1579.10 | 1579.10–1579.10 | 1058 |
| baseline/mobile/small/warm/delay | 1 | 7 | 5/5 | 1568.90 | 1568.90–1568.90 | 1058 |
| naive/web/small/warm/delay | 1 | 1 | 5/5 | 330.00 | 330.00–330.00 | 1183 |
| naive/mobile/small/warm/delay | 1 | 1 | 5/5 | 336.00 | 336.00–336.00 | 499 |
| batched/web/small/warm/delay | 1 | 1 | 1/1 | 323.10 | 323.10–323.10 | 1183 |
| batched/mobile/small/warm/delay | 1 | 1 | 1/1 | 323.20 | 323.20–323.20 | 499 |
| baseline/web/small/warm/timeout | 1 | 7 | 5/5 | 5056.10 | 5056.10–5056.10 | 663 |
| baseline/mobile/small/warm/timeout | 1 | 7 | 5/5 | 5050.10 | 5050.10–5050.10 | 663 |
| naive/web/small/warm/timeout | 1 | 1 | 5/5 | 1033.50 | 1033.50–1033.50 | 1679 |
| naive/mobile/small/warm/timeout | 1 | 1 | 5/5 | 1036.70 | 1036.70–1036.70 | 1130 |
| batched/web/small/warm/timeout | 1 | 1 | 1/1 | 1028.50 | 1028.50–1028.50 | 1679 |
| batched/mobile/small/warm/timeout | 1 | 1 | 1/1 | 1026.40 | 1026.40–1026.40 | 1130 |
| baseline/web/small/warm/error | 1 | 7 | 5/0 | 31.00 | 31.00–31.00 | 818 |
| baseline/mobile/small/warm/error | 1 | 7 | 5/0 | 29.90 | 29.90–29.90 | 818 |
| naive/web/small/warm/error | 1 | 1 | 5/0 | 16.30 | 16.30–16.30 | 1564 |
| naive/mobile/small/warm/error | 1 | 1 | 5/0 | 17.10 | 17.10–17.10 | 1015 |
| batched/web/small/warm/error | 1 | 1 | 1/0 | 17.20 | 17.20–17.20 | 1564 |
| batched/mobile/small/warm/error | 1 | 1 | 1/0 | 18.10 | 18.10–18.10 | 1015 |

Counts exclude preflight/assets/health/metrics. Payload is uncompressed response-body UTF-8 bytes, not wire traffic. Cold restarts all service processes and the web process but retains OS/browser caches. Warm has one unrecorded warm-up per cell. Screen completion is measured after two animation frames, excluding image loading. Fault runs use small/warm; timed-out service SQL may finish after the screen marker. REST baseline is deliberately sequential and does not dedup. These results do not prove GraphQL is always faster than REST.

Data equivalence checks: 24, all passed if this script completed successfully.