import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import firebaseConfigJson from '../firebase-applet-config.json' with { type: 'json' };

const projectId = process.env.VITE_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId || 'ota-smart-timetable';
const firestoreDatabaseId = firebaseConfigJson.firestoreDatabaseId;

function getCredential() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    try {
      const sa = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      console.log('[FirebaseAdmin] Loaded service account from file:', credPath);
      return cert(sa);
    } catch (e) {
      console.error('[FirebaseAdmin] Failed to parse service account JSON file:', e);
    }
  }

  const credJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (credJson) {
    try {
      const sa = JSON.parse(credJson);
      console.log('[FirebaseAdmin] Loaded service account from environment JSON string');
      return cert(sa);
    } catch (e) {
      console.error('[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY env var:', e);
    }
  }

  const fallbackPaths = ['./secrets/serviceAccountKey.json', './serviceAccountKey.json'];
  for (const p of fallbackPaths) {
    if (fs.existsSync(p)) {
      try {
        const sa = JSON.parse(fs.readFileSync(p, 'utf8'));
        console.log('[FirebaseAdmin] Loaded service account from fallback path:', p);
        return cert(sa);
      } catch (e) {
        console.error('[FirebaseAdmin] Failed to parse service account at:', p, e);
      }
    }
  }

  console.warn('[FirebaseAdmin] No explicit service account key found. Falling back to ambient default credentials.');
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
import { getFirestore as getClientFirestore, doc as clientDoc, setDoc as clientSetDoc, deleteDoc as clientDeleteDoc } from 'firebase/firestore';

const clientApp = getClientApps().length === 0
  ? initClientApp(firebaseConfigJson)
  : getClientApps()[0];

export const clientDb = firestoreDatabaseId
  ? getClientFirestore(clientApp, firestoreDatabaseId)
  : getClientFirestore(clientApp);

export async function syncOtaStoreDocToFirestore(key: string, payload: any): Promise<boolean> {
  try {
    const cleanPayload = JSON.parse(JSON.stringify(payload ?? null));
    const now = Date.now();
    await clientSetDoc(clientDoc(clientDb, 'ota_app_store', key), {
      payload: cleanPayload,
      updatedAt: now
    });
    return true;
  } catch (err) {
    console.warn(`[Firestore Cloud Sync] syncOtaStoreDocToFirestore(${key}) notice:`, err);
    return false;
  }
}

export async function deleteOtaStoreDocFromFirestore(key: string): Promise<boolean> {
  try {
    await clientDeleteDoc(clientDoc(clientDb, 'ota_app_store', key));
    return true;
  } catch (err) {
    console.warn(`[Firestore Cloud Sync] deleteOtaStoreDocFromFirestore(${key}) notice:`, err);
    return false;
  }
}

export async function syncSchoolDocToFirestore(school: any): Promise<boolean> {
  try {
    if (!school || !school.id) return false;
    const cleanSchool = JSON.parse(JSON.stringify(school));
    if (adminDb) {
      try {
        await adminDb.collection('schools').doc(school.id).set(cleanSchool);
        return true;
      } catch (adminErr) {
        // Fallback to clientDb
      }
    }
    await clientSetDoc(clientDoc(clientDb, 'schools', school.id), cleanSchool);
    return true;
  } catch (err) {
    console.info(`[Firestore Cloud Sync] syncSchoolDocToFirestore(${school?.id}) handled:`, err);
    return false;
  }
}

export async function deleteSchoolDocFromFirestore(schoolId: string): Promise<boolean> {
  try {
    if (!schoolId) return false;
    if (adminDb) {
      try {
        await adminDb.collection('schools').doc(schoolId).delete();
        return true;
      } catch (adminErr) {
        // Fallback to clientDb
      }
    }
    await clientDeleteDoc(clientDoc(clientDb, 'schools', schoolId));
    return true;
  } catch (err) {
    console.info(`[Firestore Cloud Sync] deleteSchoolDocFromFirestore(${schoolId}) handled:`, err);
    return false;
  }
}

export default appAdmin;

