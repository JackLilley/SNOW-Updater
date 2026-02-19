/**
 * Monitor Batch Progress - Flow Designer Script Step
 *
 * Polls the sys_progress_worker record for a running batch installation and
 * updates batch items and activity logs in real-time, providing the live
 * activity feed that drives the Progress Monitor UI.
 *
 * This script runs inside a Flow Designer Script action step within the
 * "Monitor Batch Progress" subflow.
 */
(function execute(inputs, outputs) {
    var batchRequestId = inputs.batch_request_id;
    var progressWorkerId = inputs.progress_worker_id;
    var logger = new x_snc_update_center.ActivityLogger();

    var MAX_POLL_TIME_MS = 7200000; // 2 hours max
    var POLL_INTERVAL_STARTING = 3000;
    var POLL_INTERVAL_RUNNING = 10000;
    var startTime = new Date().getTime();
    var lastMessage = '';
    var lastPercent = -1;
    var completedApps = 0;
    var failedApps = 0;
    var pollCount = 0;

    logger.log(batchRequestId, null, 'info', 'installation',
        'Progress monitor started. Tracking worker: ' + progressWorkerId);

    while (true) {
        pollCount++;
        var elapsed = new Date().getTime() - startTime;
        if (elapsed > MAX_POLL_TIME_MS) {
            logger.log(batchRequestId, null, 'warning', 'installation',
                'Progress monitor timed out after 2 hours');
            _finalizeBatch('failed', 'Monitor timeout');
            break;
        }

        var pw = new GlideRecord('sys_progress_worker');
        if (!pw.get(progressWorkerId)) {
            // Worker not found yet — CI/CD may still be creating it
            if (pollCount > 20) {
                logger.log(batchRequestId, null, 'error', 'installation',
                    'Progress worker not found after extended polling');
                _finalizeBatch('failed', 'Progress worker not found');
                break;
            }
            _sleep(POLL_INTERVAL_STARTING);
            continue;
        }

        var state = pw.getValue('state');
        var message = pw.getValue('message') || '';
        var percent = parseInt(pw.getValue('percent_complete')) || 0;
        var errorMsg = pw.getValue('error_message') || '';
        var outputSummary = pw.getValue('output_summary') || '';

        // Log state changes and message updates
        if (message !== lastMessage) {
            var actType = 'progress';
            if (message.toLowerCase().indexOf('error') !== -1 ||
                message.toLowerCase().indexOf('fail') !== -1) {
                actType = 'error';
            } else if (message.toLowerCase().indexOf('complete') !== -1 ||
                       message.toLowerCase().indexOf('success') !== -1) {
                actType = 'success';
            } else if (message.toLowerCase().indexOf('install') !== -1) {
                actType = 'info';
            }

            logger.log(batchRequestId, null, actType, 'installation', message, {
                progressPercent: percent,
                details: outputSummary
            });

            lastMessage = message;
            _parseAndUpdateItems(batchRequestId, message, percent);
        }

        // Log percent milestones (every 10%)
        if (percent !== lastPercent && percent % 10 === 0 && percent > 0) {
            _updateBatchProgress(batchRequestId, percent);
            lastPercent = percent;
        }

        // Check terminal states
        if (state === 'complete' || state === 'cancelled' || state === 'error') {
            var finalState = state === 'complete' ? 'completed' : 'failed';
            if (errorMsg) {
                logger.log(batchRequestId, null, 'error', 'post_install',
                    'Installation error: ' + errorMsg);
            }

            _syncFinalItemStates(batchRequestId);
            _finalizeBatch(finalState, outputSummary || message);
            break;
        }

        // Dynamic polling interval
        var interval = state === 'starting' ? POLL_INTERVAL_STARTING : POLL_INTERVAL_RUNNING;
        _sleep(interval);
    }

    function _sleep(ms) {
        var gpm = new GlideProgressMonitor(progressWorkerId);
        gpm.waitForCompletionOrTimeout(Math.ceil(ms / 1000));
    }

    function _updateBatchProgress(batchId, percent) {
        var gr = new GlideRecord('x_snc_update_center_batch_request');
        if (gr.get(batchId)) {
            gr.setValue('overall_progress', percent);
            gr.update();
        }
    }

    function _parseAndUpdateItems(batchId, message, overallPercent) {
        // Attempt to extract app-level info from progress worker messages
        // Messages from CI/CD often contain app names or version info
        var itemGr = new GlideRecord('x_snc_update_center_batch_item');
        itemGr.addQuery('batch_request', batchId);
        itemGr.addQuery('state', 'installing');
        itemGr.query();

        var totalItems = 0;
        while (itemGr.next()) totalItems++;

        if (totalItems > 0) {
            var perItemProgress = Math.round(overallPercent / 1);
            // The CI/CD batch installer processes sequentially, so estimate
            // which item is currently being processed based on overall progress
            var itemIndex = Math.floor((overallPercent / 100) * totalItems);

            itemGr = new GlideRecord('x_snc_update_center_batch_item');
            itemGr.addQuery('batch_request', batchId);
            itemGr.addQuery('state', 'installing');
            itemGr.orderBy('install_order');
            itemGr.query();

            var idx = 0;
            while (itemGr.next()) {
                if (idx < itemIndex) {
                    itemGr.setValue('state', 'completed');
                    itemGr.setValue('progress_percent', 100);
                    itemGr.setValue('end_time', new GlideDateTime());
                    itemGr.setValue('status_message', 'Installed successfully');

                    var startDt = new GlideDateTime(itemGr.getValue('start_time'));
                    var endDt = new GlideDateTime();
                    var dur = GlideDateTime.subtract(startDt, endDt);
                    itemGr.setValue('duration_seconds', Math.round(dur.getNumericValue() / 1000));
                    itemGr.update();
                    completedApps++;
                } else if (idx === itemIndex) {
                    var itemPercent = Math.round(
                        ((overallPercent - (itemIndex / totalItems * 100)) /
                         (100 / totalItems)) * 100
                    );
                    itemPercent = Math.max(0, Math.min(100, itemPercent));
                    itemGr.setValue('progress_percent', itemPercent);
                    itemGr.setValue('status_message', message);
                    itemGr.update();
                }
                idx++;
            }
        }
    }

    function _syncFinalItemStates(batchId) {
        // After completion, check sys_store_app to determine which actually updated
        var itemGr = new GlideRecord('x_snc_update_center_batch_item');
        itemGr.addQuery('batch_request', batchId);
        itemGr.query();

        while (itemGr.next()) {
            var appGr = new GlideRecord('sys_store_app');
            if (appGr.get(itemGr.getValue('application'))) {
                var currentVersion = appGr.getValue('version');
                var targetVersion = itemGr.getValue('to_version');

                if (currentVersion === targetVersion) {
                    if (itemGr.getValue('state') !== 'completed') {
                        itemGr.setValue('state', 'completed');
                        itemGr.setValue('progress_percent', 100);
                        itemGr.setValue('status_message', 'Installed successfully');
                        if (!itemGr.getValue('end_time')) {
                            itemGr.setValue('end_time', new GlideDateTime());
                        }
                        itemGr.update();

                        logger.logAppInstallComplete(batchId, itemGr.getUniqueValue(),
                            itemGr.getValue('application_name'), targetVersion, 0);
                    }
                } else if (itemGr.getValue('state') === 'installing') {
                    itemGr.setValue('state', 'failed');
                    itemGr.setValue('error_message',
                        'Version mismatch after install. Expected ' + targetVersion +
                        ', found ' + currentVersion);
                    itemGr.setValue('end_time', new GlideDateTime());
                    itemGr.update();
                    failedApps++;

                    logger.logAppInstallFailed(batchId, itemGr.getUniqueValue(),
                        itemGr.getValue('application_name'),
                        'Version not updated to ' + targetVersion);
                }
            }
        }
    }

    function _finalizeBatch(state, message) {
        // Count final statuses
        var countCompleted = 0, countFailed = 0, countSkipped = 0;
        var itemGr = new GlideRecord('x_snc_update_center_batch_item');
        itemGr.addQuery('batch_request', batchRequestId);
        itemGr.query();
        while (itemGr.next()) {
            var s = itemGr.getValue('state');
            if (s === 'completed') countCompleted++;
            else if (s === 'failed') countFailed++;
            else if (s === 'skipped') countSkipped++;
        }

        var finalState = state;
        if (countFailed > 0 && countCompleted > 0) finalState = 'partial';

        var gr = new GlideRecord('x_snc_update_center_batch_request');
        if (gr.get(batchRequestId)) {
            gr.setValue('state', finalState);
            gr.setValue('completed_apps', countCompleted);
            gr.setValue('failed_apps', countFailed);
            gr.setValue('skipped_apps', countSkipped);
            gr.setValue('overall_progress', 100);
            gr.setValue('actual_end', new GlideDateTime());

            var startDt = new GlideDateTime(gr.getValue('actual_start'));
            var endDt = new GlideDateTime();
            var dur = GlideDateTime.subtract(startDt, endDt);
            gr.setValue('duration_seconds', Math.round(dur.getNumericValue() / 1000));

            if (countFailed > 0) {
                gr.setValue('error_summary', countFailed + ' app(s) failed to install');
            }
            gr.update();
        }

        logger.logBatchComplete(batchRequestId, {
            completed: countCompleted,
            failed: countFailed,
            skipped: countSkipped,
            total: countCompleted + countFailed + countSkipped,
            durationSeconds: Math.round((new Date().getTime() - startTime) / 1000)
        });

        outputs.final_state = finalState;
        outputs.summary = message;
    }

})(inputs, outputs);
