# Dynamics 365 Project Operations — Migration Tool

A browser-based migration tool for transferring **D365 Project Operations** data (projects, tasks, team members, dependencies, assignments, buckets, and sprints) between Dataverse environments. Built with React, TypeScript, and Fluent UI — authenticates via Azure AD and communicates directly with the Dataverse Web API and Schedule API.

> **Disclaimer**
> This project was vibe-coded by [@slimrouissi](https://github.com/slimrouissi) and is provided **as-is**, with **no guarantee, warranty, or support** of any kind. It is intended solely as an **example and reference implementation**. Only **Option 3 (Power Apps + Power Automate)** has been tested in practice. Use at your own risk.

---

## Features

- **Guided 4-step wizard** — Select Projects → Preview & Validate → Configure Options → Execute Migration
- **Azure AD authentication** — MSAL-based SSO with silent token refresh and popup fallback
- **Dual-environment connectivity** — connects to source and destination Dataverse orgs simultaneously
- **Full entity coverage** — migrates projects, WBS task hierarchies, team members, task dependencies, resource assignments, buckets, and sprints
- **Schedule API integration** — uses `msdyn_CreateProjectV1`, OperationSets, and `PssCreateV1` for write operations that respect D365 business logic
- **Configurable migration options**:
  - Naming strategy (keep original, add prefix, or custom names)
  - Date handling (keep dates or shift to today)
  - Team member strategy (generic resource, match by name, or skip)
  - Conflict handling (skip or duplicate)
- **Real-time progress tracking** with per-project stage indicators and OperationSet logs
- **Validation** — pre-migration checks for circular dependencies, orphaned tasks, and data integrity
- **ID mapping** — maintains a complete old-to-new ID mapping table for traceability

## Architecture

```
src/
├── auth/                  # MSAL authentication (authConfig, useAuth hook)
├── clients/               # API clients
│   ├── DataverseClient    # Generic Dataverse Web API client (GET/POST/PATCH)
│   └── ScheduleApiClient  # D365 Schedule API wrapper (OperationSets, PssCreate)
├── components/
│   ├── wizard/            # 4-step migration wizard UI
│   ├── preview/           # Entity counts, task tree, team member list
│   └── execution/         # Progress bars, OperationSet logs, completion summary
├── config/                # Environment URLs, app constants
├── hooks/                 # React hooks (useEnvironments, useMigration, useMigrationWizard)
├── pages/                 # MigrationPage (top-level layout)
├── services/
│   ├── SourceService      # Reads all entities from source environment
│   ├── TargetService      # Writes entities to destination via Schedule API
│   ├── MigrationOrchestrator  # Coordinates the full migration workflow
│   ├── ValidationService  # Pre-migration data integrity checks
│   └── IdMappingService   # Old → new ID mapping
├── types/                 # TypeScript interfaces (migration entities, UI state, OperationSets)
└── utils/                 # Entity mapper, task sorter, OperationSet batcher
```

### Alternative Implementations

This repository also includes two additional migration approaches (not tested):

| Option | Path | Description |
|--------|------|-------------|
| **Option 1** | `Option1-PowerShell/` | PowerShell scripts for headless/automated migration |
| **Option 2** | `Option2-CSharp/` | C# console application using the Dataverse SDK |
| **Option 3** | `Option3-PowerApps-PowerAutomate/` | Power Apps canvas app + Power Automate flows (**tested**) |

## Prerequisites

- **Node.js** 18+ and npm
- An **Azure AD App Registration** with:
  - Delegated permissions for Dynamics CRM (`user_impersonation`)
  - Redirect URI set to `http://localhost:3000` (development)
- **Application User** provisioned in both source and destination D365 environments
- A user account with **Project Operations** security roles in both environments

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/slimrouissi/ProjectTasksMigration.git
cd ProjectTasksMigration
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

```env
VITE_CLIENT_ID=<Application (client) ID from Azure AD App Registration>
VITE_TENANT_ID=<Directory (tenant) ID from Azure AD App Registration>
VITE_SOURCE_URL=https://<YourSourceEnv>.crm.dynamics.com
VITE_TARGET_URL=https://<YourTargetEnv>.crm.dynamics.com
```

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with your Microsoft account.

### 5. Build for production

```bash
npm run build
npm run preview
```

## Usage

1. **Sign in** — authenticate with your Azure AD account
2. **Verify connectivity** — the app checks both environments via `WhoAmI`
3. **Select Projects** — choose which projects to migrate from the source
4. **Preview & Validate** — review entity counts, task hierarchy, and validation results
5. **Configure** — set naming, date, team member, and conflict strategies
6. **Execute** — run the migration and monitor real-time progress

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI Framework | React 18 + TypeScript |
| Component Library | Fluent UI React v9 |
| Authentication | MSAL Browser + MSAL React |
| Build Tool | Vite 5 |
| API | Dataverse Web API v9.2 + D365 Schedule API |
| Date Handling | date-fns |
| Testing | Vitest |

## License

This project is provided as an example only. No license is granted for production use.
