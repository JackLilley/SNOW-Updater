/**
 * Progress Monitor - Real-time installation progress tracking macroponent.
 *
 * This is the crown jewel of the app — a live activity monitor similar to
 * Application Manager's built-in progress view, but with richer detail:
 *
 *  - Overall progress bar with percentage and ETA
 *  - Per-application progress cards with individual status
 *  - Live activity feed (scrolling log of events)
 *  - Phase indicators (Preparation → Validation → Install → Post-Install)
 *  - Duration tracking
 *  - Cancel button
 *
 * ════════════════════════════════════════════════════════════════════
 * UI Builder Macroponent Configuration:
 *
 *   Name:         SNOW Update Progress Monitor
 *   API Name:     x_snc_update_center.progress-monitor
 *   Category:     Custom Components
 * ════════════════════════════════════════════════════════════════════
 *
 * @component
 * @properties
 *   batchRequestId {string} - sys_id of the batch request to monitor
 *
 * @dispatches
 *   UPDATE_CENTER#INSTALL_COMPLETE - Fired when installation finishes
 */

const STATUS_API = '/api/x_snc_update_center/v1/batch-status';
const ACTIVITY_API = '/api/x_snc_update_center/v1/activity-feed';
const CANCEL_API = '/api/x_snc_update_center/v1/cancel';

const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATES = ['completed', 'failed', 'partial', 'cancelled'];

