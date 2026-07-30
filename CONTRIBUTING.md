# Contributing

Thanks for helping improve OpenCode Goal.

## Before opening an issue

- Search existing issues first.
- Use a bug report for reproducible incorrect behavior.
- Use a feature request for behavior or API proposals.
- Do not disclose security vulnerabilities in a public issue; follow
  [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/beremaran/opencode-goal.git
cd opencode-goal
npm install
npm run check
```

To test the plugin in OpenCode, run `npm run build`, add the checkout's absolute
path to the `plugin` array in `opencode.json`, and restart OpenCode.

## Pull requests

1. Fork the repository and create a focused branch.
2. Add or update tests for behavior changes.
3. Run `npm run check`.
4. Update the README or changelog when users need to know about the change.
5. Open a pull request explaining the problem, the solution, and how it was
   verified.

Keep pull requests small enough to review. Avoid unrelated formatting or
refactors.

By contributing, you agree that your contributions are licensed under the
repository's [MIT License](LICENSE).
