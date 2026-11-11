# Client diagnostics

`ClientOptions.logger` accepts `debug(message)` and `warn(message)` methods for one client instance. `OAuthClientProvider.logger` accepts `warn(message)` for that provider’s authorization flows, including token refresh and credential invalidation.

Both sinks default to `console`. Hosts that own a terminal UI or reserve stdout for a protocol should supply their own sinks. These options do not change global console methods or diagnostics from other client instances.

HTTP request middleware uses the separate `withLogging({ logger })` option.
