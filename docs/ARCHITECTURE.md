# SNOW Update Center - Architecture

Deep-dive into the application architecture, data flow, and design decisions.

---

## Design Philosophy

The application is built on three principles:

1. **Native Platform** — Everything runs on ServiceNow using standard platform capabilities (Script Includes, Flow Designer, Scripted REST, Remote Tables, Next Experience). No external services needed.

2. **Real-Time Visibility** — The blog post version shows a single progress bar. This version provides per-application status, a live activity feed, and phase-level detail — similar to what you see in Application Manager's activity monitor.

3. **Separation of Concerns** — Server logic (Script Includes), orchestration (Flow Designer), API layer (Scripted REST), and UI (Next Experience components) are cleanly separated, making each layer independently testable and maintainable.

---

## Data Flow

### Installation Flow

```
User selects updates in UI
         │
         ▼
    ┌──────────┐
    │ REST API  │  POST /batch-install
    │ (Create)  │
    └────┬─────┘
         │
         ▼
┌────────────────────┐
│ BatchUpdateManager  │
│  createBatchRequest │  Creates batch_request + batch_items
│  executeBatchInstall│  Triggers subflow
└────────┬───────────┘
         │
    ┌────▼────────────────┐
    │  Flow Designer       │
    │  ┌────────────────┐  │
    │  │ Build Manifest  │  │  Formats JSON for CI/CD API
    │  └───────┬────────┘  │
    │  ┌───────▼────────┐  │
    │  │ CI/CD Batch     │  │  Calls sn_cicd.Batch Install
    │  │ Install Action  │  │  Returns progress_worker_id
    │  └───────┬────────┘  │
    └──────────┼───────────┘
               │
    ┌──────────▼───────────┐
    │  Monitor Subflow      │  Runs in background
    │  (Polls every 5-10s)  │
    │                       │
    │  ┌─────────────────┐  │
    │  │ Read progress    │  │  Reads sys_progress_worker
    │  │ worker state     │  │
    │  └───────┬─────────┘  │
    │  ┌───────▼─────────┐  │
    │  │ Update items     │  │  Updates batch_item states
    │  └───────┬─────────┘  │
    │  ┌───────▼─────────┐  │
    │  │ Write activity   │  │  Writes to activity_log
    │  │ log entries      │  │
    │  └───────┬─────────┘  │
    │  ┌───────▼─────────┐  │
    │  │ Check terminal   │  │  Loop until complete/error
    │  │ state            │  │
    │  └─────────────────┘  │
    └───────────────────────┘
```

### UI Polling Flow

```
┌───────────────────────────────────┐
│      Progress Monitor Page         │
│                                    │
│  Every 5 seconds:                  │
│  ┌──────────────────────────┐     │
│  │ GET /batch-status/{id}   │──────┼───► REST API ──► BatchUpdateManager
│  └──────────────────────────┘     │                    .getBatchStatus()
│                                    │          │
│  Every 5 seconds:                  │          ▼
│  ┌──────────────────────────┐     │    Returns: batch state,
│  │ GET /activity-feed/{id}  │──────┼───► items[], activityLog[]
│  │   ?since={timestamp}     │     │
│  └──────────────────────────┘     │
│                                    │
│  UI updates:                       │
│  ├─ Overall progress bar           │
│  ├─ Individual app cards           │
│  └─ Activity feed (append new)     │
└───────────────────────────────────┘
```

---

## Table Design

### Remote Table: Available Updates

This is not a physical table — it executes a script every time it's queried. The script:

1. Queries `sys_store_app` for apps with `update_available = true`
2. For each app, queries `sys_app_version` to find all available versions
3. Compares versions to categorize as major/minor/patch
4. Assesses risk based on update level, dependencies, and customizations
5. Returns one row per app per batch level (up to 3 rows per app)

**Trade-off**: Remote tables are slower than physical tables because they execute on every query. For dashboards, we cache the summary in a system property via the scheduled job.

### Physical Tables

**Batch Request** extends `task`, which gives us:
- Auto-numbering (BUPD0001001)
- Assignment group and assigned to
- SLA tracking
- Activity/work notes journal
- Standard task lifecycle

**Batch Item** is standalone because it's tightly coupled to the batch request and doesn't need task features.

**Activity Log** is append-only by design (immutable audit trail). ACLs prevent writes and deletes.

