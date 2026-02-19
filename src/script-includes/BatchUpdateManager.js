/**
 * BatchUpdateManager - Core logic for managing batch Store update installations.
 *
 * Handles creating batch requests, building CI/CD manifests, triggering installs,
 * and monitoring progress workers for real-time status updates.
 *
 * @class BatchUpdateManager
 * @memberof x_snc_update_center
 */
var BatchUpdateManager = Class.create();
BatchUpdateManager.prototype = {
    initialize: function() {
        this.logger = new x_snc_update_center.ActivityLogger();
        this.analyzer = new x_snc_update_center.UpdateAnalyzer();
        this.SUBFLOW_ID = 'x_snc_update_center.batch_install_updates';
    },

    /**
     * Create a new batch request from selected app version sys_ids.
     * @param {string} appVersionSysIds - Comma-separated sys_app_version sys_ids
     * @param {object} [options] - Optional settings
     * @param {string} [options.scheduledStart] - ISO datetime for scheduled install
     * @param {string} [options.notes] - Installation notes
     * @returns {object} { success, batchRequestId, message }
     */
    createBatchRequest: function(appVersionSysIds, options) {
        options = options || {};
        var sysIds = appVersionSysIds.split(',');

        if (sysIds.length === 0) {
            return { success: false, message: 'No applications selected' };
        }

        var batchGr = new GlideRecord('x_snc_update_center_batch_request');
        batchGr.initialize();
        batchGr.setValue('requested_by', gs.getUserID());
        batchGr.setValue('total_apps', sysIds.length);
        batchGr.setValue('state', options.scheduledStart ? 'scheduled' : 'draft');

        if (options.scheduledStart) {
            batchGr.setValue('scheduled_start', options.scheduledStart);
        }
        if (options.notes) {
            batchGr.setValue('install_notes', options.notes);
        }

        var batchId = batchGr.insert();
        if (!batchId) {
            return { success: false, message: 'Failed to create batch request record' };
        }

        this.logger.log(batchId, null, 'start', 'preparation',
            'Batch request created with ' + sysIds.length + ' application(s)');

        var items = this._createBatchItems(batchId, sysIds);
        if (!items.success) {
            return { success: false, message: items.message, batchRequestId: batchId };
        }

        var manifest = this._buildManifest(batchId);
        batchGr.get(batchId);
        batchGr.setValue('batch_manifest', JSON.stringify(manifest));
        batchGr.update();

        this.logger.log(batchId, null, 'info', 'preparation',
            'Batch manifest built with ' + manifest.packages.length + ' package(s)');

        return {
            success: true,
            batchRequestId: batchId,
            totalApps: sysIds.length,
            message: 'Batch request created successfully'
        };
    },

    /**
     * Execute a batch installation (immediate or scheduled).
     * @param {string} batchRequestId - sys_id of the batch request
     * @returns {object} { success, progressWorkerId, message }
     */
    executeBatchInstall: function(batchRequestId) {
        var batchGr = new GlideRecord('x_snc_update_center_batch_request');
        if (!batchGr.get(batchRequestId)) {
            return { success: false, message: 'Batch request not found' };
        }

        if (batchGr.getValue('state') === 'in_progress') {
            return { success: false, message: 'Batch is already running' };
        }

        batchGr.setValue('state', 'in_progress');
        batchGr.setValue('actual_start', new GlideDateTime());
        batchGr.update();

        this.logger.log(batchRequestId, null, 'start', 'installation',
            'Batch installation started');

        this._markAllItemsInstalling(batchRequestId);

        try {
            var manifest = batchGr.getValue('batch_manifest');
            var inputs = { apps: this._getAppVersionSysIds(batchRequestId) };

            var result = sn_fd.FlowAPI.getRunner()
                .subflow(this.SUBFLOW_ID)
                .inBackground()
                .withInputs(inputs)
                .run();

            var outputs = result.getOutputs();
            var progressId = outputs['progress_id'] || '';
            var statusMessage = outputs['status_message'] || '';

            batchGr.get(batchRequestId);
            batchGr.setValue('progress_worker', progressId);
            batchGr.update();

            this.logger.log(batchRequestId, null, 'info', 'installation',
                'CI/CD Batch Install triggered. Progress worker: ' + progressId);

            this._startProgressMonitoring(batchRequestId, progressId);

            return {
                success: true,
                progressWorkerId: progressId,
                batchRequestId: batchRequestId,
                message: statusMessage || 'Installation started'
            };
        } catch (ex) {
            var errorMsg = ex.getMessage ? ex.getMessage() : String(ex);

            batchGr.get(batchRequestId);
            batchGr.setValue('state', 'failed');
            batchGr.setValue('error_summary', errorMsg);
            batchGr.setValue('actual_end', new GlideDateTime());
            batchGr.update();

            this.logger.log(batchRequestId, null, 'error', 'installation',
                'Batch installation failed: ' + errorMsg);

            return { success: false, message: errorMsg };
        }
    },

    /**
     * Get the current detailed status of a batch request.
     * Polls the progress worker and updates item-level statuses.
     * @param {string} batchRequestId
     * @returns {object} Full status object for the UI
     */
    getBatchStatus: function(batchRequestId) {
        var batchGr = new GlideRecord('x_snc_update_center_batch_request');
        if (!batchGr.get(batchRequestId)) {
            return { success: false, message: 'Batch request not found' };
        }

        var status = {
            batchRequestId: batchRequestId,
            number: batchGr.getDisplayValue('number'),
            state: batchGr.getValue('state'),
            totalApps: parseInt(batchGr.getValue('total_apps')) || 0,
            completedApps: parseInt(batchGr.getValue('completed_apps')) || 0,
            failedApps: parseInt(batchGr.getValue('failed_apps')) || 0,
            skippedApps: parseInt(batchGr.getValue('skipped_apps')) || 0,
            overallProgress: parseInt(batchGr.getValue('overall_progress')) || 0,
            requestedBy: batchGr.getDisplayValue('requested_by'),
            actualStart: batchGr.getValue('actual_start'),
            actualEnd: batchGr.getValue('actual_end'),
            durationSeconds: parseInt(batchGr.getValue('duration_seconds')) || 0,
            errorSummary: batchGr.getValue('error_summary'),
            items: [],
            progressWorker: null
        };

        var pwId = batchGr.getValue('progress_worker');
        if (pwId) {
            status.progressWorker = this._getProgressWorkerStatus(pwId);
        }

        status.items = this._getBatchItems(batchRequestId);
        status.activityLog = this._getRecentActivity(batchRequestId, 50);

        return { success: true, data: status };
    },

    /**
     * Get installation history with optional filters.
     * @param {object} [filters]
     * @param {number} [filters.limit=20]
     * @param {number} [filters.offset=0]
     * @param {string} [filters.state]
     * @returns {object}
     */
    getInstallationHistory: function(filters) {
        filters = filters || {};
        var limit = filters.limit || 20;
        var offset = filters.offset || 0;
        var history = [];

        var gr = new GlideRecord('x_snc_update_center_batch_request');
        gr.addQuery('state', '!=', 'draft');
        if (filters.state) {
            gr.addQuery('state', filters.state);
        }
        gr.orderByDesc('sys_created_on');
        gr.chooseWindow(offset, offset + limit);
        gr.query();

        while (gr.next()) {
            history.push({
                sys_id: gr.getUniqueValue(),
                number: gr.getDisplayValue('number'),
                state: gr.getValue('state'),
                requestedBy: gr.getDisplayValue('requested_by'),
                totalApps: parseInt(gr.getValue('total_apps')) || 0,
                completedApps: parseInt(gr.getValue('completed_apps')) || 0,
                failedApps: parseInt(gr.getValue('failed_apps')) || 0,
                actualStart: gr.getValue('actual_start'),
                actualEnd: gr.getValue('actual_end'),
                durationSeconds: parseInt(gr.getValue('duration_seconds')) || 0,
                overallProgress: parseInt(gr.getValue('overall_progress')) || 0,
                createdOn: gr.getValue('sys_created_on')
            });
        }

        var countGa = new GlideAggregate('x_snc_update_center_batch_request');
        countGa.addQuery('state', '!=', 'draft');
        if (filters.state) countGa.addQuery('state', filters.state);
        countGa.addAggregate('COUNT');
        countGa.query();
        var total = 0;
        if (countGa.next()) total = parseInt(countGa.getAggregate('COUNT'));

        return { success: true, data: history, total: total };
    },

    /**
     * Cancel a running batch installation.
     * @param {string} batchRequestId
     * @returns {object}
     */
    cancelBatchInstall: function(batchRequestId) {
        var batchGr = new GlideRecord('x_snc_update_center_batch_request');
        if (!batchGr.get(batchRequestId)) {
            return { success: false, message: 'Batch request not found' };
        }

        batchGr.setValue('state', 'cancelled');
        batchGr.setValue('actual_end', new GlideDateTime());
        batchGr.update();

        this._updateQueuedItemsState(batchRequestId, 'skipped');

        this.logger.log(batchRequestId, null, 'warning', 'installation',
            'Batch installation cancelled by ' + gs.getUserDisplayName());

        return { success: true, message: 'Batch installation cancelled' };
    },

    // ── Private Methods ─────────────────────────────────────────────

    _createBatchItems: function(batchRequestId, appVersionSysIds) {
        var order = 100;
        for (var i = 0; i < appVersionSysIds.length; i++) {
            var sysId = appVersionSysIds[i].trim();
            if (!sysId) continue;

            var verGr = new GlideRecord('sys_app_version');
            if (!verGr.get(sysId)) continue;

            var appGr = new GlideRecord('sys_store_app');
            var appId = verGr.getValue('source_app_id');
            appGr.get(appId);

            var itemGr = new GlideRecord('x_snc_update_center_batch_item');
            itemGr.initialize();
            itemGr.setValue('batch_request', batchRequestId);
            itemGr.setValue('application', appId);
            itemGr.setValue('application_name', appGr.getDisplayValue());
            itemGr.setValue('app_version', sysId);
            itemGr.setValue('from_version', appGr.getValue('version'));
            itemGr.setValue('to_version', verGr.getValue('version'));
            itemGr.setValue('update_level', this.analyzer.getUpdateLevel(
                appGr.getValue('version'), verGr.getValue('version')));
            itemGr.setValue('state', 'queued');
            itemGr.setValue('install_order', order);
            order += 100;

            itemGr.insert();
        }
        return { success: true };
    },

    _buildManifest: function(batchRequestId) {
        var manifest = {
            name: 'SNOW Update Center Batch Install',
            notes: 'Batch installation via SNOW Update Center',
            packages: []
        };

        var itemGr = new GlideRecord('x_snc_update_center_batch_item');
        itemGr.addQuery('batch_request', batchRequestId);
        itemGr.orderBy('install_order');
        itemGr.query();

        while (itemGr.next()) {
            manifest.packages.push({
                id: itemGr.getValue('application'),
                type: 'application',
                load_demo_data: false,
                requested_version: itemGr.getValue('to_version'),
                notes: itemGr.getValue('application_name') + ' ' +
                       itemGr.getValue('from_version') + ' → ' +
                       itemGr.getValue('to_version')
            });
        }

        return manifest;
    },

    _getAppVersionSysIds: function(batchRequestId) {
        var ids = [];
        var gr = new GlideRecord('x_snc_update_center_batch_item');
        gr.addQuery('batch_request', batchRequestId);
        gr.orderBy('install_order');
        gr.query();
        while (gr.next()) {
            ids.push(gr.getValue('app_version'));
        }
        return ids.join(',');
    },

    _markAllItemsInstalling: function(batchRequestId) {
        var gr = new GlideRecord('x_snc_update_center_batch_item');
        gr.addQuery('batch_request', batchRequestId);
        gr.addQuery('state', 'queued');
        gr.query();
        while (gr.next()) {
            gr.setValue('state', 'installing');
            gr.setValue('start_time', new GlideDateTime());
            gr.update();
        }
    },

    _updateQueuedItemsState: function(batchRequestId, newState) {
        var gr = new GlideRecord('x_snc_update_center_batch_item');
        gr.addQuery('batch_request', batchRequestId);
        gr.addQuery('state', 'IN', 'queued,installing');
        gr.query();
        while (gr.next()) {
            gr.setValue('state', newState);
            gr.update();
        }
    },

    _getProgressWorkerStatus: function(progressWorkerId) {
        var pw = new GlideRecord('sys_progress_worker');
        if (!pw.get(progressWorkerId)) return null;

        return {
            sys_id: progressWorkerId,
            state: pw.getValue('state'),
            percentComplete: parseInt(pw.getValue('percent_complete')) || 0,
            message: pw.getValue('message'),
            outputSummary: pw.getValue('output_summary'),
            totalMessages: parseInt(pw.getValue('total_messages')) || 0,
            errorMessage: pw.getValue('error_message'),
            stateMessage: pw.getValue('state_message')
        };
    },

    _getBatchItems: function(batchRequestId) {
        var items = [];
        var gr = new GlideRecord('x_snc_update_center_batch_item');
        gr.addQuery('batch_request', batchRequestId);
        gr.orderBy('install_order');
        gr.query();

        while (gr.next()) {
            items.push({
                sys_id: gr.getUniqueValue(),
                applicationName: gr.getValue('application_name'),
                fromVersion: gr.getValue('from_version'),
                toVersion: gr.getValue('to_version'),
                updateLevel: gr.getValue('update_level'),
                state: gr.getValue('state'),
                progressPercent: parseInt(gr.getValue('progress_percent')) || 0,
                statusMessage: gr.getValue('status_message'),
                errorMessage: gr.getValue('error_message'),
                startTime: gr.getValue('start_time'),
                endTime: gr.getValue('end_time'),
                durationSeconds: parseInt(gr.getValue('duration_seconds')) || 0,
                installOrder: parseInt(gr.getValue('install_order'))
            });
        }
        return items;
    },

    _getRecentActivity: function(batchRequestId, limit) {
        var activities = [];
        var gr = new GlideRecord('x_snc_update_center_activity_log');
        gr.addQuery('batch_request', batchRequestId);
        gr.orderByDesc('timestamp');
        gr.setLimit(limit);
        gr.query();

        while (gr.next()) {
            activities.push({
                sys_id: gr.getUniqueValue(),
                timestamp: gr.getValue('timestamp'),
                activityType: gr.getValue('activity_type'),
                phase: gr.getValue('phase'),
                message: gr.getValue('message'),
                details: gr.getValue('details'),
                applicationName: gr.getValue('application_name'),
                progressPercent: parseInt(gr.getValue('progress_percent')) || 0,
                sequence: parseInt(gr.getValue('sequence')) || 0
            });
        }
        return activities;
    },

    _startProgressMonitoring: function(batchRequestId, progressWorkerId) {
        try {
            var monitorInputs = {
                batch_request_id: batchRequestId,
                progress_worker_id: progressWorkerId
            };
            sn_fd.FlowAPI.getRunner()
                .subflow('x_snc_update_center.monitor_batch_progress')
                .inBackground()
                .withInputs(monitorInputs)
                .run();
        } catch (ex) {
            gs.warn('UpdateCenter: Failed to start progress monitor: ' + ex.getMessage());
        }
    },

    type: 'BatchUpdateManager'
};
