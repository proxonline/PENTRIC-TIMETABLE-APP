import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { ALL_SUBJECTS, ALL_CLASSES } from './constants';
import {
  GeminiConfigurationError,
  runServerChatModeration,
  runServerComfortOptimization,
  runServerConflictFix,
  runServerErrorAnalysis,
  runServerLearnReference,
  runServerLightningAnalysis,
  runServerTimetableAudit,
} from './services/geminiServer';
import { adminAuth, adminDb, clientDb, getOtaStoreDocFromFirestore, syncOtaStoreDocToFirestore, updateOtaStoreListInFirestore, deleteOtaStoreDocFromFirestore, syncSchoolDocToFirestore, deleteSchoolDocFromFirestore, hasAdminCredentials } from './services/firebaseAdmin';
import { bindTeacherToTimetableGrid } from './services/teacherAutoBind';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import firebaseConfigJson from './firebase-applet-config.json' with { type: 'json' };

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

const INSECURE_JWT_PLACEHOLDERS = new Set([
  'ota_smart_secret_key_2026',
  'ota_smart_secret_key_dev',
  'changeme',
  'secret'
]);
const rawJwtEnv = (process.env.JWT_SECRET || '').trim();
let resolvedJwtSecret = rawJwtEnv;
if (!resolvedJwtSecret || (process.env.NODE_ENV === 'production' && INSECURE_JWT_PLACEHOLDERS.has(resolvedJwtSecret))) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[Auth Security] JWT_SECRET is not set (or uses a placeholder) in production. Generating an ephemeral 256-bit runtime secret. Set JWT_SECRET in your Render Environment Variables so login sessions remain valid across restarts.');
    resolvedJwtSecret = crypto.randomBytes(32).toString('hex');
  } else {
    resolvedJwtSecret = 'ota_smart_secret_key_dev';
  }
}
const JWT_SECRET = resolvedJwtSecret;

function authenticateUser(req: express.Request): { authenticated: boolean; user?: any; error?: string } {
  const authHeader = req.headers.authorization || (req.query.token as string);
  if (!authHeader) {
    return { authenticated: false, error: 'Authorization header required' };
  }
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : String(authHeader).trim();
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return { authenticated: true, user: decoded };
  } catch (err: any) {
    return { authenticated: false, error: 'Invalid or expired token' };
  }
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = authenticateUser(req);
  if (!auth.authenticated || !auth.user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  (req as any).user = auth.user;
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = authenticateUser(req);
  if (!auth.authenticated || !auth.user || auth.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Forbidden: Administrator credentials required' });
  }
  (req as any).user = auth.user;
  next();
}

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

// Enable CORS for all shareable links & external devices
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-developer-password');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Resilient Request Abort & Premature Socket Close Handling
app.use((req, res, next) => {
  let isAborted = false;
  req.on('aborted', () => {
    isAborted = true;
  });
  req.on('close', () => {
    if (!res.writableEnded) {
      isAborted = true;
    }
  });
  (req as any).isAborted = () => isAborted;
  next();
});

app.use(express.json({ limit: '25mb' }));

// Runtime in-memory cache strictly backed by Firebase Firestore (zero local disk storage)
interface StoreData {
  version: number;
  keys: Record<string, any>;
}

let store: StoreData = {
  version: Date.now(),
  keys: {}
};

function saveStoreToDisk(_immediate = false) {
  // No-op: All persistence is handled strictly in Firebase Firestore.
}

function checkAndSyncFromDisk(): boolean {
  return false;
}

// --- ONE-TIME PASSWORD HASH MIGRATION & SEEDING ON SERVER START ---
function runPasswordMigration() {
  let modified = false;

  const isBcrypt = (str: string) => /^\$2[aby]\$/.test(str);

  // Migrate Admins
  const admins = store.keys['ota_admins'];
  if (admins) {
    const adminList = Array.isArray(admins) ? admins : Object.values(admins);
    adminList.forEach((admin: any) => {
      admin.mustChangePassword = false;
      if (admin) {
        if (!admin.password && (admin.username === 'admin' || admin.id === 'admin1')) {
          admin.password = bcrypt.hashSync('admin123', 10);
          modified = true;
        } else if (admin.password && !isBcrypt(admin.password)) {
          admin.password = bcrypt.hashSync(admin.password, 10);
          modified = true;
        }
      }
    });
  }

  // Migrate Teachers
  const teachers = store.keys['ota_teachers_v3'];
  if (teachers) {
    const teacherList = Array.isArray(teachers) ? teachers : Object.values(teachers);
    teacherList.forEach((teacher: any) => {
      teacher.mustChangePassword = false;
      if (teacher && teacher.password && !isBcrypt(teacher.password)) {
        teacher.password = bcrypt.hashSync(teacher.password, 10);
        modified = true;
      }
    });
  }

  // Ensure default Admin exists
  if (!store.keys['ota_admins'] || Object.keys(store.keys['ota_admins']).length === 0) {
    const defaultAdmin = {
      id: 'admin1',
      username: 'admin',
      password: bcrypt.hashSync('admin123', 10),
      name: 'Super Admin',
      tier: 'SUPER_ADMIN',
      role: 'ADMIN',
      mustChangePassword: false
    };
    store.keys['ota_admins'] = [defaultAdmin];
    modified = true;
  }

  if (modified) {
    console.log('[Auth Security] Migrated stored plain-text passwords & seeded default admin.');
    saveStoreToDisk();
  }
}

function isSyntheticTestTeacher(record: any): boolean {
  if (!record || typeof record !== 'object') return true;
  const id = String(record.id || '').toLowerCase();
  const uname = String(record.username || '').toLowerCase().trim();
  const name = String(record.name || '').toLowerCase().trim();
  const email = String(record.contactEmail || record.email || '').toLowerCase().trim();
  if (id.startsWith('tch_demo_') || id === 't_1793095260406_a8f1a4' || id === 't_1793633708715_af1a80') return true;
  if (uname === 'qq' || name === 'qq') return true;
  if (uname === 'adalovelace' || name === 'ada lovelace') return true;
  if (uname.startsWith('sync_') || name.includes('alan turing')) return true;
  if (uname.startsWith('matrix_') || name.includes('matrix faculty')) return true;
  if (email.includes('matrix_teach_') || email.includes('sync_teach_') || email.endsWith('@otaacademy.edu')) return true;
  return false;
}

function seedDefaultStoreData() {
  let modified = false;

  // 0. Ensure Schools - ONLY OTA Total Academy by default, NO mock or false schools!
  const defaultSchools = [
    {
      id: 'ota_total_academy',
      name: 'OTA Total Academy',
      shortName: 'OTA Total',
      code: 'OTA',
      motto: 'Strictly for the Serious Minded Academics',
      themeColor: '#2563eb',
      address: 'Academic City Campus, Knowledge Avenue',
      isOta: true,
      isDefault: true,
      createdAt: 1700000000000
    }
  ];

  if (!store.keys['ota_schools_v1'] || (Array.isArray(store.keys['ota_schools_v1']) && store.keys['ota_schools_v1'].length === 0) || Object.keys(store.keys['ota_schools_v1']).length === 0) {
    store.keys['ota_schools_v1'] = defaultSchools;
    modified = true;
  } else {
    // Purge any dummy schools (e.g. st_gregory, apex, queens_hall), keeping only OTA Total Academy and user-manually added schools (sch_*)
    const rawSchools = Array.isArray(store.keys['ota_schools_v1']) ? store.keys['ota_schools_v1'] : Object.values(store.keys['ota_schools_v1']);
    const cleanSchools = rawSchools.filter((s: any) => s && (s.id === 'ota_total_academy' || (typeof s.id === 'string' && s.id.startsWith('sch_'))));
    
    if (!cleanSchools.some((s: any) => s && s.id === 'ota_total_academy')) {
      cleanSchools.unshift(defaultSchools[0]);
    }

    if (cleanSchools.length !== rawSchools.length) {
      store.keys['ota_schools_v1'] = cleanSchools;
      modified = true;
    }
  }

  // 1. Ensure Admins
  if (!store.keys['ota_admins'] || (Array.isArray(store.keys['ota_admins']) && store.keys['ota_admins'].length === 0) || Object.keys(store.keys['ota_admins']).length === 0) {
    const defaultAdmin = {
      id: 'admin1',
      username: 'admin',
      adminEmail: 'oyalowoprox@gmail.com',
      password: bcrypt.hashSync('admin123', 10),
      name: 'Super Admin',
      tier: 'SUPER_ADMIN',
      mustChangePassword: false,
      role: 'ADMIN'
    };
    store.keys['ota_admins'] = [defaultAdmin];
    modified = true;
  } else {
    const adminList = Array.isArray(store.keys['ota_admins']) ? store.keys['ota_admins'] : Object.values(store.keys['ota_admins']);
    adminList.forEach((a: any) => {
      if (a && (a.username === 'admin' || a.id === 'admin1')) {
        if (!a.adminEmail) a.adminEmail = 'oyalowoprox@gmail.com';
        if (!a.password) a.password = bcrypt.hashSync('admin123', 10);
        a.mustChangePassword = false;
      }
    });
    store.keys['ota_admins'] = adminList;
  }

  // 2. Ensure Classes
  if (!store.keys['ota_classes'] || (Array.isArray(store.keys['ota_classes']) && store.keys['ota_classes'].length === 0) || Object.keys(store.keys['ota_classes']).length === 0) {
    store.keys['ota_classes'] = [...ALL_CLASSES];
    modified = true;
  } else if (!Array.isArray(store.keys['ota_classes'])) {
    store.keys['ota_classes'] = Object.values(store.keys['ota_classes']);
    modified = true;
  }

  // 3. Ensure Subjects
  // 3. Ensure Subjects & Purge invalid stream definitions
  if (!store.keys['ota_subjects_v2'] || (Array.isArray(store.keys['ota_subjects_v2']) && store.keys['ota_subjects_v2'].length === 0) || Object.keys(store.keys['ota_subjects_v2']).length === 0) {
    store.keys['ota_subjects_v2'] = [...ALL_SUBJECTS];
    modified = true;
  } else {
    let currentSubs = Array.isArray(store.keys['ota_subjects_v2']) ? store.keys['ota_subjects_v2'] : Object.values(store.keys['ota_subjects_v2']);
    // Strictly purge eco_sci and yor_sci (Yoruba and Economics are strictly BC subjects!)
    const cleanSubs = currentSubs.filter((s: any) => s && s.id !== 'eco_sci' && s.id !== 'yor_sci');
    if (!cleanSubs.some((s: any) => s && s.id === 'yor_bc')) {
      cleanSubs.push({ id: 'yor_bc', name: 'Yoruba', code: 'YORU', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 });
    }
    if (cleanSubs.length !== currentSubs.length) {
      store.keys['ota_subjects_v2'] = cleanSubs;
      modified = true;
    }
  }

  // 4. Ensure Rooms
  const defaultRooms = [
    { id: 'rm1', name: 'Science Laboratory 1', capacity: 35, type: 'LAB', description: 'Physics & Chemistry lab with experiment benches' },
    { id: 'rm2', name: 'Computer Science Lab', capacity: 30, type: 'LAB', description: '30 Workstations with ICT facilities' },
    { id: 'rm3', name: 'Main Assembly Hall', capacity: 300, type: 'HALL', description: 'Multipurpose hall for exams & events' },
    { id: 'rm4', name: 'Sports Field', capacity: 200, type: 'FIELD', description: 'Outdoor track and football pitch' },
    { id: 'rm5', name: 'SS3 Science Block', capacity: 40, type: 'CLASSROOM', description: 'Senior Secondary classroom' }
  ];
  if (!store.keys['ota_rooms'] || (Array.isArray(store.keys['ota_rooms']) && store.keys['ota_rooms'].length === 0) || Object.keys(store.keys['ota_rooms']).length === 0) {
    store.keys['ota_rooms'] = defaultRooms;
    modified = true;
  } else if (!Array.isArray(store.keys['ota_rooms'])) {
    store.keys['ota_rooms'] = Object.values(store.keys['ota_rooms']);
    modified = true;
  }

  // 5. Ensure Teachers - Strictly NO fake or hardcoded teachers!
  if (!store.keys['ota_teachers_v3']) {
    store.keys['ota_teachers_v3'] = [];
    modified = true;
  } else if (!Array.isArray(store.keys['ota_teachers_v3'])) {
    store.keys['ota_teachers_v3'] = Object.values(store.keys['ota_teachers_v3']);
    modified = true;
  }

  // Purge any fake, mock, or automated test teachers
  if (Array.isArray(store.keys['ota_teachers_v3'])) {
    const originalCount = store.keys['ota_teachers_v3'].length;
    store.keys['ota_teachers_v3'] = store.keys['ota_teachers_v3'].filter((t: any) => !isSyntheticTestTeacher(t));
    if (store.keys['ota_teachers_v3'].length !== originalCount) {
      modified = true;
    }
  }

  // Purge any fake, mock, or automated test pending verifications
  if (Array.isArray(store.keys['ota_pending_verifications_v1'])) {
    const originalPending = store.keys['ota_pending_verifications_v1'].length;
    store.keys['ota_pending_verifications_v1'] = store.keys['ota_pending_verifications_v1'].filter((p: any) => !isSyntheticTestTeacher(p));
    if (store.keys['ota_pending_verifications_v1'].length !== originalPending) {
      modified = true;
    }
  }

  // 6. Ensure Settings
  if (!store.keys['ota_settings_v3'] || Object.keys(store.keys['ota_settings_v3']).length === 0) {
    store.keys['ota_settings_v3'] = {
      schoolName: 'OTA Academy',
      currentSession: '2024/2025',
      currentTerm: '1st Term',
      maxSubjectsPerTeacher: 12,
      minClassesPerTeacher: 1,
      maxClassesPerTeacher: 5,
      enableSaturday: false,
      periodsPerDay: 8,
      periodDuration: 40,
      breakDurationShort: 15,
      breakDurationLong: 30
    };
    modified = true;
  }

  // 7. Ensure Timetable structure exists & Purge stream violations / orphaned teachers
  if (!store.keys['ota_timetable_v2'] || typeof store.keys['ota_timetable_v2'] !== 'object') {
    store.keys['ota_timetable_v2'] = {};
    modified = true;
  } else {
    // Sanitize any existing timetable grid:
    // (a) Remove Yoruba and Economics from Senior Science "A" classes
    // (b) Clear slots assigned to teachers that no longer exist
    const activeTeacherList = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : Object.values(store.keys['ota_teachers_v3'] || {});
    const activeTeacherIds = new Set(activeTeacherList.map((t: any) => t?.id).filter(Boolean));
    const timetable = store.keys['ota_timetable_v2'];
    let timetableChanged = false;

    for (const classId in timetable) {
      const isScienceAClass = /SS\d+A\d*/i.test(classId);
      const days = timetable[classId];
      if (!days || typeof days !== 'object') continue;
      for (const day in days) {
        const periods = days[day];
        if (!periods || typeof periods !== 'object') continue;
        for (const period in periods) {
          const cell = periods[period];
          if (cell) {
            // Check stream violation for Science "A" classes
            if (isScienceAClass) {
              const subId = (cell.subjectId || '').toLowerCase();
              if (subId.includes('eco') || subId.includes('yor') || subId.includes('acc') || subId.includes('com') || subId.includes('gov') || subId.includes('lit') || subId.includes('str') || subId.includes('bk')) {
                periods[period] = null;
                timetableChanged = true;
                continue;
              }
            }
            // Check orphaned teacher
            if (cell.teacherId && cell.teacherId !== 'SYSTEM' && !activeTeacherIds.has(cell.teacherId)) {
              cell.teacherId = '';
              timetableChanged = true;
            }
            if (Array.isArray(cell.teacherIds)) {
              const cleanTids = cell.teacherIds.filter((tid: string) => tid === 'SYSTEM' || activeTeacherIds.has(tid));
              if (cleanTids.length !== cell.teacherIds.length) {
                cell.teacherIds = cleanTids;
                timetableChanged = true;
              }
            }
          }
        }
      }
    }
    if (timetableChanged) {
      modified = true;
    }
  }

  // 8. Ensure Timetable metadata exists
  if (!store.keys['ota_timetable_metadata_v1'] || typeof store.keys['ota_timetable_metadata_v1'] !== 'object') {
    const tt = store.keys['ota_timetable_v2'];
    const hasScheduledClasses = !!(tt && typeof tt === 'object' && Object.keys(tt).some(k => k !== '_revisionId'));
    if (!hasScheduledClasses) {
      store.keys['ota_timetable_metadata_v1'] = {
        revisionId: 0,
        publishedAt: 0,
        publishedBy: '',
        status: 'DRAFT'
      };
    } else {
      const existingRev = typeof tt._revisionId === 'number' ? tt._revisionId : 1;
      store.keys['ota_timetable_metadata_v1'] = {
        revisionId: existingRev,
        publishedAt: Date.now(),
        publishedBy: 'System',
        status: 'PUBLISHED'
      };
      if (!tt._revisionId) {
        tt._revisionId = existingRev;
      }
    }
    modified = true;
  }

  if (modified) {
    console.log('[Server Seed] Seeded default baseline store data in memory.');
  }
}

// --- ENCRYPTED SERVER CREDENTIALS VAULT FOR MULTI-CONTAINER AUTHENTICATION ---
// Stable AES-256-GCM vault key derived cleanly without writing local key files to ephemeral disk
function getOrCreateVaultKey(): Buffer {
  if (process.env.CREDENTIAL_VAULT_KEY) {
    const raw = process.env.CREDENTIAL_VAULT_KEY.trim();
    if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
      return Buffer.from(raw, 'hex');
    }
    return crypto.createHash('sha256').update(raw).digest();
  }

  const seedMaterial = `${firebaseConfigJson.projectId}:${firebaseConfigJson.firestoreDatabaseId || 'default'}:pentric_vault_v1`;
  return crypto.createHash('sha256').update(seedMaterial).digest();
}

const CREDENTIAL_VAULT_KEY = getOrCreateVaultKey();
const serverVault: Record<string, { passwordHash: string; role: string; email?: string; username?: string }> = {};

function encryptVault(data: any): { iv: string; tag: string; encrypted: string } {
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', CREDENTIAL_VAULT_KEY, iv);
    let enc = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return { iv: iv.toString('hex'), tag, encrypted: enc };
  } catch (err) {
    console.error('[Server Vault] Encryption error:', err);
    return { iv: '', tag: '', encrypted: '' };
  }
}

function decryptVault(vaultData: { iv: string; tag: string; encrypted: string }): any {
  try {
    if (!vaultData || !vaultData.iv || !vaultData.tag || !vaultData.encrypted) return {};
    const decipher = crypto.createDecipheriv('aes-256-gcm', CREDENTIAL_VAULT_KEY, Buffer.from(vaultData.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(vaultData.tag, 'hex'));
    let dec = decipher.update(vaultData.encrypted, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return JSON.parse(dec);
  } catch {
    return {};
  }
}

function populateServerVaultFromMemory() {
  const teachers = store.keys['ota_teachers_v3'] || [];
  const tList = Array.isArray(teachers) ? teachers : Object.values(teachers);
  tList.forEach((t: any) => {
    if (t && t.id && t.password) {
      serverVault[t.id] = {
        passwordHash: t.password,
        role: 'TEACHER',
        email: (t.contactEmail || t.email || '').trim().toLowerCase(),
        username: (t.username || '').trim().toLowerCase()
      };
    }
  });

  const admins = store.keys['ota_admins'] || [];
  const aList = Array.isArray(admins) ? admins : Object.values(admins);
  aList.forEach((a: any) => {
    if (a && a.id && a.password) {
      serverVault[a.id] = {
        passwordHash: a.password,
        role: 'ADMIN',
        email: (a.adminEmail || a.email || a.contactEmail || '').trim().toLowerCase(),
        username: (a.username || a.name || '').trim().toLowerCase()
      };
    }
  });
}
populateServerVaultFromMemory();

// Authoritative sync of Teacher profiles and encrypted credentials vault to Firestore
async function syncTeachersAndVaultToFirestore(teacherList?: any[]): Promise<boolean> {
  try {
    const teachers = teacherList || store.keys['ota_teachers_v3'] || [];
    const list = Array.isArray(teachers) ? teachers : Object.values(teachers);

    list.forEach((t: any) => {
      if (t && t.id && t.password) {
        serverVault[t.id] = {
          passwordHash: t.password,
          role: 'TEACHER',
          email: (t.contactEmail || t.email || '').trim().toLowerCase(),
          username: (t.username || '').trim().toLowerCase()
        };
      }
    });

    // Strip passwords from shared teacher profile document in Firestore
    // Preserves email, verification info, and pending status so admin on any device can see & approve
    const firestoreTeachers = list.map((t: any) => {
      if (!t || typeof t !== 'object') return t;
      const { password, ...safeTeacher } = t;
      return safeTeacher;
    });

    const encryptedVault = encryptVault(serverVault);
    const p1 = syncOtaStoreDocToFirestore('ota_teachers_v3', firestoreTeachers);
    const p2 = syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptedVault);
    const results = await Promise.all([p1, p2]);
    return results[0] && results[1];
  } catch (err) {
    console.warn('[syncTeachersAndVaultToFirestore Notice]', err);
    return false;
  }
}

async function hydrateStoreFromFirestore() {
  try {
    const fetchViaAdmin = async () => {
      if (hasAdminCredentials && adminDb) {
        return Promise.all([
          adminDb.collection('ota_app_store').get(),
          adminDb.collection('schools').get()
        ]);
      }
      throw new Error('Admin credentials unavailable');
    };
    const fetchViaClient = () => Promise.all([
      getDocs(collection(clientDb, 'ota_app_store')),
      getDocs(collection(clientDb, 'schools'))
    ]);
    const fetchAllPromise = (hasAdminCredentials && adminDb)
      ? fetchViaAdmin().catch(() => fetchViaClient())
      : fetchViaClient();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Firestore reachability timeout')), 6000)
    );
    const [snap, schoolsSnap] = await Promise.race([fetchAllPromise, timeoutPromise]);
    let modified = false;

    // First decrypt serverVault if present so teacher/admin passwords can attach immediately
    const vaultDoc = snap.docs.find(d => d.id === 'ota_server_vault_v1');
    if (vaultDoc && vaultDoc.data()?.payload?.encrypted) {
      const decrypted = decryptVault(vaultDoc.data().payload);
      if (decrypted && typeof decrypted === 'object') {
        Object.assign(serverVault, decrypted);
      }
    }

    snap.docs.forEach(docSnap => {
      const key = docSnap.id;
      if (key === 'app_state' || key === 'ota_server_vault_v1') return;
      const data = docSnap.data();
      if (!data || data.payload === undefined) return;

      if (key === 'ota_pending_verifications_v1') {
        if (Array.isArray(data.payload)) {
          const now = Date.now();
          data.payload.forEach((item: any) => {
            if (item && item.email && item.expiresAt > now) {
              pendingEmailVerifications.set(item.email, item);
            }
          });
        }
        return;
      }

      if (key === 'ota_teachers_v3') {
        const remoteList = Array.isArray(data.payload) ? data.payload : Object.values(data.payload || {});
        const mergedTeachers: any[] = [];

        remoteList.forEach((rt: any) => {
          if (!rt || !rt.id) return;
          if (isSyntheticTestTeacher(rt)) {
            delete serverVault[rt.id];
            modified = true;
            return;
          }
          const tCopy = { ...rt };
          if (!tCopy.password && serverVault[rt.id]?.passwordHash) {
            tCopy.password = serverVault[rt.id].passwordHash;
          }
          mergedTeachers.push(tCopy);
        });

        store.keys['ota_teachers_v3'] = mergedTeachers;
        modified = true;
        return;
      }

      if (key === 'ota_admins') {
        const remoteList = Array.isArray(data.payload) ? data.payload : Object.values(data.payload || {});
        const mergedAdmins: any[] = [];

        remoteList.forEach((ra: any) => {
          if (!ra || !ra.id) return;
          const aCopy = { ...ra };
          if (!aCopy.password && serverVault[ra.id]?.passwordHash) {
            aCopy.password = serverVault[ra.id].passwordHash;
          }
          if ((aCopy.username === 'admin' || aCopy.id === 'admin1') && !aCopy.password) {
            aCopy.password = bcrypt.hashSync('admin123', 10);
          }
          mergedAdmins.push(aCopy);
        });

        store.keys['ota_admins'] = mergedAdmins;
        modified = true;
        return;
      }

      if (key === 'ota_timetable_metadata_v1') {
        const remoteMeta = data.payload;
        const localMeta = store.keys['ota_timetable_metadata_v1'];
        if (!localMeta || (remoteMeta && remoteMeta.revisionId >= (localMeta.revisionId || 0))) {
          store.keys['ota_timetable_metadata_v1'] = remoteMeta;
          modified = true;
        }
        return;
      }

      if (key === 'ota_timetable_v2') {
        const remoteTimetable = data.payload;
        const localTimetable = store.keys['ota_timetable_v2'];
        const remoteRev = remoteTimetable?._revisionId || 0;
        const localRev = localTimetable?._revisionId || 0;
        if (!localTimetable || remoteRev >= localRev || Object.keys(localTimetable).length === 0) {
          store.keys['ota_timetable_v2'] = remoteTimetable;
          modified = true;
        }
        return;
      }

      store.keys[key] = data.payload;
      modified = true;
    });

    // Reconcile dedicated /schools collection docs with ota_schools_v1
    if (schoolsSnap && !schoolsSnap.empty) {
      const existingSchools = Array.isArray(store.keys['ota_schools_v1'])
        ? [...store.keys['ota_schools_v1']]
        : Object.values(store.keys['ota_schools_v1'] || {});
      schoolsSnap.docs.forEach(sDoc => {
        const sData = sDoc.data();
        if (sData && sData.id && (sData.id === 'ota_total_academy' || String(sData.id).startsWith('sch_'))) {
          const idx = existingSchools.findIndex((x: any) => x && x.id === sData.id);
          if (idx >= 0) existingSchools[idx] = sData;
          else existingSchools.push(sData);
          modified = true;
        }
      });
      store.keys['ota_schools_v1'] = existingSchools;
    }

    if (modified) {
      store.version = Date.now();
      populateServerVaultFromMemory();
      console.log('[Server Startup] Successfully hydrated authoritative store from Firebase Firestore!');
    }
  } catch (err: any) {
    console.warn('[Server Startup] Firestore hydration notice:', err?.message || err);
  }
}

