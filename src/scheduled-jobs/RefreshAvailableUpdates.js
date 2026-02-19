/**
 * Scheduled Job: Refresh Available Updates Summary
 *
 * Runs daily to pre-cache update analysis and optionally send notifications
 * when new updates are detected since the last run.
 *
 * ════════════════════════════════════════════════════════════════════
 * Configuration:
 *
 *   Name:         Refresh Update Center Summary
 *   Run as:       System
 *   Active:       true
 *   Run type:     Periodically
 *   Repeat:       Daily at 06:00
 *   Application:  x_snc_update_center
 *   Conditional:  gs.hasRole('admin')
 * ════════════════════════════════════════════════════════════════════
 */
(function executeJob() {
    var LOG_PREFIX = 'UpdateCenter.RefreshJob: ';
    gs.info(LOG_PREFIX + 'Starting available updates refresh');

    var analyzer = new x_snc_update_center.UpdateAnalyzer();
    var summary = analyzer.getUpdateSummary();

    gs.info(LOG_PREFIX + 'Found ' + summary.total + ' available updates ' +
        '(Major: ' + summary.major + ', Minor: ' + summary.minor +
        ', Patch: ' + summary.patch + ')');

    // Store latest counts in a system property for quick dashboard access
    var countsJson = JSON.stringify({
        total: summary.total,
        major: summary.major,
        minor: summary.minor,
        patch: summary.patch,
        riskBreakdown: summary.riskBreakdown,
        lastRefreshed: new GlideDateTime().getDisplayValue()
    });

    gs.setProperty('x_snc_update_center.cached_summary', countsJson);

    // Check if new updates appeared since last notification
    var lastNotified = gs.getProperty('x_snc_update_center.last_notified_count', '0');
    var lastCount = parseInt(lastNotified) || 0;

    if (summary.total > lastCount) {
        var newUpdates = summary.total - lastCount;
        gs.info(LOG_PREFIX + newUpdates + ' new update(s) detected since last notification');

        _notifyAdmins(summary, newUpdates);
        gs.setProperty('x_snc_update_center.last_notified_count', String(summary.total));
    }

    gs.info(LOG_PREFIX + 'Refresh complete');

    function _notifyAdmins(summary, newCount) {
        var notifyEnabled = gs.getProperty('x_snc_update_center.notify_on_new_updates', 'true');
        if (notifyEnabled !== 'true') return;

        var adminGr = new GlideRecord('sys_user_has_role');
        adminGr.addQuery('role.name', 'x_snc_update_center.admin');
        adminGr.addQuery('user.active', true);
        adminGr.query();

        var recipients = [];
        while (adminGr.next()) {
            var email = adminGr.user.email.toString();
            if (email) recipients.push(email);
        }

        if (recipients.length === 0) return;

        var subject = 'Update Center: ' + newCount + ' New Store Update(s) Available';
        var body = 'SNOW Update Center has detected ' + newCount +
            ' new Store update(s) available for installation.\n\n' +
            'Summary:\n' +
            '  Total Available: ' + summary.total + '\n' +
            '  Major Updates:   ' + summary.major + '\n' +
            '  Minor Updates:   ' + summary.minor + '\n' +
            '  Patches:         ' + summary.patch + '\n\n' +
            'Risk Breakdown:\n' +
            '  Critical: ' + summary.riskBreakdown.critical + '\n' +
            '  High:     ' + summary.riskBreakdown.high + '\n' +
            '  Medium:   ' + summary.riskBreakdown.medium + '\n' +
            '  Low:      ' + summary.riskBreakdown.low + '\n\n' +
            'Open Update Center to review and install updates.';

        var mail = new GlideEmailOutbound();
        mail.setSubject(subject);
        mail.setBody(body);
        for (var i = 0; i < recipients.length; i++) {
            mail.addAddress('to', recipients[i]);
        }
        mail.save();

        gs.info(LOG_PREFIX + 'Notification sent to ' + recipients.length + ' admin(s)');
    }
})();
