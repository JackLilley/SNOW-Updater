# Post-Import Setup Guide

After cloning this repo via **ServiceNow IDE > Clone Git Repository**, the following artifacts are automatically imported:

| Artifact | Status |
|----------|--------|
| Application scope (`x_snc_update_center`) | Imported |
| Roles (admin, reviewer) | Imported |
| Script Includes (3) | Imported |
| Scripted REST API + 8 endpoints | Imported |
| UI Action (Install Selected) | Imported |
| Scheduled Job (Refresh Summary) | Imported |
| System Properties (3) | Imported |

The following **must be built manually on the platform** because they involve complex record structures that cannot be reliably hand-authored as XML:

---

## 1. Create Physical Tables

These tables are needed by the Script Includes and REST API. Create them under the `x_snc_update_center` scope.

### 1a. Batch Update Request

Use the schema in `src/tables/batch_request.json` as reference.

1. Navigate to **System Definition > Tables**
2. Create: `x_snc_update_center_batch_request`
3. **Extends**: `task` (gives you number, assignment, SLAs)
4. **Number prefix**: `BUPD`
5. Add these fields:

| Label | Name | Type | Notes |
|-------|------|------|-------|
| Requested By | requested_by | Reference (sys_user) | Mandatory, default: current user |
| State | state | Choice | draft/scheduled/in_progress/completed/failed/partial/cancelled |
| Total Apps | total_apps | Integer | Read-only |
| Completed Apps | completed_apps | Integer | Read-only, default: 0 |
| Failed Apps | failed_apps | Integer | Read-only, default: 0 |
| Skipped Apps | skipped_apps | Integer | Read-only, default: 0 |
| Progress Worker | progress_worker | Reference (sys_progress_worker) | |
| Scheduled Start | scheduled_start | Date/Time | |
| Actual Start | actual_start | Date/Time | |
| Actual End | actual_end | Date/Time | |
| Duration (seconds) | duration_seconds | Integer | Read-only |
| Batch Manifest | batch_manifest | String (65536) | JSON |
| Notes | install_notes | Journal | |
| Overall Progress | overall_progress | Integer | Default: 0, read-only |
| Error Summary | error_summary | String (4000) | |

### 1b. Batch Update Item

1. Create: `x_snc_update_center_batch_item` (standalone, no extension)
2. Add these fields:

| Label | Name | Type | Notes |
|-------|------|------|-------|
| Batch Request | batch_request | Reference (batch_request table) | Mandatory |
| Application | application | Reference (sys_store_app) | Mandatory |
| Application Name | application_name | String | |
| App Version | app_version | Reference (sys_app_version) | |
| From Version | from_version | String | |
| To Version | to_version | String | |
| Update Level | update_level | Choice | major/minor/patch |
| State | state | Choice | queued/installing/completed/failed/skipped |
| Install Order | install_order | Integer | Default: 100 |
| Start Time | start_time | Date/Time | |
| End Time | end_time | Date/Time | |
| Duration (seconds) | duration_seconds | Integer | |
| Error Message | error_message | String (4000) | |
| Progress Percent | progress_percent | Integer | Default: 0 |
| Status Message | status_message | String (1000) | |

### 1c. Update Activity Log

1. Create: `x_snc_update_center_activity_log` (standalone)
2. Add these fields:

| Label | Name | Type | Notes |
|-------|------|------|-------|
| Batch Request | batch_request | Reference (batch_request table) | Mandatory |
| Batch Item | batch_item | Reference (batch_item table) | |
| Timestamp | timestamp | Date/Time | Default: now |
| Activity Type | activity_type | Choice | info/success/warning/error/progress/start/complete/milestone |
| Phase | phase | Choice | preparation/validation/download/installation/post_install/cleanup |
| Message | message | String (2000) | |
| Details | details | String (8000) | |
| Application Name | application_name | String | |
| Progress Percent | progress_percent | Integer | |
| Sequence | sequence | Integer | |

---

## 2. Create the Remote Table

