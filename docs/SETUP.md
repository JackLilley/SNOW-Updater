# SNOW Update Center - Setup Guide

Step-by-step instructions to build and deploy the SNOW Update Center application on your ServiceNow instance.

---

## Prerequisites

Before starting, ensure you have:

1. **Admin role** on the target ServiceNow instance
2. **CI/CD Spoke** activated (`sn_cicd` plugin)
3. **CI/CD API credentials** configured (user with `sn_cicd.sys_ci_automation` role + credential alias)
4. **ServiceNow version** Washington DC or later (for full Next Experience support)

---

## Step 1: Create the Application Scope

1. Navigate to **System Applications > Studio** or **App Engine Studio**
2. Create a new application:
   - **Name**: SNOW Update Center
   - **Scope**: `x_snc_update_center`
   - **Description**: Batch Store update installer with real-time progress monitoring
3. Save and note the application sys_id

> **Tip**: You won't need physical tables for entitlement purposes initially since the remote table doesn't count. The physical tables (batch_request, batch_item, activity_log) are lightweight operational tables.

---

## Step 2: Create Roles

1. Navigate to **User Administration > Roles**
2. Create two roles:

| Role Name | Description |
|-----------|-------------|
| `x_snc_update_center.admin` | Full access — install updates, view history, configure |
| `x_snc_update_center.reviewer` | Read-only — view available updates and history |

3. Assign `x_snc_update_center.admin` to yourself

---

## Step 3: Create Physical Tables

Create the following three tables under the `x_snc_update_center` scope. Use the JSON schema files in `src/tables/` as reference for field definitions.

### 3a. Batch Update Request

- Navigate to **System Definition > Tables**
- Create table: `x_snc_update_center_batch_request`
- Extends: `task` (gives you number, assignment, SLAs, etc.)
- Number prefix: `BUPD`
- Add all fields from `src/tables/batch_request.json`

### 3b. Batch Update Item

- Create table: `x_snc_update_center_batch_item`
- Standalone table (no extension)
- Add all fields from `src/tables/batch_item.json`

### 3c. Update Activity Log

- Create table: `x_snc_update_center_activity_log`
- Standalone table (no extension)
- Add all fields from `src/tables/activity_log.json`

---

## Step 4: Create the Remote Table

1. Navigate to **System Definition > Remote Tables > Tables** and click **New**
2. Configure:
   - **Label**: Available Updates
   - **Name**: `x_snc_update_center_available_update`
   - **Application**: SNOW Update Center
3. Add all columns listed in the header comment of `src/tables/available_update.js`
4. Navigate to **Remote Tables > Definitions** and click **New**
5. Select your new remote table
6. Paste the script from `src/tables/available_update.js` into the Definition Script field
7. Save and test by navigating to the table list — you should see available updates

---

## Step 5: Create Script Includes

Create three Script Includes under the `x_snc_update_center` scope. For each:

1. Navigate to **System Definition > Script Includes**
2. Click **New**
3. Set the scope to `x_snc_update_center`

| Name | Client Callable | Source File |
|------|----------------|-------------|
| `BatchUpdateManager` | false | `src/script-includes/BatchUpdateManager.js` |
| `UpdateAnalyzer` | false | `src/script-includes/UpdateAnalyzer.js` |
| `ActivityLogger` | false | `src/script-includes/ActivityLogger.js` |

---

## Step 6: Create the Scripted REST API

1. Navigate to **System Web Services > Scripted REST APIs**
2. Click **New**
3. Configure:
   - **Name**: SNOW Update Center API
   - **API ID**: `x_snc_update_center_api`
   - **API namespace**: `x_snc_update_center`
   - **Protection policy**: Read-only
4. Create the following **API Resources** (one for each endpoint):

| Method | Relative Path | Source |
|--------|--------------|--------|
| GET | `/dashboard` | `getDashboard` function from `UpdateCenterAPI.js` |
| GET | `/available-updates` | `getAvailableUpdates` function |
| POST | `/batch-install` | `postBatchInstall` function |
| GET | `/batch-status/{batchRequestId}` | `getBatchStatus` function |
| GET | `/activity-feed/{batchRequestId}` | `getActivityFeed` function |
| POST | `/cancel/{batchRequestId}` | `postCancel` function |
| GET | `/history` | `getHistory` function |
| POST | `/analyze-dependencies` | `postAnalyzeDependencies` function |

> **Note**: Each function in `UpdateCenterAPI.js` is a separate resource. Copy the relevant function body (inside the IIFE) into each resource's script field.

---

## Step 7: Create Flow Designer Subflows

### 7a. Batch Install Updates Subflow

1. Navigate to **Flow Designer** (Process Automation > Flow Designer)
2. Click **New > Subflow**
3. Configure using `src/flows/BatchInstallSubflow.json` as reference:
   - **Name**: Batch Install Updates
   - **Application**: SNOW Update Center
   - **Run as**: System
4. Add inputs and outputs as defined in the JSON
5. Add the four action steps:
   1. **Look Up Records** — query `sys_app_version` with `sys_id IN {{inputs.apps}}`
   2. **Set Flow Variables** — run the manifest-building script
   3. **sn_cicd.Batch Install** — CI/CD Batch Install action with your credentials
   4. **Set Flow Variables** — assign outputs
6. **Publish** the subflow

### 7b. Monitor Batch Progress Subflow

1. Create another subflow:
   - **Name**: Monitor Batch Progress
   - **API Name**: `x_snc_update_center.monitor_batch_progress`
