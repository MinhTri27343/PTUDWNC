# Actual browser measurements

Generated 2026-10-08T02:41:04.206Z; 210 measured runs; 5 repetitions per cell. Browser: installed Chrome, headless. Node: v22.16.0; OS: win32/x64.

| Variant/client/dataset/mode/scenario | n | Client req | Product calls/SQL | Median ms | Min–max ms | Median bytes |
|---|---:|---:|---:|---:|---:|---:|
| baseline/web/small/cold/normal | 5 | 7 | 5/5 | 33.10 | 28.20–72.30 | 1058 |
| baseline/web/small/warm/normal | 5 | 7 | 5/5 | 27.60 | 17.50–28.10 | 1058 |
| baseline/mobile/small/cold/normal | 5 | 7 | 5/5 | 30.00 | 28.60–33.50 | 1058 |
| baseline/mobile/small/warm/normal | 5 | 7 | 5/5 | 27.80 | 26.70–29.70 | 1058 |
| naive/web/small/cold/normal | 5 | 1 | 5/5 | 70.80 | 66.80–72.80 | 1183 |
| naive/web/small/warm/normal | 5 | 1 | 5/5 | 13.40 | 13.10–29.30 | 1183 |
| naive/mobile/small/cold/normal | 5 | 1 | 5/5 | 70.30 | 66.70–71.10 | 499 |
| naive/mobile/small/warm/normal | 5 | 1 | 5/5 | 14.40 | 13.40–27.10 | 499 |
| batched/web/small/cold/normal | 5 | 1 | 1/1 | 62.80 | 62.00–66.90 | 1183 |
| batched/web/small/warm/normal | 5 | 1 | 1/1 | 15.10 | 13.30–23.30 | 1183 |
| batched/mobile/small/cold/normal | 5 | 1 | 1/1 | 66.50 | 64.80–69.30 | 499 |
| batched/mobile/small/warm/normal | 5 | 1 | 1/1 | 15.30 | 14.80–24.80 | 499 |
| baseline/web/large/cold/normal | 5 | 102 | 100/100 | 213.10 | 208.00–233.40 | 20815 |
| baseline/web/large/warm/normal | 5 | 102 | 100/100 | 195.50 | 195.10–233.20 | 20815 |
| baseline/mobile/large/cold/normal | 5 | 102 | 100/100 | 199.00 | 190.80–311.80 | 20815 |
| baseline/mobile/large/warm/normal | 5 | 102 | 100/100 | 188.10 | 186.90–209.90 | 20815 |
| naive/web/large/cold/normal | 5 | 1 | 100/100 | 148.40 | 143.50–152.80 | 22745 |
| naive/web/large/warm/normal | 5 | 1 | 100/100 | 58.60 | 53.20–63.10 | 22745 |
| naive/mobile/large/cold/normal | 5 | 1 | 100/100 | 145.20 | 141.70–164.80 | 9507 |
| naive/mobile/large/warm/normal | 5 | 1 | 100/100 | 52.30 | 50.10–81.60 | 9507 |
| batched/web/large/cold/normal | 5 | 1 | 1/1 | 79.40 | 78.80–85.60 | 22745 |
| batched/web/large/warm/normal | 5 | 1 | 1/1 | 28.20 | 25.10–29.90 | 22745 |
| batched/mobile/large/cold/normal | 5 | 1 | 1/1 | 71.80 | 68.40–74.00 | 9507 |
| batched/mobile/large/warm/normal | 5 | 1 | 1/1 | 20.90 | 19.00–24.10 | 9507 |
| baseline/web/small/warm/delay | 5 | 7 | 5/5 | 1578.20 | 1568.40–1591.00 | 1058 |
| baseline/mobile/small/warm/delay | 5 | 7 | 5/5 | 1573.00 | 1568.70–1590.70 | 1058 |
| naive/web/small/warm/delay | 5 | 1 | 5/5 | 320.20 | 319.50–326.80 | 1183 |
| naive/mobile/small/warm/delay | 5 | 1 | 5/5 | 329.20 | 320.90–344.00 | 499 |
| batched/web/small/warm/delay | 5 | 1 | 1/1 | 325.90 | 318.50–344.00 | 1183 |
| batched/mobile/small/warm/delay | 5 | 1 | 1/1 | 333.30 | 320.20–336.50 | 499 |
| baseline/web/small/warm/timeout | 5 | 7 | 5/5 | 5053.80 | 5040.50–5073.40 | 663 |
| baseline/mobile/small/warm/timeout | 5 | 7 | 5/5 | 5055.00 | 5029.80–5068.70 | 663 |
| naive/web/small/warm/timeout | 5 | 1 | 5/5 | 1028.20 | 1018.60–1031.50 | 1679 |
| naive/mobile/small/warm/timeout | 5 | 1 | 5/5 | 1030.30 | 1023.20–1038.20 | 1130 |
| batched/web/small/warm/timeout | 5 | 1 | 1/1 | 1030.70 | 1016.40–1032.30 | 1679 |
| batched/mobile/small/warm/timeout | 5 | 1 | 1/1 | 1036.00 | 1027.90–1047.70 | 1130 |
| baseline/web/small/warm/error | 5 | 7 | 5/0 | 50.40 | 45.20–54.10 | 818 |
| baseline/mobile/small/warm/error | 5 | 7 | 5/0 | 31.30 | 26.30–31.90 | 818 |
| naive/web/small/warm/error | 5 | 1 | 5/0 | 31.50 | 29.80–37.50 | 1564 |
| naive/mobile/small/warm/error | 5 | 1 | 5/0 | 28.70 | 24.80–30.80 | 1015 |
| batched/web/small/warm/error | 5 | 1 | 1/0 | 29.00 | 19.70–36.30 | 1564 |
| batched/mobile/small/warm/error | 5 | 1 | 1/0 | 29.20 | 25.70–31.20 | 1015 |

Counts exclude preflight/assets/health/metrics. Payload is uncompressed response-body UTF-8 bytes, not wire traffic. Cold restarts all service processes and the web process but retains OS/browser caches. Warm has one unrecorded warm-up per cell. Screen completion is measured after two animation frames, excluding image loading. Fault runs use small/warm; timed-out service SQL may finish after the screen marker. REST baseline is deliberately sequential and does not dedup. These results do not prove GraphQL is always faster than REST.

Data equivalence checks: 120, all passed if this script completed successfully.