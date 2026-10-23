# Recovery Lab
Dependency-free disposable Node HTTP service for a real Liara DevOps/SRE demonstration. No database, tokens, paid add-ons, or unauthenticated fault-control endpoint. Port 3000; `/api/health` returns bounded JSON. Docker performs no package installation or application build.

The healthy revision returns 200. A separate controlled-failure revision returns 500 and logs `RELEASE_CONFIG_INVALID`; restarting cannot change its source constant. Changing revisions requires the product's immutable deployment proposal and exact-hash approval. This is a test application, not a hardcoded diagnosis in the agent.