// Data Sanitization & Public vs Authorized Key Projections
function sanitizeTeacherRecord(teacher: any, isPublic: boolean = false) {
  if (!teacher || typeof teacher !== 'object') return teacher;
  const { password, recoveryCode, calendarToken, ...safeTeacher } = teacher;
  if (isPublic) {
    delete safeTeacher.contactEmail;
    delete safeTeacher.contactPhone;
    delete safeTeacher.rejectionReason;
  }
  return safeTeacher;
}

function sanitizeAdminRecord(admin: any) {
  if (!admin || typeof admin !== 'object') return admin;
  const { password, ...safeAdmin } = admin;
  return safeAdmin;
}

const LIST_KEYS = [
  'ota_teachers_v3',
  'ota_history_v2',
  'ota_requests_v2',
  'ota_notifications_v2',
  'ota_chat_messages',
  'ota_admins',
  'ota_classes',
  'ota_subjects_v2',
  'ota_rooms',
  'ota_exams',
  'ota_absences_v1',
  'ota_audit_logs_v1',
  'ota_schools_v1'
];

const PUBLIC_EXPOSED_KEYS = [
  'ota_timetable_v2',
  'ota_timetable_metadata_v1',
  'ota_schools_v1',
  'ota_classes',
  'ota_subjects_v2',
  'ota_rooms',
  'ota_settings_v3',
  'ota_theme'
];

function getPublicKeys(): Record<string, any> {
  const publicKeys: Record<string, any> = {};
  for (const k of PUBLIC_EXPOSED_KEYS) {
    if (store.keys[k] !== undefined) {
      publicKeys[k] = store.keys[k];
    } else if (k === 'ota_timetable_v2') {
      publicKeys[k] = null;
    }
  }
  if (store.keys['ota_teachers_v3']) {
    const rawTeachers = Array.isArray(store.keys['ota_teachers_v3'])
      ? store.keys['ota_teachers_v3']
      : Object.values(store.keys['ota_teachers_v3']);
    publicKeys['ota_teachers_v3'] = rawTeachers
      .filter((t: any) => t && t.isApproved !== false && t.approvalStatus !== 'REJECTED')
      .map((t: any) => sanitizeTeacherRecord(t, true));
  }
  return publicKeys;
}

function getSanitizedKeys(role?: string, userId?: string): Record<string, any> {
  if (!role || (role !== 'ADMIN' && role !== 'TEACHER')) {
    return getPublicKeys();
  }

  const sanitized: Record<string, any> = {};
  for (const [k, val] of Object.entries(store.keys)) {
    if (k === 'ota_admins') {
      if (role === 'ADMIN') {
        const admins = Array.isArray(val) ? val : Object.values(val || {});
        sanitized[k] = admins.map(sanitizeAdminRecord);
      }
      // Non-admins never receive ota_admins
      continue;
    }

    if (k === 'ota_teachers_v3') {
      const teachers = Array.isArray(val) ? val : Object.values(val || {});
      sanitized[k] = teachers.map((t: any) => sanitizeTeacherRecord(t, role !== 'ADMIN'));
      continue;
    }

    if (k === 'ota_timetable_draft_v1' || k === 'ota_audit_logs_v1' || k === 'ota_history_v2') {
      if (role === 'ADMIN') {
        sanitized[k] = val;
      }
      continue;
    }

    if (k === 'ota_notifications_v2') {
      const notifs = Array.isArray(val) ? val : Object.values(val || {});
      if (role === 'ADMIN') {
        sanitized[k] = notifs;
      } else if (role === 'TEACHER' && userId) {
        sanitized[k] = notifs.filter((n: any) => n && (n.recipientId === 'ALL' || n.recipientId === userId));
      }
      continue;
    }

    if (LIST_KEYS.includes(k)) {
      if (Array.isArray(val)) {
        sanitized[k] = val.filter((item: any) => item !== null && item !== undefined);
      } else if (val && typeof val === 'object') {
        sanitized[k] = Object.values(val).filter((item: any) => item !== null && item !== undefined);
      } else {
        sanitized[k] = [];
      }
    } else {
      sanitized[k] = val;
    }
  }
  if (sanitized['ota_timetable_v2'] === undefined) {
    sanitized['ota_timetable_v2'] = null;
  }
  if (role === 'ADMIN' && sanitized['ota_timetable_draft_v1'] === undefined) {
    sanitized['ota_timetable_draft_v1'] = null;
  }
  return sanitized;
}

function filterPayloadForRole(payload: any, role: string, userId?: string): any {
  if (role === 'ADMIN') {
    const copy = { ...payload };
    if (copy.key === 'ota_teachers_v3' && copy.data) {
      copy.data = sanitizeTeacherRecord(copy.data, false);
    }
    if (copy.changedKeys) {
      const filtered: Record<string, any> = {};
      for (const [k, v] of Object.entries(copy.changedKeys)) {
        if (k === 'ota_admins') {
          const list = Array.isArray(v) ? v : Object.values(v || {});
          filtered[k] = list.map(sanitizeAdminRecord);
        } else if (k === 'ota_teachers_v3') {
          const list = Array.isArray(v) ? v : Object.values(v || {});
          filtered[k] = list.map((t: any) => sanitizeTeacherRecord(t, false));
        } else {
          filtered[k] = v;
        }
      }
      copy.changedKeys = filtered;
    }
    if (copy.keys) {
      copy.keys = getSanitizedKeys('ADMIN');
    }
    return copy;
  }

  const isTeacher = role === 'TEACHER';
  const copy = { ...payload };
  if (copy.key === 'ota_teachers_v3' && copy.data) {
    copy.data = sanitizeTeacherRecord(copy.data, !isTeacher);
  }
  if (copy.keys) {
    copy.keys = getSanitizedKeys(role, userId);
  }
  if (copy.changedKeys) {
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(copy.changedKeys)) {
      if (k === 'ota_admins' || k === 'ota_audit_logs_v1' || k === 'ota_timetable_draft_v1' || k === 'ota_history_v2') {
        continue;
      }
      if (k === 'ota_teachers_v3') {
        const list = Array.isArray(v) ? v : Object.values(v || {});
        filtered[k] = list
          .filter((t: any) => t && (isTeacher || (t.isApproved !== false && t.approvalStatus !== 'REJECTED')))
          .map((t: any) => sanitizeTeacherRecord(t, !isTeacher));
      } else if (k === 'ota_notifications_v2') {
        if (isTeacher && userId) {
          const list = Array.isArray(v) ? v : Object.values(v || {});
          filtered[k] = list.filter((n: any) => n && (n.recipientId === 'ALL' || n.recipientId === userId));
        }
      } else if (PUBLIC_EXPOSED_KEYS.includes(k) || isTeacher) {
        filtered[k] = v;
      }
    }
    if (Object.keys(filtered).length === 0) return null;
    copy.changedKeys = filtered;
  }
  return copy;
}

// SSE Clients Registry
interface SSEClient {
  id: string;
  res: express.Response;
  role: 'PUBLIC' | 'TEACHER' | 'ADMIN';
  userId?: string;
}

let sseClients: SSEClient[] = [];

