import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import firebaseConfigJson from '../firebase-applet-config.json' with { type: 'json' };

const projectId = process.env.VITE_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId || 'ota-smart-timetable';
const firestoreDatabaseId = firebaseConfigJson.firestoreDatabaseId;

function parseServiceAccountJson(raw: string): any {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  const sa = JSON.parse(jsonText);
  if (sa && typeof sa.private_key === 'string') {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }
  return sa;
}

function getCredential() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    try {
      const sa = parseServiceAccountJson(fs.readFileSync(credPath, 'utf8'));
      console.log('[FirebaseAdmin] Loaded service account from file:', credPath);
      return cert(sa);
    } catch (e) {
      console.error('[FirebaseAdmin] Failed to parse service account JSON file:', e);
    }
  }

  const credJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (credJson && credJson.trim()) {
    try {
      const sa = parseServiceAccountJson(credJson);
      console.log('[FirebaseAdmin] Loaded service account from environment variable');
      return cert(sa);
    } catch (e) {
      console.error('[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY env var:', e);
    }
  }

  const fallbackPaths = ['./secrets/serviceAccountKey.json', './serviceAccountKey.json'];
  for (const p of fallbackPaths) {
    if (fs.existsSync(p)) {
      try {
        const sa = parseServiceAccountJson(fs.readFileSync(p, 'utf8'));
        console.log('[FirebaseAdmin] Loaded service account from fallback path:', p);
        return cert(sa);
      } catch (e) {
        console.error('[FirebaseAdmin] Failed to parse service account at:', p, e);
      }
    }
  }

  console.log('[FirebaseAdmin] No explicit service account key configured; using Firestore client SDK sync.');
  return undefined;
}

const credential = getCredential();

const appAdmin = getApps().length === 0 
  ? initializeApp(
      credential ? { credential, projectId } : { projectId }
    )
  : getApp();

export const adminDb = firestoreDatabaseId ? getFirestore(appAdmin, firestoreDatabaseId) : getFirestore(appAdmin);
export const adminAuth = getAuth(appAdmin);

// Reliable direct Firestore writer for ota_app_store using Firebase JS Client SDK
import { initializeApp as initClientApp, getApps as getClientApps } from 'firebase/app';
import { 
  getFirestore as getClientFirestore, 
  initializeFirestore as initClientFirestore, 
  memoryLocalCache as clientMemoryLocalCache,
  setLogLevel as setClientLogLevel,
  doc as clientDoc, 
  getDoc as clientGetDoc,
  setDoc as clientSetDoc, 
  deleteDoc as clientDeleteDoc,
  runTransaction as clientRunTransaction
} from 'firebase/firestore';

try {
  setClientLogLevel('silent');
} catch {}

const clientApp = getClientApps().length === 0
  ? initClientApp(firebaseConfigJson)
  : getClientApps()[0];

let clientDbInstance: any;
try {
  const clientOptions = {
    localCache: clientMemoryLocalCache(),
    experimentalForceLongPolling: true,
    useFetchStreams: false
  };
  clientDbInstance = firestoreDatabaseId
    ? initClientFirestore(clientApp, clientOptions, firestoreDatabaseId)
    : initClientFirestore(clientApp, clientOptions);
} catch {
  clientDbInstance = firestoreDatabaseId
    ? getClientFirestore(clientApp, firestoreDatabaseId)
    : getClientFirestore(clientApp);
}

export const clientDb = clientDbInstance;
export const hasAdminCredentials = !!credential;

export async function getOtaStoreDocFromFirestore(key: string): Promise<any | undefined> {
  try {
    if (credential && adminDb) {
      const snap = await adminDb.collection('ota_app_store').doc(key).get();
      return snap.exists ? snap.data()?.payload : undefined;
    }
    if (clientDb) {
      const snap = await clientGetDoc(clientDoc(clientDb, 'ota_app_store', key));
      return snap.exists() ? snap.data()?.payload : undefined;
    }
    return undefined;
  } catch (err) {
    console.warn(`[Firestore Cloud Sync] getOtaStoreDocFromFirestore(${key}) notice:`, err);
    return undefined;
  }
}