1. Navigate to **System Definition > Remote Tables > Tables > New**
2. **Label**: Available Updates
3. **Name**: `x_snc_update_center_available_update`
4. Add the columns listed in `src/tables/available_update.js` (see the comment block at the top)
5. Navigate to **Remote Tables > Definitions > New**
6. Select your remote table
7. Paste the script from `src/tables/available_update.js` into the Definition Script field
8. Save and test by navigating to the table list

---

## 3. Create Flow Designer Subflows

### 3a. Batch Install Updates

1. Open **Flow Designer** (Process Automation > Flow Designer)
2. Create a new Subflow: **Batch Install Updates**
3. API Name: `x_snc_update_center.batch_install_updates`
4. Use the definition in `src/flows/BatchInstallSubflow.json` as reference
5. **Inputs**: `apps` (String) — comma-separated sys_app_version sys_ids
6. **Outputs**: `progress_id` (String), `status_message` (String)
7. **Steps**:
   1. Look Up Records — `sys_app_version` where `sys_id IN {{inputs.apps}}`
   2. Set Flow Variable `batch_manifest` — use script from JSON
   3. CI/CD Batch Install action — pass manifest + credentials
   4. Assign outputs
8. **Publish** the subflow

### 3b. Monitor Batch Progress

1. Create a new Subflow: **Monitor Batch Progress**
2. API Name: `x_snc_update_center.monitor_batch_progress`
3. **Inputs**: `batch_request_id` (String), `progress_worker_id` (String)
4. **Outputs**: `final_state` (String), `summary` (String)
5. Add a single **Script** action step
6. Paste the content from `src/flows/MonitorProgressScript.js`
7. **Publish** the subflow

---

## 4. Configure CI/CD Credentials

1. Create a user with `sn_cicd.sys_ci_automation` role
2. Set up a Credential Alias under **Connections & Credentials**
3. Reference this alias in the Batch Install subflow's CI/CD action

---

## 5. Create ACLs

Use `src/acl/acl_definitions.json` as reference:

1. Navigate to **System Security > Access Control (ACL)**
2. Create read/create/write/delete rules for each table
3. The activity_log table should be immutable (no write/delete for anyone)
4. Add ACLs to REST API resources per the definitions

---

## 6. Build Next Experience UI (Optional Enhancement)

The UI components in `src/ui/next-experience/` are reference implementations for building a modern workspace experience. These must be built in **UI Builder**:

1. Navigate to **UI Builder** (Now Experience > UI Builder)
2. Create pages using the JSON definitions in `src/ui/next-experience/pages/`
3. Create macroponents using the JS files in `src/ui/next-experience/components/`
4. Apply styles from `src/ui/next-experience/styles/update-center.scss`

Alternatively, the app works fully via the **remote table list view** and **UI Action** (Core UI) without any Next Experience components.

---

## 7. Add Navigation Modules

1. Navigate to **System Definition > Application Menus**
2. Find or create **Upgrade Center**
3. Add modules:

| Title | Order | Link Type | Configuration |
|-------|-------|-----------|--------------|
| *(separator)* | 2000 | Separator | |
| Update Center | 2010 | URL | `/update-center` |
| Available Updates | 2020 | List of Records | `x_snc_update_center_available_update` |
| Patches | 2030 | List of Records | Filter: `batch_level=patch` |
| Minor Updates | 2040 | List of Records | Filter: `batch_level=minor` |
| Major Updates | 2050 | List of Records | Filter: `batch_level=major` |
| Installation History | 2060 | List of Records | `x_snc_update_center_batch_request` |

---

## Validation Checklist

After completing all steps:

- [ ] Remote table shows available Store updates
- [ ] REST API endpoints respond (test in REST API Explorer)
- [ ] Can select updates and click "Install Selected Updates"
- [ ] Batch Install subflow triggers CI/CD Batch Install
- [ ] Monitor subflow tracks progress and writes activity logs
- [ ] Installation history records are created
- [ ] ACLs restrict access by role
- [ ] Scheduled job runs and caches summary