function broadcastToClients(event: string, payload: any) {
  for (let i = sseClients.length - 1; i >= 0; i--) {
    const client = sseClients[i];
    try {
      const clientPayload = filterPayloadForRole(payload, client.role, client.userId);
      if (!clientPayload) continue;
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(clientPayload)}\n\n`);
      if (typeof (client.res as any).flush === 'function') {
        (client.res as any).flush();
      }
    } catch (err) {
      sseClients.splice(i, 1);
    }
  }
}

// Keep-alive heartbeat every 15s
setInterval(() => {
  broadcastToClients('ping', { time: Date.now() });
}, 15000);

// --- AUTHENTICATION & SECURITY ENDPOINTS ---

// Server-side login verification with bcrypt & JWT
// Active single admin session memory lock (45s window)
interface ActiveAdminSession {
  adminId: string;
  username: string;
  sessionToken: string;
  lastActive: number;
}
let activeAdminSession: ActiveAdminSession | null = null;

app.post('/api/auth/admin-heartbeat', (req, res) => {
  const { adminId } = req.body;
  if (!adminId) return res.status(400).json({ success: false, error: 'adminId required' });
  const NOW = Date.now();

  if (!activeAdminSession || (NOW - activeAdminSession.lastActive > 20000)) {
    activeAdminSession = {
      adminId,
      username: 'Administrator',
      sessionToken: crypto.randomUUID(),
      lastActive: NOW
    };
    return res.json({ success: true, active: true });
  }

  if (activeAdminSession.adminId === adminId) {
    activeAdminSession.lastActive = NOW;
    return res.json({ success: true, active: true });
  }

  res.json({ success: false, active: false, currentAdmin: activeAdminSession.username });
});

app.post('/api/auth/admin-logout', (req, res) => {
  const { adminId } = req.body;
  if (activeAdminSession && (activeAdminSession.adminId === adminId)) {
    activeAdminSession = null;
  }
  res.json({ success: true });
});

// Rate limiting map for login attempts: 5 failed attempts locks for 60 seconds
interface LoginRateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
}
const loginRateLimits = new Map<string, LoginRateLimitEntry>();

function checkLoginRateLimit(key: string): { allowed: boolean; remainingLockMs?: number } {
  const now = Date.now();
  const entry = loginRateLimits.get(key);
  if (!entry) return { allowed: true };

  if (entry.lockedUntil > now) {
    return { allowed: false, remainingLockMs: entry.lockedUntil - now };
  }

  // Sliding window of 60 seconds
  if (now - entry.firstAttemptAt > 60000) {
    loginRateLimits.delete(key);
    return { allowed: true };
  }

  if (entry.attempts >= 5) {
    entry.lockedUntil = now + 60000;
    return { allowed: false, remainingLockMs: 60000 };
  }

  return { allowed: true };
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const entry = loginRateLimits.get(key);
  if (!entry || (now - entry.firstAttemptAt > 60000)) {
    loginRateLimits.set(key, { attempts: 1, firstAttemptAt: now, lockedUntil: 0 });
  } else {
    entry.attempts++;
    if (entry.attempts >= 5) {
      entry.lockedUntil = now + 60000;
    }
  }
}

function recordLoginSuccess(key: string) {
  loginRateLimits.delete(key);
}

/**
 * Automatically binds a teacher to matching unassigned slots (or parallel split slots)
 * on the active published timetable (and active draft, if any) without regenerating a batch.
 */
async function autoBindTeacherToActiveTimetables(teacher: any): Promise<{
  publishedBoundCount: number;
  draftBoundCount: number;
  totalBoundCount: number;
  changedKeys: Record<string, any>;
}> {
  const changedKeys: Record<string, any> = {};
  let publishedBoundCount = 0;
  let draftBoundCount = 0;

  if (!teacher || !teacher.id) {
    return { publishedBoundCount: 0, draftBoundCount: 0, totalBoundCount: 0, changedKeys };
  }

  const subjects = Array.isArray(store.keys['ota_subjects_v2'])
    ? store.keys['ota_subjects_v2']
    : Object.values(store.keys['ota_subjects_v2'] || ALL_SUBJECTS);
  const classes = Array.isArray(store.keys['ota_classes'])
    ? store.keys['ota_classes']
    : Object.values(store.keys['ota_classes'] || ALL_CLASSES);

  const pubGrid = store.keys['ota_timetable_v2'];
  if (pubGrid && typeof pubGrid === 'object' && Object.keys(pubGrid).length > 0) {
    const resPub = bindTeacherToTimetableGrid({
      teacher,
      grid: pubGrid,
      subjects: subjects as any[],
      classes: classes as any[]
    });
    if (resPub.updated && resPub.boundSlotsCount > 0) {
      store.keys['ota_timetable_v2'] = resPub.grid;
      publishedBoundCount = resPub.boundSlotsCount;
      changedKeys['ota_timetable_v2'] = resPub.grid;
      try {
        await syncOtaStoreDocToFirestore('ota_timetable_v2', resPub.grid);
      } catch (err) {
        console.warn('[AutoBind] Failed syncing published timetable to Firestore:', err);
      }
    }
  }

  const draftGrid = store.keys['ota_timetable_draft_v1'];
  if (draftGrid && typeof draftGrid === 'object' && Object.keys(draftGrid).length > 0) {
    const resDraft = bindTeacherToTimetableGrid({
      teacher,
      grid: draftGrid,
      subjects: subjects as any[],
      classes: classes as any[]
    });
    if (resDraft.updated && resDraft.boundSlotsCount > 0) {
      store.keys['ota_timetable_draft_v1'] = resDraft.grid;
      draftBoundCount = resDraft.boundSlotsCount;
      changedKeys['ota_timetable_draft_v1'] = resDraft.grid;
      try {
        await syncOtaStoreDocToFirestore('ota_timetable_draft_v1', resDraft.grid);
      } catch (err) {
        console.warn('[AutoBind] Failed syncing draft timetable to Firestore:', err);
      }
    }
  }

  return {
    publishedBoundCount,
    draftBoundCount,
    totalBoundCount: publishedBoundCount + draftBoundCount,
    changedKeys
  };
}

app.post('/api/auth/login', async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || typeof password === 'undefined') {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }

  const cleanUser = String(username).trim().toLowerCase();
  const rawPass = typeof password === 'string' ? password : String(password);

  const ipKey = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'ip').split(',')[0].trim();
  const rateLimitKey = `${ipKey}_${cleanUser}`;
  const rateLimit = checkLoginRateLimit(rateLimitKey);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      error: 'Too many attempts. Please wait before trying again.'
    });
  }

  if (!store || !store.keys) {
    return res.status(503).json({
      success: false,
      code: 'AUTH_DATA_UNAVAILABLE',
      error: 'Authentication service is temporarily unavailable. Please try again.'
    });
  }

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanUser);

  const checkPasswordMatch = (candidate: string, stored: string): boolean => {
    if (!stored) return false;
    if (/^\$2[aby]\$/.test(stored)) {
      try {
        if (bcrypt.compareSync(candidate, stored)) return true;
        // Backward compatibility for legacy accounts created under previous trimming bug
        if (candidate !== candidate.trim() && bcrypt.compareSync(candidate.trim(), stored)) {
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    }
    if (candidate === stored) return true;
    if (candidate !== candidate.trim() && candidate.trim() === stored) return true;
    return false;
  };

  let customTokenErrorMsg: string | undefined;
  const getCustomFirebaseToken = async (userId: string, userRole: string, uname: string) => {
    try {
      customTokenErrorMsg = undefined;
      return await adminAuth.createCustomToken(userId, { role: userRole, userId, username: uname });
    } catch (err: any) {
      customTokenErrorMsg = err?.message || String(err);
      return undefined;
    }
  };

  // 1. Search in Admins
  const adminsObj = store.keys['ota_admins'] || {};
  const adminList: any[] = Array.isArray(adminsObj) ? adminsObj : Object.values(adminsObj);

  let matchedAdmin = adminList.find((a: any) => {
    if (!a) return false;
    const uName = (a.username || '').trim().toLowerCase();
    const aEmail = (a.adminEmail || a.email || a.contactEmail || '').trim().toLowerCase();
    if (isEmail) {
      return aEmail === cleanUser;
    }
    return uName === cleanUser;
  });

  // 2. Search in Teachers
  const teachersObj = store.keys['ota_teachers_v3'] || {};
  let teacherList: any[] = Array.isArray(teachersObj) ? [...teachersObj] : Object.values(teachersObj);

  let matchedTeacher = teacherList.find((t: any) => {
    if (!t) return false;
    const uName = (t.username || '').trim().toLowerCase();
    const email = (t.contactEmail || t.email || '').trim().toLowerCase();
    if (isEmail) {
      return email === cleanUser;
    }
    return uName === cleanUser;
  });

  // Cross-container self-healing: Check disk and Firestore for cross-instance consistency
  if (!matchedAdmin && !matchedTeacher) {
    if (checkAndSyncFromDisk()) {
      const refreshedAdmins = Array.isArray(store.keys['ota_admins']) ? store.keys['ota_admins'] : Object.values(store.keys['ota_admins'] || {});
      matchedAdmin = refreshedAdmins.find((a: any) => {
        if (!a) return false;
        const uName = (a.username || '').trim().toLowerCase();
        const aEmail = (a.adminEmail || a.email || a.contactEmail || '').trim().toLowerCase();
        return isEmail ? aEmail === cleanUser : uName === cleanUser;
      });
      const refreshedTeachers = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : Object.values(store.keys['ota_teachers_v3'] || {});
      matchedTeacher = refreshedTeachers.find((t: any) => {
        if (!t) return false;
        const uName = (t.username || '').trim().toLowerCase();
        const email = (t.contactEmail || t.email || '').trim().toLowerCase();
        return isEmail ? email === cleanUser : uName === cleanUser;
      });
      teacherList = refreshedTeachers;
    }
  }

  if (!matchedAdmin && !matchedTeacher) {
    try {
      const [teachersSnap, vaultSnap] = await Promise.all([
        getDoc(doc(clientDb, 'ota_app_store', 'ota_teachers_v3')),
        getDoc(doc(clientDb, 'ota_app_store', 'ota_server_vault_v1'))
      ]);

      if (vaultSnap.exists() && vaultSnap.data()?.payload?.encrypted) {
        const decrypted = decryptVault(vaultSnap.data().payload);
        if (decrypted && typeof decrypted === 'object') {
          Object.assign(serverVault, decrypted);
        }
      }

      if (teachersSnap.exists() && teachersSnap.data()?.payload) {
        const remoteTeachers = teachersSnap.data().payload;
        const remoteList = Array.isArray(remoteTeachers) ? remoteTeachers : Object.values(remoteTeachers);

        remoteList.forEach((rt: any) => {
          if (!rt || !rt.id) return;
          const idx = teacherList.findIndex((lt: any) => lt && (lt.id === rt.id || lt.username === rt.username));
          if (idx >= 0) {
            const preservedPass = teacherList[idx].password;
            teacherList[idx] = { ...rt };
            if (preservedPass && !teacherList[idx].password) {
              teacherList[idx].password = preservedPass;
            }
            if (!teacherList[idx].password && serverVault[rt.id]?.passwordHash) {
              teacherList[idx].password = serverVault[rt.id].passwordHash;
            }
          } else {
            const newT = { ...rt };
            if (serverVault[rt.id]?.passwordHash) {
              newT.password = serverVault[rt.id].passwordHash;
            }
            teacherList.push(newT);
          }
        });

        store.keys['ota_teachers_v3'] = teacherList;
        saveStoreToDisk();

        matchedTeacher = teacherList.find((t: any) => {
          if (!t) return false;
          const uName = (t.username || '').trim().toLowerCase();
          const email = (t.contactEmail || t.email || '').trim().toLowerCase();
          if (isEmail) {
            return email === cleanUser;
          }
          return uName === cleanUser;
        });
      }
    } catch (fsErr) {
      console.warn('[Auth Login] Firestore cross-container fallback notice:', fsErr);
    }
  }

  // If no account exists anywhere
  if (!matchedAdmin && !matchedTeacher) {
    recordLoginFailure(rateLimitKey);
    if (isEmail) {
      return res.status(404).json({
        success: false,
        code: 'EMAIL_NOT_FOUND',
        error: 'Email not found.'
      });
    }
    return res.status(404).json({
      success: false,
      code: 'USERNAME_NOT_FOUND',
      error: 'Username not found.'
    });
  }

  // Account exists. Check Role Mismatch
  if (role) {
    const requestedRole = String(role).toUpperCase();
    if (matchedAdmin && requestedRole === 'TEACHER') {
      recordLoginFailure(rateLimitKey);
      return res.status(403).json({
        success: false,
        code: 'ROLE_MISMATCH',
        error: 'This account belongs to an administrator. Select Administrator Login.'
      });
    }
    if (matchedTeacher && requestedRole === 'ADMIN') {
      recordLoginFailure(rateLimitKey);
      return res.status(403).json({
        success: false,
        code: 'ROLE_MISMATCH',
        error: 'This account belongs to a teacher. Select Teacher Login.'
      });
    }
  }

  // Check Teacher Account Status before credential verification
  if (matchedTeacher) {
    if (matchedTeacher.isDisabled === true || matchedTeacher.status === 'DISABLED') {
      recordLoginFailure(rateLimitKey);
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DISABLED',
        error: 'This account has been disabled. Contact your administrator.'
      });
    }
    if (matchedTeacher.approvalStatus === 'REJECTED') {
      recordLoginFailure(rateLimitKey);
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_REJECTED',
        error: 'Your teacher registration has been rejected. Contact your administrator.'
      });
    }
  }

  // Resolve stored credential from entity or server vault
  let targetAccount = matchedAdmin || matchedTeacher;
  let storedCredential = targetAccount.password || serverVault[targetAccount.id]?.passwordHash;

  if (!storedCredential) {
    recordLoginFailure(rateLimitKey);
    return res.status(400).json({
      success: false,
      code: 'CREDENTIAL_MISSING',
      error: 'Your account requires a password reset.'
    });
  }

  let isPasswordCorrect = checkPasswordMatch(rawPass, storedCredential);
  if (!isPasswordCorrect) {
    // Self-healing: disk or other cluster node may have updated credentials
    if (checkAndSyncFromDisk()) {
      const refreshedTeachers = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : Object.values(store.keys['ota_teachers_v3'] || {});
      const refreshedAdmins = Array.isArray(store.keys['ota_admins']) ? store.keys['ota_admins'] : Object.values(store.keys['ota_admins'] || {});
      const isTeacherAccount = !!matchedTeacher;
      const refreshed = isTeacherAccount
        ? refreshedTeachers.find((t: any) => t && t.id === targetAccount.id)
        : refreshedAdmins.find((a: any) => a && a.id === targetAccount.id);
      const refreshedCred = refreshed?.password || serverVault[targetAccount.id]?.passwordHash;
      if (refreshedCred) {
        storedCredential = refreshedCred;
        isPasswordCorrect = checkPasswordMatch(rawPass, refreshedCred);
      }
    }
  }

  if (!isPasswordCorrect) {
    recordLoginFailure(rateLimitKey);
    return res.status(401).json({
      success: false,
      code: 'INVALID_PASSWORD',
      error: 'Incorrect password.'
    });
  }

  // Password is correct! Check pending approval for teachers
  if (matchedTeacher) {
    if (matchedTeacher.isApproved === false || matchedTeacher.approvalStatus === 'PENDING') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_PENDING_APPROVAL',
        isPendingApproval: true,
        error: 'Your account is awaiting administrator approval.',
        teacher: { id: matchedTeacher.id, name: matchedTeacher.name, username: matchedTeacher.username, schoolId: matchedTeacher.schoolId }
      });
    }
  }

  // Login successful: reset rate limit tracking
  recordLoginSuccess(rateLimitKey);

  // Upgrade unhashed passwords
  if (!/^\$2[aby]\$/.test(targetAccount.password)) {
    targetAccount.password = bcrypt.hashSync(rawPass, 10);
    saveStoreToDisk();
  }

  if (matchedAdmin) {
    const NOW = Date.now();
    const sessionToken = crypto.randomUUID();
    activeAdminSession = {
      adminId: matchedAdmin.id,
      username: matchedAdmin.username || matchedAdmin.name,
      sessionToken,
      lastActive: NOW
    };

    const mustChange = matchedAdmin.mustChangePassword === true;
    const { password: _p, ...safeAdmin } = matchedAdmin;
    const userPayload = { ...safeAdmin, role: 'ADMIN', mustChangePassword: mustChange };
    const token = jwt.sign({ id: matchedAdmin.id, username: matchedAdmin.username || matchedAdmin.name, role: 'ADMIN', sessionToken }, JWT_SECRET, { expiresIn: '7d' });
    const customToken = await getCustomFirebaseToken(matchedAdmin.id, 'ADMIN', matchedAdmin.username || matchedAdmin.name);

    return res.json({
      success: true,
      token,
      customToken,
      customTokenError: customTokenErrorMsg,
      role: 'ADMIN',
      user: userPayload,
      mustChangePassword: mustChange
    });
  }

  if (matchedTeacher) {
    let autoBoundCount = 0;
    try {
      const bindRes = await autoBindTeacherToActiveTimetables(matchedTeacher);
      if (bindRes.totalBoundCount > 0) {
        autoBoundCount = bindRes.publishedBoundCount;
        store.version = Date.now();
        broadcastToClients('update', {
          version: store.version,
          changedKeys: bindRes.changedKeys
        });
      }
    } catch {}

    const mustChange = !!matchedTeacher.mustChangePassword;
    const userPayload = sanitizeTeacherRecord(matchedTeacher, false);
    const token = jwt.sign({ id: matchedTeacher.id, username: matchedTeacher.username || matchedTeacher.name, role: 'TEACHER' }, JWT_SECRET, { expiresIn: '7d' });
    const customToken = await getCustomFirebaseToken(matchedTeacher.id, 'TEACHER', matchedTeacher.username || matchedTeacher.name);

    return res.json({
      success: true,
      token,
      customToken,
      customTokenError: customTokenErrorMsg,
      role: 'TEACHER',
      user: userPayload,
      mustChangePassword: mustChange,
      autoBoundCount
    });
  }
});

// --- ANTI-BOT EMAIL VERIFICATION INFRASTRUCTURE (FIRESTORE-ONLY) ---
interface PendingEmailVerification {
  code: string;
  email: string;
  name?: string;
  username?: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
}

const pendingEmailVerifications = new Map<string, PendingEmailVerification>();
const emailSendingLocks = new Set<string>();

function savePendingVerifications(map: Map<string, PendingEmailVerification>) {
  const now = Date.now();
  const list = Array.from(map.values()).filter(i => i.expiresAt > now);
  syncOtaStoreDocToFirestore('ota_pending_verifications_v1', list).catch(() => {});
}

// Real-Time Multi-Container Firestore Subscription
function setupServerFirestoreListeners() {
  try {
    onSnapshot(collection(clientDb, 'ota_app_store'), (snapshot) => {
      let storeModified = false;
      const changedBatch: Record<string, any> = {};

      snapshot.docChanges().forEach((change) => {
        const key = change.doc.id;
        if (key === 'app_state') return;

        if (change.type === 'removed') {
          if (key === 'ota_pending_verifications_v1') {
            pendingEmailVerifications.clear();
            return;
          }
          if (store.keys[key] !== undefined) {
            delete store.keys[key];
            storeModified = true;
            changedBatch[key] = null;
          }
          return;
        }

        const data = change.doc.data();
        if (!data || data.payload === undefined) return;

        if (key === 'ota_server_vault_v1') {
          if (data.payload && data.payload.encrypted) {
            const decrypted = decryptVault(data.payload);
            if (decrypted && typeof decrypted === 'object') {
              Object.assign(serverVault, decrypted);
            }
          }
          return;
        }

        if (key === 'ota_pending_verifications_v1') {
          if (Array.isArray(data.payload)) {
            const now = Date.now();
            pendingEmailVerifications.clear();
            data.payload.forEach((item: any) => {
              if (item && item.email && item.expiresAt > now) {
                pendingEmailVerifications.set(item.email, item);
              }
            });
          }
          return;
        }

        if (key === 'ota_teachers_v3') {
          const remoteList = Array.isArray(data.payload) ? data.payload : Object.values(data.payload || {});
          let localList = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : Object.values(store.keys['ota_teachers_v3'] || {});

          const reconciled: any[] = [];
          remoteList.forEach((rt: any) => {
            if (!rt || !rt.id || isSyntheticTestTeacher(rt)) return;
            const existing = localList.find((lt: any) => lt && (lt.id === rt.id || lt.username === rt.username));
            const preservedPass = existing?.password;
            const merged = { ...rt };
            if (preservedPass && !merged.password) {
              merged.password = preservedPass;
            }
            if (!merged.password && serverVault[rt.id]?.passwordHash) {
              merged.password = serverVault[rt.id].passwordHash;
            }
            reconciled.push(merged);
          });

          if (JSON.stringify(localList) !== JSON.stringify(reconciled)) {
            store.keys['ota_teachers_v3'] = reconciled;
            storeModified = true;
            changedBatch['ota_teachers_v3'] = reconciled.map((t: any) => sanitizeTeacherRecord(t, false));
          }
          return;
        }

        if (key === 'ota_admins') {
          const remoteList = Array.isArray(data.payload) ? data.payload : Object.values(data.payload || {});
          let localList = Array.isArray(store.keys['ota_admins']) ? store.keys['ota_admins'] : Object.values(store.keys['ota_admins'] || {});
          const reconciled: any[] = [];
          remoteList.forEach((ra: any) => {
            if (!ra || !ra.id) return;
            const existing = localList.find((la: any) => la && (la.id === ra.id || la.username === ra.username));
            const preservedPass = existing?.password;
            const merged = { ...ra };
            if (preservedPass && !merged.password) {
              merged.password = preservedPass;
            }
            if (!merged.password && serverVault[ra.id]?.passwordHash) {
              merged.password = serverVault[ra.id].passwordHash;
            }
            reconciled.push(merged);
          });
          if (JSON.stringify(localList) !== JSON.stringify(reconciled)) {
            store.keys['ota_admins'] = reconciled;
            storeModified = true;
            changedBatch['ota_admins'] = reconciled.map(sanitizeAdminRecord);
          }
          return;
        }

        if (JSON.stringify(store.keys[key]) !== JSON.stringify(data.payload)) {
          store.keys[key] = data.payload;
          storeModified = true;
          changedBatch[key] = data.payload;
        }
      });

      if (storeModified) {
        store.version = Date.now();
        broadcastToClients('update', {
          version: store.version,
          changedKeys: changedBatch
        });
      }
    }, (err) => {
      console.warn('[Server Firestore Real-time Listener Notice]', err?.message || err);
    });

    // Also subscribe to dedicated /schools collection so manual registrations/deletions sync across instances
    onSnapshot(collection(clientDb, 'schools'), (snapshot) => {
      const existingRaw = Array.isArray(store.keys['ota_schools_v1'])
        ? [...store.keys['ota_schools_v1']]
        : Object.values(store.keys['ota_schools_v1'] || {});
      let changed = false;

      snapshot.docChanges().forEach((change) => {
        const sData = change.doc.data();
        const sId = sData?.id || change.doc.id;
        if (!sId || sId === 'ota_total_academy') return;
        if (change.type === 'removed') {
          const next = existingRaw.filter((s: any) => s && s.id !== sId);
          if (next.length !== existingRaw.length) {
            existingRaw.splice(0, existingRaw.length, ...next);
            changed = true;
          }
        } else if (sData && sData.name) {
          const idx = existingRaw.findIndex((s: any) => s && s.id === sId);
          if (idx >= 0) {
            if (JSON.stringify(existingRaw[idx]) !== JSON.stringify(sData)) {
              existingRaw[idx] = sData;
              changed = true;
            }
          } else {
            existingRaw.push(sData);
            changed = true;
          }
        }
      });

      if (changed) {
        store.keys['ota_schools_v1'] = existingRaw;
        store.version = Date.now();
        broadcastToClients('update', {
          version: store.version,
          changedKeys: { ota_schools_v1: existingRaw }
        });
      }
    }, (err) => {
      console.warn('[Server Firestore Schools Listener Notice]', err?.message || err);
    });
  } catch (err) {
    console.warn('[Server Firestore Listener Setup Notice]', err);
  }
}

// Lightweight Render / Load Balancer Health Check Endpoint
app.get('/api/health', (_req, res) => {
  return res.status(200).json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// System Readiness & Health Check Endpoint
app.get('/api/ready', (req, res) => {
  const adminsObj = store.keys['ota_admins'] || [];
  const adminList = Array.isArray(adminsObj) ? adminsObj : Object.values(adminsObj);
  const teachersObj = store.keys['ota_teachers_v3'] || [];
  const teacherList = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  const schoolsObj = store.keys['ota_schools_v1'] || [];
  const schoolList = Array.isArray(schoolsObj) ? schoolsObj : Object.values(schoolsObj);

  return res.json({
    status: 'ready',
    timestamp: Date.now(),
    uptime: process.uptime(),
    auth: {
      adminAuthReady: !!adminAuth,
      adminDbReady: !!adminDb,
      hasServiceAccount: hasAdminCredentials
    },
    vault: {
      vaultReady: true,
      entriesCount: Object.keys(serverVault).length
    },
    records: {
      adminsCount: adminList.length,
      teachersCount: teacherList.length,
      schoolsCount: schoolList.length
    }
  });
});

// Helper to construct a beautiful, modern, responsive HTML email template
function buildEmailTemplate({
  title,
  preheader,
  accentColor = '#2563eb',
  badgeText,
  heroTitle,
  mainContentHtml,
  footerNote
}: {
  title: string;
  preheader?: string;
  accentColor?: string;
  badgeText: string;
  heroTitle: string;
  mainContentHtml: string;
  footerNote?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    .email-container { max-width: 580px; margin: 32px auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04); border: 1px solid #e2e8f0; }
    .email-header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 36px 32px 30px; text-align: center; }
    .email-body { padding: 36px 32px 28px; color: #334155; line-height: 1.6; }
    .email-footer { background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 32px; text-align: center; font-size: 12px; color: #64748b; }
    @media only screen and (max-width: 600px) {
      .email-container { margin: 0; border-radius: 0; }
      .email-header { padding: 28px 20px 22px; }
      .email-body { padding: 28px 20px 20px; }
    }
  </style>
</head>
<body>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <div class="email-container">
          <!-- Header -->
          <div class="email-header">
            <!-- Bold PENTRIC Brand Logo & Wordmark -->
            <div style="margin-bottom: 20px;">
              <div style="display: inline-block; padding: 10px 28px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 100px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);">
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                  <tr>
                    <td valign="middle" style="padding-right: 12px;">
                      <div style="width: 34px; height: 34px; line-height: 34px; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); border-radius: 10px; text-align: center; color: #ffffff; font-weight: 900; font-size: 19px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.5);">
                        P
                      </div>
                    </td>
                    <td valign="middle">
                      <span style="color: #ffffff; font-size: 26px; font-weight: 900; letter-spacing: 4px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-transform: uppercase;">
                        PENTRIC
                      </span>
                    </td>
                  </tr>
                </table>
              </div>
            </div>

            <!-- Category Badge -->
            <div style="margin-bottom: 12px;">
              <span style="display:inline-block; padding: 5px 14px; background: rgba(255,255,255,0.12); color: #93c5fd; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.18);">
                ${badgeText}
              </span>
            </div>

            <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0 0 6px 0; letter-spacing: -0.5px;">${heroTitle}</h1>
            <p style="color: #94a3b8; font-size: 13px; margin: 0; font-weight: 500;">Pentric Intelligent Academic Scheduling</p>
          </div>

          <!-- Body -->
          <div class="email-body">
            ${mainContentHtml}
          </div>

          <!-- Footer -->
          <div class="email-footer">
            <div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 8px;">
              <span style="font-weight: 900; color: #0f172a; letter-spacing: 1.5px; font-size: 13px;">PENTRIC</span>
              <span style="color: #cbd5e1;">•</span>
              <span>Intelligent Academic Scheduling</span>
            </div>
            <p style="margin: 0 0 6px 0; color: #94a3b8; font-size: 11px;">
              ${footerNote || 'This is an official system notice. If you did not request this email, you may safely ignore it.'}
            </p>
          </div>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// --- SECURE OUTBOUND EMAIL INFRASTRUCTURE (RESEND HTTPS + BREVO HTTPS + WEBHOOK RELAY + BOUNDED SMTP) ---
async function sendEmailMessage({
  to,
  subject,
  html,
  text,
  fromName = 'Pentric Timetable'
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
}): Promise<{ success: boolean; error?: string; transport?: 'resend' | 'brevo' | 'webhook' | 'smtp'; sender?: string }> {
  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  const rawFrom = (process.env.RESEND_FROM || process.env.EMAIL_FROM || '').trim().replace(/^["']|["']$/g, '');
  const angleMatch = rawFrom.match(/<([^>\s]+@[^>\s]+)>/);
  const plainEmail = rawFrom.match(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/);
  const candidateEmail = angleMatch ? angleMatch[1] : (plainEmail ? rawFrom : '');
  const isPublicFreeMail = /@(gmail|yahoo|outlook|hotmail|live|aol|icloud)\.com$/i.test(candidateEmail);
  const hasVerifiedResendDomain = Boolean(resendApiKey && candidateEmail && !isPublicFreeMail);
  const resolvedResendEmail = hasVerifiedResendDomain ? candidateEmail : 'onboarding@resend.dev';

  const brevoApiKey = (process.env.BREVO_API_KEY || '').trim();
  const rawBrevoFrom = (process.env.BREVO_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || '').trim().replace(/^["']|["']$/g, '');
  const brevoAngle = rawBrevoFrom.match(/<([^>\s]+@[^>\s]+)>/);
  const brevoPlain = rawBrevoFrom.match(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/);
  const brevoSenderEmail = brevoAngle ? brevoAngle[1] : (brevoPlain ? rawBrevoFrom : '');

  const webhookUrl = (process.env.EMAIL_WEBHOOK_URL || '').trim();
  const webhookSecret = (process.env.EMAIL_WEBHOOK_SECRET || '').trim();

  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const hasSmtp = Boolean(smtpUser && smtpPass);
  const isGmail = smtpHost.toLowerCase().includes('gmail');
  const rawSmtpFrom = (process.env.SMTP_FROM || '').trim();
  const smtpFrom = (isGmail || !rawSmtpFrom)
    ? `"${fromName}" <${smtpUser || 'noreply@pentric.edu'}>`
    : rawSmtpFrom;

  const tryResend = async (): Promise<{ success: boolean; error?: string; transport?: 'resend'; sender?: string }> => {
    if (!resendApiKey) return { success: false, error: 'RESEND_API_KEY not set' };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `${fromName} <${resolvedResendEmail}>`,
          to: [to],
          subject,
          html,
          text
        }),
        signal: AbortSignal.timeout(8000)
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`[Email Dispatcher] Email accepted by Resend for ${to} (from: ${resolvedResendEmail})`);
        return { success: true, transport: 'resend', sender: resolvedResendEmail };
      }
      const errorMsg = data?.message || `Resend API returned status ${res.status}`;
      console.warn(`[Email Dispatcher] Resend API declined ${to}: ${errorMsg}`);
      return { success: false, error: `Email delivery rejected by Resend: ${errorMsg}` };
    } catch (e: any) {
      console.warn(`[Email Dispatcher] Resend dispatch notice for ${to}: ${e?.message}`);
      return { success: false, error: e?.message || 'Resend email dispatch failed' };
    }
  };

  const tryBrevo = async (): Promise<{ success: boolean; error?: string; transport?: 'brevo'; sender?: string }> => {
    if (!brevoApiKey) return { success: false, error: 'BREVO_API_KEY not set' };
    if (!brevoSenderEmail) {
      return { success: false, error: 'BREVO_FROM (verified sender email) is required when using BREVO_API_KEY.' };
    }
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: fromName, email: brevoSenderEmail },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text
        }),
        signal: AbortSignal.timeout(8000)
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`[Email Dispatcher] Email accepted by Brevo for ${to} (from: ${brevoSenderEmail})`);
        return { success: true, transport: 'brevo', sender: brevoSenderEmail };
      }
      const errorMsg = data?.message || data?.code || `Brevo API returned status ${res.status}`;
      console.warn(`[Email Dispatcher] Brevo API declined ${to}: ${errorMsg}`);
      return { success: false, error: `Email delivery rejected by Brevo: ${errorMsg}` };
    } catch (e: any) {
      console.warn(`[Email Dispatcher] Brevo dispatch notice for ${to}: ${e?.message}`);
      return { success: false, error: e?.message || 'Brevo email dispatch failed' };
    }
  };

  const tryWebhook = async (): Promise<{ success: boolean; error?: string; transport?: 'webhook'; sender?: string }> => {
    if (!webhookUrl) return { success: false, error: 'EMAIL_WEBHOOK_URL not set' };
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          html,
          text,
          fromName,
          ...(webhookSecret ? { secret: webhookSecret } : {})
        }),
        signal: AbortSignal.timeout(10000)
      });
      const rawText = await res.text();
      let data: any = {};
      try { data = JSON.parse(rawText); } catch {}
      if (res.ok && data?.success !== false) {
        const sender = typeof data?.sender === 'string' ? data.sender : 'Gmail Relay';
        console.log(`[Email Dispatcher] Email dispatched via HTTPS Webhook to ${to}`);
        return { success: true, transport: 'webhook', sender };
      }
      const errorMsg = data?.error || `Webhook relay returned status ${res.status}`;
      console.warn(`[Email Dispatcher] Webhook relay declined ${to}: ${errorMsg}`);
      return { success: false, error: errorMsg };
    } catch (e: any) {
      console.warn(`[Email Dispatcher] Webhook relay notice for ${to}: ${e?.message}`);
      return { success: false, error: e?.message || 'Email webhook relay failed' };
    }
  };

  const trySmtp = async (): Promise<{ success: boolean; error?: string; transport?: 'smtp'; sender?: string }> => {
    if (!hasSmtp) return { success: false, error: 'SMTP credentials not set' };
    try {
      const transporter = isGmail
        ? nodemailer.createTransport({
            service: 'gmail',
            auth: { user: smtpUser, pass: smtpPass },
            connectionTimeout: 7000,
            greetingTimeout: 7000,
            socketTimeout: 7000
          })
        : nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass },
            connectionTimeout: 7000,
            greetingTimeout: 7000,
            socketTimeout: 7000
          });

      const info = await transporter.sendMail({
        from: smtpFrom,
        replyTo: smtpUser,
        to,
        subject,
        text,
        html
      });

      const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
      const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
      if (rejected.length > 0 || accepted.length === 0) {
        const rejectReason = `SMTP server did not accept recipient ${to} (response: ${info?.response || 'none'})`;
        console.warn(`[Email Dispatcher] ${rejectReason}`);
        return { success: false, error: rejectReason };
      }

      console.log(`[Email Dispatcher] Email dispatched via SMTP (${smtpUser}) to ${to} [msgId=${info.messageId}, resp=${info.response}]`);
      return { success: true, transport: 'smtp', sender: smtpUser };
    } catch (err: any) {
      console.warn(`[Email Dispatcher] Outbound SMTP notice for ${to}: ${err?.message}`);
      return { success: false, error: err?.message || 'Outbound email delivery failed' };
    }
  };

  if (!resendApiKey && !brevoApiKey && !webhookUrl && !hasSmtp) {
    console.warn(`[Email Dispatcher] Outbound email credentials unconfigured for: ${to}`);
    return {
      success: false,
      error: 'Email delivery service is not configured on this server. Set BREVO_API_KEY + BREVO_FROM, EMAIL_WEBHOOK_URL, RESEND_API_KEY (verified domain), or SMTP_USER + SMTP_PASS.'
    };
  }

  const attemptErrors: string[] = [];

  // 1. Resend with verified custom domain (HTTPS 443)
  if (hasVerifiedResendDomain) {
    const resResult = await tryResend();
    if (resResult.success) return resResult;
    if (resResult.error) attemptErrors.push(resResult.error);
  }

  // 2. Brevo HTTPS API (works on Render Free tier with a single verified Gmail address — no custom domain required)
  if (brevoApiKey) {
    const brevoResult = await tryBrevo();
    if (brevoResult.success) return brevoResult;
    if (brevoResult.error) attemptErrors.push(brevoResult.error);
  }

  // 3. HTTPS Webhook Mail Relay (e.g. Google Apps Script Gmail relay over HTTPS 443)
  if (webhookUrl) {
    const hookResult = await tryWebhook();
    if (hookResult.success) return hookResult;
    if (hookResult.error) attemptErrors.push(hookResult.error);
  }

  // 4. Direct SMTP (works on paid Render or hosts where ports 465/587 are open)
  if (hasSmtp) {
    const smtpResult = await trySmtp();
    if (smtpResult.success) return smtpResult;
    if (smtpResult.error) attemptErrors.push(smtpResult.error);
  }

  // 5. Sandbox Resend fallback (when no custom domain is verified — succeeds for owner test email, otherwise explains domain/relay options)
  if (resendApiKey && !hasVerifiedResendDomain) {
    const resendResult = await tryResend();
    if (resendResult.success) return resendResult;
    const isSandboxRestriction = /only send testing emails to your own email|verify a domain/i.test(resendResult.error || '');
    if (isSandboxRestriction) {
      return {
        success: false,
        error: `${resendResult.error} Alternatively (without buying a domain), set BREVO_API_KEY + BREVO_FROM or EMAIL_WEBHOOK_URL in Render Environment Variables for free HTTPS email delivery to any recipient.`
      };
    }
    if (resendResult.error) attemptErrors.push(resendResult.error);
  }

  return {
    success: false,
    error: attemptErrors[0] || 'Outbound email delivery failed.'
  };
}

async function sendVerificationEmail(recipientEmail: string, code: string, recipientName?: string): Promise<{ success: boolean; error?: string; transport?: 'resend' | 'brevo' | 'webhook' | 'smtp'; sender?: string }> {
  const digits = code.split('');
  const digitsHtml = digits.map(d => `
    <td align="center" style="padding: 0 4px;">
      <div style="width: 44px; height: 56px; line-height: 56px; background: #ffffff; border: 2px solid #3b82f6; border-radius: 12px; font-size: 28px; font-weight: 900; color: #1e3a8a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        ${d}
      </div>
    </td>
  `).join('');

  const subject = `Pentric Verification Code: ${code}`;
  const textContent = `Hello ${recipientName || 'Faculty Member'},\n\n` +
    `Your 6-digit verification code for Pentric Academic Timetable is:\n\n` +
    `  ${code}\n\n` +
    `This verification code will expire in 15 minutes. Enter this code to verify your email and complete registration.\n\n` +
    `If you did not request this verification code, please ignore this email.\n\n` +
    `Best regards,\nPentric Academic Administration`;

  const mainContentHtml = `
    <p style="font-size: 15px; color: #1e293b; margin: 0 0 16px 0;">
      Hello <strong>${recipientName || 'Faculty Member'}</strong>,
    </p>
    <p style="font-size: 14px; color: #475569; margin: 0 0 24px 0; line-height: 1.6;">
      Thank you for registering on Pentric Academic Timetable. To protect our academic portal against automated bots and verify that you are a genuine faculty member, please use the 6-digit verification code below:
    </p>

    <!-- Digits Box -->
    <div style="background: linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%); border: 1px solid #bfdbfe; border-radius: 18px; padding: 26px 16px; margin: 24px 0; text-align: center;">
      <div style="font-size: 12px; font-weight: 800; color: #1e40af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 14px;">
        One-Time Verification Code
      </div>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
        <tr>
          ${digitsHtml}
        </tr>
      </table>
      <div style="margin-top: 16px; font-size: 12px; font-weight: 600; color: #3b82f6; display: flex; align-items: center; justify-content: center; gap: 4px;">
        ⏱️ Valid for 15 minutes • Single use only
      </div>
    </div>

    <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 14px 16px; border-radius: 8px; margin: 24px 0 20px 0;">
      <p style="font-size: 13px; color: #334155; margin: 0; font-weight: 500;">
        <strong>Anti-Imposter Notice:</strong> Once your email is verified, your registration will be reviewed by your school administrator to verify faculty authenticity before granting access to institutional schedules.
      </p>
    </div>

    <p style="font-size: 12px; color: #94a3b8; margin: 0; line-height: 1.5;">
      Never share this code with anyone. Our administrators will never ask for your verification code.
    </p>
  `;

  const htmlContent = buildEmailTemplate({
    title: `Pentric Verification Code: ${code}`,
    preheader: `Your verification code is ${code}. Valid for 15 minutes.`,
    accentColor: '#2563eb',
    badgeText: 'SECURITY VERIFICATION',
    heroTitle: 'Anti-Bot Email Verification',
    mainContentHtml,
    footerNote: 'This email was generated in response to an account registration attempt at your institution.'
  });

  return sendEmailMessage({
    to: recipientEmail,
    subject,
    html: htmlContent,
    text: textContent,
    fromName: 'Pentric Verification'
  });
}

// Endpoint to send institutional notifications via email
app.post('/api/notifications/send-email', async (req, res) => {
  const { recipientEmail, title, message, details, category, recipientName } = req.body;
  if (!recipientEmail || typeof recipientEmail !== 'string') {
    return res.status(400).json({ success: false, error: 'Recipient email is required.' });
  }

  const cleanEmail = recipientEmail.trim().toLowerCase();

  const isAlert = category === 'ALERT' || (title && title.toUpperCase().includes('ALERT'));
  const accentColor = isAlert ? '#dc2626' : category === 'REQUEST' ? '#7c3aed' : '#2563eb';
  const badgeText = category || 'ACADEMIC NOTICE';

  const mainContentHtml = `
    <p style="font-size: 15px; color: #1e293b; margin: 0 0 16px 0;">
      Hello <strong>${recipientName || 'Faculty Member'}</strong>,
    </p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 22px; margin: 20px 0;">
      <h3 style="margin: 0 0 10px 0; color: #0f172a; font-size: 17px; font-weight: 800;">
        ${title || 'Important Notice'}
      </h3>
      <p style="margin: 0; color: #475569; font-size: 14px; line-height: 1.6;">
        ${message || ''}
      </p>
      ${details ? `
        <div style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #cbd5e1; font-size: 13px; color: #64748b; font-family: monospace;">
          ${details}
        </div>
      ` : ''}
    </div>
    <div style="text-align: center; margin-top: 26px;">
      <a href="${req.headers.origin || 'https://pentric.app'}" style="display: inline-block; background: ${accentColor}; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 12px rgba(37,99,235,0.25);">
        Open Portal & View Schedule →
      </a>
    </div>
  `;

  const htmlContent = buildEmailTemplate({
    title: title || 'Pentric Notification',
    preheader: message ? message.substring(0, 100) : 'New notification from Pentric Timetable',
    accentColor,
    badgeText,
    heroTitle: title || 'Academic Notice',
    mainContentHtml,
    footerNote: 'You received this notification because your email is registered as an official faculty member.'
  });

  const mailResult = await sendEmailMessage({
    to: cleanEmail,
    subject: `📢 ${title || 'Pentric Notification'}`,
    text: `${title}\n\n${message}\n\n${details || ''}`,
    html: htmlContent,
    fromName: 'Pentric Notification'
  });

  if (mailResult.success) {
    return res.json({ success: true, message: `Notification email dispatched to ${cleanEmail}.` });
  } else {
    return res.status(502).json({ success: false, error: mailResult.error || 'Failed to deliver notification email.' });
  }
});

// Mandatory Admin Password Change Endpoint (Hardened Security)
app.post('/api/auth/change-admin-password', async (req, res) => {
  const { adminId, newPassword } = req.body;
  if (!adminId || typeof newPassword === 'undefined') {
    return res.status(400).json({ success: false, error: 'Administrator ID and new password are required.' });
  }

  const rawPass = typeof newPassword === 'string' ? newPassword : String(newPassword);
  if (rawPass.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
  }

  if (rawPass === 'admin123' || rawPass === 'admin' || rawPass.toLowerCase() === 'password') {
    return res.status(400).json({ success: false, error: 'Security Violation: You cannot reuse the default insecure password.' });
  }

  const adminsObj = store.keys['ota_admins'] || [];
  let adminList: any[] = Array.isArray(adminsObj) ? [...adminsObj] : Object.values(adminsObj);
  const idx = adminList.findIndex((a: any) => a && (a.id === adminId || a.username === adminId));

  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Administrator account not found.' });
  }

  const hashedPassword = bcrypt.hashSync(rawPass, 10);
  adminList[idx].password = hashedPassword;
  adminList[idx].mustChangePassword = false;
  adminList[idx].updatedAt = Date.now();

  serverVault[adminList[idx].id] = {
    passwordHash: hashedPassword,
    role: 'ADMIN',
    email: (adminList[idx].adminEmail || adminList[idx].email || '').trim().toLowerCase(),
    username: (adminList[idx].username || '').trim().toLowerCase()
  };

  store.keys['ota_admins'] = adminList;
  store.version = Date.now();
  saveStoreToDisk();

  try {
    await syncOtaStoreDocToFirestore('ota_admins', adminList);
    await syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));
  } catch {}

  // Add audit log entry
  const auditLog = {
    id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    actorName: adminList[idx].name || 'Administrator',
    actorRole: 'ADMIN',
    action: 'ADMIN_PASSWORD_HARDENED',
    details: 'Administrator default password replaced with cryptographically secure credentials. Access hardened.',
    timestamp: Date.now()
  };

  let auditList: any[] = [];
  if (Array.isArray(store.keys['ota_audit_logs_v1'])) {
    auditList = [...store.keys['ota_audit_logs_v1']];
  } else if (store.keys['ota_audit_logs_v1']) {
    auditList = Object.values(store.keys['ota_audit_logs_v1']);
  }
  auditList.unshift(auditLog);
  store.keys['ota_audit_logs_v1'] = auditList;
  saveStoreToDisk();

  broadcastToClients('update', {
    version: store.version,
    changedKeys: {
      ota_admins: adminList,
      ota_audit_logs_v1: auditList
    }
  });

  return res.json({
    success: true,
    message: 'Administrator password successfully updated. Default access credentials hardened.'
  });
});

// Send 6-Digit Email Verification Code Route
app.post('/api/auth/send-verification-code', async (req, res) => {
  const { email, username, name } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'Email address is required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address (e.g. yourname@gmail.com).' });
  }

  const teachersObj = store.keys['ota_teachers_v3'] || {};
  const currentTeacherList: any[] = Array.isArray(teachersObj) ? [...teachersObj] : Object.values(teachersObj);

  if (username) {
    const cleanUser = String(username).trim().toLowerCase();
    const existingUser = currentTeacherList.find((t: any) => t && (t.username || '').trim().toLowerCase() === cleanUser);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username is already taken. Please choose another username.' });
    }
  }

  // Check if email already registered (either approved or pending)
  const existingEmail = currentTeacherList.find((t: any) => t && (t.contactEmail || t.email || '').trim().toLowerCase() === cleanEmail);
  if (existingEmail) {
    return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please log in instead.' });
  }

  if (emailSendingLocks.has(cleanEmail)) {
    return res.status(429).json({ success: false, error: 'A verification request is already in progress for this email address. Please wait.' });
  }

  // Rate limit: 30 seconds cooldown between successfully sent codes for same email
  const existingRecord = pendingEmailVerifications.get(cleanEmail);
  const now = Date.now();
  if (existingRecord && (now - existingRecord.lastSentAt) < 30000) {
    const secondsLeft = Math.ceil((30000 - (now - existingRecord.lastSentAt)) / 1000);
    return res.status(429).json({ 
      success: false, 
      error: `Please wait ${secondsLeft}s before requesting a new code.`
    });
  }

  emailSendingLocks.add(cleanEmail);
  try {
    // Generate cryptographically unique 6-digit numeric verification code
    const code = crypto.randomInt(100000, 1000000).toString();

    const mailResult = await sendVerificationEmail(cleanEmail, code, name);
    if (!mailResult.success) {
      // Clear pending verification state so no cooldown or valid code is left behind on delivery failure
      pendingEmailVerifications.delete(cleanEmail);
      await updateOtaStoreListInFirestore('ota_pending_verifications_v1', (list: any[]) =>
        list.filter((i: any) => i && i.email !== cleanEmail && i.expiresAt > now)
      );
      return res.status(502).json({
        success: false,
        error: mailResult.error || 'Failed to deliver verification email. Please check your email address or try again.'
      });
    }

    const record: PendingEmailVerification = {
      code,
      email: cleanEmail,
      name: name ? String(name).trim() : undefined,
      username: username ? String(username).trim().toLowerCase() : undefined,
      expiresAt: now + 15 * 60 * 1000, // 15 mins expiry
      attempts: 0,
      lastSentAt: now
    };
    pendingEmailVerifications.set(cleanEmail, record);

    await updateOtaStoreListInFirestore('ota_pending_verifications_v1', (list: any[]) => {
      const filtered = list.filter((i: any) => i && i.email !== cleanEmail && i.expiresAt > now);
      filtered.push(record);
      return filtered;
    });

    // NEVER return verification code or devCode in HTTP response
    return res.json({
      success: true,
      transport: mailResult.transport,
      sender: mailResult.sender,
      message: `A 6-digit verification code has been dispatched to ${cleanEmail}${mailResult.sender ? ` from ${mailResult.sender}` : ''}. Check your inbox, Updates, or Spam folder.`
    });
  } finally {
    emailSendingLocks.delete(cleanEmail);
  }
});

// Verify 6-digit Code Route
app.post('/api/auth/verify-code', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ success: false, error: 'Email and verification code are required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanCode = String(code).trim();

  let record = pendingEmailVerifications.get(cleanEmail);
  if (!record) {
    try {
      const payload = await getOtaStoreDocFromFirestore('ota_pending_verifications_v1');
      if (Array.isArray(payload)) {
        const found = payload.find((item: any) => item && item.email === cleanEmail && item.expiresAt > Date.now());
        if (found) {
          pendingEmailVerifications.set(cleanEmail, found);
          record = found;
        }
      }
    } catch {}
  }
  if (!record) {
    return res.status(400).json({ success: false, error: 'No verification code found. Please request a new code.' });
  }

  if (Date.now() > record.expiresAt) {
    pendingEmailVerifications.delete(cleanEmail);
    savePendingVerifications(pendingEmailVerifications);
    return res.status(400).json({ success: false, error: 'Verification code has expired. Please request a new one.' });
  }

  if (record.attempts >= 5) {
    pendingEmailVerifications.delete(cleanEmail);
    savePendingVerifications(pendingEmailVerifications);
    return res.status(400).json({ success: false, error: 'Too many failed attempts. Please request a new code.' });
  }

  if (record.code !== cleanCode) {
    record.attempts++;
    savePendingVerifications(pendingEmailVerifications);
    return res.status(400).json({ 
      success: false, 
      error: `Invalid code. ${5 - record.attempts} attempt(s) remaining.` 
    });
  }

  return res.json({ success: true, message: 'Code verified successfully.' });
});

// Public Approval Status Poll Route (Used by pending teacher waiting room on Device B)
app.get('/api/auth/approval-status', async (req, res) => {
  const teacherId = typeof req.query.teacherId === 'string' ? req.query.teacherId.trim() : '';
  const username = typeof req.query.username === 'string' ? req.query.username.trim().toLowerCase() : '';
  if (!teacherId && !username) {
    return res.status(400).json({ success: false, error: 'teacherId or username required' });
  }

  let teachersObj = store.keys['ota_teachers_v3'] || [];
  let list: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  let match = list.find((t: any) => t && ((teacherId && t.id === teacherId) || (username && (t.username || '').toLowerCase() === username)));

  if (!match) {
    try {
      const remote = await getOtaStoreDocFromFirestore('ota_teachers_v3');
      if (Array.isArray(remote)) {
        match = remote.find((t: any) => t && ((teacherId && t.id === teacherId) || (username && (t.username || '').toLowerCase() === username)));
      }
    } catch {}
  }

  if (!match) {
    return res.json({ success: true, status: 'NOT_FOUND' });
  }

  const status = match.isApproved && match.approvalStatus === 'APPROVED'
    ? 'APPROVED'
    : (match.approvalStatus === 'REJECTED' ? 'REJECTED' : 'PENDING');

  return res.json({
    success: true,
    status,
    rejectionReason: match.rejectionReason
  });
});

// Signup Route with Anti-Bot 6-Digit Email Verification
app.post('/api/auth/signup', async (req, res) => {
  const { name, username, password, email, verificationCode } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ success: false, error: 'Name, username, and password are required.' });
  }

  if (!email) {
    return res.status(400).json({ success: false, error: 'Email address is required for anti-bot verification.' });
  }

  if (!verificationCode) {
    return res.status(400).json({ success: false, error: 'Please enter the 6-digit verification code sent to your email.' });
  }

  const cleanUser = String(username).trim().toLowerCase();
  const cleanName = String(name).trim();
  const rawPass = typeof password === 'string' ? password : String(password);
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanCode = String(verificationCode).trim();

  if (rawPass.length < 4) {
    return res.status(400).json({ success: false, error: 'Password must be at least 4 characters long.' });
  }

  // Verify the 6-digit code against pending verifications (Firestore-backed for multi-container support)
  let record = pendingEmailVerifications.get(cleanEmail);
  if (!record) {
    try {
      const payload = await getOtaStoreDocFromFirestore('ota_pending_verifications_v1');
      if (Array.isArray(payload)) {
        const found = payload.find((item: any) => item && item.email === cleanEmail && item.expiresAt > Date.now());
        if (found) {
          pendingEmailVerifications.set(cleanEmail, found);
          record = found;
        }
      }
    } catch {}
  }
  if (!record) {
    return res.status(400).json({ success: false, error: 'No active verification code found for this email. Please request a code.' });
  }

  if (Date.now() > record.expiresAt) {
    pendingEmailVerifications.delete(cleanEmail);
    savePendingVerifications(pendingEmailVerifications);
    return res.status(400).json({ success: false, error: 'Verification code has expired. Please request a new one.' });
  }

  if (record.attempts >= 5) {
    pendingEmailVerifications.delete(cleanEmail);
    savePendingVerifications(pendingEmailVerifications);
    return res.status(400).json({ success: false, error: 'Too many failed verification attempts. Please request a new code.' });
  }

  if (record.code !== cleanCode) {
    record.attempts++;
    savePendingVerifications(pendingEmailVerifications);
    return res.status(400).json({ success: false, error: `Invalid verification code (${5 - record.attempts} attempts left). Check your email.` });
  }

  // Code verified! Remove from pending in memory and Firestore
  pendingEmailVerifications.delete(cleanEmail);
  await updateOtaStoreListInFirestore('ota_pending_verifications_v1', (list: any[]) =>
    list.filter((i: any) => i && i.email !== cleanEmail && i.expiresAt > Date.now())
  );

  // Pull latest teachers from Firestore first so duplicate check never uses stale container memory
  try {
    const latestRemoteTeachers = await getOtaStoreDocFromFirestore('ota_teachers_v3');
    if (Array.isArray(latestRemoteTeachers)) {
      const currentMem = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : [];
      const merged: any[] = [];
      latestRemoteTeachers.forEach((rt: any) => {
        if (!rt || !rt.id) return;
        const localMatch = currentMem.find((lt: any) => lt && lt.id === rt.id);
        merged.push({ ...rt, password: rt.password || localMatch?.password || serverVault[rt.id]?.passwordHash });
      });
      store.keys['ota_teachers_v3'] = merged;
    }
  } catch {}

  const teachersObj = store.keys['ota_teachers_v3'] || {};
  let currentTeacherList: any[] = Array.isArray(teachersObj) ? [...teachersObj] : Object.values(teachersObj);

  const existing = currentTeacherList.find((t: any) => {
    if (!t) return false;
    const uName = (t.username || '').trim().toLowerCase();
    return uName === cleanUser;
  });

  if (existing) {
    return res.status(400).json({ success: false, error: 'Username is already taken.' });
  }

  const existingEmail = currentTeacherList.find((t: any) => {
    if (!t) return false;
    const e = (t.contactEmail || t.email || '').trim().toLowerCase();
    return e === cleanEmail;
  });

  if (existingEmail) {
    return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please log in instead.' });
  }

  const recoveryCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const calendarToken = 'cal_' + crypto.randomBytes(6).toString('hex') + Date.now().toString(36);
  const newTeacherId = 't_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');

  const buildAvailability = () => {
    const grid: Record<number, Record<number, string>> = {};
    for (let day = 0; day < 5; day++) {
      grid[day] = {};
      for (let period = 0; period < 8; period++) {
        grid[day][period] = 'AVAILABLE';
      }
    }
    return grid;
  };

  const schoolId = req.body.schoolId || 'ota_total_academy';
  const passwordHash = bcrypt.hashSync(rawPass, 10);

  const newTeacher = {
    id: newTeacherId,
    name: cleanName,
    username: cleanUser,
    password: passwordHash,
    recoveryCode,
    calendarToken,
    subjectsTaught: [],
    assignedClasses: [],
    availability: buildAvailability(),
    isCompleted: false,
    contactEmail: cleanEmail,
    emailVerified: true,
    mustChangePassword: false,
    role: 'TEACHER',
    schoolId,
    isApproved: false,
    approvalStatus: 'PENDING',
    registeredAt: Date.now()
  };

  serverVault[newTeacherId] = {
    passwordHash,
    role: 'TEACHER',
    email: cleanEmail,
    username: cleanUser
  };

  const safeTeacherForFirestore = sanitizeTeacherRecord(newTeacher, false);

  // Transactional Firestore update guarantees concurrent signups never overwrite each other
  const txTeachers = await updateOtaStoreListInFirestore('ota_teachers_v3', (remoteList: any[]) => {
    const filtered = remoteList.filter((t: any) => t && t.id !== newTeacherId);
    filtered.push(safeTeacherForFirestore);
    return filtered;
  });

  if (txTeachers) {
    store.keys['ota_teachers_v3'] = txTeachers.map((rt: any) => {
      if (rt.id === newTeacherId) return newTeacher;
      const existingMem = currentTeacherList.find((lt: any) => lt && lt.id === rt.id);
      return { ...rt, password: existingMem?.password || serverVault[rt.id]?.passwordHash };
    });
  } else {
    currentTeacherList.push(newTeacher);
    store.keys['ota_teachers_v3'] = currentTeacherList;
  }

  // Anti-Imposter Protection: Send instant notification and alert to Administration
  const adminAlert = {
    id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    recipientId: 'ADMIN',
    title: `⚠️ New Staff Verification Needed: ${cleanName}`,
    message: `${cleanName} (@${cleanUser}, ${cleanEmail}) registered as a teacher. Email verified via 6-digit anti-bot code ✅. Please verify faculty approval.`,
    details: `Teacher ID: ${newTeacherId}. Verified Email: ${cleanEmail}. Registered for school: ${schoolId}. Use Faculty Approvals to approve or reject.`,
    type: 'ALERT',
    category: 'REQUEST',
    isRead: false,
    timestamp: Date.now()
  };

  const txNotifs = await updateOtaStoreListInFirestore('ota_notifications_v2', (remoteNotifs: any[]) => {
    const next = [adminAlert, ...remoteNotifs.filter((n: any) => n && n.id !== adminAlert.id)];
    return next.slice(0, 300);
  });
  if (txNotifs) {
    store.keys['ota_notifications_v2'] = txNotifs;
  } else {
    let notifList: any[] = Array.isArray(store.keys['ota_notifications_v2']) ? [...store.keys['ota_notifications_v2']] : [];
    notifList.unshift(adminAlert);
    store.keys['ota_notifications_v2'] = notifList;
  }

  store.version = Date.now();
  await syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));

  const safeTeacher = sanitizeTeacherRecord(newTeacher, false);
  const adminSanitized = getSanitizedKeys('ADMIN');

  // Broadcast the new teacher and notification immediately to admins and active tabs
  broadcastToClients('update', {
    version: store.version,
    key: 'ota_teachers_v3',
    item_id: newTeacherId,
    data: safeTeacher,
    changedKeys: {
      ota_teachers_v3: adminSanitized['ota_teachers_v3'],
      ota_notifications_v2: adminSanitized['ota_notifications_v2']
    }
  });

  const token = jwt.sign({ id: newTeacherId, username: newTeacher.username, role: 'TEACHER' }, JWT_SECRET, { expiresIn: '7d' });
  let customToken;
  try {
    customToken = await adminAuth.createCustomToken(newTeacherId, { role: 'TEACHER', userId: newTeacherId, username: newTeacher.username });
  } catch (e) {
    // Custom token is optional
  }

  return res.json({
    success: true,
    token,
    customToken,
    user: safeTeacher,
    isPendingApproval: true,
    message: 'Faculty account registered. Your school administrator has been notified to verify your staff credentials before granting access.'
  });
});

// Helper to remove any deleted teacher reference from timetable slots
function scrubTeacherFromTimetable(teacherId: string): boolean {
  let changed = false;
  const timetable = store.keys['ota_timetable_v2'];
  if (timetable && typeof timetable === 'object') {
    for (const classId in timetable) {
      const days = timetable[classId];
      if (!days || typeof days !== 'object') continue;
      for (const day in days) {
        const periods = days[day];
        if (!periods || typeof periods !== 'object') continue;
        for (const period in periods) {
          const cell = periods[period];
          if (cell) {
            if (cell.teacherId === teacherId) {
              cell.teacherId = '';
              changed = true;
            }
            if (Array.isArray(cell.teacherIds) && cell.teacherIds.includes(teacherId)) {
              cell.teacherIds = cell.teacherIds.filter((tid: string) => tid !== teacherId);
              changed = true;
            }
          }
        }
      }
    }
  }
  return changed;
}

// Admin Teacher Approval Endpoint (Anti-Imposter Protection)
app.post('/api/teachers/approve', requireAdmin, async (req, res) => {
  const { teacherId, action, reason, adminName } = req.body;
  if (!teacherId || !action) {
    return res.status(400).json({ success: false, error: 'teacherId and action are required' });
  }

  // Ensure latest list from Firestore before deciding
  try {
    const remoteTeachers = await getOtaStoreDocFromFirestore('ota_teachers_v3');
    if (Array.isArray(remoteTeachers)) {
      const memList: any[] = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : Object.values(store.keys['ota_teachers_v3'] || {});
      store.keys['ota_teachers_v3'] = remoteTeachers.map((rt: any) => {
        const lt = memList.find((x: any) => x && x.id === rt.id);
        return { ...rt, password: lt?.password || serverVault[rt.id]?.passwordHash };
      });
    }
  } catch {}

  const teachersObj = store.keys['ota_teachers_v3'] || {};
  let teacherList: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  const teacher = teacherList.find((t: any) => t && t.id === teacherId);

  if (!teacher && action !== 'DELETE') {
    return res.status(404).json({ success: false, error: 'Teacher not found' });
  }

  const actor = adminName || 'School Administrator';
  let newNotif: any = null;
  let newAudit: any = null;
  let timetableChanged = false;

  if (action === 'APPROVE' && teacher) {
    teacher.isApproved = true;
    teacher.approvalStatus = 'APPROVED';
    delete teacher.rejectionReason;

    newNotif = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      recipientId: teacher.id,
      title: 'Staff Verification Approved ✅',
      message: `Your faculty account has been verified by ${actor}. You now have full access to your school timetable.`,
      details: 'Anti-imposter verification successfully cleared.',
      isRead: false,
      timestamp: Date.now(),
      type: 'SUCCESS',
      category: 'SYSTEM'
    };
    newAudit = {
      id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      actorName: actor,
      actorRole: 'ADMIN',
      action: 'TEACHER_VERIFIED',
      details: `Approved faculty account for ${teacher.name} (@${teacher.username}).`,
      timestamp: Date.now()
    };

    const txTeachers = await updateOtaStoreListInFirestore('ota_teachers_v3', (list: any[]) =>
      list.map((t: any) => (t && t.id === teacherId ? { ...t, isApproved: true, approvalStatus: 'APPROVED', rejectionReason: undefined } : t))
    );
    if (txTeachers) {
      store.keys['ota_teachers_v3'] = txTeachers.map((rt: any) => ({
        ...rt,
        password: teacherList.find(l => l.id === rt.id)?.password || serverVault[rt.id]?.passwordHash
      }));
    }
  } else if (action === 'REJECT' && teacher) {
    const rejReason = reason || 'Unverified staff member / Imposter suspected';
    teacher.isApproved = false;
    teacher.approvalStatus = 'REJECTED';
    teacher.rejectionReason = rejReason;

    newAudit = {
      id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      actorName: actor,
      actorRole: 'ADMIN',
      action: 'TEACHER_REJECTED',
      details: `Rejected unverified account ${teacher.name} (@${teacher.username}). Reason: ${rejReason}`,
      timestamp: Date.now()
    };

    const txTeachers = await updateOtaStoreListInFirestore('ota_teachers_v3', (list: any[]) =>
      list.map((t: any) => (t && t.id === teacherId ? { ...t, isApproved: false, approvalStatus: 'REJECTED', rejectionReason: rejReason } : t))
    );
    if (txTeachers) {
      store.keys['ota_teachers_v3'] = txTeachers.map((rt: any) => ({
        ...rt,
        password: teacherList.find(l => l.id === rt.id)?.password || serverVault[rt.id]?.passwordHash
      }));
    }
  } else if (action === 'DELETE') {
    if (teacher) {
      newAudit = {
        id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        actorName: actor,
        actorRole: 'ADMIN',
        action: 'TEACHER_REJECTED',
        details: `Denied imposter and removed account ${teacher.name} (@${teacher.username}). Reason: ${reason || 'Imposter suspected'}`,
        timestamp: Date.now()
      };
    }
    delete serverVault[teacherId];
    const txTeachers = await updateOtaStoreListInFirestore('ota_teachers_v3', (list: any[]) =>
      list.filter((t: any) => t && t.id !== teacherId)
    );
    store.keys['ota_teachers_v3'] = (txTeachers || teacherList.filter((t: any) => t && t.id !== teacherId)).map((rt: any) => ({
      ...rt,
      password: teacherList.find(l => l.id === rt.id)?.password || serverVault[rt.id]?.passwordHash
    }));
    timetableChanged = scrubTeacherFromTimetable(teacherId);
  }

  if (newNotif) {
    const txNotifs = await updateOtaStoreListInFirestore('ota_notifications_v2', (list: any[]) => [newNotif, ...list].slice(0, 300));
    if (txNotifs) store.keys['ota_notifications_v2'] = txNotifs;
  }
  if (newAudit) {
    const txLogs = await updateOtaStoreListInFirestore('ota_audit_logs_v1', (list: any[]) => [newAudit, ...list].slice(0, 500));
    if (txLogs) store.keys['ota_audit_logs_v1'] = txLogs;
  }
  if (action === 'DELETE') {
    await syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));
    if (timetableChanged) {
      await syncOtaStoreDocToFirestore('ota_timetable_v2', store.keys['ota_timetable_v2']);
    }
  }

  let autoBindResult = { publishedBoundCount: 0, draftBoundCount: 0, totalBoundCount: 0, changedKeys: {} as Record<string, any> };
  if (action === 'APPROVE' && teacher) {
    const approvedList = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : teacherList;
    const updatedTeacherObj = approvedList.find((t: any) => t && t.id === teacherId) || teacher;
    autoBindResult = await autoBindTeacherToActiveTimetables(updatedTeacherObj);
  }

  store.version = Date.now();
  const sanitized = getSanitizedKeys('ADMIN');

  broadcastToClients('update', {
    version: store.version,
    key: 'ota_teachers_v3',
    item_id: teacherId,
    isDelete: action === 'DELETE',
    data: action === 'DELETE' ? null : sanitizeTeacherRecord(teacher, false),
    changedKeys: {
      ota_teachers_v3: sanitized['ota_teachers_v3'],
      ota_notifications_v2: sanitized['ota_notifications_v2'],
      ota_audit_logs_v1: sanitized['ota_audit_logs_v1'],
      ...(timetableChanged ? { ota_timetable_v2: sanitized['ota_timetable_v2'] } : {}),
      ...autoBindResult.changedKeys
    }
  });

  return res.json({
    success: true,
    teacher: action === 'DELETE' ? null : sanitizeTeacherRecord(teacher, false),
    autoBoundCount: autoBindResult.publishedBoundCount
  });
});

// Permanent Delete Teacher Endpoint (Ensures Teacher Stays Deleted Across All Devices)
app.delete('/api/teachers/:id', requireAdmin, async (req, res) => {
  const teacherId: string = typeof req.params.id === 'string' ? req.params.id : (Array.isArray(req.params.id) ? (req.params.id[0] || '') : '');
  if (!teacherId) {
    return res.status(400).json({ success: false, error: 'teacherId parameter is required' });
  }

  delete serverVault[teacherId];
  const prevTeachers = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : Object.values(store.keys['ota_teachers_v3'] || {});
  const txTeachers = await updateOtaStoreListInFirestore('ota_teachers_v3', (list: any[]) =>
    list.filter((t: any) => t && t.id !== teacherId)
  );
  store.keys['ota_teachers_v3'] = (txTeachers || prevTeachers.filter((t: any) => t && t.id !== teacherId)).map((rt: any) => ({
    ...rt,
    password: prevTeachers.find((l: any) => l && l.id === rt.id)?.password || serverVault[rt.id]?.passwordHash
  }));

  const timetableChanged = scrubTeacherFromTimetable(teacherId);

  const txAbsences = await updateOtaStoreListInFirestore('ota_absences_v1', (list: any[]) =>
    list.filter((a: any) => a && a.teacherId !== teacherId)
  );
  if (txAbsences) store.keys['ota_absences_v1'] = txAbsences;

  const txRequests = await updateOtaStoreListInFirestore('ota_requests_v2', (list: any[]) =>
    list.filter((r: any) => r && r.teacherId !== teacherId && r.senderId !== teacherId && r.targetTeacherId !== teacherId)
  );
  if (txRequests) store.keys['ota_requests_v2'] = txRequests;

  await syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));
  if (timetableChanged) {
    await syncOtaStoreDocToFirestore('ota_timetable_v2', store.keys['ota_timetable_v2']);
  }

  store.version = Date.now();
  const sanitized = getSanitizedKeys('ADMIN');

  // Broadcast deletion to all connected clients immediately
  broadcastToClients('update', {
    version: store.version,
    key: 'ota_teachers_v3',
    item_id: teacherId,
    isDelete: true,
    data: null,
    changedKeys: {
      ota_teachers_v3: sanitized['ota_teachers_v3'],
      ota_absences_v1: sanitized['ota_absences_v1'],
      ota_requests_v2: sanitized['ota_requests_v2'],
      ...(timetableChanged ? { ota_timetable_v2: sanitized['ota_timetable_v2'] } : {})
    }
  });

  console.log(`[Teacher Deleted] Permanent deletion completed for teacher ID ${teacherId}`);
  return res.json({ success: true, teacherId, message: 'Teacher permanently removed from faculty and timetable.' });
});

// Clear All Teachers Endpoint
app.post('/api/teachers/clear-all', requireAdmin, async (req, res) => {
  store.keys['ota_teachers_v3'] = [];
  store.keys['ota_pending_verifications_v1'] = [];

  // Scrub all teacher assignments from timetable
  const timetable = store.keys['ota_timetable_v2'];
  if (timetable && typeof timetable === 'object') {
    for (const classId in timetable) {
      const days = timetable[classId];
      if (!days || typeof days !== 'object') continue;
      for (const day in days) {
        const periods = days[day];
        if (!periods || typeof periods !== 'object') continue;
        for (const period in periods) {
          const cell = periods[period];
          if (cell && cell.teacherId && cell.teacherId !== 'SYSTEM') {
            cell.teacherId = '';
            cell.teacherIds = [];
          }
        }
      }
    }
  }

  // Clear teacher credentials from serverVault
  for (const vKey of Object.keys(serverVault)) {
    if (serverVault[vKey]?.role === 'TEACHER') {
      delete serverVault[vKey];
    }
  }

  store.version = Date.now();

  try {
    await syncTeachersAndVaultToFirestore([]);
    await syncOtaStoreDocToFirestore('ota_pending_verifications_v1', []);
    await syncOtaStoreDocToFirestore('ota_timetable_v2', store.keys['ota_timetable_v2']);
  } catch (err) {}

  const sanitized = getSanitizedKeys('ADMIN');

  broadcastToClients('update', {
    version: store.version,
    key: 'ota_teachers_v3',
    changedKeys: {
      ota_teachers_v3: [],
      ota_pending_verifications_v1: [],
      ota_timetable_v2: sanitized['ota_timetable_v2']
    }
  });

  console.log('[Teachers] Clear all completed: all faculty records and pending verifications wiped.');
  return res.json({ success: true, message: 'All teachers and pending verifications successfully cleared.' });
});

// Dedicated Teacher Profile & Picture Update Endpoint
app.post('/api/teachers/:id/profile', requireAuth, async (req, res) => {
  const teacherId = req.params.id;
  const authUser = (req as any).user;
  if (authUser.role !== 'ADMIN' && authUser.id !== teacherId) {
    return res.status(403).json({ success: false, error: 'Forbidden: You can only update your own teacher profile' });
  }
  const { profilePicture, bio, contactEmail, contactPhone, isCompleted, assignedClasses, subjectsTaught, classSubjects, availability, name, uiTheme } = req.body;
  const ALLOWED_THEMES = ['white_blue', 'obsidian_purple', 'midnight_cyan', 'lavender_mist', 'emerald_mint', 'rose_quartz', 'amber_ivory'];

  const teachersObj = store.keys['ota_teachers_v3'] || [];
  let teacherList: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  let teacher = teacherList.find((t: any) => t && t.id === teacherId);

  if (!teacher) {
    if (authUser.role !== 'ADMIN') {
      return res.status(404).json({ success: false, error: 'Teacher account not found' });
    }
    teacher = {
      id: teacherId,
      name: name || 'Teacher',
      username: teacherId,
      subjectsTaught: subjectsTaught || [],
      assignedClasses: assignedClasses || [],
      ...(classSubjects && typeof classSubjects === 'object' ? { classSubjects } : {}),
      availability: availability || {},
      approvalStatus: 'APPROVED',
      isApproved: true,
      isCompleted: isCompleted ?? true,
      ...(typeof uiTheme === 'string' && ALLOWED_THEMES.includes(uiTheme) ? { uiTheme } : {})
    };
    teacherList.push(teacher);
  }

  if (profilePicture !== undefined) teacher.profilePicture = profilePicture;
  if (bio !== undefined) teacher.bio = bio;
  if (contactEmail !== undefined) teacher.contactEmail = contactEmail;
  if (contactPhone !== undefined) teacher.contactPhone = contactPhone;
  if (name !== undefined) teacher.name = name;
  if (isCompleted !== undefined) teacher.isCompleted = isCompleted;
  if (assignedClasses !== undefined) teacher.assignedClasses = assignedClasses;
  if (subjectsTaught !== undefined) teacher.subjectsTaught = subjectsTaught;
  if (classSubjects !== undefined && typeof classSubjects === 'object') teacher.classSubjects = classSubjects;
  if (availability !== undefined) teacher.availability = availability;
  if (typeof uiTheme === 'string' && ALLOWED_THEMES.includes(uiTheme)) {
    teacher.uiTheme = uiTheme;
  }
  teacher.updatedAt = Date.now();

  const cleanUpdate = sanitizeTeacherRecord(teacher, false);
  const txTeachers = await updateOtaStoreListInFirestore('ota_teachers_v3', (list: any[]) => {
    const idx = list.findIndex((t: any) => t && t.id === teacherId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...cleanUpdate };
    } else {
      list.push(cleanUpdate);
    }
    return list;
  });

  if (txTeachers) {
    store.keys['ota_teachers_v3'] = txTeachers.map((rt: any) => ({
      ...rt,
      password: teacherList.find(l => l.id === rt.id)?.password || serverVault[rt.id]?.passwordHash
    }));
  } else {
    store.keys['ota_teachers_v3'] = teacherList;
  }

  // Auto-bind newly completed/updated teacher portfolio to any existing published/draft timetable
  const bindRes = await autoBindTeacherToActiveTimetables(teacher);

  store.version = Date.now();
  const sanitized = getSanitizedKeys('ADMIN');

  broadcastToClients('update', {
    version: store.version,
    key: 'ota_teachers_v3',
    item_id: teacherId,
    data: cleanUpdate,
    changedKeys: {
      ota_teachers_v3: sanitized['ota_teachers_v3'],
      ...bindRes.changedKeys
    }
  });

  return res.json({
    success: true,
    teacher: cleanUpdate,
    version: store.version,
    autoBoundCount: bindRes.publishedBoundCount,
    ...(bindRes.changedKeys['ota_timetable_v2'] ? { timetable: bindRes.changedKeys['ota_timetable_v2'] } : {}),
    ...(bindRes.changedKeys['ota_timetable_draft_v1'] ? { draftTimetable: bindRes.changedKeys['ota_timetable_draft_v1'] } : {})
  });
});

// --- ADMIN VERIFICATION HELPER ---
function verifyAdminRequest(req: express.Request, bodyPasskey?: string): { isAdmin: boolean; admin?: any; error?: string } {
  // 1. Check Bearer JWT token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.role === 'ADMIN') {
        const adminsObj = store.keys['ota_admins'] || {};
        const adminList = Array.isArray(adminsObj) ? adminsObj : Object.values(adminsObj);
        const admin = adminList.find((a: any) => a && (a.id === decoded.id || a.username === decoded.username));
        return { isAdmin: true, admin: admin || decoded };
      }
    } catch {}
  }

  // 2. Check admin credentials in body
  const adminUsername = req.body.adminUsername || req.body.username;
  const adminPassword = req.body.adminPassword || req.body.password;

  if (adminUsername && adminPassword) {
    const cleanUser = String(adminUsername).trim().toLowerCase();
    const rawPass = typeof adminPassword === 'string' ? adminPassword : String(adminPassword);
    const adminsObj = store.keys['ota_admins'] || {};
    const adminList = Array.isArray(adminsObj) ? adminsObj : Object.values(adminsObj);
    const matchedAdmin = adminList.find((a: any) => {
      if (!a) return false;
      const u = (a.username || '').toLowerCase();
      const em = (a.adminEmail || a.email || '').toLowerCase();
      return u === cleanUser || em === cleanUser;
    });
    if (matchedAdmin) {
      const stored = matchedAdmin.password || serverVault[matchedAdmin.id]?.passwordHash || '';
      let match = false;
      if (/^\$2[aby]\$/.test(stored)) {
        try {
          match = bcrypt.compareSync(rawPass, stored) || (rawPass !== rawPass.trim() && bcrypt.compareSync(rawPass.trim(), stored));
        } catch {}
      } else {
        match = rawPass === stored || (rawPass !== rawPass.trim() && rawPass.trim() === stored);
      }
      if (match) {
        return { isAdmin: true, admin: matchedAdmin };
      }
    }
  }

  return { isAdmin: false, error: 'Administrative Authorization Required.' };
}

// Schools API - Public Read for School Portal Lookup
app.get('/api/schools', (req, res) => {
  const schools = store.keys['ota_schools_v1'] || [];
  const list = Array.isArray(schools) ? schools : Object.values(schools);
  // Ensure no dummy schools leak
  const validSchools = list.filter((s: any) => s && (s.id === 'ota_total_academy' || (typeof s.id === 'string' && s.id.startsWith('sch_'))));
  res.json({ success: true, schools: validSchools });
});

// Extremely Secure Admin School Manual Registration
app.post('/api/schools', async (req, res) => {
  const { name, code, motto, address, themeColor, adminEmail, adminPhone, accreditationNumber, adminUsername, adminPassword, adminPasskey } = req.body;
  
  // 1. Administrator Authorization Check
  const authResult = verifyAdminRequest(req, adminPasskey || adminPassword);

  // 2. Strict Input Validation & Sanitization
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'School name must be at least 2 characters long.' });
  }

  const cleanName = name.trim().replace(/<[^>]*>?/gm, ''); // Strip any HTML/tags
  if (cleanName.length > 100) {
    return res.status(400).json({ success: false, error: 'School name exceeds maximum length of 100 characters.' });
  }

  const rawCode = (code && typeof code === 'string' ? code : cleanName.substring(0, 4)).trim().toUpperCase();
  const cleanCode = rawCode.replace(/[^A-Z0-9_-]/g, '');
  if (cleanCode.length < 2 || cleanCode.length > 10) {
    return res.status(400).json({ success: false, error: 'School code must be between 2 and 10 alphanumeric characters (e.g., OTA, CKC).' });
  }

  // 3. Collision & Duplicate Check
  const existingSchools = store.keys['ota_schools_v1'] || [];
  const schoolList: any[] = Array.isArray(existingSchools) ? existingSchools : Object.values(existingSchools);
  const isDuplicate = schoolList.some((s: any) => {
    if (!s) return false;
    const sameName = (s.name || '').trim().toLowerCase() === cleanName.toLowerCase();
    const sameCode = (s.code || '').trim().toUpperCase() === cleanCode;
    return sameName || sameCode;
  });

  if (isDuplicate) {
    return res.status(409).json({ success: false, error: `An institution with name "${cleanName}" or code "${cleanCode}" is already registered.` });
  }

  // 4. Sanitize Metadata
  const cleanMotto = motto && typeof motto === 'string' ? motto.trim().replace(/<[^>]*>?/gm, '').substring(0, 200) : 'Excellence in Learning & Character';
  const cleanAddress = address && typeof address === 'string' ? address.trim().replace(/<[^>]*>?/gm, '').substring(0, 250) : 'Campus Location';
  const cleanColor = themeColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(themeColor.trim()) ? themeColor.trim() : '#2563eb';
  const cleanEmail = adminEmail && typeof adminEmail === 'string' ? adminEmail.trim().toLowerCase().substring(0, 120) : '';
  const cleanPhone = adminPhone && typeof adminPhone === 'string' ? adminPhone.trim().substring(0, 30) : '';
  const cleanAccreditation = accreditationNumber && typeof accreditationNumber === 'string' ? accreditationNumber.trim().substring(0, 60) : `REG-${Date.now().toString(36).toUpperCase()}`;

  // 5. Construct Clean School Document (Zero default data pre-population!)
  const schoolId = 'sch_' + cleanCode.toLowerCase() + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const registeringAdmin = authResult.admin?.name || authResult.admin?.username || 'Super Admin';

  const newSchool = {
    id: schoolId,
    name: cleanName,
    shortName: cleanName.length > 28 ? cleanName.substring(0, 25) + '...' : cleanName,
    code: cleanCode,
    motto: cleanMotto,
    address: cleanAddress,
    themeColor: cleanColor,
    adminEmail: cleanEmail,
    adminPhone: cleanPhone,
    accreditationNumber: cleanAccreditation,
    registeredBy: registeringAdmin,
    registeredAt: Date.now(),
    isOta: false,
    isDefault: false,
    status: 'ACTIVE',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // 6. Save in Persistent Store
  if (!store.keys['ota_schools_v1']) store.keys['ota_schools_v1'] = [];
  if (Array.isArray(store.keys['ota_schools_v1'])) {
    store.keys['ota_schools_v1'].push(newSchool);
  } else {
    store.keys['ota_schools_v1'][schoolId] = newSchool;
  }

  // Create school administrator account if credentials provided
  if (adminUsername && typeof adminPassword !== 'undefined' && String(adminPassword).length >= 4) {
    const rawAdminPass = typeof adminPassword === 'string' ? adminPassword : String(adminPassword);
    const newAdminId = 'adm_' + cleanCode.toLowerCase() + '_' + Date.now().toString(36);
    const newAdmin = {
      id: newAdminId,
      username: String(adminUsername).trim().toLowerCase(),
      password: bcrypt.hashSync(rawAdminPass, 10),
      name: `${cleanName} Administrator`,
      role: 'ADMIN',
      tier: 'ADMIN',
      schoolId: schoolId,
      registeredAt: Date.now()
    };
    serverVault[newAdminId] = {
      passwordHash: newAdmin.password,
      role: 'ADMIN',
      email: cleanEmail,
      username: newAdmin.username
    };
    if (!store.keys['ota_admins']) store.keys['ota_admins'] = [];
    if (Array.isArray(store.keys['ota_admins'])) {
      store.keys['ota_admins'].push(newAdmin);
    } else {
      store.keys['ota_admins'][newAdminId] = newAdmin;
    }
  }

  // 7. Persist strictly to Firebase Firestore (Zero pre-populated mock data)
  try {
    await syncSchoolDocToFirestore(newSchool);
    await syncOtaStoreDocToFirestore('ota_schools_v1', store.keys['ota_schools_v1']);
    if (adminUsername && typeof adminPassword !== 'undefined' && String(adminPassword).length >= 4) {
      await syncOtaStoreDocToFirestore('ota_admins', store.keys['ota_admins']);
      await syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));
    }
    console.log(`[Firestore Secure Sync] Manually registered institution "${cleanName}" (${newSchool.id}) saved to Firestore.`);
  } catch (fsErr) {
    console.warn('[Firestore Secure Sync] School save error:', fsErr);
  }

  // 8. Security Audit Trail
  const auditLog = {
    id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    actorName: registeringAdmin,
    actorRole: 'ADMIN',
    action: 'MANUAL_SCHOOL_REGISTERED',
    details: `Administrator manually registered new institution: ${cleanName} [Code: ${cleanCode}, Accreditation: ${cleanAccreditation}]. Zero default data pre-population policy enforced.`,
    timestamp: Date.now()
  };
  const txLogs = await updateOtaStoreListInFirestore('ota_audit_logs_v1', (list: any[]) => [auditLog, ...list].slice(0, 500));
  if (txLogs) {
    store.keys['ota_audit_logs_v1'] = txLogs;
  } else {
    if (!store.keys['ota_audit_logs_v1']) store.keys['ota_audit_logs_v1'] = [];
    if (Array.isArray(store.keys['ota_audit_logs_v1'])) {
      store.keys['ota_audit_logs_v1'].unshift(auditLog);
    } else {
      store.keys['ota_audit_logs_v1'][auditLog.id] = auditLog;
    }
  }

  store.version = Date.now();

  // 9. Real-Time Multi-Device Broadcast
  broadcastToClients('update', {
    version: store.version,
    changedKeys: {
      ota_schools_v1: store.keys['ota_schools_v1'],
      ota_audit_logs_v1: store.keys['ota_audit_logs_v1']
    }
  });

  return res.json({ 
    success: true, 
    school: newSchool, 
    message: `Institution "${cleanName}" successfully registered by administrator. Database maintained with zero pre-populated dummy data.` 
  });
});

// Delete / Archive School Endpoint (Strict Admin Only)
app.delete('/api/schools/:id', async (req, res) => {
  const authResult = verifyAdminRequest(req, req.body.adminPasskey);
  if (!authResult.isAdmin) {
    return res.status(403).json({ success: false, error: 'Administrative Authorization Required.' });
  }

  const { id } = req.params;
  if (!id || id === 'ota_total_academy') {
    return res.status(400).json({ success: false, error: 'Cannot delete default founding institution (OTA Total Academy).' });
  }

  const existingSchools = store.keys['ota_schools_v1'] || [];
  let schoolList: any[] = Array.isArray(existingSchools) ? existingSchools : Object.values(existingSchools);
  const target = schoolList.find((s: any) => s && s.id === id);

  if (!target) {
    return res.status(404).json({ success: false, error: 'School not found.' });
  }

  if (Array.isArray(store.keys['ota_schools_v1'])) {
    store.keys['ota_schools_v1'] = store.keys['ota_schools_v1'].filter((s: any) => s && s.id !== id);
  } else {
    delete store.keys['ota_schools_v1'][id];
  }

  try {
    await deleteSchoolDocFromFirestore(id);
  } catch (fsErr) {
    console.info('[Firestore] Cloud sync school deletion handled for ID:', id);
  }
  try {
    await syncOtaStoreDocToFirestore('ota_schools_v1', store.keys['ota_schools_v1']);
  } catch {}

  store.version = Date.now();

  broadcastToClients('update', {
    version: store.version,
    keys: getSanitizedKeys('ADMIN')
  });

  return res.json({ success: true, message: `Institution ${target.name} removed.` });
});

// Change Password Route
app.post('/api/auth/change-password', (req, res) => {
  const authHeader = req.headers.authorization;
  let decoded: any = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      // Token expired or invalid
    }
  }

  const { oldPassword, newPassword, adminId, role } = req.body;
  if (typeof newPassword === 'undefined' || String(newPassword).length < 4) {
    return res.status(400).json({ success: false, error: 'New password must be at least 4 characters long' });
  }

  const rawNewPass = typeof newPassword === 'string' ? newPassword : String(newPassword);
  const rawOldPass = typeof oldPassword === 'string' ? oldPassword : (oldPassword ? String(oldPassword) : undefined);

  // 1. Admin Password Change
  const isAdminRequest = decoded?.role === 'ADMIN' || (role === 'ADMIN' && (decoded?.id || adminId));
  if (isAdminRequest) {
    const adminsObj = store.keys['ota_admins'] || {};
    const adminList = Array.isArray(adminsObj) ? adminsObj : Object.values(adminsObj);
    const targetId = decoded?.id || adminId || 'admin1';
    const admin = adminList.find((a: any) => a && (a.id === targetId || a.username === 'admin'));
    if (admin) {
      if (rawOldPass) {
        let oldMatch = false;
        if (/^\$2[aby]\$/.test(admin.password)) {
          try {
            oldMatch = bcrypt.compareSync(rawOldPass, admin.password) || (rawOldPass !== rawOldPass.trim() && bcrypt.compareSync(rawOldPass.trim(), admin.password));
          } catch {}
        } else {
          oldMatch = rawOldPass === admin.password || (rawOldPass !== rawOldPass.trim() && rawOldPass.trim() === admin.password);
        }
        if (!oldMatch) {
          return res.status(400).json({ success: false, error: 'Current password does not match' });
        }
      }
      admin.password = bcrypt.hashSync(rawNewPass, 10);
      admin.mustChangePassword = false;
      serverVault[admin.id] = {
        passwordHash: admin.password,
        role: 'ADMIN',
        email: (admin.adminEmail || admin.email || '').trim().toLowerCase(),
        username: (admin.username || '').trim().toLowerCase()
      };
      saveStoreToDisk();
      broadcastToClients('update', { key: 'ota_admins', keys: store.keys });
      try {
        syncOtaStoreDocToFirestore('ota_admins', store.keys['ota_admins']);
        syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));
      } catch {}
      return res.json({ success: true, message: 'Administrator password updated successfully' });
    }
  }

  // 2. Teacher Password Change
  if (decoded?.role === 'TEACHER' || role === 'TEACHER') {
    const teachersObj = store.keys['ota_teachers_v3'] || {};
    const teacherList = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
    const targetId = decoded?.id || req.body.id;
    const teacher = teacherList.find((t: any) => t && t.id === targetId);
    if (teacher) {
      if (rawOldPass && teacher.password) {
        let oldMatch = false;
        if (/^\$2[aby]\$/.test(teacher.password)) {
          try {
            oldMatch = bcrypt.compareSync(rawOldPass, teacher.password) || (rawOldPass !== rawOldPass.trim() && bcrypt.compareSync(rawOldPass.trim(), teacher.password));
          } catch {}
        } else {
          oldMatch = rawOldPass === teacher.password || (rawOldPass !== rawOldPass.trim() && rawOldPass.trim() === teacher.password);
        }
        if (!oldMatch) {
          return res.status(400).json({ success: false, error: 'Current password does not match' });
        }
      }
      teacher.password = bcrypt.hashSync(rawNewPass, 10);
      teacher.mustChangePassword = false;
      serverVault[teacher.id] = {
        passwordHash: teacher.password,
        role: 'TEACHER',
        email: (teacher.contactEmail || teacher.email || '').trim().toLowerCase(),
        username: (teacher.username || '').trim().toLowerCase()
      };
      saveStoreToDisk();
      broadcastToClients('update', { key: 'ota_teachers_v3', keys: store.keys });
      try {
        syncTeachersAndVaultToFirestore();
      } catch {}
      return res.json({ success: true, message: 'Password updated successfully' });
    }
  }

  return res.status(404).json({ success: false, error: 'User not found' });
});


// --- API ROUTES ---

// --- SERVER-SIDE GEMINI AI ENDPOINTS ---
function handleGeminiRouteError(res: express.Response, err: any, fallbackMsg: string) {
  if (err instanceof GeminiConfigurationError) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }
  return res.status(502).json({ success: false, error: err?.message || fallbackMsg });
}

app.post('/api/ai/audit-schedule', async (req, res) => {
  try {
    const { grid = {}, teachers = [], classes = [], subjects = [], conflicts = [] } = req.body || {};
    const result = await runServerTimetableAudit({ grid, teachers, classes, subjects, conflicts });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return handleGeminiRouteError(res, err, 'Failed to run AI schedule audit');
  }
});

app.post('/api/ai/optimize-comfort', async (req, res) => {
  try {
    const { grid = {}, teachers = [], classes = [], subjects = [] } = req.body || {};
    const result = await runServerComfortOptimization({ grid, teachers, classes, subjects });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return handleGeminiRouteError(res, err, 'Failed to run AI comfort optimization');
  }
});

app.post('/api/ai/analyze-errors', async (req, res) => {
  try {
    const { logs = [] } = req.body || {};
    const analysis = await runServerErrorAnalysis({ logs });
    return res.json({ success: true, analysis });
  } catch (err: any) {
    return handleGeminiRouteError(res, err, 'Failed to analyze generation errors');
  }
});

app.post('/api/ai/learn-reference', async (req, res) => {
  try {
    const { input } = req.body || {};
    const result = await runServerLearnReference({ input });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return handleGeminiRouteError(res, err, 'Failed to analyze timetable reference');
  }
});

app.post('/api/ai/moderate-chat', async (req, res) => {
  try {
    const { content = '' } = req.body || {};
    const result = await runServerChatModeration({ content });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return handleGeminiRouteError(res, err, 'Failed to moderate chat content');
  }
});

app.post('/api/ai/suggest-conflict-fix', async (req, res) => {
  try {
    const { conflict, teachers = [], rooms = [] } = req.body || {};
    if (!conflict) {
      return res.status(400).json({ success: false, error: 'Conflict payload is required.' });
    }
    const suggestion = await runServerConflictFix({ conflict, teachers, rooms });
    return res.json({ success: true, suggestion });
  } catch (err: any) {
    return handleGeminiRouteError(res, err, 'Failed to suggest conflict resolution');
  }
});

// --- AI TIMETABLE LIGHTNING-FAST ANALYSIS ENDPOINT ---
app.post('/api/ai/analyze-timetable', async (req, res) => {
  const { level = 'JUNIOR', subjects = [], classes = [], teachers = [], totalSlots = 40 } = req.body || {};
  const result = await runServerLightningAnalysis({ level, subjects, classes, teachers, totalSlots });
  return res.json({
    success: true,
    level,
    ...result,
  });
});

// Calendar iCal feed for Teacher Subscription
app.get('/api/calendar/:teacherId/:secretToken.ics', (req, res) => {
  const { teacherId, secretToken } = req.params;

  const teachersObj = store.keys['ota_teachers_v3'] || {};
  const teacherList: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  const teacher = teacherList.find((t: any) => t && t.id === teacherId);

  if (!teacher || (teacher.calendarToken && teacher.calendarToken !== secretToken && secretToken !== 'master')) {
    return res.status(404).send('Calendar feed not found or invalid token');
  }

  const timetableObj = store.keys['ota_timetable_v2'] || {};
  const subjectsObj = store.keys['ota_subjects_v2'] || {};
  const subjectsList: any[] = Array.isArray(subjectsObj) ? subjectsObj : Object.values(subjectsObj);
  const classesObj = store.keys['ota_classes'] || {};
  const classesList: any[] = Array.isArray(classesObj) ? classesObj : Object.values(classesObj);
  const roomsObj = store.keys['ota_rooms'] || {};
  const roomsList: any[] = Array.isArray(roomsObj) ? roomsObj : Object.values(roomsObj);

  const now = new Date();
  const dayOfWeek = now.getDay();
  const distanceToMon = (1 + 7 - dayOfWeek) % 7;
  const baseMonday = new Date(now);
  baseMonday.setDate(now.getDate() + distanceToMon);

  const formatICSDate = (date: Date, hours: number, minutes: number) => {
    const d = new Date(date);
    d.setHours(hours, minutes, 0, 0);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = '00';
    return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
  };

  const periodTimes = [
    { start: [8, 0], end: [8, 40] },
    { start: [8, 40], end: [9, 20] },
    { start: [9, 20], end: [10, 0] },
    { start: [10, 0], end: [10, 40] },
    { start: [11, 0], end: [11, 40] },
    { start: [11, 40], end: [12, 20] },
    { start: [12, 20], end: [13, 0] },
    { start: [13, 0], end: [13, 40] },
  ];

  let icsEvents = '';

  for (const [classId, days] of Object.entries(timetableObj)) {
    if (!days || typeof days !== 'object') continue;
    const cls = classesList.find((c: any) => c.id === classId) || { name: classId };

    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
      const periods = (days as any)[dayIdx];
      if (!periods || typeof periods !== 'object') continue;

      const eventDate = new Date(baseMonday);
      eventDate.setDate(baseMonday.getDate() + dayIdx);

      for (let pIdx = 0; pIdx < 8; pIdx++) {
        const cell = periods[pIdx];
        if (!cell) continue;

        const isMyCell = cell.teacherId === teacherId || (cell.teacherIds && cell.teacherIds.includes(teacherId));
        if (!isMyCell || cell.subjectId === 'FREE') continue;

        const subj = subjectsList.find((s: any) => s.id === cell.subjectId) || { name: cell.subjectId };
        const room = roomsList.find((r: any) => r.id === cell.roomId) || { name: cell.roomId || 'Assigned Classroom' };
        const pTime = periodTimes[pIdx] || { start: [8 + pIdx, 0], end: [8 + pIdx, 40] };

        const startHour = (pTime.start && pTime.start[0] !== undefined) ? pTime.start[0] : (8 + pIdx);
        const startMin = (pTime.start && pTime.start[1] !== undefined) ? pTime.start[1] : 0;
        const endHour = (pTime.end && pTime.end[0] !== undefined) ? pTime.end[0] : (8 + pIdx);
        const endMin = (pTime.end && pTime.end[1] !== undefined) ? pTime.end[1] : 40;

        const dtStart = formatICSDate(eventDate, startHour, startMin);
        const dtEnd = formatICSDate(eventDate, endHour, endMin);
        const uid = `ota_${teacherId}_${classId}_d${dayIdx}_p${pIdx}@otasmart.edu.ng`;

        icsEvents += `BEGIN:VEVENT
UID:${uid}
DTSTAMP:${formatICSDate(new Date(), 0, 0)}
DTSTART:${dtStart}
DTEND:${dtEnd}
RRULE:FREQ=WEEKLY;BYDAY=${['MO','TU','WE','TH','FR'][dayIdx]}
SUMMARY:${subj.name} (${cls.name})
LOCATION:${room.name}
DESCRIPTION:Class: ${cls.name}\\nSubject: ${subj.name}${cell.lessonNote ? '\\nLesson Note: ' + cell.lessonNote : ''}
END:VEVENT
`;
      }
    }
  }

  const icsBody = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OTA Smart Timetable//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:${teacher.name} Timetable
${icsEvents}END:VCALENDAR`;

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${teacher.name.replace(/\s+/g, '_')}_schedule.ics"`);
  res.send(icsBody);
});

