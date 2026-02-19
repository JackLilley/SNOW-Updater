/**
 * Update List - Filterable list of available Store updates with batch selection.
 *
 * Displays all available updates in a rich data table with:
 *  - Filter tabs for Major/Minor/Patch
 *  - Risk level indicators
 *  - Multi-select with "Install Selected" action
 *  - Dependency warnings
 *  - Version comparison display (from → to)
 *
 * ════════════════════════════════════════════════════════════════════
 * UI Builder Macroponent Configuration:
 *
 *   Name:         SNOW Update List
 *   API Name:     x_snc_update_center.update-list
 *   Category:     Custom Components
 * ════════════════════════════════════════════════════════════════════
 *
 * @component
 * @properties
 *   initialFilter {string} - Optional: 'major', 'minor', or 'patch'
 *
 * @dispatches
 *   UPDATE_CENTER#START_INSTALL - Begin batch installation with selected apps
 */

const UPDATES_API = '/api/x_snc_update_center/v1/available-updates';
const DEPS_API = '/api/x_snc_update_center/v1/analyze-dependencies';

const component = {
    properties: {
        initialFilter: { default: '' }
    },

    state: {
        loading: true,
        updates: [],
        filteredUpdates: [],
        activeFilter: 'all',
        selectedIds: new Set(),
        selectAll: false,
        searchText: '',
        sortField: 'name',
        sortDirection: 'asc',
        showConfirmDialog: false,
        dependencyAnalysis: null,
        analyzingDeps: false,
        error: null
    },

    actions: {
        COMPONENT_CONNECTED: {
            effect({ dispatch, properties }) {
                if (properties.initialFilter) {
                    dispatch('SET_FILTER', { filter: properties.initialFilter });
                }
                dispatch('FETCH_UPDATES');
            }
        },

        FETCH_UPDATES: {
            effect({ updateState }) {
                updateState({ loading: true });
                fetch(UPDATES_API, { headers: { 'Accept': 'application/json' } })
                    .then(res => res.json())
                    .then(data => {
                        const updates = data.result.updates || [];
                        updateState({
                            loading: false,
                            updates: updates,
                            filteredUpdates: updates
                        });
                    })
                    .catch(err => {
                        updateState({ loading: false, error: err.message });
                    });
            }
        },

        SET_FILTER: {
            reducer(state, { payload }) {
                const filter = payload.filter;
                const filtered = filter === 'all'
                    ? state.updates
                    : state.updates.filter(u => u.updateLevel === filter);
                return {
                    ...state,
                    activeFilter: filter,
                    filteredUpdates: _applySearch(filtered, state.searchText),
                    selectedIds: new Set(),
                    selectAll: false
                };
            }
        },

        SET_SEARCH: {
            reducer(state, { payload }) {
                const text = payload.text;
                const baseList = state.activeFilter === 'all'
                    ? state.updates
                    : state.updates.filter(u => u.updateLevel === state.activeFilter);
                return {
                    ...state,
                    searchText: text,
                    filteredUpdates: _applySearch(baseList, text)
                };
            }
        },

        TOGGLE_SELECT: {
            reducer(state, { payload }) {
                const newSelected = new Set(state.selectedIds);
                if (newSelected.has(payload.id)) {
                    newSelected.delete(payload.id);
                } else {
                    newSelected.add(payload.id);
                }
                return {
                    ...state,
                    selectedIds: newSelected,
                    selectAll: newSelected.size === state.filteredUpdates.length
                };
            }
        },

        TOGGLE_SELECT_ALL: {
            reducer(state) {
                if (state.selectAll) {
                    return { ...state, selectedIds: new Set(), selectAll: false };
                }
                const allIds = new Set(state.filteredUpdates.map(u => u.availableVersionSysId));
                return { ...state, selectedIds: allIds, selectAll: true };
            }
        },

        SORT: {
            reducer(state, { payload }) {
                const dir = state.sortField === payload.field && state.sortDirection === 'asc'
                    ? 'desc' : 'asc';
                const sorted = [...state.filteredUpdates].sort((a, b) => {
                    const aVal = a[payload.field] || '';
                    const bVal = b[payload.field] || '';
                    return dir === 'asc'
                        ? aVal.localeCompare(bVal)
                        : bVal.localeCompare(aVal);
                });
                return {
                    ...state,
                    sortField: payload.field,
                    sortDirection: dir,
                    filteredUpdates: sorted
                };
            }
        },

        SHOW_INSTALL_CONFIRM: {
            effect({ state, updateState }) {
                if (state.selectedIds.size === 0) return;
                updateState({ showConfirmDialog: true, analyzingDeps: true });

                const appSysIds = state.updates
                    .filter(u => state.selectedIds.has(u.availableVersionSysId))
                    .map(u => u.sys_id);

                fetch(DEPS_API, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ appSysIds })
                })
                    .then(res => res.json())
                    .then(data => {
                        updateState({
                            analyzingDeps: false,
                            dependencyAnalysis: data.result
                        });
                    })
                    .catch(() => {
                        updateState({ analyzingDeps: false });
                    });
            }
        },

        CANCEL_INSTALL: {
            reducer(state) {
                return {
                    ...state,
                    showConfirmDialog: false,
                    dependencyAnalysis: null
                };
            }
        },

        CONFIRM_INSTALL: {
            effect({ state, dispatch }) {
                const versionIds = Array.from(state.selectedIds).join(',');
                dispatch('UPDATE_CENTER#START_INSTALL', {
                    appVersionSysIds: versionIds,
                    count: state.selectedIds.size
                });
            }
        }
    },

    view(state, { dispatch }) {
        const filterTabs = [
            { id: 'all', label: 'All Updates', count: state.updates.length },
            { id: 'major', label: 'Major', count: state.updates.filter(u => u.updateLevel === 'major').length },
            { id: 'minor', label: 'Minor', count: state.updates.filter(u => u.updateLevel === 'minor').length },
            { id: 'patch', label: 'Patches', count: state.updates.filter(u => u.updateLevel === 'patch').length }
        ];

        return `
<div class="uc-update-list">
    <!-- Toolbar -->
    <div class="uc-list-toolbar">
        <div class="uc-filter-tabs">
            ${filterTabs.map(tab => `
                <button class="uc-tab ${state.activeFilter === tab.id ? 'uc-tab-active' : ''}"
                        on-click={() => dispatch('SET_FILTER', { filter: '${tab.id}' })}>
                    ${tab.label}
                    <span class="uc-tab-count">${tab.count}</span>
                </button>
            `).join('')}
        </div>

        <div class="uc-list-actions">
            <now-input
                placeholder="Search applications..."
                size="md"
                value="${state.searchText}"
                on-input={(e) => dispatch('SET_SEARCH', { text: e.target.value })}
            />
            <now-button
                label="Install Selected (${state.selectedIds.size})"
                variant="primary"
                size="md"
                icon="download-outline"
                disabled={state.selectedIds.size === 0}
                on-click={() => dispatch('SHOW_INSTALL_CONFIRM')}
            />
        </div>
    </div>

    <!-- Data Table -->
    <div class="uc-table-container">
        <table class="uc-table">
            <thead>
                <tr>
                    <th class="uc-th-check">
                        <now-checkbox
                            checked={state.selectAll}
                            on-change={() => dispatch('TOGGLE_SELECT_ALL')}
                        />
                    </th>
                    <th class="uc-th-sortable"
                        on-click={() => dispatch('SORT', { field: 'name' })}>
                        Application ${_sortIndicator(state, 'name')}
                    </th>
                    <th>Installed</th>
                    <th>Available</th>
                    <th class="uc-th-sortable"
                        on-click={() => dispatch('SORT', { field: 'updateLevel' })}>
                        Level ${_sortIndicator(state, 'updateLevel')}
                    </th>
                    <th class="uc-th-sortable"
                        on-click={() => dispatch('SORT', { field: 'riskLevel' })}>
                        Risk ${_sortIndicator(state, 'riskLevel')}
                    </th>
                    <th>Vendor</th>
                </tr>
            </thead>
            <tbody>
                ${state.loading
                    ? '<tr><td colspan="7" class="uc-loading"><now-loading-icon size="lg" /></td></tr>'
                    : state.filteredUpdates.length === 0
                        ? '<tr><td colspan="7" class="uc-empty">No updates available</td></tr>'
                        : state.filteredUpdates.map(u => _renderRow(u, state, dispatch)).join('')
                }
            </tbody>
        </table>
    </div>

    <!-- Confirmation Dialog -->
    ${state.showConfirmDialog ? _renderConfirmDialog(state, dispatch) : ''}
</div>`;
    }
};

