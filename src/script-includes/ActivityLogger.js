/**
 * ActivityLogger - Manages detailed activity log entries for batch installations.
 *
 * Provides a rich activity feed similar to Application Manager's activity monitor,
 * with timestamped entries for every phase of the installation process.
 *
 * @class ActivityLogger
 * @memberof x_snc_update_center
 */
var ActivityLogger = Class.create();
ActivityLogger.prototype = {
    initialize: function() {
        this._sequenceCounter = 0;
    },

    /**
     * Log an activity entry.
     * @param {string} batchRequestId - The parent batch request
     * @param {string|null} batchItemId - Specific item (null for batch-level)
     * @param {string} activityType - info|success|warning|error|progress|start|complete|milestone
     * @param {string} phase - preparation|validation|download|installation|post_install|cleanup
     * @param {string} message - Human-readable message
     * @param {object} [options] - Additional options
     * @param {string} [options.details] - Extended details
     * @param {string} [options.applicationName] - App name for item-level logs
     * @param {number} [options.progressPercent] - Current progress
     * @returns {string} sys_id of the created log entry
     */
    log: function(batchRequestId, batchItemId, activityType, phase, message, options) {
        options = options || {};
        this._sequenceCounter++;

        var gr = new GlideRecord('x_snc_update_center_activity_log');
        gr.initialize();
        gr.setValue('batch_request', batchRequestId);
        if (batchItemId) gr.setValue('batch_item', batchItemId);
        gr.setValue('activity_type', activityType);
        gr.setValue('phase', phase);
        gr.setValue('message', message);
        gr.setValue('sequence', this._sequenceCounter);

        if (options.details) gr.setValue('details', options.details);
        if (options.applicationName) gr.setValue('application_name', options.applicationName);
        if (options.progressPercent !== undefined) gr.setValue('progress_percent', options.progressPercent);

        return gr.insert();
    },

    /**
     * Log the start of an individual app installation.
     * @param {string} batchRequestId
     * @param {string} batchItemId
     * @param {string} appName
     * @param {string} fromVersion
     * @param {string} toVersion
     */
    logAppInstallStart: function(batchRequestId, batchItemId, appName, fromVersion, toVersion) {
        this.log(batchRequestId, batchItemId, 'start', 'installation',
            'Starting installation: ' + appName + ' ' + fromVersion + ' → ' + toVersion,
            { applicationName: appName, progressPercent: 0 });
    },

    /**
     * Log successful completion of an app installation.
     * @param {string} batchRequestId
     * @param {string} batchItemId
     * @param {string} appName
     * @param {string} toVersion
     * @param {number} durationMs
     */
    logAppInstallComplete: function(batchRequestId, batchItemId, appName, toVersion, durationMs) {
        var durSec = Math.round(durationMs / 1000);
        this.log(batchRequestId, batchItemId, 'success', 'installation',
            appName + ' updated to ' + toVersion + ' (' + durSec + 's)',
            { applicationName: appName, progressPercent: 100 });
    },

    /**
     * Log a failed app installation.
     * @param {string} batchRequestId
     * @param {string} batchItemId
     * @param {string} appName
     * @param {string} errorMessage
     */
    logAppInstallFailed: function(batchRequestId, batchItemId, appName, errorMessage) {
        this.log(batchRequestId, batchItemId, 'error', 'installation',
            'Failed to install ' + appName + ': ' + errorMessage,
            { applicationName: appName, details: errorMessage });
    },

    /**
     * Log a progress milestone for the overall batch.
     * @param {string} batchRequestId
     * @param {number} completed
     * @param {number} total
     */
    logBatchProgress: function(batchRequestId, completed, total) {
        var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        this.log(batchRequestId, null, 'milestone', 'installation',
            completed + ' of ' + total + ' applications processed (' + pct + '%)',
            { progressPercent: pct });
    },

    /**
     * Log completion of the entire batch.
     * @param {string} batchRequestId
     * @param {object} summary - { completed, failed, skipped, total, durationSeconds }
     */
    logBatchComplete: function(batchRequestId, summary) {
        var msg = 'Batch installation complete. ' +
            summary.completed + ' succeeded, ' +
            summary.failed + ' failed, ' +
            summary.skipped + ' skipped. ' +
            'Total time: ' + this._formatDuration(summary.durationSeconds);

        var actType = summary.failed > 0 ? 'warning' : 'complete';
        this.log(batchRequestId, null, actType, 'cleanup', msg,
            { progressPercent: 100, details: JSON.stringify(summary) });
    },

    /**
     * Get activity log entries for a batch request, suitable for the UI feed.
     * @param {string} batchRequestId
     * @param {object} [options]
     * @param {number} [options.limit=100]
     * @param {string} [options.sinceTimestamp] - Only entries after this timestamp
     * @param {string} [options.activityType] - Filter by type
     * @returns {object[]}
     */
    getActivityFeed: function(batchRequestId, options) {
        options = options || {};
        var limit = options.limit || 100;
        var entries = [];

        var gr = new GlideRecord('x_snc_update_center_activity_log');
        gr.addQuery('batch_request', batchRequestId);

        if (options.sinceTimestamp) {
            gr.addQuery('timestamp', '>', options.sinceTimestamp);
        }
        if (options.activityType) {
            gr.addQuery('activity_type', options.activityType);
        }

        gr.orderByDesc('sequence');
        gr.setLimit(limit);
        gr.query();

        while (gr.next()) {
            entries.push({
                sys_id: gr.getUniqueValue(),
                timestamp: gr.getValue('timestamp'),
                relativeTime: this._getRelativeTime(gr.getValue('timestamp')),
                activityType: gr.getValue('activity_type'),
                phase: gr.getValue('phase'),
                message: gr.getValue('message'),
                details: gr.getValue('details'),
                applicationName: gr.getValue('application_name'),
                progressPercent: parseInt(gr.getValue('progress_percent')) || 0,
                sequence: parseInt(gr.getValue('sequence')),
                icon: this._getActivityIcon(gr.getValue('activity_type')),
                color: this._getActivityColor(gr.getValue('activity_type'))
            });
        }

        return entries;
    },

    // ── Private Methods ─────────────────────────────────────────────

    _formatDuration: function(seconds) {
        if (seconds < 60) return seconds + 's';
        var min = Math.floor(seconds / 60);
        var sec = seconds % 60;
        if (min < 60) return min + 'm ' + sec + 's';
        var hr = Math.floor(min / 60);
        min = min % 60;
        return hr + 'h ' + min + 'm';
    },

    _getRelativeTime: function(timestamp) {
        if (!timestamp) return '';
        var then = new GlideDateTime(timestamp);
        var now = new GlideDateTime();
        var diff = GlideDateTime.subtract(then, now);
        var seconds = Math.abs(diff.getNumericValue() / 1000);

        if (seconds < 10) return 'just now';
        if (seconds < 60) return Math.floor(seconds) + 's ago';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
        return Math.floor(seconds / 3600) + 'h ago';
    },

    _getActivityIcon: function(activityType) {
        var icons = {
            'info': 'info-circle-outline',
            'success': 'check-circle-fill',
            'warning': 'alert-triangle-fill',
            'error': 'close-circle-fill',
            'progress': 'spinner',
            'start': 'play-fill',
            'complete': 'check-decagram-outline',
            'milestone': 'flag-fill'
        };
        return icons[activityType] || 'circle-outline';
    },

    _getActivityColor: function(activityType) {
        var colors = {
            'info': '#0070d2',
            'success': '#2e844a',
            'warning': '#fe9339',
            'error': '#c23934',
            'progress': '#0070d2',
            'start': '#0070d2',
            'complete': '#2e844a',
            'milestone': '#8b5cf6'
        };
        return colors[activityType] || '#666666';
    },

    type: 'ActivityLogger'
};
