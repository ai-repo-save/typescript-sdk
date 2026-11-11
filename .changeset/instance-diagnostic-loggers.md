---
'@modelcontextprotocol/client': patch
---

Allow hosts to route client and OAuth diagnostics through instance-scoped logger sinks. `ClientOptions.logger` accepts `debug` and `warn`; `OAuthClientProvider.logger` accepts `warn`. Both retain console output by default. Protocol validation, credential invalidation, and diagnostic message contents are unchanged.
