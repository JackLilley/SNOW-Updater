/**
 * Remote Table Definition Script: Available Updates
 * Table: x_snc_update_center_available_update
 *
 * Dynamically queries sys_store_app and sys_app_version to build a consolidated
 * view of all available Store updates with version analysis.
 *
 * Remote Table Fields:
 * ─────────────────────────────────────────────────────────────────────
 *  Column Label             | Column Name              | Type       | Reference
 * ─────────────────────────────────────────────────────────────────────
 *  Name                     | name                     | String     |
 *  Application              | application              | Reference  | sys_store_app
 *  Scope                    | scope                    | String     |
 *  Installed Version        | installed_version        | String     |
 *  Available Version        | available_version        | Reference  | sys_app_version
 *  Version Number           | version_number           | String     |
 *  Update Level             | update_level             | Choice     | major/minor/patch
 *  Batch Level              | batch_level              | Choice     | major/minor/patch
 *  Risk Level               | risk_level               | Choice     | low/medium/high/critical
 *  Avail. Major             | major_count              | Integer    |
 *  Avail. Minor             | minor_count              | Integer    |
 *  Avail. Patches           | patch_count              | Integer    |
 *  Latest Major Version     | latest_major_version     | Reference  | sys_app_version
 *  Latest Minor Version     | latest_minor_version     | Reference  | sys_app_version
 *  Latest Patch Version     | latest_patch_version     | Reference  | sys_app_version
 *  Latest Version Level     | latest_version_level     | Choice     |
 *  Has Dependencies         | has_dependencies         | True/False |
 *  Dependency Count         | dependency_count         | Integer    |
 *  Last Updated             | last_updated             | Date/Time  |
 *  Vendor                   | vendor                   | String     |
 *  Release Notes URL        | release_notes_url        | URL        |
 */
(function executeQuery(v_table, v_query) {
    var res = {};
    var versionLevel = { 'major': 3, 'minor': 2, 'patch': 1, 'none': 0 };
    var versionLevelAscending = Object.keys(versionLevel).reverse();

    var getAvailableVersions = function(appSysId) {
        var versions = [];
        var vr = new GlideRecord('sys_app_version');
        vr.addQuery('source_app_id', '=', appSysId);
        vr.orderBy('version');
        vr.query();
        while (vr.next()) {
            versions.push({
                sys_id: vr.getUniqueValue(),
                name: vr.getDisplayValue(),
                version: vr.getValue('version'),
                publish_date: vr.getValue('publish_date')
            });
        }
        return versions;
    };

    var compareVersions = function(currentVer, availableVer) {
        var cur = currentVer.split('.');
        var avail = availableVer.split('.');

        if (cur[0] !== avail[0]) return 'major';
        if (cur[1] !== avail[1]) return 'minor';
        if (cur[2] !== avail[2]) return 'patch';
        return 'none';
    };

    var assessRisk = function(updateLevel, majorCount, minorCount) {
        if (updateLevel === 'major' || majorCount > 0) return 'high';
        if (minorCount > 2) return 'medium';
        if (updateLevel === 'minor') return 'medium';
        return 'low';
    };

    var getDependencyInfo = function(appSysId) {
        var count = 0;
        var depGr = new GlideRecord('sys_app_dependency');
        depGr.addQuery('source_app_id', appSysId);
        depGr.query();
        count = depGr.getRowCount();
        return { hasDependencies: count > 0, count: count };
    };

    var createTemplate = function() {
        return {
            sys_id: null,
            application: null,
            scope: null,
            name: null,
            update_level: null,
            available_version: null,
            version_number: null,
            installed_version: null,
            latest_major_version: null,
            latest_minor_version: null,
            latest_patch_version: null,
            major_count: 0,
            minor_count: 0,
            patch_count: 0,
            risk_level: 'low',
            has_dependencies: false,
            dependency_count: 0,
            last_updated: null,
            vendor: null,
            release_notes_url: null,
            latest_version_level: null,
            batch_level: null
        };
    };

    var storeApps = new GlideRecord('sys_store_app');
    storeApps.addQuery('active', '=', true);
    storeApps.addQuery('update_available', '=', true);
    storeApps.query();

    while (storeApps.next()) {
        var appId = storeApps.getUniqueValue();
        var appName = storeApps.getDisplayValue();
        var installedVer = storeApps.getValue('version');
        var scope = storeApps.getValue('scope');
        var vendor = storeApps.getValue('vendor') || 'ServiceNow';
        var versions = getAvailableVersions(appId);
        var depInfo = getDependencyInfo(appId);

        for (var i = 0; i < versions.length; i++) {
            var ver = versions[i];
            var diff = compareVersions(installedVer, ver.version);

            if (diff === 'none') continue;

            if (!res.hasOwnProperty(appId)) {
                res[appId] = {
                    major: createTemplate(),
                    minor: createTemplate(),
                    patch: createTemplate(),
                    none: createTemplate()
                };
            }

            var entry = res[appId][diff];
            entry.sys_id = ver.sys_id;
            entry.application = appId;
            entry.scope = scope;
            entry.update_level = diff;
            entry.available_version = ver.sys_id;
            entry.version_number = ver.version;
            entry.installed_version = installedVer;
            entry.name = appName + ' - ' + ver.version;
            entry.has_dependencies = depInfo.hasDependencies;
            entry.dependency_count = depInfo.count;
            entry.last_updated = ver.publish_date;
            entry.vendor = vendor;

            if (diff === 'patch') {
                entry.latest_patch_version = ver.sys_id;
                entry.latest_minor_version = ver.sys_id;
                entry.latest_major_version = ver.sys_id;
            }
            if (diff === 'minor') {
                entry.latest_minor_version = ver.sys_id;
                entry.latest_major_version = ver.sys_id;
            }
            if (diff === 'major') {
                entry.latest_major_version = ver.sys_id;
            }

            // Propagate version level and counts across all batch levels for this app
            ['patch', 'minor', 'major'].forEach(function(lvl) {
                res[appId][lvl].latest_version_level = diff;
                res[appId][lvl][diff + '_count']++;
            });
        }
    }

    // Post-process: fill gaps and compute risk, then add rows
    for (var app in res) {
        var lastLevel = res[app]['patch'];
        for (var l = 0; l < versionLevelAscending.length; l++) {
            var levelCheck = versionLevelAscending[l];
            if (l > 0) {
                if (gs.nil(res[app][levelCheck].application)) {
                    res[app][levelCheck] = JSON.parse(JSON.stringify(lastLevel));
                } else {
                    lastLevel = res[app][levelCheck];
                }
            }
        }

        for (var lev in res[app]) {
            if (lev === 'none') continue;
            var row = res[app][lev];
            row.batch_level = lev;
            row.risk_level = assessRisk(lev, row.major_count, row.minor_count);

            if (!gs.nil(row.available_version)) {
                v_table.addRow(row);
            }
        }
    }
})(v_table, v_query);
