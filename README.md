# NoteToPlan

A full-stack productivity application that converts messy notes into structured tasks and shows its actual backend processing through a live workflow diagram and replayable execution history.

## Included source

- `artifacts/notetoplan/`: React + Vite frontend
- `artifacts/api-server/`: Express + TypeScript backend and tests
- `lib/db/`: PostgreSQL schema and Drizzle configuration
- `lib/api-spec/`: OpenAPI contract and client generation
- `lib/api-client-react/` and `lib/api-zod/`: typed API clients and validation
- `lib/integrations-openai-ai-server/`: server-side AI integration
- Workspace configuration, dependency lockfile, scripts, and Replit configuration

The ZIP contains a snapshot of the current source files, not Git history. Installed dependencies, compiled builds, credentials, local agent files, and database records are excluded.

## Upload to GitHub

Extract the ZIP and upload the contents of the `NoteToPlan` folder to your repository. Keep the directory structure intact.

Alternatively, from inside that folder:

```bash
git init
git add .
git commit -m "Add NoteToPlan application"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Replace `YOUR_GITHUB_REPOSITORY_URL` with your own repository URL. These commands assume a new, empty remote repository.

## Installation and checks

Use Node.js 24 and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test:notetoplan
```

## Runtime setup

The application requires PostgreSQL and server-side AI configuration. Credentials and saved notes/tasks are not bundled in this source export. Configure environment variables securely in the environment where you run the app; do not commit credentials to GitHub.

Replit service metadata is included. The frontend and backend are separate services, and API requests use `/api`. If you host elsewhere, configure equivalent routing and the required service environment before running the application. Uploading code to GitHub does not itself host the app or copy its database.

See `replit.md` and each service's `package.json` for project-specific commands.
