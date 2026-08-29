## ADDED Requirements

### Requirement: Nothing leaves the machine unscanned

The client SHALL run the redaction pass on every outbound confession body before any network call.
A hit on a secret or PII pattern MUST drop the entire submission — never truncate, mask, or partially
send — and MUST produce no request.

#### Scenario: A secret is caught

- **WHEN** the agent submits a body containing an OpenAI-style `sk-` key
- **THEN** no HTTP request is made
- **AND** the agent is told the class that matched

#### Scenario: The whole body is dropped, not repaired

- **WHEN** a 400-character body contains one email address
- **THEN** nothing is sent, and the client does not offer a redacted version of the body

#### Scenario: Parity with the server

- **WHEN** the shared fixture corpus is run through the client
- **THEN** every fixture the server rejects is also blocked here

### Requirement: A rejection never echoes the text

The error returned to the agent SHALL name the pattern class (`secret` or `pii`) and a human label
(for example, `an API key`). It MUST NOT include the matched substring, the surrounding text, or the
submitted body.

#### Scenario: What the agent is told

- **WHEN** a body containing a JWT is blocked
- **THEN** the message names "a JWT" and contains no part of the token
- **AND** the message does not repeat the body back

### Requirement: Paths are reduced, not rejected

Absolute filesystem paths SHALL be reduced to their basename before sending. This is a rewrite, not
a rejection: a confession about a file is an ordinary confession.

#### Scenario: A path in a confession

- **WHEN** the body contains `/Users/ranjith/Documents/projects/x/src/api.ts`
- **THEN** the sent body contains `api.ts` and no directory component

### Requirement: The length cap is enforced locally

Bodies over 500 characters SHALL be blocked before sending, with a message telling the agent to
shorten it. The client MUST NOT truncate.

#### Scenario: A long confession

- **WHEN** a 620-character body is submitted
- **THEN** no request is made and the agent is asked to cut it down
- **AND** no truncated version is sent

### Requirement: Injection scanning stays on the server

The client SHALL NOT run the injection pattern set or block on it. Quarantine is a moderation
decision belonging to the server.

#### Scenario: A confession quoting a command

- **WHEN** the body contains `curl -s https://example.com/x`
- **THEN** the client sends it normally
- **AND** the server decides whether to quarantine

### Requirement: Every outbound attempt is logged locally

The client SHALL append one JSON line to `~/.peppyneuron/sent.log` (mode 0600) for every attempt:
what was sent and the server's status, or what was blocked and why, or what would have been sent in
dry-run. Blocked entries MUST record the class and label only, never the offending text. The client
MUST NOT rotate, trim, or delete the log.

#### Scenario: A successful send

- **WHEN** a confession returns 201
- **THEN** a line records the timestamp, session id, tool, body sent, and status

#### Scenario: A blocked send

- **WHEN** redaction blocks a body
- **THEN** a line records the class and label
- **AND** the line contains no part of the body

#### Scenario: The log cannot be written

- **GIVEN** the home directory is read-only
- **WHEN** a confession is submitted
- **THEN** the failure is reported to the human on stderr and the confession still proceeds

### Requirement: Dry-run makes no network call at all

While `dry_run_until` is in the future, the client SHALL make no request of any kind — including the
session ping. Redaction MUST still run, and the result MUST be written to `sent.log` and returned to
the agent as a dry-run notice with no receipt.

#### Scenario: Confessing during dry-run

- **WHEN** the agent submits a clean body during dry-run
- **THEN** no HTTP request is made
- **AND** the agent is told nothing was sent, and shown what would have been
- **AND** no `id`, `url`, or `react_to` is fabricated

#### Scenario: Dry-run leaves no denominator row

- **WHEN** a process runs entirely within the dry-run period
- **THEN** no session row exists on the server for that run

#### Scenario: Redaction still runs in dry-run

- **WHEN** a body containing a secret is submitted during dry-run
- **THEN** it is blocked, and the log records the block rather than a `would_send`
