# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-05-27

### Added
- Initial release of SlopBlock
- On-device AI text detection with hybrid heuristic + two-model ML ensemble
- AI image detection with 3-model ONNX ensemble and metadata forensics (C2PA, PNG chunks, URL patterns)
- YouTube AI video filter using creator-declared synthetic content labels
- Browser extension for Chrome/Edge/Brave/Vivaldi (Manifest V3) and Firefox
- Enhanced Mode — local HTTPS proxy for system-wide filtering across all browsers and apps
- Ad blocking via declarative net request rules and network-level HTTP 204 responses
- Configurable detection thresholds via dashboard
- Token-bucket rate limiting for model inference protection
- LRU classification cache for performance
- Short-text gate to prevent overflagging genuine human social media posts
- Stylometric analysis (inter-sentence Jaccard similarity + opener repetition)
- Academic citation whitelist to reduce false positives on research content
- Human-content whitelist (URLs, @mentions, code blocks)
- Comprehensive evaluation suite with bake-off and live-fire datasets
- Test suite with Jest for classifier, config, and service modules
- GitHub Actions CI pipeline
- CONTRIBUTING.md and open-source contribution guidelines

### Security
- Service token authentication prevents arbitrary web pages from calling the local API
- CORS restricted to chrome-extension:// origins
- Private IP blocking in image fetching
- Model integrity verification via SHA256 hashes

## [Unreleased]

### Planned
- Docker support for cross-platform testing
- Additional language support (non-English slop detection)
- Safari extension
- Mobile companion app
