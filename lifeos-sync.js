/**
 * 라이프 OS 가족 동기화 라이브러리
 * Firebase Firestore 기반 실시간 동기화
 */
(function() {
  'use strict';

  const CONFIG_KEY = 'lifeos-firebase-config';
  const FAMILY_ID_KEY = 'lifeos-family-id';
  const SYNC_LOG_KEY = 'lifeos-sync-log';

  let app = null, db = null, auth = null;
  let familyId = null;
  let initialized = false;
  let initPromise = null;
  const listeners = {};

  function getConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function clearConfig() {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(FAMILY_ID_KEY);
    initialized = false;
    initPromise = null;
  }

  function getFamilyId() {
    return localStorage.getItem(FAMILY_ID_KEY);
  }

  function saveFamilyId(id) {
    localStorage.setItem(FAMILY_ID_KEY, id);
  }

  function isConfigured() {
    return !!(getConfig() && getFamilyId());
  }

  async function init() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const config = getConfig();
      const fid = getFamilyId();

      if (!config || !fid) {
        return { success: false, reason: 'not-configured' };
      }

      if (typeof firebase === 'undefined') {
        console.error('[LifeOSSync] Firebase SDK 로드 안 됨');
        return { success: false, reason: 'sdk-missing' };
      }

      try {
        if (firebase.apps && firebase.apps.length > 0) {
          app = firebase.app();
        } else {
          app = firebase.initializeApp(config);
        }
        db = firebase.firestore();
        auth = firebase.auth();
        await auth.signInAnonymously();
        familyId = fid;
        initialized = true;
        console.log('[LifeOSSync] 초기화 완료. 가족 ID:', fid);
        return { success: true };
      } catch(e) {
        console.error('[LifeOSSync] 초기화 실패:', e);
        initPromise = null;
        return { success: false, reason: 'init-error', error: e.message };
      }
    })();

    return initPromise;
  }

  async function load(moduleKey) {
    if (!initialized) {
      const r = await init();
      if (!r.success) return null;
    }

    try {
      const doc = await db
        .collection('families').doc(familyId)
        .collection('modules').doc(moduleKey)
        .get();

      if (!doc.exists) return null;
      const d = doc.data();
      return {
        data: d.payload,
        updatedAt: d.updatedAt ? d.updatedAt.toMillis() : 0,
        updatedBy: d.updatedBy || '',
      };
    } catch(e) {
      console.error('[LifeOSSync] load 실패:', moduleKey, e);
      return null;
    }
  }

  async function save(moduleKey, data, deviceLabel) {
    if (!initialized) {
      const r = await init();
      if (!r.success) return false;
    }

    try {
      await db
        .collection('families').doc(familyId)
        .collection('modules').doc(moduleKey)
        .set({
          payload: data,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: deviceLabel || getDeviceLabel(),
        });
      logSync(moduleKey, 'save');
      return true;
    } catch(e) {
      console.error('[LifeOSSync] save 실패:', moduleKey, e);
      return false;
    }
  }

  function onChange(moduleKey, callback) {
    if (!initialized) {
      console.warn('[LifeOSSync] 초기화 안 됨. onChange 무시');
      return () => {};
    }
    if (listeners[moduleKey]) listeners[moduleKey]();

    const unsubscribe = db
      .collection('families').doc(familyId)
      .collection('modules').doc(moduleKey)
      .onSnapshot((doc) => {
        if (!doc.exists) return;
        const d = doc.data();
        callback(d.payload, {
          updatedAt: d.updatedAt ? d.updatedAt.toMillis() : 0,
          updatedBy: d.updatedBy || '',
        });
      }, (err) => {
        console.error('[LifeOSSync] onChange 에러:', moduleKey, err);
      });

    listeners[moduleKey] = unsubscribe;
    return unsubscribe;
  }

  function getDeviceLabel() {
    let label = localStorage.getItem('lifeos-device-label');
    if (!label) {
      const ua = navigator.userAgent;
      let prefix = '기기';
      if (/iPhone/.test(ua)) prefix = '아이폰';
      else if (/iPad/.test(ua)) prefix = '아이패드';
      else if (/Android/.test(ua)) prefix = '안드로이드';
      else if (/Mac/.test(ua)) prefix = '맥';
      else if (/Windows/.test(ua)) prefix = 'PC';
      label = `${prefix}-${Math.random().toString(36).substr(2, 4)}`;
      localStorage.setItem('lifeos-device-label', label);
    }
    return label;
  }

  function setDeviceLabel(label) {
    localStorage.setItem('lifeos-device-label', label);
  }

  function logSync(moduleKey, action) {
    try {
      const log = JSON.parse(localStorage.getItem(SYNC_LOG_KEY) || '[]');
      log.unshift({ moduleKey, action, at: Date.now() });
      if (log.length > 50) log.length = 50;
      localStorage.setItem(SYNC_LOG_KEY, JSON.stringify(log));
    } catch(e) {}
  }

  function getSyncLog() {
    try { return JSON.parse(localStorage.getItem(SYNC_LOG_KEY) || '[]'); }
    catch(e) { return []; }
  }

  async function uploadAllLocalData() {
    if (!initialized) {
      const r = await init();
      if (!r.success) return { success: false, reason: r.reason };
    }
    const moduleKeys = {
      'gagebu-full-v1': 'gagebu',
      'lifeos-travel-v1': 'travel',
      'lifeos-kids-v1': 'kids',
      'lifeos-home-v1': 'home',
      'lifeos-health-v1': 'health',
      'lifeos-maintenance-v1': 'maintenance',
      'lifeos-calendar-v1': 'calendar',
      'lifeos-api-keys': 'api-keys',
    };
    const results = { uploaded: [], skipped: [], failed: [] };
    for (const [storageKey, moduleKey] of Object.entries(moduleKeys)) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) { results.skipped.push(moduleKey); continue; }
        const data = JSON.parse(raw);
        const ok = await save(moduleKey, data);
        if (ok) results.uploaded.push(moduleKey);
        else results.failed.push(moduleKey);
      } catch(e) {
        results.failed.push(moduleKey);
      }
    }
    return { success: true, ...results };
  }

  async function downloadAllToLocal() {
    if (!initialized) {
      const r = await init();
      if (!r.success) return { success: false, reason: r.reason };
    }
    const moduleKeys = {
      'gagebu': 'gagebu-full-v1',
      'travel': 'lifeos-travel-v1',
      'kids': 'lifeos-kids-v1',
      'home': 'lifeos-home-v1',
      'health': 'lifeos-health-v1',
      'maintenance': 'lifeos-maintenance-v1',
      'calendar': 'lifeos-calendar-v1',
      'api-keys': 'lifeos-api-keys',
    };
    const results = { downloaded: [], empty: [], failed: [] };
    for (const [moduleKey, storageKey] of Object.entries(moduleKeys)) {
      try {
        const cloud = await load(moduleKey);
        if (!cloud || cloud.data == null) {
          results.empty.push(moduleKey);
          continue;
        }
        localStorage.setItem(storageKey, JSON.stringify(cloud.data));
        results.downloaded.push(moduleKey);
      } catch(e) {
        results.failed.push(moduleKey);
      }
    }
    return { success: true, ...results };
  }

  window.LifeOSSync = {
    isConfigured, getConfig, saveConfig, clearConfig,
    getFamilyId, saveFamilyId, getDeviceLabel, setDeviceLabel,
    init, load, save, onChange,
    uploadAllLocalData, downloadAllToLocal,
    getSyncLog,
  };

  console.log('[LifeOSSync] 라이브러리 로드됨');
})();