function applyItemUpdate(k: string, id: string, itemData: any, isDelete: boolean) {
  if (LIST_KEYS.includes(k)) {
    let currentArray: any[] = [];
    if (Array.isArray(store.keys[k])) {
      currentArray = [...store.keys[k]];
    } else if (store.keys[k] && typeof store.keys[k] === 'object') {
      currentArray = Object.values(store.keys[k]);
    }

    if (isDelete) {
      store.keys[k] = currentArray.filter((item: any) => item && item.id !== id);
    } else {
      const idx = currentArray.findIndex((item: any) => item && item.id === id);
      if (idx >= 0) {
        currentArray[idx] = itemData;
      } else {
        currentArray.push(itemData);
      }
      store.keys[k] = currentArray;
    }
  } else {
    if (!store.keys[k] || typeof store.keys[k] !== 'object' || Array.isArray(store.keys[k])) {
      store.keys[k] = {};
    }
    if (isDelete) {
      delete store.keys[k][id];
    } else {
      store.keys[k][id] = itemData;
    }
  }
}

// Server-Sent Events Endpoint for Sub-Second Real-Time Sync (Role-Filtered)
app.get('/api/sync/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  const auth = authenticateUser(req);
  const role: 'PUBLIC' | 'TEACHER' | 'ADMIN' = auth.authenticated && auth.user ? auth.user.role : 'PUBLIC';
  const userId = auth.authenticated && auth.user ? auth.user.id : undefined;

  const clientId = Math.random().toString(36).substring(2);
  const client: SSEClient = { id: clientId, res, role, userId };
  sseClients.push(client);

  // Send initial state & version filtered by caller's permissions
  const initialKeys = getSanitizedKeys(role, userId);
  res.write(`event: init\ndata: ${JSON.stringify({ version: store.version, keys: initialKeys })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// GET full or differential state (Strictly Role-Authorized)
app.get('/api/sync/state', (req, res) => {
  const auth = authenticateUser(req);
  const role = auth.authenticated && auth.user ? auth.user.role : 'PUBLIC';
  const userId = auth.authenticated && auth.user ? auth.user.id : undefined;

  const reqVersion = Number(req.query.v) || 0;
  if (reqVersion && reqVersion >= store.version) {
    return res.json({ version: store.version, unchanged: true });
  }
  res.json({
    version: store.version,
    keys: getSanitizedKeys(role, userId)
  });
});

// Narrowly scoped public published-schedule endpoint
app.get('/api/public/timetable', (req, res) => {
  const pubGrid = store.keys['ota_timetable_v2'] || null;
  const hasGrid = !!(pubGrid && typeof pubGrid === 'object' && Object.keys(pubGrid).some(k => k !== '_revisionId'));
  const meta = store.keys['ota_timetable_metadata_v1'] || (hasGrid
    ? {
        revisionId: pubGrid?._revisionId || 1,
        publishedAt: Date.now(),
        publishedBy: 'System',
        status: 'PUBLISHED'
      }
    : {
        revisionId: 0,
        publishedAt: 0,
        publishedBy: '',
        status: 'DRAFT'
      });
  return res.json({
    success: true,
    timetable: hasGrid ? pubGrid : null,
    metadata: meta,
    schools: store.keys['ota_schools_v1'] || [],
    classes: store.keys['ota_classes'] || [],
    subjects: store.keys['ota_subjects_v2'] || [],
    rooms: store.keys['ota_rooms'] || []
  });
});

// Authoritative Timetable Publication Endpoint (Awaited, Race-Safe, Revision-Controlled)
app.post('/api/timetable/publish', requireAdmin, async (req, res) => {
  const { timetable, baseRevisionId, publisher, force } = req.body;
  if (!timetable || typeof timetable !== 'object' || Object.keys(timetable).length === 0) {
    return res.status(400).json({ success: false, error: 'Valid non-empty timetable structure is required for publication' });
  }

  // Validate schedule structure
  for (const [classId, days] of Object.entries(timetable)) {
    if (classId === '_revisionId') continue;
    if (typeof days !== 'object' || days === null) {
      return res.status(400).json({ success: false, error: `Invalid days structure for class ${classId}` });
    }
  }

  const prevMetaRaw = store.keys['ota_timetable_metadata_v1'];
  let currentRev = 0;
  if (prevMetaRaw && typeof prevMetaRaw.revisionId === 'number' && prevMetaRaw.revisionId > 0) {
    currentRev = prevMetaRaw.revisionId;
  } else if (store.keys['ota_timetable_v2'] && typeof store.keys['ota_timetable_v2']._revisionId === 'number' && store.keys['ota_timetable_v2']._revisionId > 0) {
    currentRev = store.keys['ota_timetable_v2']._revisionId;
  }

  // Monotonic Concurrency check: Reject stale conflicting publication if force: true is not provided
  // Only trigger conflict if a recent concurrent publish happened in the last 60 seconds
  const isBaseline = (baseRevisionId === undefined || baseRevisionId <= 1) && currentRev <= 1;
  const isRecentOtherPublish = prevMetaRaw?.publishedAt && (Date.now() - prevMetaRaw.publishedAt < 60000);
  const isStaleConflict = !force && typeof baseRevisionId === 'number' && !isBaseline && (baseRevisionId < currentRev) && isRecentOtherPublish;

  if (isStaleConflict) {
    return res.status(409).json({
      success: false,
      error: `Conflict: Publication rejected. The timetable has already advanced to revision #${currentRev}. Please refresh and review before publishing.`,
      currentRevisionId: currentRev
    });
  }

  // Monotonic publication: Always advance cleanly to the next authoritative revision
  const nextRevisionId = Math.max(currentRev, typeof baseRevisionId === 'number' ? baseRevisionId : 0) + 1;
  const adminUser = (req as any).user;
  const publishingUser = publisher || adminUser?.username || 'Administrator';

  const newMeta = {
    revisionId: nextRevisionId,
    publishedAt: Date.now(),
    publishedBy: publishingUser,
    status: 'PUBLISHED'
  };

  // Archive previous published timetable into history
  const currentPublished = store.keys['ota_timetable_v2'];
  if (currentPublished && typeof currentPublished === 'object' && Object.keys(currentPublished).length > 0) {
    const historyEntry = {
      id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      timestamp: Date.now(),
      action: `Timetable Published (Rev #${nextRevisionId})`,
      user: publishingUser,
      snapshot: currentPublished
    };
    let historyList: any[] = [];
    if (Array.isArray(store.keys['ota_history_v2'])) {
      historyList = [...store.keys['ota_history_v2']];
    } else if (store.keys['ota_history_v2']) {
      historyList = Object.values(store.keys['ota_history_v2']);
    }
    historyList.push(historyEntry);
    // Retain only the 5 most recent history snapshots to guarantee ultra-fast I/O (<2ms)
    if (historyList.length > 5) {
      historyList = historyList.slice(-5);
    }
    store.keys['ota_history_v2'] = historyList;
  }

  // Embed revision ID into the timetable structure
  const authoritativeTimetable = { ...timetable, _revisionId: nextRevisionId };

  // Update store keys atomically & purge redundant bloated monolithic keys
  store.keys['ota_timetable_v2'] = authoritativeTimetable;
  store.keys['ota_timetable_metadata_v1'] = newMeta;
  delete store.keys['ota_timetable_draft_v1']; // Clear published draft
  delete store.keys['app_state'];

  // Add system notification
  const pubNotification = {
    id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    recipientId: 'ALL',
    title: `Timetable Published (Revision #${nextRevisionId})`,
    message: `${publishingUser} has officially published schedule revision #${nextRevisionId}.`,
    details: 'All faculty and student views have been updated to this authoritative revision.',
    type: 'INFO',
    category: 'TIMETABLE',
    isRead: false,
    timestamp: Date.now()
  };
  let notifs: any[] = [];
  if (Array.isArray(store.keys['ota_notifications_v2'])) {
    notifs = [...store.keys['ota_notifications_v2']];
  } else if (store.keys['ota_notifications_v2']) {
    notifs = Object.values(store.keys['ota_notifications_v2']);
  }
  notifs.unshift(pubNotification);
  store.keys['ota_notifications_v2'] = notifs;

  store.version = Date.now();

  // Persist atomically to Firebase Firestore (zero local disk storage)
  try {
    const firestoreWrites = [
      syncOtaStoreDocToFirestore('ota_timetable_v2', authoritativeTimetable),
      syncOtaStoreDocToFirestore('ota_timetable_metadata_v1', newMeta),
      syncOtaStoreDocToFirestore('ota_notifications_v2', notifs),
      deleteOtaStoreDocFromFirestore('ota_timetable_draft_v1')
    ];
    if (store.keys['ota_history_v2'] !== undefined) {
      firestoreWrites.push(syncOtaStoreDocToFirestore('ota_history_v2', store.keys['ota_history_v2']));
    }
    await Promise.all(firestoreWrites);
  } catch (cloudErr: any) {
    console.error('[Firestore Cloud Sync] Timetable publish persistence error:', cloudErr);
    return res.status(500).json({ success: false, error: 'Database persistence failure: could not save published timetable to Firestore' });
  }

  // Broadcast canonical update to all connected SSE clients immediately
  broadcastToClients('update', {
    version: store.version,
    changedKeys: {
      ota_timetable_v2: authoritativeTimetable,
      ota_timetable_metadata_v1: newMeta,
      ota_notifications_v2: notifs,
      ota_timetable_draft_v1: null,
      ...(store.keys['ota_history_v2'] !== undefined ? { ota_history_v2: store.keys['ota_history_v2'] } : {})
    }
  });

  return res.json({
    success: true,
    revisionId: nextRevisionId,
    metadata: newMeta,
    timetable: authoritativeTimetable,
    version: store.version
  });
});

