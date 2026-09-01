# Changelog

## [0.1.3](https://github.com/Peppy-Neuron/peppyneuron-mcp/compare/v0.1.2...v0.1.3) (2026-09-01)


### Bug Fixes

* log the session ping's correlation id, like every other line ([0b4b1fe](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/0b4b1fe66570dc473fda71f2271a398216d9fe33))
* log the session ping's correlation id, like every other line ([b20dc9f](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/b20dc9f0b14304fd1d234793a0eb90fd368b231f))

## [0.1.2](https://github.com/Peppy-Neuron/peppyneuron-mcp/compare/v0.1.1...v0.1.2) (2026-09-01)


### Bug Fixes

* bring server.json's description under the registry's 100-char cap ([dcb74e2](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/dcb74e2947c44370df33d1d570563589a14f1f44))
* bring server.json's description under the registry's 100-char cap ([6a9379c](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/6a9379c5bf1ece759c4a7ea27ea1b020687a0bd4))

## [0.1.1](https://github.com/Peppy-Neuron/peppyneuron-mcp/compare/v0.1.0...v0.1.1) (2026-09-01)


### Bug Fixes

* **readme:** correct the status block the 0.1.0 publish falsified ([9c64df7](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/9c64df79f1a3d3b34b961f4447e2936b00ffde95))
* **readme:** correct the status block the 0.1.0 publish falsified ([388884a](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/388884afd858e564b8f7f976c9748f89d4f4df87))

## 0.1.0 (2026-09-01)


### Features

* implement the MCP server, init and status ([33eb65b](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/33eb65b94ce667f5a5de3fbdb416a712ccda0171))


### Bug Fixes

* bound every request and scrub keys on the structured path ([fc07905](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/fc07905b854956b8c9b392726bbb1706a251102c))
* five defects found reviewing the client implementation ([0026deb](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/0026deba44b35c48e422d327a0c8232219bb859d))
* make init's second-agent guard see a key in the environment ([964490c](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/964490c850842628e525f30ec0cdf0c0c4b0dfe7))
* re-check dry-run on every call instead of once at startup ([7a08986](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/7a089865f7e25542cf31624908c292c000da8437))
* re-read the config so ending dry-run reaches a running server ([93d6f8a](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/93d6f8a1f0e5c748b476d4bc71c54e23f34a8504))
* re-read the config so ending dry-run reaches a running server ([161d57d](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/161d57ddedf25d7b7c10d7100a13cdb2eda3d1cf))
* stop guarding the Claude workflows on author_association ([b3221f2](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/b3221f2125d33033df38c971eda5b3b27f042898))
* treat an unreadable success envelope as an error, not a crash ([83befca](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/83befcac6c60818419a07491e70305a92b84e741))
* write config.json and sent.log 0600 even when they already exist ([57856e2](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/57856e2aaef7fafec8890662821f3506ce51fe0f))


### Code Refactoring

* check EXTRA_CONTEXT against the codes the server can return ([d4798a6](https://github.com/Peppy-Neuron/peppyneuron-mcp/commit/d4798a6504565e47ff63376d82640519ca44972a))
