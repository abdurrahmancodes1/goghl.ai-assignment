# Decisions

- `assignment/` is the active application root; the original scaffold remains in place as a backup/reference.
- Submission packaging: the provided Compose file, dev-container, harness, mock services, and original documentation are copied into this Git root. Checker/mocks are byte-identical to the parent. Root npm scripts and `switchboard.json` use `server/` and `client/`; compatibility aliases retain the original quick-start commands. `README.md` documents the Linux requirement for the unchanged checker's process-group crash tests and the existing-service Docker workflow.
- Server credentials come from the process environment or ignored `server/.env`, resolved relative to the configuration module. Injected checker settings take precedence, including its dynamic `PORT`. Missing credentials fail startup with variable names only. Safe placeholders are documented in `server/.env.example`.
- The client currently requires no environment variables and uses relative URLs; `client/.env.example` documents this. No server credentials are exposed to the browser. Git excludes local environments, dependencies, generated output, logs, and editor files while retaining examples, manifests, lockfiles, source, and this document. Git had no tracked or staged files at the environment setup check, so no index removal was necessary.
- MongoDB is treated as standalone. Correctness uses unique/partial indexes, conditional updates, and embedded outbound delivery state rather than multi-document transactions.
- Webhook payloads are stored in `WebhookEvent` before processing. `processing` rows are intentionally not treated as complete, so a retry can finish them after a crash.
- Outbound messages contain their own lease, retry, and provider-delivery state. Provider retries reuse the caller's `clientRef` as `Idempotency-Key`; the local uniqueness scope is `(workspace, clientRef)` because callers are not required to provide globally unique references.
- Worker leases are 15 seconds, fenced by `delivery.leaseOwner`, and provider calls time out after 5 seconds. Pending/retry jobs are selected only when due; sending jobs only when their lease expires.
- Pigeon rate limiting currently uses a shared Redis key per workspace. This is a conservative coordination implementation; it sacrifices some throughput after crashes rather than risking duplicate sends.
- Workspace event sequences are allocated from MongoDB counters and persisted before Redis publication. Redis is only fanout; replay reads MongoDB.

## Verification from the self-contained root (2026-11-25)

- Installed both applications from lockfiles and built the React client successfully in the supplied Node 22 Alpine runtime. Compose configuration and all application/harness entry-point paths validated. SHA-256 checks confirmed all 17 copied infrastructure/documentation files match their parent originals.
- `npm run up` started the five supplied services; both its readiness check and `npm run doctor` printed all required services PASS and Ready. Host Windows Node 24.19.0 then exited with a native `UV_HANDLE_CLOSING` assertion. This host runtime problem remains unresolved. Docker itself is available.
- Ran the unchanged `npm run check` and `npm run check:full` inside a one-off Linux container using the existing Compose network/services, with port 4000 forwarded and service URLs supplied through the environment. Quick check: 24/24. Latest full check: 72.8/75 (L1 24/24, L2 11.8/14, L3 22/22, L5 15/15). The genuine full report is `CHECK_REPORT.json`; hidden Level 4 was not run.
- Known failures: crash inbound completeness was 109/172 messages, and crash-send status matched 11/12 final statuses. The latest multi-instance Retry-After check passed. Startup was observed waiting on the Windows bind-mount filesystem, but the precise cause of inbound loss and the one missing status has not been isolated. These are outstanding correctness/verification risks, not passing requirements.
- The visible login, tenant isolation, live WebSocket and reconnect replay checks passed. This does not establish correctness for every untested race. The browser client remains minimal and was built, not manually exercised end to end.
- The checker stops Pigeon's drizzle. Use `npm run drizzle` when resuming interactive development. No volumes were removed; the only application-data resets were the documented checker workflows. Export actual AI session transcripts into `ai-logs/` before submission; they have not been fabricated or substituted with summaries.

## Targeted product & correctness updates

- Added backward-compatible conversation pagination to `GET /api/conversations`: omitting `page` and `limit` returns the existing array shape; passing `page` or `limit` returns `{ items, page, limit, total, hasMore }`. Added Prev/Next controls in the React sidebar.
- Added `POST /api/conversations/:contact/state` (accepting `open` or `closed`) with session and workspace membership checks, publishing `conversation.state` events, plus a Close/Reopen button in the React conversation header.
- Updated `client/src/main.jsx` to initialize `workspace` from `me.workspaces[0].id` (instead of hard-coding `ws_acme`), refresh the active conversation's messages and metadata on WebSocket events, and reconnect with exponential backoff using `&after=<lastSeq>`.
- Extended `Session.expiresAt` to 24 hours (and `Max-Age=86400` on `sb_session`) on successful `/auth/callback` in `server/src/routes/auth.js`.
- Added `isValidWebhookPayload()` in `server/src/index.js` to return `400` on non-object JSON, missing `id`, or malformed `message.inbound`/`message.status` payloads for known workspaces before calling `ingest()`.
- Outbound worker logic, webhook recovery, database indexes, and backend WebSocket sequencing were left unchanged.

## Post-update verification

- `npm run build` (Vite production build) succeeded (`dist/assets/index-P3y5pgR2.js`, 913ms).
- `npm run check:full` in the Linux Node 22 container scored **72.8 / 75** (`L1 24/24`, `L2 11.8/14`, `L3 22/22`, `L5 15/15`), written to `CHECK_REPORT.json`.
- Remaining limitations: `crash_inbound_complete` stored `109/172` messages (`0.9/3`), `crash_sends_status` matched `11/12` (`0.92/1`), hidden Level 4 was not run, the React UI was built but not manually exercised end to end in a browser, and `ai-logs/` must still be exported before submission.