export async function syncOtaStoreDocToFirestore(key: string, payload: any): Promise<boolean> {
  try {
    let cleanPayload = JSON.parse(JSON.stringify(payload ?? null));
    if (key === 'app_state' && cleanPayload && typeof cleanPayload === 'object' && cleanPayload.keys) {
      // Prevent 1MB limit exceed: individual documents store timetables & history authoritatively
      const shallowKeys = { ...cleanPayload.keys };
      delete shallowKeys.ota_timetable_v2;
      delete shallowKeys.ota_timetable_published_v2;
      delete shallowKeys.ota_history_v2;
      cleanPayload = { ...cleanPayload, keys: shallowKeys };
    }
    const now = Date.now();
    if (credential && adminDb) {
      await adminDb.collection('ota_app_store').doc(key).set({
        payload: cleanPayload,
        updatedAt: now
      });
      return true;
    }
    if (clientDb) {
      await clientSetDoc(clientDoc(clientDb, 'ota_app_store', key), {
        payload: cleanPayload,
        updatedAt: now
      });
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`[Firestore Cloud Sync] syncOtaStoreDocToFirestore(${key}) notice:`, err);
    return false;
  }
}

export async function updateOtaStoreListInFirestore<T = any>(
  key: string,
  mutator: (currentList: T[]) => T[]
): Promise<T[] | null> {
  const now = Date.now();
  const normalizeList = (raw: any): T[] => {
    if (Array.isArray(raw)) return raw.filter((i: any) => i !== null && i !== undefined);
    if (raw && typeof raw === 'object') return Object.values(raw).filter((i: any) => i !== null && i !== undefined) as T[];
    return [];
  };

  try {
    if (credential && adminDb) {
      const docRef = adminDb.collection('ota_app_store').doc(key);
      const updated = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        const current = snap.exists ? normalizeList(snap.data()?.payload) : [];
        const next = JSON.parse(JSON.stringify(mutator([...current])));
        tx.set(docRef, { payload: next, updatedAt: now });
        return next;
      });
      return updated;
    }
    if (clientDb) {
      const docRef = clientDoc(clientDb, 'ota_app_store', key);
      const updated = await clientRunTransaction(clientDb, async (tx) => {
        const snap = await tx.get(docRef);
        const current = snap.exists() ? normalizeList(snap.data()?.payload) : [];
        const next = JSON.parse(JSON.stringify(mutator([...current])));
        tx.set(docRef, { payload: next, updatedAt: now });
        return next;
      });
      return updated;
    }
    return null;
  } catch (err) {
    console.warn(`[Firestore Cloud Sync] updateOtaStoreListInFirestore(${key}) notice:`, err);
    return null;
  }
}

export async function deleteOtaStoreDocFromFirestore(key: string): Promise<boolean> {
  try {
    if (credential && adminDb) {
      await adminDb.collection('ota_app_store').doc(key).delete();
      return true;
    }
    if (clientDb) {
      await clientDeleteDoc(clientDoc(clientDb, 'ota_app_store', key));
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`[Firestore Cloud Sync] deleteOtaStoreDocFromFirestore(${key}) notice:`, err);
    return false;
  }
}

export async function syncSchoolDocToFirestore(school: any): Promise<boolean> {
  try {
    if (!school || !school.id) return false;
    const cleanSchool = JSON.parse(JSON.stringify(school));
    if (credential && adminDb) {
      await adminDb.collection('schools').doc(school.id).set(cleanSchool);
      return true;
    }
    if (clientDb) {
      await clientSetDoc(clientDoc(clientDb, 'schools', school.id), cleanSchool);
      return true;
    }
    return false;
  } catch (err) {
    console.info(`[Firestore Cloud Sync] syncSchoolDocToFirestore(${school?.id}) handled:`, err);
    return false;
  }
}

export async function deleteSchoolDocFromFirestore(schoolId: string): Promise<boolean> {
  try {
    if (!schoolId) return false;
    if (credential && adminDb) {
      await adminDb.collection('schools').doc(schoolId).delete();
      return true;
    }
    if (clientDb) {
      await clientDeleteDoc(clientDoc(clientDb, 'schools', schoolId));
      return true;
    }
    return false;
  } catch (err) {
    console.info(`[Firestore Cloud Sync] deleteSchoolDocFromFirestore(${schoolId}) handled:`, err);
    return false;
  }
}

export default appAdmin;