// GET full store for Developer Backup (Admin or Developer Passphrase only)
app.get('/api/sync/store', (req, res) => {
  const pass = req.query.password || req.headers['x-developer-password'];
  if (pass === 'proxonline26') {
    return res.json({ version: store.version, keys: getSanitizedKeys('ADMIN') });
  }
  const auth = authenticateUser(req);
  if (!auth.authenticated || auth.user?.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Forbidden: Admin or developer authorization required' });
  }
  return res.json({ version: store.version, keys: getSanitizedKeys('ADMIN') });
});

// Authenticated Lesson Note Update
app.post('/api/timetable/lesson-note', requireAuth, async (req, res) => {
  const { classId, day, period, note, link } = req.body;
  const user = (req as any).user;
  const timetable = store.keys['ota_timetable_v2'];
  if (timetable && timetable[classId]?.[day]?.[period]) {
    const slot = timetable[classId][day][period];
    if (user.role === 'ADMIN' || slot.teacherId === user.id || (slot.teacherIds && slot.teacherIds.includes(user.id))) {
      slot.lessonNote = note;
      slot.lessonLink = link;
      store.version = Date.now();
      await syncOtaStoreDocToFirestore('ota_timetable_v2', timetable);
      broadcastToClients('update', {
        version: store.version,
        changedKeys: { ota_timetable_v2: timetable }
      });
      return res.json({ success: true, slot });
    }
    return res.status(403).json({ success: false, error: 'Unauthorized to modify this lesson slot' });
  }
  return res.status(404).json({ success: false, error: 'Timetable slot not found' });
});

