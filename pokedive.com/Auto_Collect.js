// ==UserScript==
// @name         PokeDive - Auto Collect
// @namespace    http://tampermonkey.net/
// @version      1.2.2
// @description  Automatically collects resources on pokedive.com: on return from expedition, before departure, and when resources are maxed or unchanged for 5s
// @author       Cline
// @match        *://pokedive.com/*
// @match        *://www.pokedive.com/*
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/personal/main/pokedive.com/Auto_Collect.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/personal/main/meta/Auto_Collect.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_NAME = 'PokeDive Auto Collect';
    const INIT_KEY = '__pokedive_auto_collect_initialized';

    // Guard against double initialization (userscript manager re-injection)
    if (window[INIT_KEY]) return;
    window[INIT_KEY] = true;

    const CONFIG = {
        storageKey: 'pokedive_autocollect_settings',
        defaults: {
            enabled: true,
            debug: false,
            // triggers
            collectOnReturn: true,      // collect when coming back from an expedition
            collectOnDeparture: true,   // collect just before leaving on an expedition
            collectWhenStable: true,    // collect when resources stop changing
            stableSeconds: 10,           // seconds of no change before collecting
            pollInterval: 1000,         // ms between resource-value checks
        },
        selectors: {
            hud: '#hud',
            gather: '#gather',
            gatherButton: '#gather button[data-act="collect-all"]',
            resources: '#res button.r .rn',
        },
    };

    let settings = { ...CONFIG.defaults };
    let hudObserver = null;
    let pollTimer = null;
    let lastUrl = null;
    let urlWatcher = null;

    // State
    let isCollecting = false;
    let lastCollectTime = 0;
    const COLLECT_COOLDOWN_MS = 8000; // avoid duplicate collects from overlapping triggers

    let inTown = null;        // null = unknown until first HUD read
    let seenExpedition = false; // have we left town at least once?

    let lastResourceValues = null;
    let resourceStableSince = null; // timestamp when values became stable

    const log = (...args) => {
        if (settings.debug) {
            console.log('[' + SCRIPT_NAME + ']', ...args);
        }
    };

    /* ---------- settings persistence ---------- */

    function validateSettings(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var s = {};
        s.enabled = typeof raw.enabled === 'boolean' ? raw.enabled : CONFIG.defaults.enabled;
        s.debug = typeof raw.debug === 'boolean' ? raw.debug : CONFIG.defaults.debug;
        s.collectOnReturn = typeof raw.collectOnReturn === 'boolean' ? raw.collectOnReturn : CONFIG.defaults.collectOnReturn;
        s.collectOnDeparture = typeof raw.collectOnDeparture === 'boolean' ? raw.collectOnDeparture : CONFIG.defaults.collectOnDeparture;
        s.collectWhenStable = typeof raw.collectWhenStable === 'boolean' ? raw.collectWhenStable : CONFIG.defaults.collectWhenStable;
        s.stableSeconds = typeof raw.stableSeconds === 'number' && raw.stableSeconds > 0 ? raw.stableSeconds : CONFIG.defaults.stableSeconds;
        s.pollInterval = typeof raw.pollInterval === 'number' && raw.pollInterval > 0 ? raw.pollInterval : CONFIG.defaults.pollInterval;
        return s;
    }

    function loadSettings() {
        try {
            var raw = localStorage.getItem(CONFIG.storageKey);
            if (raw) {
                var parsed = JSON.parse(raw);
                var validated = validateSettings(parsed);
                if (validated) {
                    settings = Object.assign({}, CONFIG.defaults, validated);
                } else {
                    log('Invalid stored settings, using defaults');
                }
            }
        } catch (e) {
            log('Failed to load settings:', e);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(settings));
        } catch (e) {
            log('Failed to save settings:', e);
        }
    }

    /* ---------- helpers ---------- */

    function now() { return Date.now(); }

    function qs(sel) {
        try { return document.querySelector(sel); } catch (e) { return null; }
    }
    function qsa(sel) {
        try { return document.querySelectorAll(sel); } catch (e) { return []; }
    }

    function isVisible(el) {
        return el && el.offsetParent !== null && !el.hidden;
    }

    function parseNum(text) {
        var n = parseInt((text || '').replace(/[^0-9-]/g, ''), 10);
        return isNaN(n) ? null : n;
    }

    /* ---------- resource reading ---------- */

    function getResourceValues() {
        var out = {};
        qsa(CONFIG.selectors.resources).forEach(function(span) {
            var btn = span.closest ? span.closest('button') : null;
            var id = btn ? btn.getAttribute('data-id') : null;
            if (!id) return;
            var v = parseNum(span.textContent);
            if (v !== null) out[id] = v;
        });
        return out;
    }

    function getGatherButton() {
        return qs(CONFIG.selectors.gatherButton);
    }

    function gatherHasAmounts() {
        var gather = qs(CONFIG.selectors.gather);
        if (!gather) return false;
        var btn = getGatherButton();
        if (!btn || btn.disabled) return false;
        var amounts = gather.querySelectorAll('span.rn');
        var hasPositive = false;
        amounts.forEach(function(a) {
            var v = parseNum(a.textContent);
            if (v && v > 0) hasPositive = true;
        });
        return isVisible(gather) && isVisible(btn) && (hasPositive || amounts.length > 0);
    }

    /* ---------- collection ---------- */

    function collect(reason) {
        if (!settings.enabled) return;
        if (isCollecting) return;
        if (now() - lastCollectTime < COLLECT_COOLDOWN_MS) {
            log('Collect skipped (cooldown):', reason);
            return;
        }
        var btn = getGatherButton();
        if (!btn) {
            log('No gather button available:', reason);
            return;
        }
        if (!gatherHasAmounts()) {
            log('Nothing to collect:', reason);
            return;
        }
        isCollecting = true;
        lastCollectTime = now();
        try {
            btn.dataset.pdCollected = 'true';
            btn.click();
            log('Collected (' + reason + '):', btn.textContent.trim());
        } catch (e) {
            log('Error clicking gather:', e);
        } finally {
            isCollecting = false;
        }
    }

    /* ---------- expedition mode detection ---------- */

    function getHudMode() {
        var hud = qs(CONFIG.selectors.hud);
        return hud ? hud.getAttribute('data-mode') : null;
    }

    function onModeChanged(prevMode, newMode) {
        log('Hud mode changed:', prevMode, '->', newMode);
        var prevTown = prevMode === 'town';
        var newTown = newMode === 'town';

        if (!prevTown && newTown) {
            // returned from expedition to town
            seenExpedition = true;
            if (settings.collectOnReturn) {
                // small delay to let the town HUD settle
                setTimeout(function() { collect('return from expedition'); }, 800);
            }
        }
        if (prevTown && !newTown) {
            // leaving town for an expedition
            seenExpedition = true;
            if (settings.collectOnDeparture) {
                collect('departure to expedition');
            }
        }
        inTown = newTown;
    }

    /* ---------- resource stability monitor ---------- */

    function checkResources() {
        if (!settings.enabled || !settings.collectWhenStable) {
            resourceStableSince = null;
            lastResourceValues = null;
            return;
        }
        var cur = getResourceValues();
        if (lastResourceValues === null) {
            lastResourceValues = cur;
            resourceStableSince = null;
            return;
        }
        var changed = false;
        var keys = Object.keys(cur);
        if (keys.length === 0) {
            lastResourceValues = cur;
            return;
        }
        keys.forEach(function(k) {
            if (cur[k] !== lastResourceValues[k]) changed = true;
        });
        Object.keys(lastResourceValues).forEach(function(k) {
            if (cur[k] === undefined) changed = true;
        });

        if (changed) {
            lastResourceValues = cur;
            resourceStableSince = null;
            return;
        }

        // values are stable
        if (resourceStableSince === null) resourceStableSince = now();
        var stableFor = now() - resourceStableSince;
        if (stableFor >= settings.stableSeconds * 1000) {
            collect('resources stable for ' + stableFor + 'ms');
            // reset so we wait for the next change/stable cycle
            resourceStableSince = null;
            lastResourceValues = null;
        }
    }

    function startPoll() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(checkResources, settings.pollInterval);
    }
    function stopPoll() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    /* ---------- observers ---------- */

    function observeHud() {
        var hud = qs(CONFIG.selectors.hud);
        if (!hud) return;
        if (hudObserver) {
            hudObserver.disconnect();
            hudObserver = null;
        }
        hudObserver = new MutationObserver(function(mutations) {
            if (!settings.enabled) return;
            mutations.forEach(function(m) {
                if (m.type === 'attributes' && m.attributeName === 'data-mode') {
                    var prev = m.oldValue;
                    var cur = m.target.getAttribute('data-mode');
                    if (prev !== cur) onModeChanged(prev, cur);
                }
                if (m.type === 'childList') {
                    m.addedNodes.forEach(function(node) {
                        if (node.nodeType !== 1) return;
                        var gather = node.id === 'gather' ? node : (node.querySelector ? node.querySelector('#gather') : null);
                        if (gather && isTown() && settings.collectOnReturn && seenExpedition) {
                            setTimeout(function() { collect('gather panel appeared'); }, 800);
                        }
                    });
                }
            });
        });
        hudObserver.observe(hud, { attributes: true, attributeOldValue: true, childList: true, subtree: true });

        // initialize town state
        var mode = hud.getAttribute('data-mode');
        inTown = mode === 'town';
        seenExpedition = inTown ? false : seenExpedition;
    }

    /* ---------- url watcher (SPA navigation without full reload) ---------- */

    function startUrlWatcher() {
        lastUrl = location.href;
        urlWatcher = setInterval(function() {
            if (location.href !== lastUrl) {
                log('URL change detected, reinitializing');
                stopPoll();
                stopUrlWatcher();
                if (hudObserver) { hudObserver.disconnect(); hudObserver = null; }
                lastUrl = location.href;
                setTimeout(function() {
                    inTown = null;
                    seenExpedition = false;
                    lastResourceValues = null;
                    resourceStableSince = null;
                    observeHud();
                    startPoll();
                    startUrlWatcher();
                }, 300);
            }
        }, 1000);
    }
    function stopUrlWatcher() {
        if (urlWatcher) { clearInterval(urlWatcher); urlWatcher = null; }
    }

    /* ---------- injected UI ---------- */

    function removeToggle() {
        var el = document.getElementById('pokedive-ac-toggle');
        if (el) el.remove();
    }

    function injectToggleButton() {
        removeToggle();
        var btn = document.createElement('button');
        btn.id = 'pokedive-ac-toggle';
        btn.type = 'button';
        btn.textContent = settings.enabled ? 'AC: ON' : 'AC: OFF';
        btn.setAttribute('aria-label', 'Auto Collect ' + (settings.enabled ? 'enabled' : 'disabled'));
        btn.style.cssText =
            'position: fixed; top: 10px; left: 10px; z-index: 100000; ' +
            'background: ' + (settings.enabled ? '#00d2ff' : '#666') + '; ' +
            'color: ' + (settings.enabled ? '#000' : '#fff') + '; ' +
            'border: none; border-radius: 4px; padding: 6px 10px; ' +
            'font-size: 12px; font-weight: bold; cursor: pointer; ' +
            'box-shadow: 0 2px 6px rgba(0,0,0,0.4);';
        btn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            settings.enabled = !settings.enabled;
            btn.textContent = settings.enabled ? 'AC: ON' : 'AC: OFF';
            btn.setAttribute('aria-label', 'Auto Collect ' + (settings.enabled ? 'enabled' : 'disabled'));
            btn.style.background = settings.enabled ? '#00d2ff' : '#666';
            btn.style.color = settings.enabled ? '#000' : '#fff';
            saveSettings();
            if (settings.enabled) { startPoll(); } else { stopPoll(); }
            log('Auto collect toggled:', settings.enabled);
        };
        document.body.appendChild(btn);
    }

    function buildSettingsPopup() {
        var existing = document.getElementById('pokedive-ac-popup');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'pokedive-ac-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 99999; display: none;';

        var popup = document.createElement('div');
        popup.id = 'pokedive-ac-popup';
        popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 340px; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 8px; padding: 16px; z-index: 100000; font-family: sans-serif; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);';

        var title = document.createElement('h3');
        title.textContent = 'Auto Collect Settings';
        title.style.cssText = 'margin: 0 0 12px 0; font-size: 18px; color: #00d2ff;';

        function makeToggle(labelText, checked, keyLabel) {
            var wrap = document.createElement('label');
            wrap.style.cssText = 'display: block; margin: 8px 0; cursor: pointer;';
            wrap.innerHTML = '<input type="checkbox" id="pd-ac-' + keyLabel + '" style="margin-right:8px;" ' + (checked ? 'checked' : '') + '><strong>' + labelText + '</strong>';
            return wrap;
        }

        var enabledToggle = makeToggle('Enabled', settings.enabled, 'enabled');
        var returnToggle = makeToggle('Collect on return from expedition', settings.collectOnReturn, 'collect-on-return');
        var departToggle = makeToggle('Collect before leaving on expedition', settings.collectOnDeparture, 'collect-on-departure');
        var stableToggle = makeToggle('Collect when resources stop changing', settings.collectWhenStable, 'collect-when-stable');

        var stableLabel = document.createElement('label');
        stableLabel.style.cssText = 'display: block; margin: 8px 0;';
        stableLabel.innerHTML = '<strong>Stable seconds:</strong><br><input type="number" id="pd-ac-stable-seconds" value="' + settings.stableSeconds + '" min="1" max="60" style="width:70px; padding:4px; background:#333; color:#fff; border:1px solid #555;">';

        var intervalLabel = document.createElement('label');
        intervalLabel.style.cssText = 'display: block; margin: 8px 0;';
        intervalLabel.innerHTML = '<strong>Check interval (seconds):</strong><br><input type="number" id="pd-ac-poll-interval" value="' + (settings.pollInterval / 1000) + '" min="1" max="60" style="width:70px; padding:4px; background:#333; color:#fff; border:1px solid #555;">';

        var debugToggle = makeToggle('Debug logging', settings.debug, 'debug');

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 8px; margin-top: 16px;';

        var saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = 'flex:1; padding: 8px; background: #00d2ff; color: #000; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';

        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.cssText = 'flex:1; padding: 8px; background: #444; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer;';

        var resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset';
        resetBtn.style.cssText = 'flex:1; padding: 8px; background: #666; color: #fff; border: 1px solid #888; border-radius: 4px; cursor: pointer;';

        saveBtn.onclick = function() {
            settings.enabled = document.getElementById('pd-ac-enabled').checked;
            settings.collectOnReturn = document.getElementById('pd-ac-collect-on-return').checked;
            settings.collectOnDeparture = document.getElementById('pd-ac-collect-on-departure').checked;
            settings.collectWhenStable = document.getElementById('pd-ac-collect-when-stable').checked;
            settings.debug = document.getElementById('pd-ac-debug').checked;
            var stableSecs = parseInt(document.getElementById('pd-ac-stable-seconds').value, 10) || 5;
            settings.stableSeconds = Math.max(1, Math.min(60, stableSecs));
            var pollSecs = parseInt(document.getElementById('pd-ac-poll-interval').value, 10) || 1;
            settings.pollInterval = Math.max(1, Math.min(60, pollSecs)) * 1000;
            saveSettings();
            var btn = document.getElementById('pokedive-ac-toggle');
            if (btn) {
                btn.textContent = settings.enabled ? 'AC: ON' : 'AC: OFF';
                btn.style.background = settings.enabled ? '#00d2ff' : '#666';
                btn.style.color = settings.enabled ? '#000' : '#fff';
            }
            if (settings.enabled) startPoll(); else stopPoll();
            overlay.style.display = 'none';
            log('Settings saved:', settings);
        };

        closeBtn.onclick = function() { overlay.style.display = 'none'; };

        resetBtn.onclick = function() {
            settings = Object.assign({}, CONFIG.defaults);
            saveSettings();
            location.reload();
        };

        btnRow.appendChild(saveBtn);
        btnRow.appendChild(closeBtn);
        btnRow.appendChild(resetBtn);

        popup.appendChild(title);
        popup.appendChild(enabledToggle);
        popup.appendChild(returnToggle);
        popup.appendChild(departToggle);
        popup.appendChild(stableToggle);
        popup.appendChild(stableLabel);
        popup.appendChild(intervalLabel);
        popup.appendChild(debugToggle);
        popup.appendChild(btnRow);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
    }

    /* ---------- init / cleanup ---------- */

    function cleanup() {
        stopPoll();
        stopUrlWatcher();
        if (hudObserver) { hudObserver.disconnect(); hudObserver = null; }
        removeToggle();
        ['pokedive-ac-popup', 'pokedive-ac-overlay'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });
        lastResourceValues = null;
        resourceStableSince = null;
        inTown = null;
        seenExpedition = false;
        log('Cleanup complete');
    }

    function init() {
        loadSettings();

        if (!window.location.hostname.includes('pokedive.com')) return;

        injectToggleButton();
        buildSettingsPopup();
        observeHud();
        startPoll();
        startUrlWatcher();
        log('Auto Collect initialized (mode:', getHudMode(), ')');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