---

## Component Architecture (Next Experience)

```
┌─────────────────────────────────────┐
│         Page (UI Builder)            │
│  ┌─────────────────────────────┐    │
│  │     Macroponent              │    │
│  │  ┌──────────────────────┐   │    │
│  │  │   State Management    │   │    │
│  │  │   (actions/reducers)  │   │    │
│  │  └──────────┬───────────┘   │    │
│  │  ┌──────────▼───────────┐   │    │
│  │  │   View (template)     │   │    │
│  │  │   ┌───────────────┐  │   │    │
│  │  │   │ Now Components │  │   │    │
│  │  │   │ (now-button,   │  │   │    │
│  │  │   │  now-badge,    │  │   │    │
│  │  │   │  now-icon)     │  │   │    │
│  │  │   └───────────────┘  │   │    │
│  │  └──────────────────────┘   │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

Each component follows the Now Experience pattern:
- **Properties**: External inputs from the page or parent component
- **State**: Internal reactive state
- **Actions**: Event handlers with `effect` (side effects) and `reducer` (state mutations)
- **View**: Template function that renders based on state

### Component Hierarchy

```
Dashboard Page
  └─ UpdateDashboard
       ├─ Summary Cards (inline)
       ├─ Risk Bars (inline)
       └─ History Items (inline)

Update List Page
  └─ UpdateList
       ├─ Filter Tabs (inline)
       ├─ Data Table (inline)
       │    └─ UpdateCard (per row, optional grid view)
       └─ Confirm Dialog (conditional)

Progress Page
  └─ ProgressMonitor
       ├─ Overall Progress Bar (inline)
       ├─ App Cards (inline, per item)
       ├─ ActivityFeed (embedded component)
       └─ Cancel Dialog (conditional)
```

---

## Security Model

### Role-Based Access

| Action | admin | reviewer | No role |
|--------|:-----:|:--------:|:-------:|
| View dashboard | Y | Y | N |
| View available updates | Y | Y | N |
| Start batch install | Y | N | N |
| View progress monitor | Y | Y* | N |
| Cancel installation | Y | N | N |
| View history | Y | Y | N |
| View activity logs | Y | Y | N |

*Reviewers can view progress but cannot initiate or cancel.

### API Security

All REST API resources require authentication. The Scripted REST API applies role checks per-resource. The CI/CD Batch Install action uses a separate credential alias (not the user's session) so that installations run with appropriate privileges.

---

## Progress Monitoring Strategy

The CI/CD Batch Install action creates a `sys_progress_worker` record. The platform updates this record as the installation progresses. Our monitoring strategy:

1. **Batch Install Subflow** fires the CI/CD action and gets back a `progress_worker_id`
2. **Monitor Subflow** starts in the background, polling the progress worker
3. Poll intervals:
   - `starting` state: every 3 seconds (CI/CD is initializing)
   - `running` state: every 10 seconds (installation in progress)
4. On each poll, the monitor:
   - Reads the progress worker's state, message, and percent
   - Maps progress to individual batch items (estimated sequential processing)
   - Writes activity log entries for message changes
   - Updates the batch request's overall progress
5. On terminal state (`complete`/`error`/`cancelled`):
   - Verifies actual installed versions via `sys_store_app`
   - Marks items as completed/failed based on actual state
   - Writes final summary to activity log
   - Updates batch request to terminal state

### Why not use events/business rules?

The `sys_progress_worker` table doesn't reliably fire business rules for all state transitions. Polling is more reliable and gives us control over the granularity of status updates.

---

## Performance Considerations

1. **Remote Table Query Cost**: Each query to the Available Updates table runs the full script. For large instances with many store apps, consider caching results in a system property and refreshing via the scheduled job.

2. **Polling Frequency**: The UI polls every 5 seconds. The monitor subflow polls every 3-10 seconds. These are balanced for responsiveness vs. server load.

3. **Activity Log Growth**: For large batch installations, the activity log can accumulate many entries. The UI limits display to 200 entries and supports incremental polling (`?since=timestamp`).

4. **Table Indexes**: Consider adding indexes on:
   - `x_snc_update_center_batch_item.batch_request`
   - `x_snc_update_center_activity_log.batch_request`
   - `x_snc_update_center_activity_log.timestamp`
