# Security

Use GitHub's private vulnerability reporting for this repository when available. Do not post credentials, private test cases, or sensitive outputs in a public issue. If private reporting is unavailable, contact the owner through an existing trusted channel first.

Adapters and schemas are trusted executable inputs, not sandboxed workloads. Treat PR artifacts as untrusted data. Never run PR code in the write-enabled `workflow_run` reporter or expose provider keys to untrusted PR jobs. Read the README's boundaries before adapting these workflows.

If a credential is exposed, revoke it at its provider. Removing it from a file or Git history does not invalidate it.
