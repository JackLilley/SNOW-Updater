/**
 * Update Dashboard - Main dashboard macroponent for SNOW Update Center.
 *
 * Displays a high-level overview with:
 *  - Summary cards (total, major, minor, patch counts)
 *  - Risk breakdown donut chart
 *  - Quick action buttons
 *  - Recent installation history
 *
 * ════════════════════════════════════════════════════════════════════
 * UI Builder Macroponent Configuration:
 *
 *   Name:         SNOW Update Dashboard
 *   API Name:     x_snc_update_center.update-dashboard
 *   Category:     Custom Components
 *   Description:  Dashboard overview for Store update management
 * ════════════════════════════════════════════════════════════════════
 *
 * @component
 * @properties
 *   None (fetches its own data)
 *
 * @dispatches
 *   UPDATE_CENTER#NAVIGATE_TO_LIST   - Navigate to update list with optional filter
 *   UPDATE_CENTER#NAVIGATE_TO_HISTORY - Navigate to installation history
 */

// ── Client Script (Now Experience Component) ────────────────────────

const DASHBOARD_API = '/api/x_snc_update_center/v1/dashboard';
const HISTORY_API = '/api/x_snc_update_center/v1/history?limit=5';

const component = {
    properties: {},

    state: {
        loading: true,
        error: null,
        counts: { total: 0, major: 0, minor: 0, patch: 0 },
        riskBreakdown: { low: 0, medium: 0, high: 0, critical: 0 },
        byVendor: {},
        recentHistory: []
    },

    actions: {
        COMPONENT_CONNECTED: {
            effect({ dispatch }) {
                dispatch('FETCH_DASHBOARD');
                dispatch('FETCH_RECENT_HISTORY');
            }
        },

        FETCH_DASHBOARD: {
            effect({ updateState }) {
                fetch(DASHBOARD_API, { headers: { 'Accept': 'application/json' } })
                    .then(res => res.json())
                    .then(data => {
                        updateState({
                            loading: false,
                            counts: data.result.counts,
                            riskBreakdown: data.result.riskBreakdown,
                            byVendor: data.result.byVendor
                        });
                    })
                    .catch(err => {
                        updateState({ loading: false, error: err.message });
                    });
            }
        },

        FETCH_RECENT_HISTORY: {
            effect({ updateState }) {
                fetch(HISTORY_API, { headers: { 'Accept': 'application/json' } })
                    .then(res => res.json())
                    .then(data => {
                        updateState({ recentHistory: data.result.data || [] });
                    })
                    .catch(() => {});
            }
        },

        NAVIGATE_TO_LIST: {
            effect({ dispatch, action }) {
                dispatch('UPDATE_CENTER#NAVIGATE_TO_LIST', {
                    filter: action.payload?.filter || ''
                });
            }
        }
    },

    view(state, { dispatch }) {
        return `
<div class="uc-dashboard">
    <!-- Header -->
    <div class="uc-dashboard-header">
        <div class="uc-header-content">
            <h1 class="uc-title">Update Center</h1>
            <p class="uc-subtitle">Manage and install ServiceNow Store updates</p>
        </div>
        <div class="uc-header-actions">
            <now-button
                label="View All Updates"
                variant="primary"
                size="md"
                icon="arrow-right-fill"
                on-click={() => dispatch('NAVIGATE_TO_LIST')}
            />
            <now-button
                label="Installation History"
                variant="secondary"
                size="md"
                icon="clock-outline"
                on-click={() => dispatch('UPDATE_CENTER#NAVIGATE_TO_HISTORY')}
            />
        </div>
    </div>

    <!-- Summary Cards -->
    <div class="uc-summary-cards">
        <div class="uc-card uc-card-total"
             on-click={() => dispatch('NAVIGATE_TO_LIST')}>
            <div class="uc-card-icon">
                <now-icon icon="arrow-up-circle-outline" size="lg" />
            </div>
            <div class="uc-card-content">
                <span class="uc-card-number">${state.counts.total}</span>
                <span class="uc-card-label">Total Updates</span>
            </div>
        </div>

        <div class="uc-card uc-card-major"
             on-click={() => dispatch('NAVIGATE_TO_LIST', { filter: 'major' })}>
            <div class="uc-card-icon">
                <now-icon icon="alert-triangle-fill" size="lg" />
            </div>
            <div class="uc-card-content">
                <span class="uc-card-number">${state.counts.major}</span>
                <span class="uc-card-label">Major</span>
            </div>
            <div class="uc-card-badge uc-badge-major">Breaking Changes Possible</div>
        </div>

        <div class="uc-card uc-card-minor"
             on-click={() => dispatch('NAVIGATE_TO_LIST', { filter: 'minor' })}>
            <div class="uc-card-icon">
                <now-icon icon="plus-circle-outline" size="lg" />
            </div>
            <div class="uc-card-content">
                <span class="uc-card-number">${state.counts.minor}</span>
                <span class="uc-card-label">Minor</span>
            </div>
            <div class="uc-card-badge uc-badge-minor">New Features</div>
        </div>

        <div class="uc-card uc-card-patch"
             on-click={() => dispatch('NAVIGATE_TO_LIST', { filter: 'patch' })}>
            <div class="uc-card-icon">
                <now-icon icon="check-circle-outline" size="lg" />
            </div>
            <div class="uc-card-content">
                <span class="uc-card-number">${state.counts.patch}</span>
                <span class="uc-card-label">Patches</span>
            </div>
            <div class="uc-card-badge uc-badge-patch">Bug Fixes</div>
        </div>
    </div>

    <!-- Risk Breakdown + Recent History -->
    <div class="uc-dashboard-grid">
        <div class="uc-panel uc-risk-panel">
            <h2 class="uc-panel-title">Risk Assessment</h2>
            <div class="uc-risk-bars">
                ${_renderRiskBar('Critical', state.riskBreakdown.critical, state.counts.total, '#c23934')}
                ${_renderRiskBar('High', state.riskBreakdown.high, state.counts.total, '#fe9339')}
                ${_renderRiskBar('Medium', state.riskBreakdown.medium, state.counts.total, '#f0c355')}
                ${_renderRiskBar('Low', state.riskBreakdown.low, state.counts.total, '#2e844a')}
            </div>
        </div>

        <div class="uc-panel uc-history-panel">
            <h2 class="uc-panel-title">Recent Installations</h2>
            ${state.recentHistory.length === 0
                ? '<p class="uc-empty-state">No installations yet</p>'
                : state.recentHistory.map(h => _renderHistoryItem(h)).join('')
            }
        </div>
    </div>
</div>`;
    }
};