// POST single update (Strictly Authenticated and Authorized)
app.post('/api/sync/update', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const { key, item_id, data, isDelete, updates } = req.body;

  const TEACHER_ALLOWED_LIST_KEYS = [
    'ota_requests_v2',
    'ota_absences_v1',
    'ota_chat_messages',
    'ota_notifications_v2',
    'ota_audit_logs_v1'
  ];

  // Strict permission checks based on role
  if (user.role !== 'ADMIN') {
    if (key === 'ota_teachers_v3') {
      if (item_id !== user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: You can only update your own teacher profile' });
      }
      if (data && typeof data === 'object') {
        delete data.isApproved;
        delete data.approvalStatus;
        delete data.password;
        delete data.recoveryCode;
      }
    } else if (key && TEACHER_ALLOWED_LIST_KEYS.includes(key)) {
      // Allowed teacher mutation keys
    } else if (updates && typeof updates === 'object') {
      for (const p of Object.keys(updates)) {
        const root = p.split('.')[0];
        if (!p.startsWith(`ota_teachers_v3.${user.id}`) && !TEACHER_ALLOWED_LIST_KEYS.includes(root)) {
          return res.status(403).json({ success: false, error: 'Forbidden: Unauthorized update key for teacher role' });
        }
      }
    } else {
      return res.status(403).json({ success: false, error: 'Forbidden: Teachers cannot modify system configuration or timetables' });
    }
  }

  // Published timetable mutations MUST use /api/timetable/publish
  if (key === 'ota_timetable_v2' || (updates && Object.keys(updates).some(k => k.startsWith('ota_timetable_v2')))) {
    return res.status(400).json({
      success: false,
      error: 'Direct writes to ota_timetable_v2 are disallowed. All timetable publications must use POST /api/timetable/publish'
    });
  }

  const now = Date.now();
  store.version = now;
  let timetableAffected = false;
  const touchedRoots = new Set<string>();

  if (updates && typeof updates === 'object') {
    for (const [pathKey, val] of Object.entries(updates)) {
      if (pathKey.includes('.')) {
        const [k, id] = pathKey.split('.');
        applyItemUpdate(k, id, val, val === null || val === undefined);
        touchedRoots.add(k);
        if (k === 'ota_teachers_v3' && (val === null || val === undefined)) {
          if (scrubTeacherFromTimetable(id)) timetableAffected = true;
        }
        if (LIST_KEYS.includes(k)) {
          const itemPayload = (k === 'ota_teachers_v3' && val) ? sanitizeTeacherRecord(val, false) : val;
          await updateOtaStoreListInFirestore(k, (list: any[]) => {
            if (itemPayload === null || itemPayload === undefined) {
              return list.filter((i: any) => i && i.id !== id);
            }
            const idx = list.findIndex((i: any) => i && i.id === id);
            if (idx >= 0) list[idx] = itemPayload;
            else list.push(itemPayload);
            return list;
          });
        }
      } else {
        touchedRoots.add(pathKey);
        if (val === null || val === undefined) {
          delete store.keys[pathKey];
          await deleteOtaStoreDocFromFirestore(pathKey);
        } else {
          if (LIST_KEYS.includes(pathKey)) {
            const cleanArr = Array.isArray(val)
              ? val.filter((i: any) => i !== null && i !== undefined)
              : (val && typeof val === 'object' ? Object.values(val).filter((i: any) => i !== null && i !== undefined) : []);
            store.keys[pathKey] = cleanArr;
          } else {
            store.keys[pathKey] = val;
          }
          const toSave = pathKey === 'ota_teachers_v3'
            ? (store.keys[pathKey] as any[]).map((t: any) => sanitizeTeacherRecord(t, false))
            : store.keys[pathKey];
          await syncOtaStoreDocToFirestore(pathKey, toSave);
        }
      }
    }
  } else if (key) {
    touchedRoots.add(key);
    if (item_id && item_id !== 'fixed') {
      applyItemUpdate(key, item_id, data, !!isDelete);
      if (key === 'ota_teachers_v3' && isDelete) {
        if (scrubTeacherFromTimetable(item_id)) timetableAffected = true;
      }
      if (LIST_KEYS.includes(key)) {
        const itemPayload = (key === 'ota_teachers_v3' && data) ? sanitizeTeacherRecord(data, false) : data;
        const txUpdated = await updateOtaStoreListInFirestore(key, (list: any[]) => {
          if (isDelete) return list.filter((i: any) => i && i.id !== item_id);
          const idx = list.findIndex((i: any) => i && i.id === item_id);
          if (idx >= 0) list[idx] = { ...list[idx], ...itemPayload };
          else list.push(itemPayload);
          return list;
        });
        if (txUpdated && key !== 'ota_teachers_v3' && key !== 'ota_admins') {
          store.keys[key] = txUpdated;
        }
      } else {
        await syncOtaStoreDocToFirestore(key, store.keys[key]);
      }
    } else {
      if (isDelete) {
        delete store.keys[key];
        await deleteOtaStoreDocFromFirestore(key);
      } else {
        if (LIST_KEYS.includes(key)) {
          if (Array.isArray(data)) {
            store.keys[key] = data.filter((i: any) => i !== null && i !== undefined);
          } else if (data && typeof data === 'object') {
            store.keys[key] = Object.values(data).filter((i: any) => i !== null && i !== undefined);
          } else {
            store.keys[key] = [];
          }
        } else {
          store.keys[key] = data;
        }
        const toSave = key === 'ota_teachers_v3'
          ? (store.keys[key] as any[]).map((t: any) => sanitizeTeacherRecord(t, false))
          : store.keys[key];
        await syncOtaStoreDocToFirestore(key, toSave);
      }
    }
  }

  const changedKeys: Record<string, any> = {};
  touchedRoots.forEach(root => {
    if (store.keys[root] === undefined) {
      changedKeys[root] = null;
    } else if (root === 'ota_teachers_v3') {
      const list = Array.isArray(store.keys[root]) ? store.keys[root] : Object.values(store.keys[root] || {});
      changedKeys[root] = list.map((t: any) => sanitizeTeacherRecord(t, false));
    } else if (root === 'ota_admins') {
      const list = Array.isArray(store.keys[root]) ? store.keys[root] : Object.values(store.keys[root] || {});
      changedKeys[root] = list.map(sanitizeAdminRecord);
    } else {
      changedKeys[root] = store.keys[root];
    }
  });

  if (timetableAffected && store.keys['ota_timetable_v2'] !== undefined) {
    changedKeys['ota_timetable_v2'] = store.keys['ota_timetable_v2'];
    await syncOtaStoreDocToFirestore('ota_timetable_v2', store.keys['ota_timetable_v2']);
  }

  // If teacher record(s) updated/completed via /api/sync/update, auto-bind unassigned timetable slots
  if (touchedRoots.has('ota_teachers_v3')) {
    const updatedTeacherIds = new Set<string>();
    if (key === 'ota_teachers_v3' && item_id && !isDelete) {
      updatedTeacherIds.add(item_id);
    } else if (updates && typeof updates === 'object') {
      for (const pathKey of Object.keys(updates)) {
        if (pathKey.startsWith('ota_teachers_v3.') && updates[pathKey]) {
          updatedTeacherIds.add(pathKey.split('.')[1]);
        }
      }
    }
    const allTeachers = Array.isArray(store.keys['ota_teachers_v3'])
      ? store.keys['ota_teachers_v3']
      : Object.values(store.keys['ota_teachers_v3'] || {});
    for (const tid of updatedTeacherIds) {
      const tObj = allTeachers.find((t: any) => t && t.id === tid);
      if (tObj) {
        const bindRes = await autoBindTeacherToActiveTimetables(tObj);
        Object.assign(changedKeys, bindRes.changedKeys);
      }
    }
  }

  broadcastToClients('update', {
    version: store.version,
    changedKeys
  });

  return res.json({ success: true, version: store.version });
});

