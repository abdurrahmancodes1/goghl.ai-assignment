# Switchboard submission

This directory is the project and Git root. Node 22+, npm, and Docker Compose
are required. MongoDB, Redis, and all simulators come from the supplied Compose
file; no separately installed database services are needed. The application
uses JavaScript, Express, Mongoose, Redis, and React/Vite.

## Install and configure

From this directory run `npm run install:app`. This installs `server/` and
`client/` from their lockfiles. The root package has no dependencies.

Copy `server/.env.example` to `server/.env` and replace placeholders using the
provided simulator contracts and configuration. Existing process variables
override the file. Do not commit local environment files. The root
`.env.example` lists application and supplied infrastructure settings; root
`.env` is only automatically read by Docker Compose, not npm or the checker.
The unchanged Compose file contains the supplied public simulator development
keys. Application source does not embed those keys.

The checker supplies its own application variables, so it does not require
an application `.env` in a clean clone. For customized checker settings, export
them in the shell as well as configuring the services consistently.

## Run

```sh
npm run up
npm run doctor
npm run dev:server
# In another terminal, from this directory:
npm run dev:client
```

Open http://localhost:5173. Vite proxies `/api`, `/auth`, `/healthz`, and `/ws`
to http://localhost:4000. The backend listens on `PORT`. The registered login
callback remains http://localhost:4000/auth/callback even when the checker
uses other ports for application instances.

`npm run build` produces `client/dist/`. `npm start` starts the server.
The supplied `scaffold:*` commands are retained as aliases to the new server
and client, so the original quick-start instructions remain usable.

## Check

Stop your development server first. These commands launch application
instances themselves and **delete application test data**, as documented in
the original brief:

```sh
npm run check
npm run check -- --levels 5
npm run check:full
```

The full check writes `CHECK_REPORT.json`. The checker uses `sh` and Unix
process-group SIGKILL, so run it under Linux, WSL with Linux Node, or the
included dev-container. Native Windows Node is not a reliable environment
for those crash tests. The checker and mock services have not been modified.

To run a Linux check while using the existing Compose services from Windows,
run this PowerShell command from this directory (port 4000 must be free):

```powershell
docker compose run --rm --no-deps -p 4000:4000 `
  -v "${PWD}:/workspace" -w /workspace `
  -e MONGO_URL=mongodb://mongo:27017/switchboard `
  -e REDIS_URL=redis://redis:6379 `
  -e PIGEON_URL=http://pigeon:4010 `
  -e OIDC_ISSUER=http://host.docker.internal:4020 `
  pigeon npm run check:full
```

This one-off container runs the checker instead of another mock service.
It uses the same Compose network and databases; its published port receives
webhooks at the existing `host.docker.internal:4000` destination. Use
`npm run check` in place of `npm run check:full` for the quick check.
Install dependencies in that Linux runtime before checking if moving from
a different platform; frontend build tools may have platform-specific binaries.

## Submit

Follow `SUBMISSION.md` after reading `DECISIONS.md`. Export every actual AI
session transcript into `ai-logs/`; they cannot be substituted with summaries.
Keep the generated full checker report, lockfiles, source, examples, and
documentation in the submission. Do not include `.env`, `node_modules`, or
build output. No commit or push is performed by these setup scripts.

Original specifications are in `BRIEF.md`, `PIGEON.md`, and `REFERENCE.html`
or `REFERENCE.pdf`. Paybox and search documentation are preserved as supplied;
the application does not implement these optional features.

## Current verification

On 2026-11-25 the Linux Node 22 installation and client production build passed.
The quick checker scored 24/24; the full checker scored 71.3/75. See the actual
`CHECK_REPORT.json` and the remaining crash/retry failures in `DECISIONS.md`.
Hidden Level 4 and manual browser testing were not performed.

On this Windows host, `npm run up` and `npm run doctor` reached Ready with all
required services passing, but Node 24.19.0 then hit a native
`UV_HANDLE_CLOSING` assertion on shutdown. The Linux checker invocation above
completed successfully. Do not interpret the host assertion as a missing
Compose service or the checker scores as proof that all P0 cases pass.
