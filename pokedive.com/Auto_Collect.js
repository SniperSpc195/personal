// ==UserScript==
// @name         PokeDive - Auto Collect
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Automatically collects resources on pokedive.com: on return from expedition, before departure (ready button / expedition start), and when resources are unchanged for 10s
// @author       Cline
// @match        *://pokedive.com/*
// @match        *://www.pokedive.com/*
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/SniperSpc195/personal/main/pokedive.com/Auto_Collect.js
// @updateURL    https://raw.githubusercontent.com/SniperSpc195/personal/main/meta/Auto_Collect.meta.js
// ==/UserScript==
// @ts-nocheck

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
            collectOnReadyButton: true,  // collect when the ready button is activated
            collectOnExpeditionStart: true, // collect when the user starts the expedition
            pollInterval: 1000,         // ms between resource-value checks
        },
        selectors: {
            hud: '#hud',
            gather: '#gather',
            gatherButton: '#gather button[data-act="collect-all"]',
            resources: '#gather span[data-id] .rn',
            // Expedition-initiation triggers (candidates; first match wins).
            readyButton: 'button[data-act="ready"], button[data-act="listo"], button.ready, [data-state="ready"]',
            expeditionStart: 'button[data-act="start-expedition"], button[data-act="partida"], button[data-act="expedition"], button.start-expedition',
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
    let stableTriggerFired = false;
    let stableTriggerWaiting = false;

    // Return-from-expedition poller (waits until gather button has amounts)
    let returnPollTimer = null;
    const RETURN_POLL_INTERVAL_MS = 250;
    const RETURN_POLL_MAX_ATTEMPTS = 40; // ~10s

    // Departure best-effort rapid retry (during town→expedition transition)
    let departureRetryTimer = null;
    const DEPARTURE_RETRY_INTERVAL_MS = 200;
    const DEPARTURE_RETRY_MAX_ATTEMPTS = 15; // ~3s

// NEW: expedition-initiation state
let readyObserver = null;
let departureCollected = false; // collected once per town->expedition cycle
let expeditionClickListenerAttached = false;

    const diagnosticEntries = [];
    const MAX_DIAGNOSTIC_ENTRIES = 30;

    const log = (...args) => {
        if (settings.debug) {
            console.log('[' + SCRIPT_NAME + ']', ...args);
        }
    };

    function renderDiagnostics() {
        var list = document.getElementById('pokedive-ac-diagnostics-list');
        if (!list) return;

        while (list.firstChild) list.removeChild(list.firstChild);
        if (diagnosticEntries.length === 0) {
            var empty = document.createElement('div');
            empty.textContent = 'No activity recorded yet.';
            empty.style.color = '#aaa';
            list.appendChild(empty);
            return;
        }

        diagnosticEntries.forEach(function(entry) {
            var row = document.createElement('div');
            row.textContent = '[' + entry.time + '] ' + entry.message;
            row.style.cssText = 'padding: 4px 0; border-top: 1px solid #333; overflow-wrap: anywhere;';
            list.appendChild(row);
        });
    }

    function recordDiagnostic(message) {
        diagnosticEntries.unshift({
            time: new Date().toLocaleTimeString(),
            message: String(message),
        });
        if (diagnosticEntries.length > MAX_DIAGNOSTIC_ENTRIES) {
            diagnosticEntries.length = MAX_DIAGNOSTIC_ENTRIES;
        }
        renderDiagnostics();
    }

    /* ---------- settings persistence ---------- */

    function validateSettings(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var s = {};
        s.enabled = typeof raw.enabled === 'boolean' ? raw.enabled : CONFIG.defaults.enabled;
        s.debug = typeof raw.debug === 'boolean' ? raw.debug : CONFIG.defaults.debug;
        s.collectOnReturn = typeof raw.collectOnReturn === 'boolean' ? raw.collectOnReturn : CONFIG.defaults.collectOnReturn;
        s.collectOnDeparture = typeof raw.collectOnDeparture === 'boolean' ? raw.collectOnDeparture : CONFIG.defaults.collectOnDeparture;
        s.collectWhenStable = typeof raw.collectWhenStable === 'boolean' ? raw.collectWhenStable : CONFIG.defaults.collectWhenStable;
        s.collectOnReadyButton = typeof raw.collectOnReadyButton === 'boolean' ? raw.collectOnReadyButton : CONFIG.defaults.collectOnReadyButton;
        s.collectOnExpeditionStart = typeof raw.collectOnExpeditionStart === 'boolean' ? raw.collectOnExpeditionStart : CONFIG.defaults.collectOnExpeditionStart;
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

    function isTown() {
        return inTown === true;
    }

    function parseNum(text) {
        var n = parseInt((text || '').replace(/[^0-9-]/g, ''), 10);
        return isNaN(n) ? null : n;
    }

    /* ---------- resource reading ---------- */

    function getResourceValues() {
        var out = {};
        qsa(CONFIG.selectors.resources).forEach(function(span) {
            // Resources render as: <span data-id="building"><span class="rn">+N</span></span>
            // inside the #gather panel. Read the id from the data-id span, not a button.
            var host = span.closest ? span.closest('[data-id]') : null;
            var id = host ? host.getAttribute('data-id') : null;
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
        return isVisible(gather) && isVisible(btn) && hasPositive;
    }

    /* ---------- expedition-initiation detection (ready button / start expedition) ---------- */

function getReadyButton() {
    return qs(CONFIG.selectors.readyButton);
}

function getExpeditionStartButton() {
    return qs(CONFIG.selectors.expeditionStart);
}

function buttonText(el) {
    return el ? (el.textContent || '').trim() : '';
}

function matchesSelectorList(el, sel) {
    if (!el || !el.matches) return false;
    try { return el.matches(sel); } catch (e) { return false; }
}

function looksLikeReadyButton(el) {
    if (!el) return false;
    if (matchesSelectorList(el, CONFIG.selectors.readyButton)) return true;
    var t = buttonText(el).toLowerCase();
    return t.indexOf('listo') !== -1 || t.indexOf('ready') !== -1;
}

function looksLikeExpeditionStart(el) {
    if (!el) return false;
    if (matchesSelectorList(el, CONFIG.selectors.expeditionStart)) return true;
    var t = buttonText(el).toLowerCase();
    return t.indexOf('partida') !== -1 || t.indexOf('start') !== -1 || t.indexOf('expedition') !== -1 || t.indexOf('iniciar') !== -1;
}

function isReadyButtonActive(el) {
    if (!el || !isVisible(el) || el.disabled) return false;
    var cls = (el.getAttribute('class') || '').toLowerCase();
    var state = (el.getAttribute('data-state') || '').toLowerCase();
    var aria = (el.getAttribute('aria-pressed') || '').toLowerCase();
    var active = /active|selected|on|enabled/.test(cls) || /active|selected|on|enabled/.test(state) || aria === 'true';
    var t = buttonText(el).toLowerCase();
    if (t.indexOf('not ') !== -1 && (t.indexOf('ready') !== -1 || t.indexOf('listo') !== -1)) return false;
    return active;
}

function findReadyButton() {
    var b = getReadyButton();
    if (b) return b;
    var candidates = qsa('button, [role="button"]');
    for (var i = 0; i < candidates.length; i++) {
        if (looksLikeReadyButton(candidates[i])) return candidates[i];
    }
    return null;
}

function findExpeditionStartButton() {
    var b = getExpeditionStartButton();
    if (b) return b;
    var candidates = qsa('button, [role="button"]');
    for (var i = 0; i < candidates.length; i++) {
        if (looksLikeExpeditionStart(candidates[i])) return candidates[i];
    }
    return null;
}

function triggerDepartureCollection(reason) {
    if (!settings.enabled || !isTown() || departureCollected) return false;
    recordDiagnostic('Departure trigger: ' + reason);
    log('Departure trigger:', reason);
    var ok = collect(reason);
    if (ok) {
        departureCollected = true;
        recordDiagnostic('Departure collection performed (' + reason + ').');
    }
    return ok;
}

function startReadyButtonObserver() {
    stopReadyButtonObserver();
    if (!settings.enabled || !settings.collectOnReadyButton || !isTown()) return;
    var initial = findReadyButton();
    if (initial && isReadyButtonActive(initial)) {
        triggerDepartureCollection('ready button active on town entry');
    }
    readyObserver = new MutationObserver(function(mutations) {
        if (!settings.enabled || !isTown() || departureCollected) return;
        var shouldTrigger = false;
        mutations.forEach(function(m) {
            if (shouldTrigger) return;
            var nodes = [];
            if (m.type === 'childList') {
                m.addedNodes.forEach(function(n) {
                    if (n.nodeType === 1) nodes.push(n);
                });
            } else if (m.type === 'attributes') {
                nodes.push(m.target);
            }
            nodes.forEach(function(n) {
                if (shouldTrigger) return;
                var btn = null;
                if (looksLikeReadyButton(n)) {
                    btn = n;
                } else if (n.querySelectorAll) {
                    var f = n.querySelectorAll(CONFIG.selectors.readyButton);
                    if (f.length) btn = f[0];
                }
                if (btn && isReadyButtonActive(btn)) shouldTrigger = true;
            });
        });
        if (shouldTrigger) {
            triggerDepartureCollection('ready button activated');
        }
    });
    try {
        readyObserver.observe(document.body, { childList: true, attributes: true, subtree: true });
    } catch (e) {
        log('Ready button observer failed:', e);
        readyObserver = null;
    }
}

function stopReadyButtonObserver() {
    if (readyObserver) { readyObserver.disconnect(); readyObserver = null; }
}

function handleExpeditionClick(e) {
    if (!settings.enabled || !isTown() || departureCollected) return;
    var target = e.target;
    var btn = target && target.closest ? target.closest('button, [role="button"]') : null;
    if (!btn) return;
    var isReady = isReadyButtonActive(btn);
    var isStart = looksLikeExpeditionStart(btn);
    if ((isReady && settings.collectOnReadyButton) || (isStart && settings.collectOnExpeditionStart)) {
        recordDiagnostic('Expedition button clicked: ' + (isStart ? 'start' : 'ready'));
        triggerDepartureCollection(isStart ? 'expedition start clicked' : 'ready button clicked');
    }
}

function attachExpeditionClickListeners() {
    if (expeditionClickListenerAttached) return;
    try {
        document.addEventListener('click', handleExpeditionClick, true);
        expeditionClickListenerAttached = true;
    } catch (e) {
        log('Expedition click listener failed:', e);
    }
}

function removeExpeditionClickListeners() {
    if (expeditionClickListenerAttached) {
        try { document.removeEventListener('click', handleExpeditionClick, true); } catch (e) {}
        expeditionClickListenerAttached = false;
    }
}

    /* ---------- collection ---------- */

    function collect(reason) {
        recordDiagnostic('Collection requested: ' + reason);
        if (!settings.enabled) {
            recordDiagnostic('Skipped: automation is disabled.');
            log('Collect skipped (disabled):', reason);
            return false;
        }
        if (isCollecting) {
            recordDiagnostic('Skipped: another collection is already running.');
            log('Collect skipped (already collecting):', reason);
            return false;
        }
        var cooldownRemaining = COLLECT_COOLDOWN_MS - (now() - lastCollectTime);
        if (cooldownRemaining > 0) {
            recordDiagnostic('Skipped: cooldown has ' + Math.ceil(cooldownRemaining / 1000) + 's remaining.');
            log('Collect skipped (cooldown):', reason);
            return false;
        }
        var btn = getGatherButton();
        if (!btn) {
            recordDiagnostic('Skipped: collect button was not found.');
            log('No gather button available:', reason);
            return false;
        }
        if (!gatherHasAmounts()) {
            recordDiagnostic('Skipped: no visible resources are available to collect.');
            log('Nothing to collect:', reason);
            return false;
        }
        isCollecting = true;
        lastCollectTime = now();
        try {
            btn.dataset.pdCollected = 'true';
            btn.click();
            recordDiagnostic('Collect button clicked (' + reason + ').');
            log('Collected (' + reason + '):', btn.textContent.trim());
            return true;
        } catch (e) {
            recordDiagnostic('Collection click failed: ' + (e && e.message ? e.message : String(e)));
            log('Error clicking gather:', e);
            return false;
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
        recordDiagnostic('HUD mode changed: ' + prevMode + ' -> ' + newMode + '.');
        var prevTown = prevMode === 'town';
        var newTown = newMode === 'town';

        if (!prevTown && newTown) {
            // returned from expedition to town
            seenExpedition = true;
            departureCollected = false; // new town visit; allow pre-departure collection again
            if (settings.collectOnReturn) {
                recordDiagnostic('Return-from-expedition trigger detected; waiting for collectable resources.');
                log('Return-from-expedition trigger will poll for gather button');
                startReturnPoll();
            } else {
                recordDiagnostic('Return trigger ignored: disabled in settings.');
            }
        }
        if (prevTown && !newTown) {
            // leaving town for an expedition
            seenExpedition = true;
            stopReadyButtonObserver(); // no longer in town
            if (settings.collectOnDeparture) {
                recordDiagnostic('Departure trigger detected; rapid retry for collectable resources.');
                log('Departure-to-expedition trigger will rapid-retry collect');
                startDepartureRetry();
            } else {
                recordDiagnostic('Departure trigger ignored: disabled in settings.');
            }
        }
        inTown = newTown;
        if (isTown()) {
            startReadyButtonObserver();
        }
    }

    /* ---------- resource stability monitor ---------- */

    function checkResources() {
        if (!settings.enabled) {
            if (resourceStableSince !== null || lastResourceValues !== null || stableTriggerFired) {
                recordDiagnostic('Stability timer reset: automation is disabled.');
            }
            resourceStableSince = null;
            lastResourceValues = null;
            stableTriggerFired = false;
            stableTriggerWaiting = false;
            return;
        }
        var cur = getResourceValues();

        if (!settings.collectWhenStable) {
            if (resourceStableSince !== null || lastResourceValues !== null || stableTriggerFired) {
                recordDiagnostic('Stability timer reset: stable collection is disabled.');
            }
            resourceStableSince = null;
            lastResourceValues = null;
            stableTriggerFired = false;
            stableTriggerWaiting = false;
            return;
        }
        if (lastResourceValues === null) {
            lastResourceValues = cur;
            resourceStableSince = null;
            stableTriggerFired = false;
            stableTriggerWaiting = false;
            if (Object.keys(cur).length > 0) {
                recordDiagnostic('Tracking resource values: ' + JSON.stringify(cur) + '.');
            }
            return;
        }
        var changed = false;
        var keys = Object.keys(cur);
        if (keys.length === 0) {
            if (Object.keys(lastResourceValues).length > 0) {
                recordDiagnostic('Resource values disappeared; stability timer reset.');
            }
            lastResourceValues = cur;
            resourceStableSince = null;
            stableTriggerFired = false;
            stableTriggerWaiting = false;
            return;
        }
        keys.forEach(function(k) {
            if (cur[k] !== lastResourceValues[k]) changed = true;
        });
        Object.keys(lastResourceValues).forEach(function(k) {
            if (cur[k] === undefined) changed = true;
        });
        // Also treat brand-new resource keys as a change (e.g. a new resource
        // type appears in the HUD). Otherwise the stability timer would never
        // reset when a previously-untracked resource shows up.
        Object.keys(cur).forEach(function(k) {
            if (lastResourceValues[k] === undefined) changed = true;
        });

        if (changed) {
            lastResourceValues = cur;
            resourceStableSince = null;
            stableTriggerFired = false;
            stableTriggerWaiting = false;
            recordDiagnostic('Resource values changed; stability timer restarted: ' + JSON.stringify(cur) + '.');
            log('Resource values changed, stability timer reset');
            return;
        }

        // values are stable
        if (resourceStableSince === null) {
            resourceStableSince = now();
            recordDiagnostic('Resource values are unchanged; ' + settings.stableSeconds + 's stability timer started.');
            log('Resources became stable, starting ' + settings.stableSeconds + 's timer');
        }
        var stableFor = now() - resourceStableSince;
        if (!stableTriggerFired && stableFor >= settings.stableSeconds * 1000) {
            if (now() - lastCollectTime < COLLECT_COOLDOWN_MS || !gatherHasAmounts()) {
                if (!stableTriggerWaiting) {
                    stableTriggerWaiting = true;
                    recordDiagnostic('Stable threshold reached after ' + Math.floor(stableFor / 1000) + 's; waiting for collectable resources or cooldown.');
                }
                return;
            }
            if (collect('resources stable for ' + stableFor + 'ms')) {
                stableTriggerFired = true;
                stableTriggerWaiting = false;
                recordDiagnostic('Stable trigger completed; it will re-arm after resource values change.');
            }
        }
    }

    function startPoll() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(checkResources, settings.pollInterval);
    }
    function stopPoll() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    /* ---------- return / departure pollers ---------- */

    // Return from expedition: poll until the gather button actually has
    // collectable amounts (expedition loot may take a moment to appear),
    // then collect. Stops as soon as collection succeeds or attempts expire.
    function startReturnPoll() {
        if (returnPollTimer) clearInterval(returnPollTimer);
        var attempts = 0;
        returnPollTimer = setInterval(function() {
            attempts++;
            if (!settings.enabled || !settings.collectOnReturn) {
                clearInterval(returnPollTimer);
                returnPollTimer = null;
                return;
            }
            if (gatherHasAmounts()) {
                clearInterval(returnPollTimer);
                returnPollTimer = null;
                collect('return from expedition (polled)');
            } else if (attempts >= RETURN_POLL_MAX_ATTEMPTS) {
                clearInterval(returnPollTimer);
                returnPollTimer = null;
                recordDiagnostic('Return poll timed out: no collectable resources.');
            }
        }, RETURN_POLL_INTERVAL_MS);
    }

    // Departure: best-effort rapid retry during the town→expedition transition
    // window, in case the gather button is briefly still clickable.
    function startDepartureRetry() {
        if (departureRetryTimer) clearInterval(departureRetryTimer);
        var attempts = 0;
        departureRetryTimer = setInterval(function() {
            attempts++;
            if (!settings.enabled || !settings.collectOnDeparture || isTown()) {
                // Still in town (transition did not complete) or disabled.
                clearInterval(departureRetryTimer);
                departureRetryTimer = null;
                return;
            }
            if (gatherHasAmounts()) {
                clearInterval(departureRetryTimer);
                departureRetryTimer = null;
                collect('departure to expedition (retry)');
            } else if (attempts >= DEPARTURE_RETRY_MAX_ATTEMPTS) {
                clearInterval(departureRetryTimer);
                departureRetryTimer = null;
                recordDiagnostic('Departure retry timed out: no collectable resources.');
            }
        }, DEPARTURE_RETRY_INTERVAL_MS);
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
                            recordDiagnostic('Gather panel appeared after expedition; waiting for collectable resources.');
                            log('Gather panel appeared trigger will poll for gather button');
                            startReturnPoll();
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
                    departureCollected = false;
                    lastResourceValues = null;
                    resourceStableSince = null;
                    stableTriggerFired = false;
                    stableTriggerWaiting = false;
                    observeHud();
                    startReadyButtonObserver();
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
            var overlay = document.getElementById('pokedive-ac-overlay');
            if (overlay) {
                overlay.style.display = 'flex';
                log('Settings popup opened');
            } else {
                log('Settings overlay not found');
            }
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
        popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 340px; max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 8px; padding: 16px; z-index: 100000; font-family: sans-serif; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);';

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
        var readyToggle = makeToggle('Collect on ready button (party ready-up)', settings.collectOnReadyButton, 'collect-on-ready-button');
        var startToggle = makeToggle('Collect when starting expedition (hosting)', settings.collectOnExpeditionStart, 'collect-on-expedition-start');
        var stableToggle = makeToggle('Collect when resources stop changing', settings.collectWhenStable, 'collect-when-stable');

        var stableLabel = document.createElement('label');
        stableLabel.style.cssText = 'display: block; margin: 8px 0;';
        stableLabel.innerHTML = '<strong>Stable seconds:</strong><br><input type="number" id="pd-ac-stable-seconds" value="' + settings.stableSeconds + '" min="1" max="60" style="width:70px; padding:4px; background:#333; color:#fff; border:1px solid #555;">';

        var intervalLabel = document.createElement('label');
        intervalLabel.style.cssText = 'display: block; margin: 8px 0;';
        intervalLabel.innerHTML = '<strong>Check interval (seconds):</strong><br><input type="number" id="pd-ac-poll-interval" value="' + (settings.pollInterval / 1000) + '" min="1" max="60" style="width:70px; padding:4px; background:#333; color:#fff; border:1px solid #555;">';

        var debugToggle = makeToggle('Debug logging', settings.debug, 'debug');

        var diagnosticsHeader = document.createElement('div');
        diagnosticsHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-top: 14px;';
        var diagnosticsTitle = document.createElement('strong');
        diagnosticsTitle.textContent = 'Recent activity';
        var clearDiagnosticsBtn = document.createElement('button');
        clearDiagnosticsBtn.type = 'button';
        clearDiagnosticsBtn.textContent = 'Clear';
        clearDiagnosticsBtn.setAttribute('aria-label', 'Clear recent activity');
        clearDiagnosticsBtn.style.cssText = 'padding: 4px 8px; background: #444; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer;';
        clearDiagnosticsBtn.onclick = function() {
            diagnosticEntries.length = 0;
            renderDiagnostics();
        };
        diagnosticsHeader.appendChild(diagnosticsTitle);
        diagnosticsHeader.appendChild(clearDiagnosticsBtn);

        var diagnosticsList = document.createElement('div');
        diagnosticsList.id = 'pokedive-ac-diagnostics-list';
        diagnosticsList.setAttribute('role', 'log');
        diagnosticsList.setAttribute('aria-live', 'polite');
        diagnosticsList.style.cssText = 'max-height: 160px; overflow-y: auto; margin-top: 6px; padding: 6px 8px; background: #111; border: 1px solid #444; border-radius: 4px; color: #ddd; font-size: 12px;';
        renderDiagnostics();

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
            settings.collectOnReadyButton = document.getElementById('pd-ac-collect-on-ready-button').checked;
            settings.collectOnExpeditionStart = document.getElementById('pd-ac-collect-on-expedition-start').checked;
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
        popup.appendChild(readyToggle);
        popup.appendChild(startToggle);
        popup.appendChild(stableToggle);
        popup.appendChild(stableLabel);
        popup.appendChild(intervalLabel);
        popup.appendChild(debugToggle);
        popup.appendChild(diagnosticsHeader);
        popup.appendChild(diagnosticsList);
        popup.appendChild(btnRow);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
    }

    /* ---------- init / cleanup ---------- */

    function cleanup() {
        stopPoll();
        stopUrlWatcher();
        if (returnPollTimer) { clearInterval(returnPollTimer); returnPollTimer = null; }
        if (departureRetryTimer) { clearInterval(departureRetryTimer); departureRetryTimer = null; }
        stopReadyButtonObserver();
        removeExpeditionClickListeners();
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
        stableTriggerFired = false;
        stableTriggerWaiting = false;
        departureCollected = false;
        log('Cleanup complete');
    }

    function init() {
        loadSettings();

        if (!window.location.hostname.includes('pokedive.com')) return;

        injectToggleButton();
        buildSettingsPopup();
        observeHud();
        attachExpeditionClickListeners();
        startReadyButtonObserver();
        startPoll();
        startUrlWatcher();
        recordDiagnostic('Auto Collect initialized; HUD mode: ' + (getHudMode() || 'unknown') + '.');
        log('Auto Collect initialized (mode:', getHudMode(), ')');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
