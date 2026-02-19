/**
 * UpdateAnalyzer - Analyzes available updates for risk, dependencies, and categorization.
 *
 * Provides intelligence about which updates are safe to batch-install,
 * identifies dependency chains, and assesses risk levels.
 *
 * @class UpdateAnalyzer
 * @memberof x_snc_update_center
 */
var UpdateAnalyzer = Class.create();
UpdateAnalyzer.prototype = {
    initialize: function() {
        this.RISK_WEIGHTS = {
            major: 30,
            minor: 15,
            patch: 5,
            dependency_per: 10,
            customization_detected: 20
        };
    },

    /**
     * Get a summary of all available updates grouped by type.
     * @returns {object} { major, minor, patch, total, byVendor, riskBreakdown }
     */
    getUpdateSummary: function() {
        var summary = {
            major: 0,
            minor: 0,
            patch: 0,
            total: 0,
            byVendor: {},
            riskBreakdown: { low: 0, medium: 0, high: 0, critical: 0 },
            apps: []
        };

        var storeApps = new GlideRecord('sys_store_app');
        storeApps.addQuery('active', true);
        storeApps.addQuery('update_available', true);
        storeApps.query();

        while (storeApps.next()) {
            var appId = storeApps.getUniqueValue();
            var appName = storeApps.getDisplayValue();
            var installedVer = storeApps.getValue('version');
            var vendor = storeApps.getValue('vendor') || 'ServiceNow';
            var latestVer = this._getLatestAvailableVersion(appId);

            if (!latestVer) continue;

            var level = this.getUpdateLevel(installedVer, latestVer.version);
            var risk = this.assessAppRisk(appId, level);

            summary[level]++;
            summary.total++;

            if (!summary.byVendor[vendor]) summary.byVendor[vendor] = 0;
            summary.byVendor[vendor]++;

            summary.riskBreakdown[risk]++;

            summary.apps.push({
                sys_id: appId,
                name: appName,
                scope: storeApps.getValue('scope'),
                installedVersion: installedVer,
                availableVersion: latestVer.version,
                availableVersionSysId: latestVer.sys_id,
                updateLevel: level,
                riskLevel: risk,
                vendor: vendor,
                publishDate: latestVer.publish_date
            });
        }

        return summary;
    },

    /**
     * Determine update level between two version strings.
     * @param {string} fromVersion - e.g. "2.1.3"
     * @param {string} toVersion - e.g. "3.0.0"
     * @returns {string} 'major', 'minor', or 'patch'
     */
    getUpdateLevel: function(fromVersion, toVersion) {
        var from = (fromVersion || '0.0.0').split('.');
        var to = (toVersion || '0.0.0').split('.');

        if (from[0] !== to[0]) return 'major';
        if (from[1] !== to[1]) return 'minor';
        return 'patch';
    },

    /**
     * Assess risk level for updating an app.
     * Considers update level, dependencies, and customization.
     * @param {string} appSysId
     * @param {string} updateLevel
     * @returns {string} 'low', 'medium', 'high', or 'critical'
     */
    assessAppRisk: function(appSysId, updateLevel) {
        var score = 0;
        score += this.RISK_WEIGHTS[updateLevel] || 0;

        var depCount = this._getDependencyCount(appSysId);
        score += depCount * this.RISK_WEIGHTS.dependency_per;

        if (this._hasCustomizations(appSysId)) {
            score += this.RISK_WEIGHTS.customization_detected;
        }

        if (score >= 60) return 'critical';
        if (score >= 40) return 'high';
        if (score >= 20) return 'medium';
        return 'low';
    },

    /**
     * Analyze dependencies for a set of apps about to be installed.
     * Returns install order and any conflicts.
     * @param {string[]} appSysIds - Array of sys_store_app sys_ids
     * @returns {object} { orderedApps, conflicts, warnings }
     */
    analyzeDependencies: function(appSysIds) {
        var result = {
            orderedApps: [],
            conflicts: [],
            warnings: [],
            dependencyMap: {}
        };

        var depMap = {};
        for (var i = 0; i < appSysIds.length; i++) {
            var appId = appSysIds[i];
            depMap[appId] = this._getAppDependencies(appId);
        }
        result.dependencyMap = depMap;

        var sorted = this._topologicalSort(appSysIds, depMap);
        result.orderedApps = sorted.order;
        result.conflicts = sorted.conflicts;

        for (var j = 0; j < appSysIds.length; j++) {
            var deps = depMap[appSysIds[j]] || [];
            for (var k = 0; k < deps.length; k++) {
                if (appSysIds.indexOf(deps[k]) === -1) {
                    var depApp = this._getAppName(deps[k]);
                    var thisApp = this._getAppName(appSysIds[j]);
                    result.warnings.push(
                        thisApp + ' depends on ' + depApp +
                        ' which is not in this batch. Ensure it is already up to date.'
                    );
                }
            }
        }

        return result;
    },

    /**
     * Check for available updates per category and return counts.
     * Lightweight version of getUpdateSummary for the dashboard cards.
     * @returns {object} { major, minor, patch, total }
     */
    getUpdateCounts: function() {
        var counts = { major: 0, minor: 0, patch: 0, total: 0 };

        var storeApps = new GlideRecord('sys_store_app');
        storeApps.addQuery('active', true);
        storeApps.addQuery('update_available', true);
        storeApps.query();

        while (storeApps.next()) {
            var installedVer = storeApps.getValue('version');
            var latestVer = this._getLatestAvailableVersion(storeApps.getUniqueValue());
            if (!latestVer) continue;

            var level = this.getUpdateLevel(installedVer, latestVer.version);
            counts[level]++;
            counts.total++;
        }

        return counts;
    },

    // ── Private Methods ─────────────────────────────────────────────

    _getLatestAvailableVersion: function(appSysId) {
        var vr = new GlideRecord('sys_app_version');
        vr.addQuery('source_app_id', appSysId);
        vr.orderByDesc('version');
        vr.setLimit(1);
        vr.query();

        if (vr.next()) {
            return {
                sys_id: vr.getUniqueValue(),
                version: vr.getValue('version'),
                publish_date: vr.getValue('publish_date')
            };
        }
        return null;
    },

    _getDependencyCount: function(appSysId) {
        var ga = new GlideAggregate('sys_app_dependency');
        ga.addQuery('source_app_id', appSysId);
        ga.addAggregate('COUNT');
        ga.query();
        if (ga.next()) return parseInt(ga.getAggregate('COUNT'));
        return 0;
    },

    _getAppDependencies: function(appSysId) {
        var deps = [];
        var gr = new GlideRecord('sys_app_dependency');
        gr.addQuery('source_app_id', appSysId);
        gr.query();
        while (gr.next()) {
            deps.push(gr.getValue('target_app_id'));
        }
        return deps;
    },

    _getAppName: function(appSysId) {
        var gr = new GlideRecord('sys_store_app');
        if (gr.get(appSysId)) return gr.getDisplayValue();
        return appSysId;
    },

    _hasCustomizations: function(appSysId) {
        var gr = new GlideRecord('sys_store_app');
        if (!gr.get(appSysId)) return false;
        var scope = gr.getValue('scope');
        if (!scope) return false;

        var custGr = new GlideRecord('sys_update_xml');
        custGr.addQuery('update_set.application', scope);
        custGr.addQuery('update_set.is_default', false);
        custGr.setLimit(1);
        custGr.query();
        return custGr.hasNext();
    },

    _topologicalSort: function(appIds, depMap) {
        var visited = {};
        var order = [];
        var conflicts = [];
        var visiting = {};

        var visit = function(id) {
            if (visiting[id]) {
                conflicts.push('Circular dependency detected involving ' + id);
                return;
            }
            if (visited[id]) return;

            visiting[id] = true;
            var deps = depMap[id] || [];
            for (var i = 0; i < deps.length; i++) {
                if (appIds.indexOf(deps[i]) !== -1) {
                    visit(deps[i]);
                }
            }
            visiting[id] = false;
            visited[id] = true;
            order.push(id);
        };

        for (var i = 0; i < appIds.length; i++) {
            visit(appIds[i]);
        }

        return { order: order, conflicts: conflicts };
    },

    type: 'UpdateAnalyzer'
};