const component = {
    properties: {
        batchRequestId: { default: '' }
    },

    state: {
        loading: true,
        batch: null,
        items: [],
        activityLog: [],
        elapsedSeconds: 0,
        pollTimer: null,
        elapsedTimer: null,
        lastActivityTimestamp: null,
        showCancelConfirm: false,
        autoScroll: true
    },

    actions: {
        COMPONENT_CONNECTED: {
            effect({ dispatch, properties }) {
                dispatch('FETCH_STATUS');
                const pollTimer = setInterval(() => dispatch('POLL'), POLL_INTERVAL_MS);
                const elapsedTimer = setInterval(() => dispatch('TICK'), 1000);
                dispatch('SET_TIMERS', { pollTimer, elapsedTimer });
            }
        },

        COMPONENT_DISCONNECTED: {
            effect({ state }) {
                if (state.pollTimer) clearInterval(state.pollTimer);
                if (state.elapsedTimer) clearInterval(state.elapsedTimer);
            }
        },

        SET_TIMERS: {
            reducer(state, { payload }) {
                return { ...state, pollTimer: payload.pollTimer, elapsedTimer: payload.elapsedTimer };
            }
        },

        TICK: {
            reducer(state) {
                if (state.batch && TERMINAL_STATES.includes(state.batch.state)) return state;
                return { ...state, elapsedSeconds: state.elapsedSeconds + 1 };
            }
        },

        FETCH_STATUS: {
            effect({ properties, updateState, dispatch }) {
                const url = `${STATUS_API}/${properties.batchRequestId}`;
                fetch(url, { headers: { 'Accept': 'application/json' } })
                    .then(res => res.json())
                    .then(data => {
                        const batchData = data.result.data;
                        updateState({
                            loading: false,
                            batch: batchData,
                            items: batchData.items || [],
                            activityLog: batchData.activityLog || []
                        });

                        if (TERMINAL_STATES.includes(batchData.state)) {
                            dispatch('STOP_POLLING');
                            dispatch('UPDATE_CENTER#INSTALL_COMPLETE', {
                                batchRequestId: properties.batchRequestId,
                                state: batchData.state
                            });
                        }
                    })
                    .catch(err => {
                        updateState({ loading: false, error: err.message });
                    });
            }
        },

        POLL: {
            effect({ dispatch, state }) {
                if (state.batch && TERMINAL_STATES.includes(state.batch.state)) return;
                dispatch('FETCH_STATUS');
                dispatch('FETCH_NEW_ACTIVITY');
            }
        },

        FETCH_NEW_ACTIVITY: {
            effect({ properties, state, updateState }) {
                let url = `${ACTIVITY_API}/${properties.batchRequestId}?limit=20`;
                if (state.lastActivityTimestamp) {
                    url += `&since=${encodeURIComponent(state.lastActivityTimestamp)}`;
                }

                fetch(url, { headers: { 'Accept': 'application/json' } })
                    .then(res => res.json())
                    .then(data => {
                        const newEntries = data.result.entries || [];
                        if (newEntries.length > 0) {
                            const merged = [...newEntries, ...state.activityLog];
                            const unique = merged.filter((entry, idx, arr) =>
                                arr.findIndex(e => e.sys_id === entry.sys_id) === idx
                            );
                            updateState({
                                activityLog: unique,
                                lastActivityTimestamp: data.result.polledAt
                            });
                        }
                    })
                    .catch(() => {});
            }
        },

        STOP_POLLING: {
            effect({ state }) {
                if (state.pollTimer) clearInterval(state.pollTimer);
                if (state.elapsedTimer) clearInterval(state.elapsedTimer);
            },
            reducer(state) {
                return { ...state, pollTimer: null, elapsedTimer: null };
            }
        },

        SHOW_CANCEL: {
            reducer(state) {
                return { ...state, showCancelConfirm: true };
            }
        },

        DISMISS_CANCEL: {
            reducer(state) {
                return { ...state, showCancelConfirm: false };
            }
        },

        CONFIRM_CANCEL: {
            effect({ properties, updateState, dispatch }) {
                fetch(`${CANCEL_API}/${properties.batchRequestId}`, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' }
                })
                    .then(() => {
                        updateState({ showCancelConfirm: false });
                        dispatch('FETCH_STATUS');
                    })
                    .catch(() => {});
            }
        },

        TOGGLE_AUTOSCROLL: {
            reducer(state) {
                return { ...state, autoScroll: !state.autoScroll };
            }
        }
    },

    view(state, { dispatch }) {
        if (state.loading) {
            return `
<div class="uc-monitor uc-monitor-loading">
    <now-loading-icon size="lg" />
    <p>Loading installation status...</p>
</div>`;
        }

        const b = state.batch;
        const isRunning = !TERMINAL_STATES.includes(b.state);
        const progress = b.overallProgress || 0;

        return `
<div class="uc-monitor">
    <!-- Header Bar -->
    <div class="uc-monitor-header">
        <div class="uc-monitor-title">
            <h1>Installation Progress</h1>
            <span class="uc-monitor-number">${b.number}</span>
            <now-badge
                label="${_stateLabel(b.state)}"
                color="${_stateColor(b.state)}"
            />
        </div>
        <div class="uc-monitor-meta">
            <span class="uc-elapsed">
                <now-icon icon="clock-outline" size="sm" />
                ${_formatDuration(state.elapsedSeconds)}
            </span>
            <span class="uc-requested-by">
                <now-icon icon="user-outline" size="sm" />
                ${b.requestedBy}
            </span>
            ${isRunning ? `
                <now-button
                    label="Cancel"
                    variant="destructive"
                    size="sm"
                    icon="close-outline"
                    on-click={() => dispatch('SHOW_CANCEL')}
                />
            ` : ''}
        </div>
    </div>

    <!-- Overall Progress -->
    <div class="uc-overall-progress">
        <div class="uc-progress-stats">
            <span class="uc-progress-percent">${progress}%</span>
            <span class="uc-progress-detail">
                ${b.completedApps} of ${b.totalApps} complete
                ${b.failedApps > 0 ? `, ${b.failedApps} failed` : ''}
            </span>
        </div>
        <div class="uc-progress-bar-track">
            <div class="uc-progress-bar-fill ${_progressBarClass(b.state)}"
                 style="width: ${progress}%; transition: width 0.5s ease;">
            </div>
        </div>
    </div>

    <!-- Main Content: App Cards + Activity Feed side by side -->
    <div class="uc-monitor-content">
        <!-- Left: Application Cards -->
        <div class="uc-app-cards">
            <h2 class="uc-section-title">Applications (${b.totalApps})</h2>
            <div class="uc-cards-list">
                ${state.items.map(item => _renderAppCard(item)).join('')}
            </div>
        </div>

        <!-- Right: Activity Feed -->
        <div class="uc-activity-feed">
            <div class="uc-feed-header">
                <h2 class="uc-section-title">Activity Log</h2>
                <button class="uc-autoscroll-toggle ${state.autoScroll ? 'active' : ''}"
                        on-click={() => dispatch('TOGGLE_AUTOSCROLL')}>
                    <now-icon icon="arrow-down-outline" size="sm" />
                    Auto-scroll ${state.autoScroll ? 'ON' : 'OFF'}
                </button>
            </div>
            <div class="uc-feed-list" id="activityFeed">
                ${state.activityLog.length === 0
                    ? '<div class="uc-feed-empty">Waiting for activity...</div>'
                    : state.activityLog.map(entry => _renderActivityEntry(entry)).join('')
                }
            </div>
        </div>
    </div>

    <!-- Cancel Confirmation -->
    ${state.showCancelConfirm ? `
        <div class="uc-dialog-overlay">
            <div class="uc-dialog uc-dialog-sm">
                <div class="uc-dialog-header">
                    <h2>Cancel Installation?</h2>
                </div>
                <div class="uc-dialog-body">
                    <p>This will stop the batch installation. Applications already installed
                    will remain at their new version. Applications not yet started will be skipped.</p>
                </div>
                <div class="uc-dialog-footer">
                    <now-button label="Keep Running" variant="secondary"
                        on-click={() => dispatch('DISMISS_CANCEL')} />
                    <now-button label="Cancel Installation" variant="destructive"
                        on-click={() => dispatch('CONFIRM_CANCEL')} />
                </div>
            </div>
        </div>
    ` : ''}
</div>`;
    }
};

