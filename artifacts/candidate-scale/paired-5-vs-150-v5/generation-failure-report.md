# Candidate-scale v5 generation failure

- Status: preserved negative generation result
- Raw candidates returned: **150**
- Contract-valid candidates: **96**
- Rejected candidates: **54**
- Paid architect calls: **15**
- Actual spend: **$1.16333**
- Valid-pool diversity: **96/96/96** exact/meaningful/signature unique
- Portfolio emitted: **No**
- Performance evaluation started: **No**

The dominant frozen-contract failure was a candidate setting `requireCompleteContext=true` while omitting one or more declared role context sources. The failure was preserved; rejected packages were not repaired or replaced after seeing performance.

Receipt hash: `d1dd3ded907f6c39b3d80a0646c99dc07bda15e5f397cf06dcb9930f030ae098`