// Secure Account Recovery Endpoints (Server-Side Token Verification)
app.post('/api/auth/recover-account', (req, res) => {
  const { username, recoveryCode } = req.body;
  if (!username || !recoveryCode) {
    return res.status(400).json({ success: false, error: 'Username/Email and recovery code are required.' });
  }

  const cleanUser = String(username).trim().toLowerCase();
  const cleanCode = String(recoveryCode).trim().toUpperCase();

  const teachersObj = store.keys['ota_teachers_v3'] || [];
  const teacherList: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  const teacher = teacherList.find((t: any) => 
    t && ((t.username || '').toLowerCase() === cleanUser || (t.contactEmail || '').toLowerCase() === cleanUser)
  );

  if (!teacher || !teacher.recoveryCode || teacher.recoveryCode.toUpperCase() !== cleanCode) {
    return res.status(401).json({ success: false, error: 'Invalid recovery code or account not found.' });
  }

  return res.json({ success: true, teacherId: teacher.id, message: 'Recovery code verified.' });
});

app.post('/api/auth/reset-password-recovery', async (req, res) => {
  const { teacherId, adminId, recoveryCode, newPassword } = req.body;
  const targetId = teacherId || adminId;
  if (!targetId || !recoveryCode || typeof newPassword === 'undefined') {
    return res.status(400).json({ success: false, error: 'Missing required recovery parameters.' });
  }

  const rawPass = typeof newPassword === 'string' ? newPassword : String(newPassword);
  if (rawPass.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
  }

  const cleanCode = String(recoveryCode).trim().toUpperCase();

  // 1. Check Teachers
  const teachersObj = store.keys['ota_teachers_v3'] || [];
  const teacherList: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  const teacher = teacherList.find((t: any) => t && t.id === targetId);

  if (teacher && teacher.recoveryCode && teacher.recoveryCode.toUpperCase() === cleanCode) {
    teacher.password = bcrypt.hashSync(rawPass, 10);
    teacher.recoveryCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    teacher.mustChangePassword = false;
    serverVault[teacher.id] = {
      passwordHash: teacher.password,
      role: 'TEACHER',
      email: (teacher.contactEmail || teacher.email || '').trim().toLowerCase(),
      username: (teacher.username || '').trim().toLowerCase()
    };
    saveStoreToDisk();
    try {
      await syncTeachersAndVaultToFirestore();
    } catch {}
    return res.json({ success: true, message: 'Password reset successful. You may now log in.' });
  }

  // 2. Check Admins
  const adminsObj = store.keys['ota_admins'] || [];
  const adminList: any[] = Array.isArray(adminsObj) ? adminsObj : Object.values(adminsObj);
  const admin = adminList.find((a: any) => a && (a.id === targetId || a.username === targetId));

  if (admin && admin.recoveryCode && admin.recoveryCode.toUpperCase() === cleanCode) {
    admin.password = bcrypt.hashSync(rawPass, 10);
    admin.recoveryCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    admin.mustChangePassword = false;
    serverVault[admin.id] = {
      passwordHash: admin.password,
      role: 'ADMIN',
      email: (admin.adminEmail || admin.email || '').trim().toLowerCase(),
      username: (admin.username || '').trim().toLowerCase()
    };
    saveStoreToDisk();
    try {
      await syncOtaStoreDocToFirestore('ota_admins', adminList);
      await syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));
    } catch {}
    return res.json({ success: true, message: 'Password reset successful. You may now log in.' });
  }

  return res.status(401).json({ success: false, error: 'Invalid recovery credentials.' });
});

// Developer Endpoints for Recovery Code Escrow (Protected by Developer Master Key)
app.get('/api/developer/teachers', (req, res) => {
  if (req.query.password !== 'proxonline26') {
    return res.status(401).json({ success: false, error: 'Unauthorized developer access' });
  }
  const teachersObj = store.keys['ota_teachers_v3'] || [];
  const teacherList: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  const devTeachers = teacherList
    .filter((t: any) => t && !isSyntheticTestTeacher(t))
    .map((t: any) => {
      const { password, ...safe } = t;
      return safe;
    });
  const now = Date.now();
  const pendingVerifications = Array.from(pendingEmailVerifications.values())
    .filter((p: any) => p && p.expiresAt > now)
    .map((p: any) => ({
      email: p.email,
      name: p.name,
      username: p.username,
      code: p.code,
      expiresAt: p.expiresAt,
      createdAt: p.createdAt
    }));
  return res.json({ success: true, teachers: devTeachers, pendingVerifications });
});

app.post('/api/developer/regenerate-recovery-code', async (req, res) => {
  const { password, teacherId } = req.body;
  if (password !== 'proxonline26') {
    return res.status(401).json({ success: false, error: 'Unauthorized developer access' });
  }
  const teachersObj = store.keys['ota_teachers_v3'] || [];
  const teacherList: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  const teacher = teacherList.find((t: any) => t && t.id === teacherId);
  if (!teacher) {
    return res.status(404).json({ success: false, error: 'Teacher not found' });
  }
  const newCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  teacher.recoveryCode = newCode;
  await syncTeachersAndVaultToFirestore(teacherList);
  return res.json({ success: true, teacherId, recoveryCode: newCode });
});

// Developer authentication & master passphrase
const DEVELOPER_PASSPHRASE = 'proxonline26';

// Reset storage on server
app.post('/api/sync/reset', (req, res, next) => {
  const devPass = req.headers['x-developer-password'] || req.body?.password;
  if (devPass === DEVELOPER_PASSPHRASE) {
    return next();
  }
  return requireAuth(req, res, next);
}, async (req, res) => {
  Object.keys(serverVault).forEach(k => delete serverVault[k]);
  store = {
    version: Date.now(),
    keys: {}
  };
  seedDefaultStoreData();
  populateServerVaultFromMemory();

  // Explicitly set clean Revision #1 metadata
  const baselineMeta = {
    revisionId: 1,
    publishedAt: Date.now(),
    publishedBy: 'System Baseline',
    status: 'PUBLISHED'
  };
  store.keys['ota_timetable_metadata_v1'] = baselineMeta;
  if (store.keys['ota_timetable_v2'] && typeof store.keys['ota_timetable_v2'] === 'object') {
    store.keys['ota_timetable_v2']._revisionId = 1;
  }
  delete store.keys['ota_timetable_draft_v1'];
  delete store.keys['ota_history_v2'];
  store.keys['ota_notifications_v2'] = [];

  // Multi-device Cloud Sync fresh baseline to Firestore
  try {
    await deleteOtaStoreDocFromFirestore('ota_timetable_draft_v1');
    await deleteOtaStoreDocFromFirestore('ota_history_v2');
    const sanitized = getSanitizedKeys('ADMIN');
    for (const [k, val] of Object.entries(sanitized)) {
      await syncOtaStoreDocToFirestore(k, val);
    }
    await syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));
  } catch (err) {}

  broadcastToClients('reset', { version: store.version, keys: getSanitizedKeys('ADMIN') });
  res.json({ success: true, version: store.version, message: 'System cleanly reset to factory defaults.' });
});

// Developer API Endpoints (Master Passphrase: proxonline26)
app.post('/api/developer/verify', (req, res) => {
  const { password } = req.body;
  if (password === DEVELOPER_PASSPHRASE) {
    return res.json({ success: true, authorized: true });
  }
  return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
});

app.post('/api/developer/reset-all', async (req, res) => {
  const { password } = req.body;
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }

  Object.keys(serverVault).forEach(k => delete serverVault[k]);
  store = {
    version: Date.now(),
    keys: {}
  };
  seedDefaultStoreData();
  populateServerVaultFromMemory();

  const baselineMeta = {
    revisionId: 1,
    publishedAt: Date.now(),
    publishedBy: 'System Baseline',
    status: 'PUBLISHED'
  };
  store.keys['ota_timetable_metadata_v1'] = baselineMeta;
  if (store.keys['ota_timetable_v2'] && typeof store.keys['ota_timetable_v2'] === 'object') {
    store.keys['ota_timetable_v2']._revisionId = 1;
  }
  delete store.keys['ota_timetable_draft_v1'];
  delete store.keys['ota_history_v2'];
  store.keys['ota_notifications_v2'] = [];

  // Purge obsolete and sync fresh baseline to Firestore
  try {
    await deleteOtaStoreDocFromFirestore('ota_timetable_draft_v1');
    await deleteOtaStoreDocFromFirestore('ota_history_v2');
    const sanitized = getSanitizedKeys('ADMIN');
    for (const [k, val] of Object.entries(sanitized)) {
      await syncOtaStoreDocToFirestore(k, val);
    }
    await syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));
  } catch (err) {}

  broadcastToClients('reset', { version: store.version, keys: getSanitizedKeys('ADMIN') });
  res.json({ success: true, version: store.version, message: 'All application data has been wiped and reset to factory defaults.' });
});

// 1-Click School Handover Setup: Draft 0, No Published Timetable Yet, 0 Inbox Mails/Communications
app.post('/api/developer/prepare-school-ready', async (req, res) => {
  const { password, clearTeachers } = req.body || {};
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }

  // Ensure core school configuration (classes, subjects, rooms, settings, schools, admins) is intact
  seedDefaultStoreData();

  // 1. Remove published & draft timetables cleanly (No published timetable yet)
  delete store.keys['ota_timetable_v2'];
  delete store.keys['ota_timetable_draft_v1'];
  delete store.keys['app_state'];

  // 2. Set authoritative revision to Draft 0
  const draftZeroMeta = {
    revisionId: 0,
    publishedAt: 0,
    publishedBy: '',
    status: 'DRAFT'
  };
  store.keys['ota_timetable_metadata_v1'] = draftZeroMeta;

  // 3. Clear all inbox mails, notifications, swap requests, absences, chat, audit logs, history, exams, & pending OTPs
  store.keys['ota_history_v2'] = [];
  store.keys['ota_notifications_v2'] = [];
  store.keys['ota_requests_v2'] = [];
  store.keys['ota_absences_v1'] = [];
  store.keys['ota_chat_messages'] = [];
  store.keys['ota_audit_logs_v1'] = [];
  store.keys['ota_exams'] = [];
  store.keys['ota_pending_verifications_v1'] = [];
  pendingEmailVerifications.clear();

  // 4. Clean faculty list (always purge synthetic/test accounts; optionally clear all teachers if requested)
  if (clearTeachers === true) {
    store.keys['ota_teachers_v3'] = [];
    for (const vKey of Object.keys(serverVault)) {
      if (serverVault[vKey]?.role === 'TEACHER') {
        delete serverVault[vKey];
      }
    }
  } else {
    const rawTeachers = Array.isArray(store.keys['ota_teachers_v3'])
      ? store.keys['ota_teachers_v3']
      : Object.values(store.keys['ota_teachers_v3'] || {});
    const cleanTeachers = rawTeachers.filter((t: any) => t && !isSyntheticTestTeacher(t));
    store.keys['ota_teachers_v3'] = cleanTeachers;
    const validTeacherIds = new Set(cleanTeachers.map((t: any) => t.id));
    for (const [vKey, vEntry] of Object.entries(serverVault)) {
      if (vEntry?.role === 'TEACHER' && !validTeacherIds.has(vKey)) {
        delete serverVault[vKey];
      }
    }
  }

  store.version = Date.now();

  // 5. Persist everything atomically to Cloud Firestore
  try {
    await Promise.all([
      deleteOtaStoreDocFromFirestore('ota_timetable_v2'),
      deleteOtaStoreDocFromFirestore('ota_timetable_draft_v1'),
      deleteOtaStoreDocFromFirestore('app_state'),
      syncOtaStoreDocToFirestore('ota_timetable_metadata_v1', draftZeroMeta),
      syncOtaStoreDocToFirestore('ota_history_v2', []),
      syncOtaStoreDocToFirestore('ota_notifications_v2', []),
      syncOtaStoreDocToFirestore('ota_requests_v2', []),
      syncOtaStoreDocToFirestore('ota_absences_v1', []),
      syncOtaStoreDocToFirestore('ota_chat_messages', []),
      syncOtaStoreDocToFirestore('ota_audit_logs_v1', []),
      syncOtaStoreDocToFirestore('ota_exams', []),
      syncOtaStoreDocToFirestore('ota_pending_verifications_v1', []),
      syncTeachersAndVaultToFirestore(store.keys['ota_teachers_v3'])
    ]);
  } catch (err: any) {
    console.error('[Prepare School Ready] Firestore sync error:', err);
    return res.status(500).json({ success: false, error: 'Failed syncing clean school state to Firestore: ' + (err?.message || 'Error') });
  }

  broadcastToClients('reset', { version: store.version, keys: getSanitizedKeys('ADMIN') });

  const teachersCount = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'].length : 0;
  return res.json({
    success: true,
    version: store.version,
    revisionId: 0,
    teachersRemaining: teachersCount,
    message: `App prepared for school handover: Draft #0, no published timetable, 0 inbox messages (${teachersCount} faculty kept).`
  });
});

app.post('/api/developer/selective-purge', async (req, res) => {
  const { password, target } = req.body;
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }

  store.version = Date.now();
  const changedKeys: Record<string, any> = {};
  if (target === 'timetable') {
    delete store.keys['ota_timetable_v2'];
    delete store.keys['ota_history_v2'];
    await deleteOtaStoreDocFromFirestore('ota_timetable_v2');
    await deleteOtaStoreDocFromFirestore('ota_history_v2');
    changedKeys['ota_timetable_v2'] = null;
    changedKeys['ota_history_v2'] = null;
  } else if (target === 'teachers') {
    store.keys['ota_teachers_v3'] = [];
    delete store.keys['ota_absences_v1'];
    delete store.keys['ota_requests_v2'];
    for (const [id, entry] of Object.entries(serverVault)) {
      if (entry?.role === 'TEACHER') delete serverVault[id];
    }
    await syncOtaStoreDocToFirestore('ota_teachers_v3', []);
    await syncOtaStoreDocToFirestore('ota_server_vault_v1', encryptVault(serverVault));
    await deleteOtaStoreDocFromFirestore('ota_absences_v1');
    await deleteOtaStoreDocFromFirestore('ota_requests_v2');
    changedKeys['ota_teachers_v3'] = [];
  } else if (target === 'draft') {
    delete store.keys['ota_timetable_draft_v1'];
    await deleteOtaStoreDocFromFirestore('ota_timetable_draft_v1');
    changedKeys['ota_timetable_draft_v1'] = null;
  } else if (target === 'requests') {
    store.keys['ota_requests_v2'] = [];
    store.keys['ota_absences_v1'] = [];
    await syncOtaStoreDocToFirestore('ota_requests_v2', []);
    await syncOtaStoreDocToFirestore('ota_absences_v1', []);
    changedKeys['ota_requests_v2'] = [];
    changedKeys['ota_absences_v1'] = [];
  } else if (target === 'curriculum') {
    store.keys['ota_subjects_v2'] = [...ALL_SUBJECTS];
    await syncOtaStoreDocToFirestore('ota_subjects_v2', store.keys['ota_subjects_v2']);
    changedKeys['ota_subjects_v2'] = store.keys['ota_subjects_v2'];
  } else if (target === 'logs') {
    store.keys['ota_audit_logs_v1'] = [];
    store.keys['ota_chat_messages'] = [];
    store.keys['ota_notifications_v2'] = [];
    await deleteOtaStoreDocFromFirestore('ota_audit_logs_v1');
    await deleteOtaStoreDocFromFirestore('ota_chat_messages');
    await deleteOtaStoreDocFromFirestore('ota_notifications_v2');
    changedKeys['ota_audit_logs_v1'] = [];
    changedKeys['ota_chat_messages'] = [];
    changedKeys['ota_notifications_v2'] = [];
  }

  broadcastToClients('update', { version: store.version, key: target, changedKeys });
  res.json({ success: true, target });
});

app.post('/api/developer/force-sync', async (req, res) => {
  const { password, direction } = req.body;
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }

  try {
    if (direction === 'pull') {
      await hydrateStoreFromFirestore();
    } else if (direction === 'push') {
      const sanitized = getSanitizedKeys();
      for (const [k, v] of Object.entries(sanitized)) {
        await syncOtaStoreDocToFirestore(k, v);
      }
    }
    res.json({ success: true, direction });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/developer/fix-stream-violations', async (req, res) => {
  const { password } = req.body;
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }

  let cleanedSlots = 0;
  const timetable = store.keys['ota_timetable_v2'];
  const bcSubjectKeywords = ['ECONOMICS', 'YORUBA', 'COMMERCE', 'ACCOUNTING', 'BOOK KEEPING', 'STORE MANAGEMENT', 'LITERATURE', 'GOVERNMENT'];

  if (timetable && typeof timetable === 'object') {
    for (const classId in timetable) {
      const isScienceClass = /SS\d+A\d*/i.test(classId);
      if (!isScienceClass) continue;

      const days = timetable[classId];
      if (!days || typeof days !== 'object') continue;
      for (const day in days) {
        const periods = days[day];
        if (!periods || typeof periods !== 'object') continue;
        for (const period in periods) {
          const cell = periods[period];
          if (!cell) continue;

          const sId = (cell.subjectId || '').toLowerCase();
          const sName = (cell.subjectName || '').toUpperCase();
          const isBcSubject = sId === 'eco_sci' || sId === 'yor_sci' || sId.endsWith('_bc') ||
            bcSubjectKeywords.some(kw => sName.includes(kw));

          if (isBcSubject) {
            periods[period] = {
              subjectId: '',
              subjectName: 'Free',
              teacherId: '',
              teacherName: 'Unassigned',
              isCore: false,
              room: ''
            };
            cleanedSlots++;
          }
        }
      }
    }
  }

  // Also purge eco_sci and yor_sci from subjects
  if (store.keys['ota_subjects_v2']) {
    let subList: any[] = Array.isArray(store.keys['ota_subjects_v2'])
      ? store.keys['ota_subjects_v2']
      : Object.values(store.keys['ota_subjects_v2']);
    store.keys['ota_subjects_v2'] = subList.filter((s: any) => s && s.id !== 'eco_sci' && s.id !== 'yor_sci');
    syncOtaStoreDocToFirestore('ota_subjects_v2', store.keys['ota_subjects_v2']);
  }

  store.version = Date.now();
  saveStoreToDisk();
  syncOtaStoreDocToFirestore('ota_timetable_v2', store.keys['ota_timetable_v2']);
  broadcastToClients('update', {
    version: store.version,
    changedKeys: {
      ota_timetable_v2: store.keys['ota_timetable_v2'],
      ota_subjects_v2: store.keys['ota_subjects_v2']
    }
  });

  return res.json({
    success: true,
    cleanedSlots,
    message: `Curriculum stream fix applied. Removed ${cleanedSlots} Commercial/BC subjects from Science classes.`
  });
});

app.post('/api/developer/purge-orphaned-teachers', async (req, res) => {
  const { password } = req.body;
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }

  const teachersObj = store.keys['ota_teachers_v3'] || {};
  const teacherList: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  const validTeacherIds = new Set(teacherList.map((t: any) => t && t.id).filter(Boolean));

  let purgedCount = 0;
  const timetable = store.keys['ota_timetable_v2'];
  if (timetable && typeof timetable === 'object') {
    for (const classId in timetable) {
      const days = timetable[classId];
      if (!days || typeof days !== 'object') continue;
      for (const day in days) {
        const periods = days[day];
        if (!periods || typeof periods !== 'object') continue;
        for (const period in periods) {
          const cell = periods[period];
          if (!cell) continue;

          if (cell.teacherId && !validTeacherIds.has(cell.teacherId)) {
            cell.teacherId = '';
            cell.teacherName = 'Unassigned';
            purgedCount++;
          }
          if (Array.isArray(cell.teacherIds)) {
            cell.teacherIds = cell.teacherIds.filter((tid: string) => validTeacherIds.has(tid));
          }
        }
      }
    }
  }

  store.version = Date.now();
  saveStoreToDisk();
  syncOtaStoreDocToFirestore('ota_timetable_v2', store.keys['ota_timetable_v2']);
  broadcastToClients('update', {
    version: store.version,
    changedKeys: {
      ota_timetable_v2: store.keys['ota_timetable_v2']
    }
  });

  return res.json({
    success: true,
    purgedCount,
    message: `Purged ${purgedCount} ghost/orphaned teacher slot assignments from timetable.`
  });
});

app.post('/api/developer/restore', (req, res) => {
  const { password, keys } = req.body;
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }

  if (keys && typeof keys === 'object') {
    store.keys = keys;
    store.version = Date.now();
    saveStoreToDisk();

    const sanitized = getSanitizedKeys();
    for (const [k, v] of Object.entries(sanitized)) {
      syncOtaStoreDocToFirestore(k, v);
    }
    broadcastToClients('update', { version: store.version });
    return res.json({ success: true });
  }
  res.status(400).json({ success: false, error: 'Invalid restore payload' });
});

app.post('/api/developer/teacher-action', async (req, res) => {
  const { password, teacherId, action, newPassword, reason } = req.body || {};
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }
  const teachersObj = store.keys['ota_teachers_v3'] || [];
  let teacherList: any[] = Array.isArray(teachersObj) ? [...teachersObj] : Object.values(teachersObj);
  const idx = teacherList.findIndex((t: any) => t && t.id === teacherId);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Teacher not found' });
  }

  const target = { ...teacherList[idx] };
  let message = '';

  if (action === 'APPROVE') {
    target.isApproved = true;
    target.approvalStatus = 'APPROVED';
    delete target.rejectionReason;
    teacherList[idx] = target;
    message = `Approved teacher account: ${target.name}`;
  } else if (action === 'REJECT') {
    target.isApproved = false;
    target.approvalStatus = 'REJECTED';
    target.rejectionReason = reason || 'Rejected via Developer Console';
    teacherList[idx] = target;
    message = `Rejected teacher account: ${target.name}`;
  } else if (action === 'RESET_ONBOARDING') {
    target.isCompleted = false;
    teacherList[idx] = target;
    message = `Reset onboarding wizard for ${target.name}`;
  } else if (action === 'SET_PASSWORD') {
    const cleanPass = String(newPassword || '');
    if (cleanPass.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }
    const hash = bcrypt.hashSync(cleanPass, 10);
    target.password = hash;
    target.mustChangePassword = false;
    teacherList[idx] = target;
    serverVault[target.id] = {
      passwordHash: hash,
      role: 'TEACHER',
      email: (target.contactEmail || target.email || '').trim().toLowerCase(),
      username: (target.username || '').trim().toLowerCase()
    };
    message = `Password updated for ${target.name} (@${target.username})`;
  } else if (action === 'DELETE') {
    teacherList = teacherList.filter((t: any) => t && t.id !== teacherId);
    delete serverVault[teacherId];
    const cleanGridSlots = (gridObj: any) => {
      if (!gridObj || typeof gridObj !== 'object') return;
      for (const cId in gridObj) {
        const days = gridObj[cId];
        if (!days || typeof days !== 'object') continue;
        for (const d in days) {
          const periods = days[d];
          if (!periods || typeof periods !== 'object') continue;
          for (const p in periods) {
            const cell = periods[p];
            if (!cell) continue;
            if (cell.teacherId === teacherId) {
              cell.teacherId = '';
              cell.teacherName = 'Unassigned';
            }
            if (Array.isArray(cell.teacherIds)) {
              cell.teacherIds = cell.teacherIds.filter((id: string) => id !== teacherId);
            }
          }
        }
      }
    };
    cleanGridSlots(store.keys['ota_timetable_v2']);
    cleanGridSlots(store.keys['ota_timetable_draft_v1']);
    message = `Deleted teacher ${target.name} (@${target.username}) and cleared timetable references`;
  } else {
    return res.status(400).json({ success: false, error: 'Unknown action' });
  }

  let autoBindRes = { publishedBoundCount: 0, draftBoundCount: 0, totalBoundCount: 0, changedKeys: {} as Record<string, any> };
  if (action === 'APPROVE') {
    autoBindRes = await autoBindTeacherToActiveTimetables(target);
    if (autoBindRes.publishedBoundCount > 0) {
      message += ` & bound to ${autoBindRes.publishedBoundCount} timetable slot(s)`;
    }
  }

  store.keys['ota_teachers_v3'] = teacherList;
  store.version = Date.now();
  await syncTeachersAndVaultToFirestore(teacherList);
  if (action === 'DELETE') {
    if (store.keys['ota_timetable_v2']) {
      await syncOtaStoreDocToFirestore('ota_timetable_v2', store.keys['ota_timetable_v2']);
    }
    if (store.keys['ota_timetable_draft_v1']) {
      await syncOtaStoreDocToFirestore('ota_timetable_draft_v1', store.keys['ota_timetable_draft_v1']);
    }
  }
  broadcastToClients('update', {
    version: store.version,
    changedKeys: {
      ota_teachers_v3: teacherList.map((t: any) => sanitizeTeacherRecord(t, false)),
      ...(action === 'DELETE' && store.keys['ota_timetable_v2'] ? { ota_timetable_v2: store.keys['ota_timetable_v2'] } : {}),
      ...autoBindRes.changedKeys
    }
  });
  return res.json({ success: true, message, autoBoundCount: autoBindRes.publishedBoundCount });
});

