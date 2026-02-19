/**
 * Scripted REST API: SNOW Update Center API
 * Base Path: /api/x_snc_update_center/v1
 *
 * Provides all endpoints needed by the Next Experience UI to manage
 * batch Store update installations.
 *
 * ════════════════════════════════════════════════════════════════════
 * API Definition (create in ServiceNow under Scripted REST APIs):
 *
 *   Name:       SNOW Update Center API
 *   API ID:     x_snc_update_center_api
 *   Namespace:  x_snc_update_center
 *   Base Path:  /api/x_snc_update_center/v1
 *
 * ════════════════════════════════════════════════════════════════════
 */


// ─────────────────────────────────────────────────────────────────────
// Resource: GET /dashboard
// Returns dashboard summary data (update counts, risk breakdown).
// ─────────────────────────────────────────────────────────────────────
(function getDashboard(request, response) {
    var analyzer = new x_snc_update_center.UpdateAnalyzer();
    var summary = analyzer.getUpdateSummary();

    var body = {
        counts: {
            total: summary.total,
            major: summary.major,
            minor: summary.minor,
            patch: summary.patch
        },
        riskBreakdown: summary.riskBreakdown,
        byVendor: summary.byVendor
    };

    response.setStatus(200);
    response.setBody(body);
})(request, response);


// ─────────────────────────────────────────────────────────────────────
// Resource: GET /available-updates
// Returns all available Store updates with full detail.
// Query params: ?level=major|minor|patch  &risk=low|medium|high|critical
// ─────────────────────────────────────────────────────────────────────
(function getAvailableUpdates(request, response) {
    var analyzer = new x_snc_update_center.UpdateAnalyzer();
    var summary = analyzer.getUpdateSummary();

    var levelFilter = request.queryParams.level ? request.queryParams.level.toString() : '';
    var riskFilter = request.queryParams.risk ? request.queryParams.risk.toString() : '';

    var apps = summary.apps;
    if (levelFilter) {
        apps = apps.filter(function(a) { return a.updateLevel === levelFilter; });
    }
    if (riskFilter) {
        apps = apps.filter(function(a) { return a.riskLevel === riskFilter; });
    }

    response.setStatus(200);
    response.setBody({
        total: apps.length,
        updates: apps
    });
})(request, response);


// ─────────────────────────────────────────────────────────────────────
// Resource: POST /batch-install
// Create and optionally execute a batch installation.
// Body: { appVersionSysIds: "id1,id2,...", execute: true, scheduledStart: "", notes: "" }
// ─────────────────────────────────────────────────────────────────────
(function postBatchInstall(request, response) {
    var body = request.body.data;
    var appVersionSysIds = body.appVersionSysIds || '';
    var execute = body.execute !== false;
    var options = {
        scheduledStart: body.scheduledStart || null,
        notes: body.notes || ''
    };

    if (!appVersionSysIds) {
        response.setStatus(400);
        response.setBody({ error: 'appVersionSysIds is required' });
        return;
    }

    var manager = new x_snc_update_center.BatchUpdateManager();
    var result = manager.createBatchRequest(appVersionSysIds, options);

    if (!result.success) {
        response.setStatus(500);
        response.setBody(result);
        return;
    }

    if (execute && !options.scheduledStart) {
        var execResult = manager.executeBatchInstall(result.batchRequestId);
        result.execution = execResult;
    }

    response.setStatus(201);
    response.setBody(result);
})(request, response);


// ─────────────────────────────────────────────────────────────────────
// Resource: GET /batch-status/{batchRequestId}
// Returns full status of a batch request including all items and activity.
// ─────────────────────────────────────────────────────────────────────
(function getBatchStatus(request, response) {
    var batchRequestId = request.pathParams.batchRequestId;

    if (!batchRequestId) {
        response.setStatus(400);
        response.setBody({ error: 'batchRequestId is required' });
        return;
    }

    var manager = new x_snc_update_center.BatchUpdateManager();
    var result = manager.getBatchStatus(batchRequestId);

    if (!result.success) {
        response.setStatus(404);
        response.setBody(result);
        return;
    }

    response.setStatus(200);
    response.setBody(result);
})(request, response);


// ─────────────────────────────────────────────────────────────────────
// Resource: GET /activity-feed/{batchRequestId}
// Returns activity log feed, supports polling with ?since=timestamp
// ─────────────────────────────────────────────────────────────────────
(function getActivityFeed(request, response) {
    var batchRequestId = request.pathParams.batchRequestId;
    var sinceTimestamp = request.queryParams.since ? request.queryParams.since.toString() : null;
    var limit = request.queryParams.limit ? parseInt(request.queryParams.limit.toString()) : 50;

    if (!batchRequestId) {
        response.setStatus(400);
        response.setBody({ error: 'batchRequestId is required' });
        return;
    }

    var logger = new x_snc_update_center.ActivityLogger();
    var entries = logger.getActivityFeed(batchRequestId, {
        sinceTimestamp: sinceTimestamp,
        limit: limit
    });

    response.setStatus(200);
    response.setBody({
        batchRequestId: batchRequestId,
        entries: entries,
        count: entries.length,
        polledAt: new GlideDateTime().getDisplayValue()
    });
})(request, response);


// ─────────────────────────────────────────────────────────────────────
// Resource: POST /cancel/{batchRequestId}
// Cancel a running batch installation.
// ─────────────────────────────────────────────────────────────────────
(function postCancel(request, response) {
    var batchRequestId = request.pathParams.batchRequestId;

    if (!batchRequestId) {
        response.setStatus(400);
        response.setBody({ error: 'batchRequestId is required' });
        return;
    }

    var manager = new x_snc_update_center.BatchUpdateManager();
    var result = manager.cancelBatchInstall(batchRequestId);

    response.setStatus(result.success ? 200 : 500);
    response.setBody(result);
})(request, response);


// ─────────────────────────────────────────────────────────────────────
// Resource: GET /history
// Returns installation history. Query params: ?limit=20&offset=0&state=completed
// ─────────────────────────────────────────────────────────────────────
(function getHistory(request, response) {
    var filters = {
        limit: request.queryParams.limit ? parseInt(request.queryParams.limit.toString()) : 20,
        offset: request.queryParams.offset ? parseInt(request.queryParams.offset.toString()) : 0,
        state: request.queryParams.state ? request.queryParams.state.toString() : null
    };

    var manager = new x_snc_update_center.BatchUpdateManager();
    var result = manager.getInstallationHistory(filters);

    response.setStatus(200);
    response.setBody(result);
})(request, response);


// ─────────────────────────────────────────────────────────────────────
// Resource: POST /analyze-dependencies
// Analyze dependencies for a set of apps before installation.
// Body: { appSysIds: ["id1", "id2", ...] }
// ─────────────────────────────────────────────────────────────────────
(function postAnalyzeDependencies(request, response) {
    var body = request.body.data;
    var appSysIds = body.appSysIds || [];

    if (!appSysIds.length) {
        response.setStatus(400);
        response.setBody({ error: 'appSysIds array is required' });
        return;
    }

    var analyzer = new x_snc_update_center.UpdateAnalyzer();
    var result = analyzer.analyzeDependencies(appSysIds);

    response.setStatus(200);
    response.setBody(result);
})(request, response);
