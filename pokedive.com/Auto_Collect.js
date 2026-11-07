// ==UserScript==
// @name         PokeDive - Auto Collect
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Automatically collects available rewards on pokedive.com
// @author       Cline
// @match        *://pokedive.com/*
// @match        *://www.pokedive.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        storageKey: 'pokedive_autocollect_settings',
        defaults: {
            enabled: true,
            interval: 30000,
            collectEnergy: true,
            collectItems: true,
            debug: false
        },
        selectors: {
            collectButtons: '[class*="collect"], [class*="claim"], [class*="reward"], button.collect, button.claim',
            energyBar: '[class*="energy"], [class*="stamina"]',
            notification: '[class*="notification"], [class*="alert"]'
        }
    };

    let settings = { ...CONFIG.defaults };
    let timer = null;
    let isCollecting = false;
    let initialized = false;

    const log = (...args) => {
        if (settings.debug) {
            console.log('[PokeDive Auto Collect]', ...args);
        }
    };

    function loadSettings() {
        try {
            const raw = localStorage.getItem(CONFIG.storageKey);
            if (raw) {
                settings = { ...CONFIG.defaults, ...JSON.parse(raw) };
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

    function findCollectButtons() {
        const buttons = [];
        try {
            const candidates = document.querySelectorAll(CONFIG.selectors.collectButtons);
            candidates.forEach(btn => {
                if (!btn) return;
                if (btn.disabled || btn.dataset.pdCollected === 'true') return;
                const rect = btn.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return;
                const text = (btn.textContent || '').trim().toLowerCase();
                if (text.includes('collect') || text.includes('claim') ||
                    text.includes('reward') || text.includes('collect reward') ||
                    btn.classList.contains('collect') || btn.classList.contains('claim')) {
                    buttons.push(btn);
                }
            });
        } catch (e) {
            log('Error finding collect buttons:', e);
        }
        return buttons;
    }

    function collectButton(btn) {
        if (!btn || isCollecting) return;
        isCollecting = true;
        try {
            btn.dataset.pdCollected = 'true';
            btn.click();
            log('Clicked collect button:', btn.textContent.trim());
        } catch (e) {
            log('Error clicking button:', e);
        } finally {
            isCollecting = false;
        }
    }

    function runCollection() {
        if (!settings.enabled) return;
        const buttons = findCollectButtons();
        log('Found', buttons.length, 'collectable button(s)');
        buttons.forEach((btn, idx) => {
            setTimeout(() => collectButton(btn), idx * 500);
        });
    }

    function startLoop() {
        if (timer) clearInterval(timer);
        if (!settings.enabled) return;
        timer = setInterval(runCollection, settings.interval);
        log('Auto collect loop started, interval:', settings.interval, 'ms');
    }

    function stopLoop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }
    function buildSettingsPopup() {
        const existing = document.getElementById('pokedive-autocollect-popup');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'pokedive-autocollect-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 99999; display: none;';
        const popup = document.createElement('div');
        popup.id = 'pokedive-autocollect-popup';
        popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 340px; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 8px; padding: 16px; z-index: 100000; font-family: sans-serif; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);';
        const title = document.createElement('h3');
        title.textContent = 'Auto Collect Settings';
        title.style.cssText = 'margin: 0 0 12px 0; font-size: 18px; color: #00d2ff;';
        popup.appendChild(title);
        const toggle = document.createElement('label');
        toggle.style.cssText = 'display: block; margin: 8px 0; cursor: pointer;';
        toggle.innerHTML = '<input type="checkbox" id="pd-ac-enabled" style="margin-right:8px;" ' + (settings.enabled ? 'checked' : '') + '><strong>Enabled</strong>';
        popup.appendChild(toggle);
        const intervalLabel = document.createElement('label');
        intervalLabel.style.cssText = 'display: block; margin: 8px 0;';
        intervalLabel.innerHTML = '<strong>Check interval (seconds):</strong><br><input type="number" id="pd-ac-interval" value="' + (settings.interval / 1000) + '" min="5" max="3600" style="width:70px; padding:4px; background:#333; color:#fff; border:1px solid #555;">';
        popup.appendChild(intervalLabel);
        const debugToggle = document.createElement('label');
        debugToggle.style.cssText = 'display: block; margin: 8px 0; cursor: pointer;';
        debugToggle.innerHTML = '<input type="checkbox" id="pd-ac-debug" style="margin-right:8px;" ' + (settings.debug ? 'checked' : '') + '> Debug logging';
        popup.appendChild(debugToggle);
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 8px; margin-top: 16px;';
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = 'flex:1; padding: 8px; background: #00d2ff; color: #000; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.cssText = 'flex:1; padding: 8px; background: #444; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer;';
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset';
        resetBtn.style.cssText = 'flex:1; padding: 8px; background: #666; color: #fff; border: 1px solid #888; border-radius: 4px; cursor: pointer;';
        saveBtn.onclick = () => {
            const enabledCb = document.getElementById('pd-ac-enabled');
            const intervalInput = document.getElementById('pd-ac-interval');
            const debugCb = document.getElementById('pd-ac-debug');
            settings.enabled = enabledCb.checked;
            settings.debug = debugCb.checked;
            const secs = parseInt(intervalInput.value, 10) || 30;
            settings.interval = Math.max(5, Math.min(3600, secs)) * 1000;
            saveSettings();
            startLoop();
            overlay.style.display = 'none';
            log('Settings saved:', settings);
        };
        closeBtn.onclick = () => { overlay.style.display = 'none'; };
        resetBtn.onclick = () => { settings = { ...CONFIG.defaults }; saveSettings(); location.reload(); };
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(closeBtn);
        btnRow.appendChild(resetBtn);
        popup.appendChild(btnRow);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
    }
    function injectToggleButton() {
        const existing = document.getElementById('pokedive-autocollect-toggle');
        if (existing) return;
        const btn = document.createElement('button');
        btn.id = 'pokedive-autocollect-toggle';
        btn.textContent = settings.enabled ? 'AC: ON' : 'AC: OFF';
        btn.style.cssText = 'position: fixed; bottom: 16px; left: 16px; z-index: 100000; background: ' + (settings.enabled ? '#00d2ff' : '#666') + '; color: ' + (settings.enabled ? '#000' : '#fff') + '; border: none; border-radius: 4px; padding: 6px 10px; font-size: 12px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.4);';
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            settings.enabled = !settings.enabled;
            btn.textContent = settings.enabled ? 'AC: ON' : 'AC: OFF';
            btn.style.background = settings.enabled ? '#00d2ff' : '#666';
            btn.style.color = settings.enabled ? '#000' : '#fff';
            saveSettings();
            startLoop();
            log('Auto collect toggled:', settings.enabled);
        };
        document.body.appendChild(btn);
    }

    function init() {
        if (initialized) return;
        initialized = true;
        loadSettings();
        if (!window.location.hostname.includes('pokedive.com')) return;
        injectToggleButton();
        buildSettingsPopup();
        const toggleBtn = document.getElementById('pokedive-autocollect-toggle');
        let clickCount = 0;
        let clickTimer = null;
        toggleBtn.addEventListener('click', (e) => {
            clickCount++;
            if (clickCount === 1) {
                clickTimer = setTimeout(() => { clickCount = 0; }, 400);
            } else if (clickCount >= 3) {
                clearTimeout(clickTimer);
                clickCount = 0;
                const overlay = document.getElementById('pokedive-autocollect-overlay');
                if (overlay) overlay.style.display = 'flex';
            }
        });
        startLoop();
        log('Auto Collect initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
