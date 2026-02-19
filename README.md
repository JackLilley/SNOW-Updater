# SNOW Update Center

A ServiceNow scoped application for batch-installing Store updates with a modern Next Experience UI and real-time installation monitoring.

## Overview

SNOW Update Center improves upon the standard Application Manager experience by providing:

- **Dashboard View** — At-a-glance summary of available major, minor, and patch updates with risk indicators
- **Batch Selection & Install** — Select multiple updates across categories, review dependencies, and install in one operation
- **Real-Time Activity Monitor** — Live progress tracking per-application with detailed activity logs, just like Application Manager's built-in monitor
- **Installation History** — Full audit trail of past batch installations with outcomes and timing
- **Scheduling** — Queue installations for maintenance windows
- **Dependency Analysis** — See which apps depend on others and install in the right order

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Next Experience UI (Workspace)          │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────┐  │
│  │Dashboard │ │ Update List  │ │Activity Monitor │  │
│  │  Page    │ │    Page      │ │     Page        │  │
│  └────┬─────┘ └──────┬───────┘ └───────┬─────────┘  │
│       │              │                 │             │
│  ┌────▼──────────────▼─────────────────▼─────────┐  │
│  │         Scripted REST API (v1)                 │  │
│  │  /available-updates  /batch-install  /progress │  │
│  └────┬──────────────────────┬───────────────────┘  │
│       │                      │                      │
│  ┌────▼──────────┐    ┌──────▼──────────────────┐   │
│  │Script Includes│    │  Flow Designer Subflows  │   │
│  │               │    │                          │   │
│  │BatchUpdateMgr │    │ Batch Install + Monitor  │   │
│  │UpdateAnalyzer │    │ CI/CD Batch Install API  │   │
│  │ActivityLogger │    └──────────────────────────┘   │
│  └───────────────┘                                   │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │                    Tables                        │ │
│  │  Remote: Available Updates                       │ │
│  │  Physical: Batch Request, Batch Item, Activity   │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Application Scope

- **Scope Name**: `x_snc_update_center`
- **App Name**: SNOW Update Center

## Tables

| Table | Type | Purpose |
|-------|------|---------|
| `x_snc_update_center_available_update` | Remote | Dynamically queries available Store updates |
| `x_snc_update_center_batch_request` | Physical | Tracks batch installation requests |
| `x_snc_update_center_batch_item` | Physical | Individual apps within a batch request |
| `x_snc_update_center_activity_log` | Physical | Detailed per-step activity log entries |

## Prerequisites

1. **CI/CD Spoke** — The Continuous Integration / Continuous Deployment spoke must be active
2. **CI/CD Credentials** — A user with `sn_cicd.sys_ci_automation` role, plus a credential alias configured
3. **Admin Access** — The installing user needs `admin` role to create tables and flows
4. **ServiceNow Version** — Washington DC or later recommended (for latest Next Experience features)

## Installation (Git Import)

This repo is structured for ServiceNow's source control integration.

### Step 1: Clone into ServiceNow

1. Open **ServiceNow IDE** (or App Engine Studio)
2. Click **Clone Git repository**
3. Enter this repo's URL and credentials
4. ServiceNow will import the application scope and all records from `update/`

### Step 2: Post-Import Setup

The Git import creates the app scope, Script Includes, REST API, roles, UI action, scheduled job, and system properties. However, some artifacts **must be built on the platform** after import:

- Physical tables (3) — batch_request, batch_item, activity_log
- Remote table + definition script
- Flow Designer subflows (2) — Batch Install + Monitor Progress
- ACLs
- CI/CD credential configuration
- Next Experience UI components (optional)

See **[docs/POST_IMPORT_SETUP.md](docs/POST_IMPORT_SETUP.md)** for complete step-by-step instructions.

## File Structure

```
├── sn_source_control.properties    # ServiceNow Git integration config
├── update/                         # ServiceNow-importable XML records
│   ├── sys_app_*.xml              #   Application record
│   ├── sys_user_role_*.xml        #   Roles (admin, reviewer)
│   ├── sys_script_include_*.xml   #   Script Includes (3)
│   ├── sys_ws_definition_*.xml    #   REST API definition
│   ├── sys_ws_operation_*.xml     #   REST API endpoints (8)
│   ├── sys_ui_action_*.xml        #   UI Action
│   ├── sysauto_script_*.xml       #   Scheduled Job
│   └── sys_properties_*.xml       #   System Properties (3)
│
├── src/                            # Human-readable reference (not imported by SN)
│   ├── tables/                    #   Table schemas + remote table script
│   ├── script-includes/           #   Script Include source files
│   ├── scripted-rest-api/         #   REST API source (combined)
│   ├── flows/                     #   Flow Designer subflow definitions
│   ├── ui/next-experience/        #   UI Builder components + pages + styles
│   ├── ui-actions/                #   UI Action source
│   ├── scheduled-jobs/            #   Scheduled job source
│   └── acl/                       #   ACL rule definitions
│
├── docs/
│   ├── POST_IMPORT_SETUP.md       #   What to build after Git import
│   ├── SETUP.md                   #   Full manual setup guide
│   └── ARCHITECTURE.md            #   Architecture deep-dive
│
└── README.md
```

### What Gets Imported vs. What Needs Manual Setup

| Artifact | Via Git Import | Manual Post-Import |
|----------|:-:|:-:|
| App scope + metadata | Y | |
| Roles (admin, reviewer) | Y | |
| Script Includes (3) | Y | |
| Scripted REST API + endpoints | Y | |
| UI Action | Y | |
| Scheduled Job | Y | |
| System Properties (3) | Y | |
| Physical Tables (3) | | Y |
| Remote Table + Script | | Y |
| Flow Designer Subflows (2) | | Y |
| ACLs | | Y |
| CI/CD Credentials | | Y |
| Next Experience UI | | Y (optional) |
| Navigation Modules | | Y |

## Key Improvements Over the Blog Post Version

| Feature | Blog Version | SNOW Update Center |
|---------|-------------|-------------------|
| UI Framework | Core UI (Jelly pages) | Next Experience (UI Builder) |
| Progress Tracking | Basic progress worker bar | Per-app activity feed with status icons |
| Update Categorization | Major/Minor/Patch only | + Risk level, dependency info, release notes |
| Installation History | None | Full audit trail with outcomes |
| Error Handling | Basic error messages | Detailed error logging with retry options |
| Scheduling | None | Maintenance window scheduling |
| Dependency Analysis | None | Pre-install dependency checking |
| ACLs | None | Role-based access control |

## Roles

| Role | Description |
|------|-------------|
| `x_snc_update_center.admin` | Full access — can install updates and configure settings |
| `x_snc_update_center.reviewer` | Read-only — can view available updates and history |

## License

Internal ServiceNow application — not for redistribution.