2. Add inputs: `batch_request_id` (String), `progress_worker_id` (String)
3. Add a single **Script** action step
4. Paste the content from `src/flows/MonitorProgressScript.js`
5. **Publish** the subflow

---

## Step 8: Configure CI/CD Credentials

If you haven't already:

1. Create a user with the `sn_cicd.sys_ci_automation` role
2. Navigate to **Connections & Credentials > Credential Aliases**
3. Create or identify the credential alias for the CI/CD spoke
4. Configure the credential with the CI/CD user's username and password
5. Ensure the alias is referenced in the Batch Install action in your subflow

Documentation: [ServiceNow CI/CD API](https://docs.servicenow.com/csh?topicname=cicd-api.html&version=latest)

---

## Step 9: Build the Next Experience UI

### Option A: UI Builder (Recommended)

1. Navigate to **UI Builder** (Now Experience > UI Builder)
2. Create a new **Workspace Experience** or add pages to an existing workspace
3. Create four pages using the JSON definitions in `src/ui/next-experience/pages/`:

| Page | URL Path | Components |
|------|----------|------------|
| Dashboard | `/update-center` | UpdateDashboard macroponent |
| Available Updates | `/update-center/updates` | UpdateList macroponent |
| Progress Monitor | `/update-center/progress/:id` | ProgressMonitor macroponent |
| Installation History | `/update-center/history` | Record List (standard) |

4. For each page, create macroponents using the JS files in `src/ui/next-experience/components/`
5. Apply styles from `src/ui/next-experience/styles/update-center.scss`

### Option B: Custom Component Development (Advanced)

If you want fully custom Now Experience components:

1. Install the ServiceNow CLI: `npm install -g @servicenow/cli`
2. Scaffold components using `snc ui-component scaffolding`
3. Use the component JS files as your component logic
4. Build and deploy via CLI

### Navigation Modules

Add navigation entries so users can find the app:

1. Navigate to **System Definition > Application Menus**
2. Find or create the **Upgrade Center** menu
3. Add modules:

| Title | Order | Type | Configuration |
|-------|-------|------|--------------|
| *separator* | 2000 | Separator | |
| Update Center | 2010 | URL | `/update-center` |
| Available Updates | 2020 | URL | `/update-center/updates` |
| Installation History | 2030 | URL | `/update-center/history` |

---

## Step 10: Create ACLs

Using the definitions in `src/acl/acl_definitions.json`:

1. Navigate to **System Security > Access Control (ACL)**
2. Create ACL rules for each table and operation as defined
3. Pay special attention to the activity log — it should be immutable (no write/delete for anyone)

---

## Step 11: Create the UI Action (Optional — for Core UI)

If you also want the batch install available from the Core UI list view:

1. Navigate to **System Definition > UI Actions**
2. Create a new UI action using `src/ui-actions/install_selected.js`
3. Configure as described in the file's header comment
4. Associate with the `x_snc_update_center_available_update` table

---

## Step 12: Create the Scheduled Job (Optional)

1. Navigate to **System Definition > Scheduled Jobs**
2. Click **New**
3. Configure using `src/scheduled-jobs/RefreshAvailableUpdates.js`
4. Set to run daily at a time that works for your team

---

## Step 13: Configure System Properties

Create these system properties for the application:

| Property | Default | Description |
|----------|---------|-------------|
| `x_snc_update_center.cached_summary` | `{}` | Cached update summary (auto-populated) |
| `x_snc_update_center.last_notified_count` | `0` | Last notified total count |
| `x_snc_update_center.notify_on_new_updates` | `true` | Send email when new updates detected |

---

## Validation Checklist

After completing setup, verify:

- [ ] Remote table shows available Store updates
- [ ] REST API endpoints respond (test with REST API Explorer)
- [ ] Dashboard page loads and shows correct counts
- [ ] Update list page shows available updates with filters
- [ ] Batch install subflow runs successfully (test with 1-2 patches)
- [ ] Progress monitor shows real-time updates during installation
- [ ] Activity feed populates with timestamped entries
- [ ] Installation history page shows completed batch requests
- [ ] ACLs prevent unauthorized access
- [ ] Roles work as expected (admin vs reviewer)
- [ ] Scheduled job runs and caches summary

---

## Troubleshooting

### Remote table is empty
- Verify `sys_store_app` records exist with `update_available = true`
- Check the remote table definition script for errors in Script Debugger

### CI/CD Batch Install fails
- Verify the CI/CD user has `sn_cicd.sys_ci_automation` role
- Check that the credential alias is correctly configured
- Test with a single app version first
- Review System Logs for errors from the `sn_cicd` scope

### Progress monitor not updating
- Ensure the Monitor Batch Progress subflow is published and active
- Check that the progress worker sys_id is being passed correctly
- Verify the polling interval in the UI component (default 5s)

### Activity feed empty during install
- The ActivityLogger must be able to insert into `x_snc_update_center_activity_log`
- Check ACLs — the system user running the subflow needs create access
- Review the Monitor Progress script for errors

### REST API returns 403
- Verify the user has the `x_snc_update_center.admin` role
- Check the ACL rules on the Scripted REST API resources
- Ensure the application scope is correct

---

## What's Next

Ideas for future enhancements:

- **Service Catalog integration** — Let business owners request specific updates
- **Approval workflows** — Require approval before major updates
- **Test instance validation** — Run updates on sub-prod first, then promote
- **Rollback tracking** — Record pre-install state for manual rollback guidance
- **Update notes extraction** — Pull release notes from the Store for each update
- **Slack/Teams notifications** — Notify channels when installs complete
- **Scheduled maintenance windows** — Auto-run batches during configured windows
