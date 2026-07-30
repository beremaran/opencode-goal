# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-31

### Added

- Persistent per-session `/goal` lifecycle with pause, resume, clear, and status
  controls.
- Independent completion evaluation in a temporary child session.
- Automatic continuation after incomplete evaluations.
- Optional token and turn budgets.
- `get_goal` and `update_goal` tools for model-visible state and claims.
- Durable state across context compaction and OpenCode restarts.
- Provider failure and user interruption safeguards.
- Strict type checking and automated behavioral tests.

[Unreleased]: https://github.com/beremaran/opencode-goal/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/beremaran/opencode-goal/releases/tag/v0.1.0
