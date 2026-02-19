/**
 * Activity Feed - Standalone activity log component.
 *
 * A reusable component that displays a scrolling feed of activity log entries
 * with color-coded icons, timestamps, and auto-scroll behavior. Can be embedded
 * within other macroponents or used standalone.
 *
 * ════════════════════════════════════════════════════════════════════
 * UI Builder Macroponent Configuration:
 *
 *   Name:         SNOW Activity Feed
 *   API Name:     x_snc_update_center.activity-feed
 *   Category:     Custom Components
 * ════════════════════════════════════════════════════════════════════
 *
 * @component
 * @properties
 *   batchRequestId {string}  - sys_id of batch request
 *   pollInterval   {number}  - Polling interval in ms (default 5000)
 *   maxEntries     {number}  - Max entries to display (default 200)
 *   autoScroll     {boolean} - Auto-scroll to newest (default true)
 *   compact        {boolean} - Compact display mode (default false)
 */

const ACTIVITY_API = '/api/x_snc_update_center/v1/activity-feed';

const component = {
    properties: {
        batchRequestId: { default: '' },
        pollInterval: { default: 5000 },
        maxEntries: { default: 200 },
        autoScroll: { default: true },
        compact: { default: false }
    },

    state: {
        entries: [],
        lastTimestamp: null,
        isPolling: false,
        pollTimer: null,
        userScrolledUp: false,
        filterType: 'all'
    },

    actions: {
        COMPONENT_CONNECTED: {
            effect({ dispatch, properties }) {
                dispatch('FETCH_ENTRIES');
                if (properties.pollInterval > 0) {
                    const timer = setInterval(
                        () => dispatch('POLL_NEW'),
                        properties.pollInterval
                    );
                    dispatch('SET_TIMER', { timer });
                }
            }
        },

        COMPONENT_DISCONNECTED: {
            effect({ state }) {
                if (state.pollTimer) clearInterval(state.pollTimer);
            }
        },

        SET_TIMER: {
            reducer(state, { payload }) {
                return { ...state, pollTimer: payload.timer };
            }
        },

        FETCH_ENTRIES: {
            effect({ properties, updateState }) {
                const url = `${ACTIVITY_API}/${properties.batchRequestId}?limit=${properties.maxEntries}`;
                fetch(url, { headers: { 'Accept': 'application/json' } })
                    .then(res => res.json())
                    .then(data => {
                        const entries = data.result.entries || [];
                        updateState({
                            entries,
                            lastTimestamp: data.result.polledAt,
                            isPolling: true
                        });
                    })
                    .catch(() => {});
            }
        },

        POLL_NEW: {
            effect({ properties, state, updateState }) {
                if (!state.lastTimestamp) return;

                const url = `${ACTIVITY_API}/${properties.batchRequestId}` +
                    `?limit=20&since=${encodeURIComponent(state.lastTimestamp)}`;

                fetch(url, { headers: { 'Accept': 'application/json' } })
                    .then(res => res.json())
                    .then(data => {
                        const newEntries = data.result.entries || [];
                        if (newEntries.length > 0) {
                            let merged = [...newEntries, ...state.entries];
                            const seen = new Set();
                            merged = merged.filter(e => {
                                if (seen.has(e.sys_id)) return false;
                                seen.add(e.sys_id);
                                return true;
                            });
                            if (merged.length > properties.maxEntries) {
                                merged = merged.slice(0, properties.maxEntries);
                            }
                            updateState({
                                entries: merged,
                                lastTimestamp: data.result.polledAt
                            });
                        }
                    })
                    .catch(() => {});
            }
        },

        SET_FILTER: {
            reducer(state, { payload }) {
                return { ...state, filterType: payload.type };
            }
        },

        USER_SCROLL: {
            reducer(state, { payload }) {
                return { ...state, userScrolledUp: payload.scrolledUp };
            }
        }
    },

    view(state, { dispatch, properties }) {
        const filteredEntries = state.filterType === 'all'
            ? state.entries
            : state.entries.filter(e => e.activityType === state.filterType);

        const filterButtons = [
            { type: 'all', label: 'All' },
            { type: 'error', label: 'Errors' },
            { type: 'warning', label: 'Warnings' },
            { type: 'success', label: 'Success' },
            { type: 'info', label: 'Info' }
        ];

        return `
<div class="uc-activity-standalone ${properties.compact ? 'uc-compact' : ''}">
    <div class="uc-feed-toolbar">
        <div class="uc-feed-filters">
            ${filterButtons.map(f => `
                <button class="uc-feed-filter-btn ${state.filterType === f.type ? 'active' : ''}"
                        on-click={() => dispatch('SET_FILTER', { type: '${f.type}' })}>
                    ${f.label}
                    ${f.type !== 'all' ? `
                        <span class="uc-filter-count">
                            ${state.entries.filter(e => e.activityType === f.type).length}
                        </span>
                    ` : ''}
                </button>
            `).join('')}
        </div>
        <span class="uc-feed-count">${filteredEntries.length} entries</span>
    </div>

    <div class="uc-feed-scroll"
         on-scroll={(e) => {
             const el = e.target;
             const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
             dispatch('USER_SCROLL', { scrolledUp: !isAtBottom });
         }}>
        ${filteredEntries.length === 0
            ? `<div class="uc-feed-empty-state">
                   <now-icon icon="document-outline" size="lg" />
                   <p>No activity entries yet</p>
               </div>`
            : filteredEntries.map(entry => _renderEntry(entry, properties.compact)).join('')
        }
    </div>

    ${state.userScrolledUp && properties.autoScroll ? `
        <button class="uc-scroll-to-bottom"
                on-click={() => {
                    dispatch('USER_SCROLL', { scrolledUp: false });
                    document.querySelector('.uc-feed-scroll').scrollTop = 999999;
                }}>
            <now-icon icon="arrow-down-outline" size="sm" />
            New activity below
        </button>
    ` : ''}
</div>`;
    }
};

