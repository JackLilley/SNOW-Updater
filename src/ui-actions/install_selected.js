/**
 * UI Action: Install Selected Updates
 *
 * A list banner button that appears on the Available Updates remote table.
 * Collects selected records and triggers the batch installation flow.
 *
 * ════════════════════════════════════════════════════════════════════
 * Configuration:
 *
 *   Name:            Install Selected Updates
 *   Table:           x_snc_update_center_available_update
 *   Type:            List banner button
 *   Order:           100
 *   Active:          true
 *   Client:          true
 *   List choice:     true
 *   List v2 Compat:  true
 *   Show update:     true
 *   Onclick:         installSelectedUpdates()
 *
 *   Condition:       gs.hasRole('x_snc_update_center.admin')
 * ════════════════════════════════════════════════════════════════════
 */

// Client-side script (runs in browser)
function installSelectedUpdates() {
    var selectedRecords = g_list.getChecked();
    if (!selectedRecords || selectedRecords.length === 0) {
        g_form.addErrorMessage('Please select at least one update to install.');
        return false;
    }

    var count = selectedRecords.split(',').length;
    var dialogClass = typeof GlideModal !== 'undefined' ? GlideModal : GlideDialogWindow;
    var dialog = new dialogClass('x_snc_update_center_confirm_install');
    dialog.setTitle('Confirm Batch Installation');
    dialog.setSize(680, 500);
    dialog.setPreference('sysparm_app_versions', selectedRecords);
    dialog.setPreference('sysparm_count', count);
    dialog.render();

    return false;
}

/**
 * Alternative: Direct navigation to Next Experience page.
 * Use this version if you prefer the workspace UI over the modal dialog.
 */
function installSelectedUpdatesNX() {
    var selectedRecords = g_list.getChecked();
    if (!selectedRecords || selectedRecords.length === 0) {
        g_form.addErrorMessage('Please select at least one update to install.');
        return false;
    }

    var url = '/now/update-center/updates?selected=' + encodeURIComponent(selectedRecords);
    window.open(url, '_self');
    return false;
}
