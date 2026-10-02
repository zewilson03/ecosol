# Ecosol Domain Instructions

These instructions supplement the global engineering rules. They define domain risk, not a required programming language, framework, database, or hosting platform.

## Domain priorities

- Preserve correctness, confidentiality, traceability, and recoverability for customer and financial data.
- Treat CPF, contact data, credentials, session data, bank identifiers, payment details, and operational logs as sensitive.
- Keep business rules explicit and testable. Do not rely only on client-side checks for security or financial correctness.

## High-risk areas

Treat changes involving financial calculations, payments, boletos, authentication, authorization, bank integrations, database schema or data migrations, secrets, infrastructure, deployment, backups, and production configuration as high risk.

Before changing a high-risk area:

1. Map the current flow, trust boundaries, persisted state, and external side effects.
2. Define expected state transitions and invariants.
3. Identify duplicate, concurrent, timeout, partial-failure, retry, and recovery scenarios.
4. Confirm how the change will be tested, observed, rolled out, and recovered.

## Financial operations and boletos

- Use decimal-safe monetary handling and explicit currency, scale, and rounding rules.
- Require an idempotency strategy when repeating an operation could issue a second boleto, duplicate a charge, record a payment twice, or create inconsistent state.
- Make financial state transitions explicit; reject invalid transitions and retain an audit trail appropriate to the operation.
- Reconcile local state with the bank or provider when external success and local persistence can diverge.
- Retry only when the operation is known to be safe or protected by idempotency.

## Authentication and authorization

- Enforce authorization on the server or trusted backend boundary for every protected action.
- Check resource ownership and role permissions; do not equate authentication with authorization.
- Protect credentials and tokens in storage, transit, logs, errors, and diagnostics.
- For changes to sessions, password recovery, account activation, or administrative access, test expiration, replay, revocation, enumeration, and privilege-escalation scenarios.

## Bank and external integrations

- Use authoritative contracts and documentation. Do not invent provider behavior.
- Define timeouts, error mapping, rate-limit behavior, idempotency, retries, webhook verification, observability, and recovery from partial failures.
- Never expose authorization headers, certificates, client secrets, tokens, or sensitive provider payloads.

## Database and infrastructure

- Preserve existing data and compatibility during migrations; use staged or forward-compatible changes when risk warrants it.
- Do not perform destructive data operations without a reviewed impact and recovery plan.
- Treat backups, restore procedures, secret management, TLS, access controls, persistence, monitoring, and production configuration as part of correctness.

## Validation

Use the project's actual tools. Exercise normal, invalid, duplicate, concurrent, timeout, external-failure, persistence-failure, and recovery paths in proportion to the change. Report any validation that could not be performed.

## Custom Codex agents

This repository defines project-scoped Codex agents in `.codex/agents/`:

- `backend_agent`: implements and investigates backend behavior and uses the feature, bug, and external-integration skills appropriate to the task.
- `security_agent`: performs read-only security and financial-risk analysis.
- `database_agent`: handles SQLite, schema, migration, integrity, concurrency, and persistence work using temporary test databases.
- `reviewer_agent`: performs the final read-only review of diffs and local change sets.

For non-trivial work, delegate independent, well-bounded analysis when the user asks for subagents or parallel work, or when separate read-heavy investigations will materially improve quality. Prefer the specialized agent whose description matches the task. Do not run multiple write-capable agents against the same files. The primary agent owns the final decision, integration, and validation.

Agents inherit the user's installed skills. When delegating, name the relevant skill or risk domain explicitly so the specialist applies the correct workflow. Never delegate approval decisions, destructive production actions, commits, pushes, publication, or deployment.