function _renderRiskBar(label, count, total, color) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
<div class="uc-risk-row">
    <span class="uc-risk-label">${label}</span>
    <div class="uc-risk-bar-track">
        <div class="uc-risk-bar-fill" style="width: ${pct}%; background: ${color};"></div>
    </div>
    <span class="uc-risk-count">${count}</span>
</div>`;
}

function _renderHistoryItem(h) {
    const stateIcons = {
        completed: 'check-circle-fill',
        failed: 'close-circle-fill',
        partial: 'alert-circle-fill',
        in_progress: 'spinner',
        cancelled: 'ban-fill'
    };
    const stateColors = {
        completed: '#2e844a',
        failed: '#c23934',
        partial: '#fe9339',
        in_progress: '#0070d2',
        cancelled: '#666666'
    };
    return `
<div class="uc-history-item">
    <now-icon icon="${stateIcons[h.state] || 'circle-outline'}"
              style="color: ${stateColors[h.state] || '#666'};" />
    <div class="uc-history-detail">
        <span class="uc-history-number">${h.number}</span>
        <span class="uc-history-meta">
            ${h.completedApps}/${h.totalApps} apps
            ${h.actualStart ? ' — ' + h.actualStart : ''}
        </span>
    </div>
    <now-badge label="${h.state}" color="${stateColors[h.state]}" />
</div>`;
}

export default component;
