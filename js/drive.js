// Google Drive backup/restore via GIS implicit flow + REST API

const CLIENT_ID = '146475241021-2sschmrutnqdeug5fo6onc772im94ltt.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const BACKUP_FILENAME = 'barra-libre-backup.json';

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

export function initDrive() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {},
  });
}

function isTokenValid() {
  return accessToken && Date.now() < tokenExpiry;
}

function ensureAuth() {
  return new Promise((resolve, reject) => {
    if (isTokenValid()) {
      resolve(accessToken);
      return;
    }
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }
      accessToken = response.access_token;
      tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000;
      resolve(accessToken);
    };
    tokenClient.requestAccessToken();
  });
}

async function findBackupFile(token) {
  const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name,modifiedTime)',
    q: `name='${BACKUP_FILENAME}'`,
    pageSize: '1',
  });
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Error al buscar backup: ${res.status}`);
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

async function uploadFile(token, content, existingFileId) {
  const metadata = existingFileId
    ? { name: BACKUP_FILENAME }
    : { name: BACKUP_FILENAME, parents: ['appDataFolder'] };

  const boundary = '---barra_libre_boundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  const res = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Error al subir backup: ${res.status}`);
  return res.json();
}

async function downloadFile(token, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Error al descargar backup: ${res.status}`);
  return res.text();
}

export async function backupToDrive(db) {
  const token = await ensureAuth();
  const content = JSON.stringify(db, null, 2);
  const existing = await findBackupFile(token);
  await uploadFile(token, content, existing ? existing.id : null);
  return { success: true, updated: !!existing };
}

export async function restoreFromDrive() {
  const token = await ensureAuth();
  const file = await findBackupFile(token);
  if (!file) return { success: false, reason: 'no_backup' };
  const content = await downloadFile(token, file.id);
  const data = JSON.parse(content);
  if (!data.workouts) throw new Error('Formato de backup no valido');
  return { success: true, data, modifiedTime: file.modifiedTime };
}