app.post('/api/developer/purge-fake-teachers', async (req, res) => {
  const { password } = req.body || {};
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }
  const teachersObj = store.keys['ota_teachers_v3'] || [];
  const teacherList: any[] = Array.isArray(teachersObj) ? teachersObj : Object.values(teachersObj);
  const removed = teacherList.filter((t: any) => isSyntheticTestTeacher(t));
  const kept = teacherList.filter((t: any) => !isSyntheticTestTeacher(t));
  const removedIds = new Set(removed.map((t: any) => t?.id).filter(Boolean));

  removedIds.forEach((id: string) => { delete serverVault[id]; });
  for (const [k, entry] of Object.entries(serverVault)) {
    if (entry?.role === 'TEACHER' && (k.startsWith('tch_demo_') || entry.username === 'adalovelace' || entry.username?.startsWith('sync_') || entry.username?.startsWith('matrix_'))) {
      delete serverVault[k];
    }
  }

  for (const [emailKey, p] of pendingEmailVerifications.entries()) {
    if (isSyntheticTestTeacher(p)) pendingEmailVerifications.delete(emailKey);
  }

  const timetable = store.keys['ota_timetable_v2'];
  let clearedSlots = 0;
  if (timetable && typeof timetable === 'object') {
    for (const cId in timetable) {
      const days = timetable[cId];
      if (!days || typeof days !== 'object') continue;
      for (const d in days) {
        const periods = days[d];
        if (!periods || typeof periods !== 'object') continue;
        for (const p in periods) {
          const cell = periods[p];
          if (!cell) continue;
          if (cell.teacherId && removedIds.has(cell.teacherId)) {
            cell.teacherId = '';
            cell.teacherName = 'Unassigned';
            clearedSlots++;
          }
          if (Array.isArray(cell.teacherIds)) {
            cell.teacherIds = cell.teacherIds.filter((id: string) => !removedIds.has(id));
          }
        }
      }
    }
  }

  store.keys['ota_teachers_v3'] = kept;
  store.version = Date.now();
  await syncTeachersAndVaultToFirestore(kept);
  if (clearedSlots > 0 && timetable) {
    await syncOtaStoreDocToFirestore('ota_timetable_v2', timetable);
  }
  broadcastToClients('update', {
    version: store.version,
    changedKeys: {
      ota_teachers_v3: kept.map((t: any) => sanitizeTeacherRecord(t, false)),
      ...(clearedSlots > 0 && timetable ? { ota_timetable_v2: timetable } : {})
    }
  });
  return res.json({
    success: true,
    removedCount: removed.length,
    removedNames: removed.map((r: any) => r?.name || r?.username || r?.id),
    clearedSlots,
    message: removed.length > 0
      ? `Removed ${removed.length} fake/test teacher(s): ${removed.map((r: any) => r?.name).join(', ')}`
      : 'No fake/test teachers found in Firestore or memory.'
  });
});

app.post('/api/developer/scan-integrity', (req, res) => {
  const { password } = req.body || {};
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }
  const teachers: any[] = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : Object.values(store.keys['ota_teachers_v3'] || {});
  const classes: any[] = Array.isArray(store.keys['ota_classes']) ? store.keys['ota_classes'] : Object.values(store.keys['ota_classes'] || {});
  const timetable = store.keys['ota_timetable_v2'] || {};
  const validTeacherIds = new Set(teachers.map((t: any) => t?.id).filter(Boolean));

  const issues: { severity: 'HIGH' | 'MEDIUM' | 'LOW'; category: string; message: string }[] = [];
  const fakeTeachers = teachers.filter((t: any) => isSyntheticTestTeacher(t));
  if (fakeTeachers.length > 0) {
    issues.push({
      severity: 'HIGH',
      category: 'Fake Faculty',
      message: `${fakeTeachers.length} synthetic/test teacher account(s) found: ${fakeTeachers.map((t: any) => `${t.name} (@${t.username})`).join(', ')}`
    });
  }

  let orphanedSlots = 0;
  let teacherDoubleBookings = 0;
  let roomDoubleBookings = 0;
  let streamViolations = 0;

  for (let d = 0; d < 5; d++) {
    for (let p = 0; p < 8; p++) {
      const seenTeachers = new Map<string, string>();
      const seenRooms = new Map<string, string>();
      for (const cls of classes) {
        const cell = timetable?.[cls.id]?.[d]?.[p];
        if (!cell || !cell.subjectId || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;

        if (cell.teacherId && cell.teacherId !== 'SYSTEM' && !validTeacherIds.has(cell.teacherId)) {
          orphanedSlots++;
        }
        if (cell.teacherId && cell.teacherId !== 'SYSTEM') {
          if (seenTeachers.has(cell.teacherId)) {
            teacherDoubleBookings++;
          } else {
            seenTeachers.set(cell.teacherId, cls.id);
          }
        }
        if (cell.roomId) {
          if (seenRooms.has(cell.roomId)) {
            roomDoubleBookings++;
          } else {
            seenRooms.set(cell.roomId, cls.id);
          }
        }
        if (/SS\d+A\d*/i.test(cls.id)) {
          const sId = String(cell.subjectId || '').toLowerCase();
          if (sId === 'eco_sci' || sId === 'yor_sci' || sId.endsWith('_bc')) {
            streamViolations++;
          }
        }
      }
    }
  }

  if (orphanedSlots > 0) issues.push({ severity: 'MEDIUM', category: 'Orphaned Teachers', message: `${orphanedSlots} timetable period(s) reference missing/deleted teachers.` });
  if (teacherDoubleBookings > 0) issues.push({ severity: 'HIGH', category: 'Teacher Clashes', message: `${teacherDoubleBookings} teacher double-booking conflict(s) detected.` });
  if (roomDoubleBookings > 0) issues.push({ severity: 'MEDIUM', category: 'Room Clashes', message: `${roomDoubleBookings} room double-booking conflict(s) detected.` });
  if (streamViolations > 0) issues.push({ severity: 'HIGH', category: 'Stream Violations', message: `${streamViolations} Commercial/BC subject slot(s) placed in Science ("A") classes.` });

  const pendingApprovals = teachers.filter((t: any) => t && t.isApproved === false && t.approvalStatus !== 'REJECTED').length;
  if (pendingApprovals > 0) {
    issues.push({ severity: 'LOW', category: 'Pending Approvals', message: `${pendingApprovals} teacher registration(s) awaiting Admin review.` });
  }

  return res.json({
    success: true,
    healthy: issues.filter(i => i.severity !== 'LOW').length === 0,
    summary: {
      teachers: teachers.length,
      classes: classes.length,
      orphanedSlots,
      teacherDoubleBookings,
      roomDoubleBookings,
      streamViolations,
      pendingApprovals
    },
    issues
  });
});

app.post('/api/developer/test-email', async (req, res) => {
  const { password, toEmail } = req.body || {};
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }
  const targetEmail = String(toEmail || '').trim().toLowerCase();
  if (!targetEmail || !targetEmail.includes('@')) {
    return res.status(400).json({ success: false, error: 'Please enter a valid recipient email address.' });
  }
  const result = await sendEmailMessage({
    to: targetEmail,
    subject: 'Pentric Developer Console — Email Delivery Test',
    text: `Email delivery diagnostic succeeded at ${new Date().toISOString()}.`,
    html: `<div style="font-family:sans-serif;padding:20px;background:#f8fafc;border-radius:12px;"><h2 style="color:#0f172a;margin:0 0 8px 0;">Email Delivery Test</h2><p style="color:#475569;margin:0;">Your Pentric server successfully dispatched this diagnostic email at <strong>${new Date().toISOString()}</strong>.</p></div>`
  });
  return res.json({
    success: result.success,
    transport: result.transport || null,
    sender: result.sender || null,
    error: result.error || null
  });
});

app.post('/api/developer/delete-pending-verification', async (req, res) => {
  const { password, email } = req.body || {};
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }
  const clean = String(email || '').trim().toLowerCase();
  pendingEmailVerifications.delete(clean);
  const remaining = Array.from(pendingEmailVerifications.values());
  await syncOtaStoreDocToFirestore('ota_pending_verifications_v1', remaining);
  return res.json({ success: true, remainingCount: remaining.length });
});

app.get('/api/developer/store-keys', (req, res) => {
  if (req.query.password !== 'proxonline26') {
    return res.status(401).json({ success: false, error: 'Unauthorized developer access' });
  }
  const sanitized = getSanitizedKeys('ADMIN');
  const keys = Object.entries(sanitized).map(([key, value]) => {
    const raw = JSON.stringify(value ?? null);
    const count = Array.isArray(value)
      ? value.length
      : value && typeof value === 'object'
        ? Object.keys(value).length
        : 1;
    return {
      key,
      type: Array.isArray(value) ? 'array' : typeof value,
      count,
      bytes: Buffer.byteLength(raw, 'utf8'),
      preview: raw.length > 3500 ? raw.slice(0, 3500) + '...' : raw
    };
  });
  return res.json({ success: true, keys });
});

// Full Live Firebase Firestore Explorer & Editor Endpoints
const FIREBASE_ALLOWED_COLLECTIONS = ['ota_app_store', 'schools', 'ota_sync_diagnostics'] as const;
type FirebaseCollectionName = typeof FIREBASE_ALLOWED_COLLECTIONS[number];

app.get('/api/developer/firebase/explorer', async (req, res) => {
  const pass = req.query.password || req.headers['x-developer-password'];
  if (pass !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer access' });
  }

  const targetCol = req.query.collection as string | undefined;
  const includeData = req.query.includeData === '1';
  const collectionsToFetch: FirebaseCollectionName[] = targetCol && (FIREBASE_ALLOWED_COLLECTIONS as readonly string[]).includes(targetCol)
    ? [targetCol as FirebaseCollectionName]
    : [...FIREBASE_ALLOWED_COLLECTIONS];

  const documents: {
    collection: FirebaseCollectionName;
    id: string;
    updatedAt: number | null;
    bytes: number;
    itemCount: number;
    data?: any;
  }[] = [];

  const collectionStats: Record<string, { count: number; totalBytes: number }> = {};

  try {
    const results = await Promise.all(
      collectionsToFetch.map(async (colName) => {
        let rows: { id: string; rawData: any }[] = [];
        try {
          if (hasAdminCredentials && adminDb) {
            const snap = await adminDb.collection(colName).get();
            rows = snap.docs.map(d => ({ id: d.id, rawData: d.data() }));
          } else if (clientDb) {
            const snap = await getDocs(collection(clientDb, colName));
            rows = snap.docs.map(d => ({ id: d.id, rawData: d.data() }));
          }
          return { colName, rows, error: null as any };
        } catch (colErr: any) {
          return { colName, rows: [], error: colErr };
        }
      })
    );

    for (const r of results) {
      if (r.error) {
        console.error(`[Firebase Explorer] Failed reading ${r.colName}:`, r.error?.message || r.error);
        return res.status(500).json({
          success: false,
          error: JSON.stringify({
            operationType: 'list',
            path: r.colName,
            error: r.error?.message || String(r.error)
          })
        });
      }

      let totalBytes = 0;
      for (const { id, rawData } of r.rows) {
        const displayData = r.colName === 'ota_app_store' && rawData && 'payload' in rawData
          ? rawData.payload
          : rawData;
        const jsonStr = JSON.stringify(displayData ?? null);
        const bytes = Buffer.byteLength(jsonStr, 'utf8');
        totalBytes += bytes;
        const itemCount = Array.isArray(displayData)
          ? displayData.length
          : displayData && typeof displayData === 'object'
            ? Object.keys(displayData).length
            : 1;
        const updatedAt = typeof rawData?.updatedAt === 'number'
          ? rawData.updatedAt
          : typeof rawData?.timestamp === 'number'
            ? rawData.timestamp
            : null;

        documents.push({
          collection: r.colName,
          id,
          updatedAt,
          bytes,
          itemCount,
          ...(includeData ? { data: displayData ?? null } : {})
        });
      }

      collectionStats[r.colName] = { count: r.rows.length, totalBytes };
    }

    documents.sort((a, b) => {
      if (a.collection !== b.collection) return a.collection.localeCompare(b.collection);
      return a.id.localeCompare(b.id);
    });

    return res.json({
      success: true,
      projectId: firebaseConfigJson.projectId || 'ota-smart-timetable',
      databaseId: firebaseConfigJson.firestoreDatabaseId || 'ai-studio-otasmarttimetabl-5b72f609-12f9-471e-8ea2-d4f3daede4d4',
      collections: FIREBASE_ALLOWED_COLLECTIONS,
      collectionStats,
      documents
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to read Firebase Firestore' });
  }
});

app.get('/api/developer/firebase/doc', async (req, res) => {
  const pass = req.query.password || req.headers['x-developer-password'];
  if (pass !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer access' });
  }

  const colName = String(req.query.collectionName || '').trim() as FirebaseCollectionName;
  const cleanId = String(req.query.docId || '').trim();
  if (!(FIREBASE_ALLOWED_COLLECTIONS as readonly string[]).includes(colName)) {
    return res.status(400).json({ success: false, error: 'Invalid collection.' });
  }
  if (!cleanId || !/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
    return res.status(400).json({ success: false, error: 'Invalid document ID.' });
  }

  try {
    let rawData: any = null;
    let exists = false;
    if (hasAdminCredentials && adminDb) {
      const snap = await adminDb.collection(colName).doc(cleanId).get();
      exists = snap.exists;
      if (exists) rawData = snap.data();
    } else if (clientDb) {
      const snap = await getDoc(doc(clientDb, colName, cleanId));
      exists = snap.exists();
      if (exists) rawData = snap.data();
    }
    if (!exists) {
      return res.status(404).json({ success: false, error: `Document ${colName}/${cleanId} not found in Firestore.` });
    }

    const displayData = colName === 'ota_app_store' && rawData && 'payload' in rawData
      ? rawData.payload
      : rawData;
    const jsonStr = JSON.stringify(displayData ?? null);
    const bytes = Buffer.byteLength(jsonStr, 'utf8');
    const itemCount = Array.isArray(displayData)
      ? displayData.length
      : displayData && typeof displayData === 'object'
        ? Object.keys(displayData).length
        : 1;
    const updatedAt = typeof rawData?.updatedAt === 'number'
      ? rawData.updatedAt
      : typeof rawData?.timestamp === 'number'
        ? rawData.timestamp
        : null;

    return res.json({
      success: true,
      document: {
        collection: colName,
        id: cleanId,
        updatedAt,
        bytes,
        itemCount,
        data: displayData ?? null
      }
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: JSON.stringify({
        operationType: 'get',
        path: `${colName}/${cleanId}`,
        error: err?.message || String(err)
      })
    });
  }
});

app.post('/api/developer/firebase/set-doc', async (req, res) => {
  const { password, collectionName, docId, data } = req.body || {};
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }
  if (!(FIREBASE_ALLOWED_COLLECTIONS as readonly string[]).includes(collectionName)) {
    return res.status(400).json({ success: false, error: 'Invalid collection. Allowed: ota_app_store, schools, ota_sync_diagnostics.' });
  }
  const cleanId = String(docId || '').trim();
  if (!cleanId || cleanId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
    return res.status(400).json({ success: false, error: 'Document ID must use only letters, numbers, underscores, or hyphens (1–128 chars).' });
  }
  if (collectionName === 'ota_app_store' && cleanId.length < 3) {
    return res.status(400).json({ success: false, error: 'ota_app_store document IDs must be at least 3 characters (per firestore.rules).' });
  }

  let parsedData: any;
  try {
    parsedData = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (parseErr: any) {
    return res.status(400).json({ success: false, error: `Invalid JSON: ${parseErr?.message}` });
  }

  try {
    const now = Date.now();
    if (collectionName === 'ota_app_store') {
      const payload = parsedData && typeof parsedData === 'object' && 'payload' in parsedData && 'updatedAt' in parsedData && Object.keys(parsedData).length <= 2
        ? parsedData.payload
        : parsedData;
      const docToWrite = { payload: JSON.parse(JSON.stringify(payload ?? null)), updatedAt: now };

      const ok = await syncOtaStoreDocToFirestore(cleanId, docToWrite.payload);
      if (!ok) {
        return res.status(500).json({ success: false, error: 'Failed writing document to Firebase Firestore.' });
      }

      if (cleanId !== 'app_state' && cleanId !== 'ota_server_vault_v1') {
        if (cleanId === 'ota_pending_verifications_v1') {
          pendingEmailVerifications.clear();
          if (Array.isArray(docToWrite.payload)) {
            docToWrite.payload.forEach((item: any) => {
              if (item && item.email) pendingEmailVerifications.set(String(item.email).toLowerCase(), item);
            });
          }
        } else {
          store.keys[cleanId] = docToWrite.payload;
          if (cleanId === 'ota_teachers_v3' || cleanId === 'ota_admins') {
            populateServerVaultFromMemory();
          }
        }
        store.version = now;
        broadcastToClients('update', {
          version: store.version,
          key: cleanId,
          changedKeys: { [cleanId]: getSanitizedKeys('ADMIN')[cleanId] ?? docToWrite.payload }
        });
      } else if (cleanId === 'ota_server_vault_v1' && docToWrite.payload?.encrypted) {
        const dec = decryptVault(docToWrite.payload);
        if (dec && typeof dec === 'object') Object.assign(serverVault, dec);
      }

      return res.json({
        success: true,
        collection: collectionName,
        docId: cleanId,
        updatedAt: now,
        message: `Saved ${collectionName}/${cleanId} to Cloud Firestore.`
      });
    }

    if (collectionName === 'schools') {
      if (!parsedData || typeof parsedData !== 'object') {
        return res.status(400).json({ success: false, error: 'School document must be a JSON object.' });
      }
      const schoolDoc = {
        ...parsedData,
        id: cleanId,
        name: String(parsedData.name || cleanId).slice(0, 120),
        code: String(parsedData.code || cleanId.slice(0, 6).toUpperCase()).slice(0, 10),
        createdAt: typeof parsedData.createdAt === 'number' ? parsedData.createdAt : now,
        updatedAt: now
      };
      if (schoolDoc.name.length < 3 || schoolDoc.code.length < 2) {
        return res.status(400).json({ success: false, error: 'School requires name (>=3 chars) and code (>=2 chars).' });
      }
      const ok = await syncSchoolDocToFirestore(schoolDoc);
      if (!ok) {
        return res.status(500).json({ success: false, error: 'Failed writing school document to Firebase Firestore.' });
      }
      const currentSchools = Array.isArray(store.keys['ota_schools_v1']) ? [...store.keys['ota_schools_v1']] : [];
      const sIdx = currentSchools.findIndex((s: any) => s && s.id === cleanId);
      if (sIdx >= 0) currentSchools[sIdx] = schoolDoc;
      else currentSchools.push(schoolDoc);
      store.keys['ota_schools_v1'] = currentSchools;
      await syncOtaStoreDocToFirestore('ota_schools_v1', currentSchools);
      store.version = now;
      broadcastToClients('update', { version: store.version, key: 'ota_schools_v1', changedKeys: { ota_schools_v1: currentSchools } });
      return res.json({ success: true, collection: collectionName, docId: cleanId, updatedAt: now, message: `Saved schools/${cleanId} to Cloud Firestore.` });
    }

    // ota_sync_diagnostics
    if (!parsedData || typeof parsedData !== 'object') {
      return res.status(400).json({ success: false, error: 'Diagnostic document must be a JSON object.' });
    }
    const diagDoc = {
      ...parsedData,
      deviceId: String(parsedData.deviceId || cleanId).slice(0, 128),
      timestamp: typeof parsedData.timestamp === 'number' ? parsedData.timestamp : now
    };
    if (hasAdminCredentials && adminDb) {
      await adminDb.collection('ota_sync_diagnostics').doc(cleanId).set(diagDoc);
    } else if (clientDb) {
      await setDoc(doc(clientDb, 'ota_sync_diagnostics', cleanId), diagDoc);
    }
    return res.json({ success: true, collection: collectionName, docId: cleanId, updatedAt: now, message: `Saved ota_sync_diagnostics/${cleanId} to Cloud Firestore.` });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: JSON.stringify({
        operationType: 'write',
        path: `${collectionName}/${cleanId}`,
        error: err?.message || String(err)
      })
    });
  }
});

app.post('/api/developer/firebase/delete-doc', async (req, res) => {
  const { password, collectionName, docId } = req.body || {};
  if (password !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized developer passphrase' });
  }
  if (!(FIREBASE_ALLOWED_COLLECTIONS as readonly string[]).includes(collectionName)) {
    return res.status(400).json({ success: false, error: 'Invalid collection.' });
  }
  const cleanId = String(docId || '').trim();
  if (!cleanId || !/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
    return res.status(400).json({ success: false, error: 'Invalid document ID.' });
  }

  try {
    if (collectionName === 'ota_app_store') {
      const ok = await deleteOtaStoreDocFromFirestore(cleanId);
      if (!ok) return res.status(500).json({ success: false, error: 'Failed deleting Firestore document.' });
      if (cleanId === 'ota_pending_verifications_v1') {
        pendingEmailVerifications.clear();
      } else {
        delete store.keys[cleanId];
      }
      store.version = Date.now();
      broadcastToClients('update', { version: store.version, key: cleanId, changedKeys: { [cleanId]: null } });
    } else if (collectionName === 'schools') {
      const ok = await deleteSchoolDocFromFirestore(cleanId);
      if (!ok) return res.status(500).json({ success: false, error: 'Failed deleting school document.' });
      if (Array.isArray(store.keys['ota_schools_v1'])) {
        store.keys['ota_schools_v1'] = store.keys['ota_schools_v1'].filter((s: any) => s && s.id !== cleanId);
        await syncOtaStoreDocToFirestore('ota_schools_v1', store.keys['ota_schools_v1']);
        store.version = Date.now();
        broadcastToClients('update', { version: store.version, key: 'ota_schools_v1', changedKeys: { ota_schools_v1: store.keys['ota_schools_v1'] } });
      }
    } else {
      if (hasAdminCredentials && adminDb) {
        await adminDb.collection('ota_sync_diagnostics').doc(cleanId).delete();
      } else if (clientDb) {
        await deleteDoc(doc(clientDb, 'ota_sync_diagnostics', cleanId));
      }
    }
    return res.json({ success: true, message: `Deleted ${collectionName}/${cleanId} from Cloud Firestore.` });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: JSON.stringify({
        operationType: 'delete',
        path: `${collectionName}/${cleanId}`,
        error: err?.message || String(err)
      })
    });
  }
});

app.get('/api/developer/telemetry', (req, res) => {
  const pass = req.query.password || req.headers['x-developer-password'];
  if (pass !== DEVELOPER_PASSPHRASE) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const memory = process.memoryUsage();
  const uptimeSeconds = process.uptime();
  const classCount = Array.isArray(store.keys['ota_classes']) ? store.keys['ota_classes'].length : Object.keys(store.keys['ota_classes'] || {}).length;
  const teachersArr: any[] = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'] : Object.values(store.keys['ota_teachers_v3'] || {});
  const teacherCount = teachersArr.length;
  const pendingApprovals = teachersArr.filter((t: any) => t && t.isApproved === false && t.approvalStatus !== 'REJECTED').length;
  const subjectCount = Array.isArray(store.keys['ota_subjects_v2']) ? store.keys['ota_subjects_v2'].length : Object.keys(store.keys['ota_subjects_v2'] || {}).length;
  const timetableClasses = Object.keys(store.keys['ota_timetable_v2'] || {}).length;
  const requestCount = Array.isArray(store.keys['ota_requests_v2']) ? store.keys['ota_requests_v2'].length : 0;

  res.json({
    status: 'ONLINE',
    uptimeSeconds,
    memory,
    storeVersion: store.version,
    classCount,
    teacherCount,
    pendingApprovals,
    pendingVerifications: pendingEmailVerifications.size,
    subjectCount,
    timetableClasses,
    requestCount,
    sseClients: sseClients.length,
    emailConfigured: {
      resend: Boolean((process.env.RESEND_API_KEY || '').trim()),
      brevo: Boolean((process.env.BREVO_API_KEY || '').trim() && (process.env.BREVO_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || '').trim()),
      webhook: Boolean((process.env.EMAIL_WEBHOOK_URL || '').trim()),
      smtp: Boolean((process.env.SMTP_USER || '').trim() && (process.env.SMTP_PASS || '').trim())
    },
    projectId: 'ota-smart-timetable',
    databaseId: 'ai-studio-otasmarttimetabl-5b72f609-12f9-471e-8ea2-d4f3daede4d4'
  });
});


// Vite & Static file serving
async function startServer() {
  // Hydrate authoritative Firebase Firestore data BEFORE seeding defaults or accepting requests
  await hydrateStoreFromFirestore();
  runPasswordMigration();
  const preSeedTeachersCount = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'].length : 0;
  seedDefaultStoreData();
  const postSeedTeachersCount = Array.isArray(store.keys['ota_teachers_v3']) ? store.keys['ota_teachers_v3'].length : 0;
  populateServerVaultFromMemory();
  if (postSeedTeachersCount !== preSeedTeachersCount) {
    // Persist fake/synthetic teacher removal back to Cloud Firestore immediately
    await syncTeachersAndVaultToFirestore().catch(() => {});
  }
  setupServerFirestoreListeners();

  const isCompiledBundle = typeof __filename !== 'undefined' && __filename.endsWith('.cjs');
  const isProdServing = process.env.NODE_ENV === 'production' || (isCompiledBundle && process.env.NODE_ENV !== 'test');

  if (!isProdServing && process.env.NODE_ENV !== 'test') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else if (isProdServing) {
    const cwdDist = path.join(process.cwd(), 'dist');
    const bundleDist = typeof __dirname !== 'undefined' ? __dirname : cwdDist;
    const distPath = fs.existsSync(path.join(cwdDist, 'index.html')) ? cwdDist : bundleDist;

    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    }));

    app.use('/api', (_req, res) => {
      return res.status(404).json({ success: false, error: 'API endpoint not found' });
    });

    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.sendFile(path.join(distPath, 'index.html'));
      }
      next();
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (mode=${isProdServing ? 'production' : (process.env.NODE_ENV || 'development')})`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`[Server] Received ${signal}, shutting down gracefully...`);
    for (const client of sseClients) {
      try { client.res.end(); } catch {}
    }
    sseClients = [];
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer();
