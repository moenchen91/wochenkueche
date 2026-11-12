/* Wochenküche: one private JSON file in Google Drive's appDataFolder. */
const CLOUD_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const CLOUD_NAME = 'wochenkueche-data.json';
const CLOUD_CLIENT_KEY = 'wochenkueche-google-client-id'; // configuration only
const CLOUD_EMAIL_KEY = 'wochenkueche-google-email'; // preferred account, not recipe data
let cloudToken = '', cloudId = '', cloudVersion = '', cloudReady = false;
let cloudPending = false, cloudWriting = false, cloudBlocked = false;
let cloudAccount = '';

function cloudMessage(message, error = false) {
  const el = document.getElementById('cloudStatus');
  if (el) { el.textContent = message; el.className = error ? 'warn' : 'muted'; }
  const indicator = document.getElementById('cloudIndicator');
  if (indicator) indicator.textContent = 'Google Drive: ' + message;
}
function cloudGate(show) { document.getElementById('cloudGate').hidden = !show; }
function cloudInit() {
  try {
    document.getElementById('clientId').value = localStorage.getItem(CLOUD_CLIENT_KEY) || '';
    document.getElementById('accountEmail').value = localStorage.getItem(CLOUD_EMAIL_KEY) || '';
  } catch (_) {}
  cloudGate(true);
}
function cloudSwitch() {
  if (cloudPending || cloudWriting) return alert('Bitte warte, bis die Änderungen in Google Drive gespeichert sind.');
  cloudReady = false; cloudToken = ''; cloudId = ''; cloudVersion = ''; cloudAccount = '';
  document.getElementById('firstCloud').hidden = true;
  document.getElementById('recoverCloud').hidden = true;
  s = load(); render(); cloudGate(true);
  cloudMessage('Trage die gewünschte Google-Adresse ein und verbinde sie.');
  document.getElementById('accountEmail').focus();
}
async function cloudAPI(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store', ...options,
    headers: { Authorization: 'Bearer ' + cloudToken, ...(options.headers || {}) }
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error?.message || ''; } catch (_) {}
    throw new Error('Google Drive: HTTP ' + response.status + (detail ? ' – ' + detail : ''));
  }
  return response;
}
function cloudValidate(data) {
  if (!data || !Array.isArray(data.recipes) || !data.req ||
      typeof data.req !== 'object' || !data.plan || typeof data.plan !== 'object' ||
      !Array.isArray(data.history)) throw new Error('Die Datendatei hat kein gültiges Wochenküche-Format.');
  data.settings ||= { lunch: true, cake: true, dinner: true };
  return data;
}
function cloudConnect() {
  const clientId = document.getElementById('clientId').value.trim();
  const expectedEmail = document.getElementById('accountEmail').value.trim().toLowerCase();
  if (!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    return cloudMessage('Bitte eine gültige Web-OAuth-Client-ID eingeben.', true);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedEmail)) {
    return cloudMessage('Bitte die Google-E-Mail-Adresse eingeben, in der deine Rezepte liegen sollen.', true);
  }
  try {
    localStorage.setItem(CLOUD_CLIENT_KEY, clientId);
    localStorage.setItem(CLOUD_EMAIL_KEY, expectedEmail);
  } catch (_) {}
  if (!window.google?.accounts?.oauth2) {
    return cloudMessage('Google-Anmeldung konnte nicht geladen werden. Prüfe die Internetverbindung.', true);
  }
  cloudMessage('Google-Anmeldung läuft …');
  document.getElementById('firstCloud').hidden = true;
  const client = google.accounts.oauth2.initTokenClient({
    client_id: clientId, scope: CLOUD_SCOPE, login_hint: expectedEmail,
    callback: async response => {
      if (response.error || !response.access_token) {
        return cloudMessage('Anmeldung fehlgeschlagen: ' + (response.error || 'kein Token'), true);
      }
      cloudToken = response.access_token;
      try {
        const about = await (await cloudAPI('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')).json();
        const actualEmail = about.user?.emailAddress?.toLowerCase();
        if (!actualEmail) throw new Error('Google Drive hat keine Konto-Adresse zurückgegeben. Zur Sicherheit werden keine Daten geöffnet.');
        if (actualEmail !== expectedEmail) {
          cloudToken = '';
          throw new Error('Google hat ' + actualEmail + ' angemeldet, erwartet wird ' + expectedEmail + '. Wähle beim nächsten Versuch „Anderes Konto verwenden“.');
        }
        cloudAccount = actualEmail;
        await cloudOpen();
      } catch (e) { cloudMessage(e.message, true); }
    },
    error_callback: e => cloudMessage('Anmeldung abgebrochen: ' + (e.message || e.type), true)
  });
  client.requestAccessToken({ prompt: 'select_account' });
}
async function cloudList() {
  const q = new URLSearchParams({
    spaces: 'appDataFolder', q: "name = '" + CLOUD_NAME + "' and trashed = false",
    fields: 'nextPageToken,files(id,name,version)', pageSize: '100'
  });
  const result = await (await cloudAPI('https://www.googleapis.com/drive/v3/files?' + q)).json();
  if (result.nextPageToken || result.files.length > 1) {
    throw new Error('Mehrere Datendateien gefunden. Bitte zuerst ein Backup exportieren und die doppelten App-Daten klären.');
  }
  return result.files[0] || null;
}
async function cloudOpen() {
  cloudMessage('Lade Daten aus Google Drive …');
  const file = await cloudList();
  if (!file) {
    document.getElementById('firstCloud').hidden = false;
    cloudMessage('Noch keine Datendatei vorhanden. Wähle, wie du beginnen möchtest.');
    return;
  }
  const remote = await (await cloudAPI('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media')).json();
  const data = cloudValidate(remote);
  cloudId = file.id; cloudVersion = file.version;
  cloudReady = true; cloudBlocked = false; cloudPending = false;
  s = data; render(); cloudGate(false);
  cloudMessage('Verbunden als ' + cloudAccount + ' · ' + s.recipes.length + ' Rezepte');
}
async function cloudRefresh() {
  if (!cloudReady || cloudWriting || cloudPending || cloudBlocked) return;
  try {
    const file = await cloudList();
    if (!file || file.id !== cloudId) throw new Error('Die gemeinsame Datendatei wurde entfernt oder ersetzt.');
    if (file.version !== cloudVersion) await cloudOpen();
    else cloudMessage('Aktueller Stand: ' + cloudAccount + ' · ' + s.recipes.length + ' Rezepte');
  } catch (e) { cloudMessage('Aktualisieren fehlgeschlagen: ' + e.message, true); }
}
function cloudOldData() {
  for (const key of [K, ...OLD]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return cloudValidate(JSON.parse(raw));
    } catch (_) {}
  }
  return null;
}
async function cloudStart(importOld) {
  try {
    const old = importOld ? cloudOldData() : null;
    if (importOld && !old) throw new Error('Auf diesem Gerät wurden keine bisherigen lokalen Daten gefunden. Nutze gegebenenfalls den JSON-Import.');
    // Recheck to avoid replacing another device's newly created file.
    if (await cloudList()) return cloudOpen();
    const data = old || { recipes: [], req: {}, plan: {}, history: [], settings: { lunch:true, cake:true, dinner:true } };
    const file = await cloudUpload(data);
    cloudId = file.id; cloudVersion = file.version;
    cloudReady = true; cloudBlocked = false;
    s = data; render(); cloudGate(false);
    cloudMessage('Verbunden als ' + cloudAccount + ' · ' + s.recipes.length + ' Rezepte');
  } catch (e) { cloudMessage(e.message, true); }
}
async function cloudUpload(data) {
  const json = JSON.stringify(data);
  if (cloudId) {
    const res = await cloudAPI('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(cloudId) + '?uploadType=media&fields=id,version', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json
    });
    return res.json();
  }
  const boundary = 'wk' + Math.random().toString(36).slice(2);
  const body = new Blob([
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify({ name: CLOUD_NAME, mimeType: 'application/json', parents: ['appDataFolder'] }),
    '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n', json,
    '\r\n--' + boundary + '--'
  ]);
  const res = await cloudAPI('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
  });
  return res.json();
}
function cloudQueueSave() {
  if (!cloudReady || cloudBlocked) return;
  cloudPending = true;
  cloudMessage('Speichere in Google Drive …');
  void cloudFlush();
}
async function cloudFlush() {
  if (cloudWriting) return;
  cloudWriting = true;
  try {
    while (cloudPending && !cloudBlocked) {
      cloudPending = false;
      const snapshot = JSON.parse(JSON.stringify(s));
      const metadata = await (await cloudAPI('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(cloudId) + '?fields=id,version')).json();
      if (metadata.version !== cloudVersion) {
        throw new Error('Ein anderes Gerät hat die Daten geändert. Diese Änderung wurde NICHT überschrieben. Exportiere deinen aktuellen Stand als JSON und lade die App neu.');
      }
      const updated = await cloudUpload(snapshot);
      cloudVersion = updated.version;
    }
    if (!cloudBlocked) cloudMessage('In Google Drive gespeichert: ' + cloudAccount + ' · ' + s.recipes.length + ' Rezepte');
  } catch (e) {
    cloudBlocked = true; cloudPending = false; cloudGate(true);
    document.getElementById('firstCloud').hidden = true;
    document.getElementById('recoverCloud').hidden = false;
    cloudMessage('Speichern gestoppt: ' + e.message, true);
  } finally { cloudWriting = false; }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && cloudReady) void cloudRefresh();
});
