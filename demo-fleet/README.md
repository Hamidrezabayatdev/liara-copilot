# Liara Copilot demo fleet

These tiny applications make the hackathon scenarios reproducible against the
real Liara APIs. They contain no credentials and are deployed independently of
the copilot.

- `front/` is the healthy storefront control.
- `api/` deliberately starts on `APP_PORT=3001` while Liara routes to port
  `3000`. Its structured log explains the mismatch. Changing `APP_PORT` to
  `3000` and restarting fixes the 502 without changing code.
- `worker/` exposes a health endpoint and emits a heartbeat. After its first
  successful deployment it is scaled to zero to demonstrate stopped-resource
  diagnosis.

Current live state:

- `https://digishop-front.liara.run` → `200`
- `https://digishop-api.liara.run` → intentional `502` with `PORT_MISMATCH` logs
- `digishop-worker` → successful release, scale `0`

The deployment script is intentionally not stored with tokens. Use the root
`.env` only from a trusted workstation and pass `--team-id` to the Liara CLI.
Keep the API broken for the judge demo; if you approve the proposed fix, restore
`APP_PORT=3001` afterwards.