function _applySearch(updates, searchText) {
    if (!searchText) return updates;
    const lower = searchText.toLowerCase();
    return updates.filter(u =>
        (u.name || '').toLowerCase().includes(lower) ||
        (u.scope || '').toLowerCase().includes(lower) ||
        (u.vendor || '').toLowerCase().includes(lower)
    );
}

function _sortIndicator(state, field) {
    if (state.sortField !== field) return '';
    return state.sortDirection === 'asc' ? ' ↑' : ' ↓';
}

function _renderRow(update, state, dispatch) {
    const isSelected = state.selectedIds.has(update.availableVersionSysId);
    const levelColors = { major: '#c23934', minor: '#fe9339', patch: '#2e844a' };
    const riskColors = { low: '#2e844a', medium: '#f0c355', high: '#fe9339', critical: '#c23934' };

    return `
<tr class="uc-row ${isSelected ? 'uc-row-selected' : ''}">
    <td>
        <now-checkbox
            checked={${isSelected}}
            on-change={() => dispatch('TOGGLE_SELECT', { id: '${update.availableVersionSysId}' })}
        />
    </td>
    <td>
        <div class="uc-app-name">${update.name}</div>
        <div class="uc-app-scope">${update.scope || ''}</div>
    </td>
    <td class="uc-version uc-version-from">${update.installedVersion}</td>
    <td class="uc-version uc-version-to">
        <span class="uc-version-arrow">→</span> ${update.availableVersion}
    </td>
    <td>
        <now-badge
            label="${update.updateLevel}"
            color="${levelColors[update.updateLevel] || '#666'}"
        />
    </td>
    <td>
        <now-badge
            label="${update.riskLevel}"
            color="${riskColors[update.riskLevel] || '#666'}"
        />
    </td>
    <td class="uc-vendor">${update.vendor || '-'}</td>
</tr>`;
}