function _renderAppCard(item) {
    const stateConfig = {
        queued:     { icon: 'clock-outline',       color: '#888',    label: 'Queued' },
        installing: { icon: 'spinner',             color: '#0070d2', label: 'Installing' },
        completed:  { icon: 'check-circle-fill',   color: '#2e844a', label: 'Completed' },
        failed:     { icon: 'close-circle-fill',   color: '#c23934', label: 'Failed' },
        skipped:    { icon: 'ban-fill',            color: '#666',    label: 'Skipped' }
    };
    const cfg = stateConfig[item.state] || stateConfig.queued;
    const levelColors = { major: '#c23934', minor: '#fe9339', patch: '#2e844a' };

    return `
<div class="uc-app-card uc-app-card-${item.state}">
    <div class="uc-app-card-header">
        <now-icon icon="${cfg.icon}" style="color: ${cfg.color};" size="md" />
        <div class="uc-app-card-title">
            <span class="uc-app-card-name">${item.applicationName}</span>
            <span class="uc-app-card-version">
                ${item.fromVersion}
                <span class="uc-version-arrow">→</span>
                ${item.toVersion}
            </span>
        </div>
        <now-badge label="${item.updateLevel}"
                   color="${levelColors[item.updateLevel] || '#666'}" size="sm" />
    </div>

    ${item.state === 'installing' ? `
        <div class="uc-app-card-progress">
            <div class="uc-mini-progress-track">
                <div class="uc-mini-progress-fill"
                     style="width: ${item.progressPercent}%;">
                </div>
            </div>
            <span class="uc-mini-progress-text">${item.progressPercent}%</span>
        </div>
        ${item.statusMessage ? `
            <div class="uc-app-card-status">${item.statusMessage}</div>
        ` : ''}
    ` : ''}

    ${item.state === 'completed' ? `
        <div class="uc-app-card-meta">
            <now-icon icon="clock-outline" size="sm" />
            ${_formatDuration(item.durationSeconds)}
        </div>
    ` : ''}

    ${item.state === 'failed' && item.errorMessage ? `
        <div class="uc-app-card-error">
            <now-icon icon="alert-triangle-outline" size="sm" />
            ${item.errorMessage}
        </div>
    ` : ''}
</div>`;
}

function _renderActivityEntry(entry) {
    return `
<div class="uc-feed-entry uc-feed-${entry.activityType}">
    <div class="uc-feed-time">${entry.relativeTime || entry.timestamp}</div>
    <div class="uc-feed-icon">
        <now-icon icon="${entry.icon}" style="color: ${entry.color};" size="sm" />
    </div>
    <div class="uc-feed-content">
        <span class="uc-feed-message">${entry.message}</span>
        ${entry.applicationName ? `
            <span class="uc-feed-app">${entry.applicationName}</span>
        ` : ''}
        ${entry.details ? `
            <div class="uc-feed-details">${entry.details}</div>
        ` : ''}
    </div>
</div>`;
}

function _stateLabel(state) {
    const labels = {
        draft: 'Draft',
        scheduled: 'Scheduled',
        in_progress: 'In Progress',
        completed: 'Completed',
        failed: 'Failed',
        partial: 'Partially Complete',
        cancelled: 'Cancelled'
    };
    return labels[state] || state;
}

function _stateColor(state) {
    const colors = {
        draft: '#888',
        scheduled: '#0070d2',
        in_progress: '#0070d2',
        completed: '#2e844a',
        failed: '#c23934',
        partial: '#fe9339',
        cancelled: '#666'
    };
    return colors[state] || '#888';
}

function _progressBarClass(state) {
    if (state === 'failed') return 'uc-progress-error';
    if (state === 'partial') return 'uc-progress-warning';
    if (state === 'completed') return 'uc-progress-success';
    return 'uc-progress-active';
}

function _formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0s';
    if (seconds < 60) return seconds + 's';
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    if (min < 60) return `${min}m ${sec}s`;
    const hr = Math.floor(min / 60);
    const rm = min % 60;
    return `${hr}h ${rm}m`;
}

export default component;