function _renderEntry(entry, compact) {
    const typeStyles = {
        info:     { icon: 'info-circle-outline',    bg: '#e8f4fd', border: '#0070d2' },
        success:  { icon: 'check-circle-fill',      bg: '#e8f8e8', border: '#2e844a' },
        warning:  { icon: 'alert-triangle-fill',    bg: '#fff8e6', border: '#fe9339' },
        error:    { icon: 'close-circle-fill',       bg: '#fde8e8', border: '#c23934' },
        progress: { icon: 'spinner',                bg: '#e8f4fd', border: '#0070d2' },
        start:    { icon: 'play-fill',              bg: '#e8f4fd', border: '#0070d2' },
        complete: { icon: 'check-decagram-outline', bg: '#e8f8e8', border: '#2e844a' },
        milestone:{ icon: 'flag-fill',              bg: '#f3e8ff', border: '#8b5cf6' }
    };

    const style = typeStyles[entry.activityType] || typeStyles.info;

    if (compact) {
        return `
<div class="uc-entry uc-entry-compact"
     style="border-left: 3px solid ${style.border};">
    <now-icon icon="${style.icon}" style="color: ${style.border};" size="sm" />
    <span class="uc-entry-time">${entry.relativeTime}</span>
    <span class="uc-entry-msg">${entry.message}</span>
</div>`;
    }

    return `
<div class="uc-entry" style="background: ${style.bg}; border-left: 4px solid ${style.border};">
    <div class="uc-entry-header">
        <now-icon icon="${style.icon}" style="color: ${style.border};" size="md" />
        <span class="uc-entry-timestamp">${entry.timestamp}</span>
        <span class="uc-entry-relative">${entry.relativeTime}</span>
        ${entry.phase ? `<now-badge label="${entry.phase}" size="sm" />` : ''}
    </div>
    <div class="uc-entry-body">
        <p class="uc-entry-message">${entry.message}</p>
        ${entry.applicationName ? `
            <span class="uc-entry-app">
                <now-icon icon="application-outline" size="sm" />
                ${entry.applicationName}
            </span>
        ` : ''}
    </div>
    ${entry.details ? `
        <div class="uc-entry-details">${entry.details}</div>
    ` : ''}
    ${entry.progressPercent > 0 ? `
        <div class="uc-entry-progress">
            <div class="uc-entry-progress-track">
                <div class="uc-entry-progress-fill"
                     style="width: ${entry.progressPercent}%;
                            background: ${style.border};">
                </div>
            </div>
            <span>${entry.progressPercent}%</span>
        </div>
    ` : ''}
</div>`;
}

export default component;