function _renderConfirmDialog(state, dispatch) {
    const selectedUpdates = state.updates.filter(
        u => state.selectedIds.has(u.availableVersionSysId)
    );
    const analysis = state.dependencyAnalysis;

    return `
<div class="uc-dialog-overlay">
    <div class="uc-dialog">
        <div class="uc-dialog-header">
            <h2>Confirm Installation</h2>
            <now-button
                label=""
                variant="tertiary"
                icon="close-outline"
                size="sm"
                on-click={() => dispatch('CANCEL_INSTALL')}
            />
        </div>

        <div class="uc-dialog-body">
            <p class="uc-dialog-summary">
                <strong>${selectedUpdates.length}</strong> application(s) will be updated:
            </p>

            <div class="uc-confirm-list">
                ${selectedUpdates.map(u => `
                    <div class="uc-confirm-item">
                        <now-icon icon="application-outline" />
                        <span class="uc-confirm-name">${u.name}</span>
                        <span class="uc-confirm-version">
                            ${u.installedVersion} → ${u.availableVersion}
                        </span>
                        <now-badge label="${u.updateLevel}" size="sm" />
                    </div>
                `).join('')}
            </div>

            ${state.analyzingDeps ? `
                <div class="uc-deps-loading">
                    <now-loading-icon size="md" />
                    <span>Analyzing dependencies...</span>
                </div>
            ` : ''}

            ${analysis && analysis.warnings && analysis.warnings.length > 0 ? `
                <div class="uc-deps-warnings">
                    <h3>Dependency Warnings</h3>
                    ${analysis.warnings.map(w => `
                        <div class="uc-warning-item">
                            <now-icon icon="alert-triangle-outline" />
                            <span>${w}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            ${analysis && analysis.conflicts && analysis.conflicts.length > 0 ? `
                <div class="uc-deps-conflicts">
                    <h3>Conflicts Detected</h3>
                    ${analysis.conflicts.map(c => `
                        <div class="uc-conflict-item">
                            <now-icon icon="close-circle-outline" />
                            <span>${c}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        </div>

        <div class="uc-dialog-footer">
            <now-button
                label="Cancel"
                variant="secondary"
                on-click={() => dispatch('CANCEL_INSTALL')}
            />
            <now-button
                label="Install ${selectedUpdates.length} Update(s)"
                variant="primary-positive"
                icon="download-outline"
                on-click={() => dispatch('CONFIRM_INSTALL')}
            />
        </div>
    </div>
</div>`;
}

export default component;
