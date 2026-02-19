/**
 * Update Card - Individual update display card for use in lists and grids.
 *
 * A compact, visually rich card that shows a single Store app update with
 * version info, risk level, and quick actions.
 *
 * ════════════════════════════════════════════════════════════════════
 * UI Builder Macroponent Configuration:
 *
 *   Name:         SNOW Update Card
 *   API Name:     x_snc_update_center.update-card
 *   Category:     Custom Components
 * ════════════════════════════════════════════════════════════════════
 *
 * @component
 * @properties
 *   update       {object}   - Update data object from the API
 *   selected     {boolean}  - Whether this card is selected
 *   showActions  {boolean}  - Show action buttons (default true)
 *
 * @dispatches
 *   UPDATE_CARD#TOGGLE_SELECT - Toggle selection of this card
 *   UPDATE_CARD#VIEW_IN_STORE - Open app in ServiceNow Store
 */

const component = {
    properties: {
        update: { default: {} },
        selected: { default: false },
        showActions: { default: true }
    },

    actions: {
        TOGGLE_SELECT: {
            effect({ dispatch, properties }) {
                dispatch('UPDATE_CARD#TOGGLE_SELECT', {
                    id: properties.update.availableVersionSysId,
                    selected: !properties.selected
                });
            }
        },

        VIEW_IN_STORE: {
            effect({ properties }) {
                const appId = properties.update.sys_id;
                window.open(
                    `/nav_to.do?uri=sys_store_app.do?sys_id=${appId}`,
                    '_blank'
                );
            }
        }
    },

    view(state, { dispatch, properties }) {
        const u = properties.update;
        if (!u || !u.name) return '';

        const levelConfig = {
            major: {
                color: '#c23934', bg: '#fde8e8',
                icon: 'alert-triangle-fill', label: 'Major Update'
            },
            minor: {
                color: '#fe9339', bg: '#fff8e6',
                icon: 'plus-circle-outline', label: 'Minor Update'
            },
            patch: {
                color: '#2e844a', bg: '#e8f8e8',
                icon: 'check-circle-outline', label: 'Patch'
            }
        };

        const riskConfig = {
            low:      { color: '#2e844a', icon: 'shield-outline' },
            medium:   { color: '#f0c355', icon: 'shield-outline' },
            high:     { color: '#fe9339', icon: 'alert-circle-outline' },
            critical: { color: '#c23934', icon: 'alert-triangle-fill' }
        };

        const lc = levelConfig[u.updateLevel] || levelConfig.patch;
        const rc = riskConfig[u.riskLevel] || riskConfig.low;

        return `
<div class="uc-update-card ${properties.selected ? 'uc-card-selected' : ''}"
     style="border-left: 4px solid ${lc.color};">

    <div class="uc-ucard-header">
        ${properties.showActions ? `
            <now-checkbox
                checked={${properties.selected}}
                on-change={() => dispatch('TOGGLE_SELECT')}
            />
        ` : ''}
        <div class="uc-ucard-title">
            <span class="uc-ucard-name">${u.name}</span>
            <span class="uc-ucard-scope">${u.scope || ''}</span>
        </div>
        <now-badge label="${lc.label}" color="${lc.color}" size="sm" />
    </div>

    <div class="uc-ucard-versions">
        <div class="uc-ucard-ver-from">
            <span class="uc-ver-label">Installed</span>
            <span class="uc-ver-value">${u.installedVersion}</span>
        </div>
        <div class="uc-ucard-arrow">
            <now-icon icon="arrow-right-fill" size="sm"
                      style="color: ${lc.color};" />
        </div>
        <div class="uc-ucard-ver-to">
            <span class="uc-ver-label">Available</span>
            <span class="uc-ver-value uc-ver-highlight"
                  style="color: ${lc.color};">${u.availableVersion}</span>
        </div>
    </div>

    <div class="uc-ucard-footer">
        <div class="uc-ucard-meta">
            <span class="uc-ucard-risk" style="color: ${rc.color};">
                <now-icon icon="${rc.icon}" size="sm" />
                ${u.riskLevel} risk
            </span>
            <span class="uc-ucard-vendor">
                <now-icon icon="building-outline" size="sm" />
                ${u.vendor || 'Unknown'}
            </span>
            ${u.publishDate ? `
                <span class="uc-ucard-date">
                    <now-icon icon="calendar-outline" size="sm" />
                    ${u.publishDate}
                </span>
            ` : ''}
        </div>
        ${properties.showActions ? `
            <now-button
                label="View in Store"
                variant="tertiary"
                size="sm"
                icon="open-outline"
                on-click={() => dispatch('VIEW_IN_STORE')}
            />
        ` : ''}
    </div>
</div>`;
    }
};

export default component;
