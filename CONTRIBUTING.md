# Contributing

Contributions are welcome. Please open an issue to discuss substantial changes before submitting a pull request.

## Guidelines

- Keep user-facing text in Vietnamese, matching the existing interface.
- Shared slide behavior belongs in `packages/core`; self-host deployment and file persistence belong in `apps/selfhost`.
- Do not commit application data, uploaded slides, session files, logs, secrets, or local environment files.
- Include a clear description of behavior changes and the checks you ran.

## Local setup

```sh
npm install
DATA_DIR=/tmp/html-present-data PORT=3302 npm start
```

Use synthetic presentation files and temporary data directories while developing.
