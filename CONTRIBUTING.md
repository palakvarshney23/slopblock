# Contributing to SlopBlock

Thank you for your interest in improving SlopBlock! This document will get you up and running in minutes.

[![CI](https://github.com/palakvarshney23/slopblock/actions/workflows/ci.yml/badge.svg)](https://github.com/palakvarshney23/slopblock/actions/workflows/ci.yml)

**Judges evaluating the hackathon:** use [`JUDGES.md`](JUDGES.md) instead of this file.

---

## Quick Start

```bash
# 1. Clone the repo

cd SlopBlock

# 2. Download the bundled ONNX model (~84 MB)
git lfs pull

# 3. Install dependencies
npm install

# 4. Run in development mode
npm start          # Electron dev mode with hot reload

# 5. Run tests
npm test           # Jest test suite (74 tests)
npm run test:coverage  # With coverage report
npm run test:marketplace  # Track G bake-off
```

**Requirements:** Node.js 18+ · Windows (primary target) · Git LFS

---

## Architecture Overview

| File | Responsibility |
|---|---|
| `main.js` | Electron main process — window, tray, IPC, settings persistence |
| `classifier.js` | **All detection logic** — text heuristics, ML ensemble, image pipeline, stylometrics |
| `service.js` | Local HTTP API (`:8083`) for the browser extension |
| `proxy.js` | HTTPS MITM proxy — HTML injection, network-level ad blocking |
| `config.js` | Single source of truth for tunable detection parameters |
| `state.js` | Shared runtime feature flags |
| `counts.js` | Persistent session counters |
| `logger.js` | Structured debug logging |
| `extension/` | Browser extension (Chrome MV3 + Firefox) |
| `models/` | Bundled ONNX image model (Git LFS) |

The detection engine is entirely in `classifier.js`. If you want to improve slop detection, that's the file.

---

## Code Style

- **SPDX headers** on every file (GPL-3.0-only)
- **No semicolons** (except where ASI fails)
- **Single quotes** for strings
- **CamelCase** for variables/functions, **UPPER_SNAKE** for constants
- **Comments** explain *why*, not *what*

We don't enforce this with a linter (yet) — please match the surrounding style.

---

## Testing Requirements

Every PR that touches `classifier.js` must include tests for:
1. New heuristic signals (test in `__tests__/classifier.test.js`)
2. New threshold logic (test edge cases)
3. Model integration changes (mock the pipeline)

Every PR that touches `config.js`, `service.js`, or `state.js` must include unit tests.

### Running Tests

```bash
npm test                  # Full suite
npm test -- classifier    # Filter to classifier tests
npm run test:coverage     # With Istanbul coverage report
```

**Coverage target:** >80% for `classifier.js`, `config.js`, `service.js`.

---

## How to Contribute

### Reporting Bugs

Open a GitHub issue with:
- SlopBlock version
- Windows version / browser version
- Steps to reproduce
- Expected vs actual behavior
- A sample text or image URL that was misclassified (if applicable)

### Suggesting Features

Open a GitHub discussion (preferred) or issue. Describe:
- The slop domain (social, news, code, docs, etc.)
- Why current detection misses it
- A concrete example
- Whether you plan to implement it yourself

### Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-signal`)
3. Commit your changes with clear messages
4. Push to your fork
5. Open a PR against `main`

**PR checklist:**
- [ ] Tests added or updated
- [ ] `npm test` passes
- [ ] README updated (if user-facing change)
- [ ] `SLopScan_116_ROADMAP.md` updated (if scoring-relevant)
- [ ] No unrelated files committed

---

## Release Process

Maintainers only (Palak Varshney):

1. Update `package.json` version
2. Update `CHANGELOG.md`
3. Tag: `git tag -a v1.x.x -m "Release v1.x.x"`
4. Push tags: `git push origin v1.x.x`
5. GitHub Actions builds the NSIS installer
6. Draft release with release notes

---

## Community

- **Discord:** [Hackathon Raptors](https://)

- **Homepage:** 

---

## License

By contributing, you agree that your contributions will be licensed under GPL-3.0-only.

Copyright (C) 2026 Palak Varshney <palakvarshney23012003@gmail.com>.
