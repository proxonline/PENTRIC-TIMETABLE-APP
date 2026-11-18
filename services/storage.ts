import { Teacher, TimetableGrid, Subject, HistoryEntry, SwapRequest, AppNotification, AppSettings, ChatMessage, AdminUser, Class, Room, ExamSession, TeacherAbsence, AuditLogEntry, School, AcademicLevel, SlotBudgetInfo, TimetableMetadata } from '../types';
import { ALL_SUBJECTS, ALL_CLASSES } from '../constants';
import { getSubjectStream, getClassStream } from './curriculum_eligibility';
import bcrypt from 'bcryptjs';
import { db, doc, setDoc, deleteDoc, getDocs, onSnapshot, collection, runTransaction, auth, signInWithCustomToken } from './firebase';

const KEYS = {
  TEACHERS: 'ota_teachers_v3',
  TIMETABLE: 'ota_timetable_v2',
  TIMETABLE_DRAFT: 'ota_timetable_draft_v1',
  TIMETABLE_METADATA: 'ota_timetable_metadata_v1',
  ADMIN_SESSION: 'ota_admin_session_id',
  TEACHER_SESSION: 'ota_teacher_session',
  HISTORY: 'ota_history_v2',
  REQUESTS: 'ota_requests_v2',
  NOTIFICATIONS: 'ota_notifications_v2',
  THEME: 'ota_theme',
  SETTINGS: 'ota_settings_v3',
  CHAT: 'ota_chat_messages',
  ADMINS: 'ota_admins',
  CLASSES: 'ota_classes',
  SUBJECTS: 'ota_subjects_v2',
  ROOMS: 'ota_rooms',
  EXAMS: 'ota_exams',
  ABSENCES: 'ota_absences_v1',
  AUDIT_LOGS: 'ota_audit_logs_v1',
  AUTH_TOKEN: 'ota_auth_token',
  FIREBASE_CUSTOM_TOKEN: 'ota_firebase_custom_token',
  TUTORIAL_SEEN: 'ota_tutorial_seen_v1',
  APP_WALKTHROUGH: 'ota_app_walkthrough_complete',
  SCHOOLS: 'ota_schools_v1',
  CURRENT_SCHOOL: 'ota_current_school'
};

const SYNC_KEYS = [
  KEYS.TEACHERS,
  KEYS.TIMETABLE,
  KEYS.TIMETABLE_DRAFT,
  KEYS.TIMETABLE_METADATA,
  KEYS.HISTORY,
  KEYS.REQUESTS,
  KEYS.NOTIFICATIONS,
  KEYS.SETTINGS,
  KEYS.CHAT,
  KEYS.ADMINS,
  KEYS.CLASSES,
  KEYS.SUBJECTS,
  KEYS.ROOMS,
  KEYS.EXAMS,
  KEYS.ABSENCES,
  KEYS.AUDIT_LOGS,
  KEYS.THEME,
  KEYS.SCHOOLS
];

const INTERNAL_FIRESTORE_KEYS = new Set([
  'ota_server_vault_v1',
  'ota_pending_verifications_v1',
  'app_state'
]);

export const DEFAULT_SCHOOLS: School[] = [
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

// Strictly in-memory store: zero data is saved locally on any device (Firebase Firestore is the single source of truth)
const memStore = new Map<string, string>();
const recentDeletedTeacherTombstones = new Map<string, number>();

function purgeLegacyLocalStorage() {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('ota_')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => {
      try { window.localStorage.removeItem(k); } catch {}
    });
  } catch {}
  try {
    const sKeysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith('ota_')) {
        sKeysToRemove.push(k);
      }
    }
    sKeysToRemove.forEach(k => {
      try { window.sessionStorage.removeItem(k); } catch {}
    });
  } catch {}
}

purgeLegacyLocalStorage();

function memGet(key: string): string | null {
  return memStore.has(key) ? memStore.get(key)! : null;
}

function memSet(key: string, value: string): void {
  memStore.set(key, value);
}

function memRemove(key: string): void {
  memStore.delete(key);
}

function sanitizeTeacherForFirestore(teacher: any): any {
  if (!teacher || typeof teacher !== 'object') return teacher;
  const { password, recoveryCode, calendarToken, ...safe } = teacher;
  return safe;
}

// Helper to safely parse array data from string/JSON/object payloads
function safeParseArray<T>(data: string | null, defaultValue: T[] = []): T[] {
  if (!data) return defaultValue;
  try {
    const parsed = JSON.parse(data);
    let arr: any[] = [];
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === 'object' && parsed !== null) {
      arr = Object.values(parsed);
    } else {
      return defaultValue;
    }
    return arr.filter((item): item is T => item !== null && item !== undefined && typeof item === 'object');
  } catch {
    return defaultValue;
  }
}

// --- CLOUD REALTIME SYNC (FIREBASE FIRESTORE + SERVER SSE/POLL) ---
class CloudSync {
  private listeners: ((showIndicator?: boolean) => void)[] = [];
  private connectionListeners: ((connected: boolean) => void)[] = [];
  public ready = false;
  public isConnected = false;
  public isApiConnected = false;
  public isFirestoreConnected = false;
  private readyListeners: (() => void)[] = [];
  private recentErrors: Array<{ timestamp: number; operation: string; error: string; code?: string }> = [];
  public serverSyncVersion = 0;
  private sseSource: EventSource | null = null;
  private syncInterval: any = null;
  public lastFirestoreTimestamps: Record<string, number> = {};
  public lastLocalTimetableMutation = 0;

  private getDeletedTeacherIds(): string[] {
    const now = Date.now();
    for (const [id, ts] of recentDeletedTeacherTombstones.entries()) {
      if (now - ts > 30000) {
        recentDeletedTeacherTombstones.delete(id);
      }
    }
    return Array.from(recentDeletedTeacherTombstones.keys());
  }

  private updateConnectionStatus(api?: boolean, firestore?: boolean) {
    if (api !== undefined) this.isApiConnected = api;
    if (firestore !== undefined) this.isFirestoreConnected = firestore;
    const newOverall = this.isApiConnected || this.isFirestoreConnected;
    if (this.isConnected !== newOverall) {
      this.isConnected = newOverall;
      this.connectionListeners.forEach(l => l(newOverall));
    }
  }

  constructor() {
    if (typeof window !== 'undefined') {
      this.hydrateFromFirestore().catch(() => {});
      this.fetchLatestFromApi(true).catch(() => {});
      this.initFirebaseSync();
      this.startFallbackSyncLoop();
      this.initSSESync();
    }
  }

  private logSyncError(operation: string, err: any) {
    const code = err?.code || err?.name;
    const msg = err?.message || String(err);
    if (code === 'unavailable' || msg.includes('Could not reach Cloud Firestore backend') || msg.includes('offline')) {
      this.updateConnectionStatus(undefined, false);
      return;
    }
    console.warn(`[CloudSync Notice - ${operation}] Code: ${code || 'UNKNOWN'}, Message: ${msg}`);
    this.recentErrors.unshift({
      timestamp: Date.now(),
      operation,
      error: msg,
      code
    });
    if (this.recentErrors.length > 20) {
      this.recentErrors.pop();
    }
  }

  public getRecentErrors() {
    return [...this.recentErrors];
  }

  private markReady() {
    if (!this.ready) {
      this.ready = true;
      this.readyListeners.forEach(l => l());
      this.readyListeners = [];
    }
  }

  private async hydrateFromFirestore(): Promise<void> {
    try {
      const [appSnap, schoolsSnap] = await Promise.all([
        getDocs(collection(db, 'ota_app_store')),
        getDocs(collection(db, 'schools'))
      ]);
      this.updateConnectionStatus(undefined, true);

      const incomingKeys: Record<string, any> = {};
      appSnap.docs.forEach((docSnap) => {
        const key = docSnap.id;
        if (INTERNAL_FIRESTORE_KEYS.has(key) || !SYNC_KEYS.includes(key)) return;
        const data = docSnap.data();
        if (data && data.payload !== undefined) {
          incomingKeys[key] = data.payload;
        }
      });

      if (!schoolsSnap.empty) {
        const existingSchools = Array.isArray(incomingKeys[KEYS.SCHOOLS])
          ? [...incomingKeys[KEYS.SCHOOLS]]
          : safeParseArray<School>(memGet(KEYS.SCHOOLS), []);
        schoolsSnap.docs.forEach((sDoc) => {
          const sData = sDoc.data();
          if (sData && sData.id && (sData.id === 'ota_total_academy' || String(sData.id).startsWith('sch_'))) {
            const idx = existingSchools.findIndex((x: any) => x && x.id === sData.id);
            if (idx >= 0) existingSchools[idx] = sData as School;
            else existingSchools.push(sData as School);
          }
        });
        incomingKeys[KEYS.SCHOOLS] = existingSchools;
      }

      const changed = this.applyKeysToStore(incomingKeys, 'FIRESTORE');
      this.markReady();
      if (changed) {
        this.notify(false);
      }
    } catch (err) {
      this.logSyncError('hydrateFromFirestore', err);
      this.markReady();
    }
  }

  private applyKeysToStore(keysData: Record<string, any>, source: 'FIRESTORE' | 'API' | 'SSE' = 'FIRESTORE'): boolean {
    let changed = false;
    const isAdminSessionActive = !!memGet(KEYS.ADMIN_SESSION);

    // If an API poll/event returned an unauthenticated PUBLIC projection while an admin is logged in,
    // never let the public projection strip admin-only data or pending teachers.
    const isPublicProjectionFromApi =
      source !== 'FIRESTORE' &&
      isAdminSessionActive &&
      keysData[KEYS.ADMINS] === undefined &&
      keysData[KEYS.TEACHERS] !== undefined &&
      Object.keys(keysData).length > 4;

    const keysToProcess = Object.keys(keysData).sort((a, b) => {
      if (a === KEYS.TIMETABLE_METADATA) return -1;
      if (b === KEYS.TIMETABLE_METADATA) return 1;
      return 0;
    });

    keysToProcess.forEach(k => {
      if (!SYNC_KEYS.includes(k)) return;
      const payload = keysData[k];
      if (payload === undefined) return;

      if (payload === null) {
        if (k === KEYS.TIMETABLE || k === KEYS.TIMETABLE_DRAFT || k === KEYS.HISTORY || k === KEYS.EXAMS || k === KEYS.ABSENCES || k === KEYS.AUDIT_LOGS || k === KEYS.CHAT) {
          if (memGet(k) !== null) {
            memRemove(k);
            changed = true;
          }
        }
        return;
      }

      if (k === KEYS.TIMETABLE_METADATA) {
        let parsedMeta: any = payload;
        if (typeof payload === 'string') {
          try { parsedMeta = JSON.parse(payload); } catch {}
        }
        if (parsedMeta && typeof parsedMeta.revisionId === 'number') {
          const currentMetaStr = memGet(KEYS.TIMETABLE_METADATA);
          let currentRev = 0;
          if (currentMetaStr) {
            try {
              const parsedCur = JSON.parse(currentMetaStr);
              if (parsedCur && typeof parsedCur.revisionId === 'number') {
                currentRev = parsedCur.revisionId;
              }
            } catch {}
          }
          const isExplicitDraftZero = parsedMeta.revisionId === 0 && parsedMeta.status === 'DRAFT';
          const incomingClearsTimetable = keysData[KEYS.TIMETABLE] === null || (source !== 'FIRESTORE' && keysData[KEYS.TIMETABLE] === undefined && isExplicitDraftZero);
          if (incomingClearsTimetable && memGet(KEYS.TIMETABLE) !== null) {
            memRemove(KEYS.TIMETABLE);
            changed = true;
          }
          if (parsedMeta.revisionId >= currentRev || (isExplicitDraftZero && (!memGet(KEYS.TIMETABLE) || incomingClearsTimetable || source === 'SSE'))) {
            const valStr = JSON.stringify(parsedMeta);
            if (valStr !== currentMetaStr) {
              memSet(k, valStr);
              changed = true;
            }
          }
        }
      } else if (k === KEYS.TIMETABLE) {
        const curMetaStr = memGet(KEYS.TIMETABLE_METADATA);
        let curRev = 0;
        if (curMetaStr) {
          try { curRev = JSON.parse(curMetaStr)?.revisionId || 0; } catch {}
        }

        let incRev = 0;
        if (keysData[KEYS.TIMETABLE_METADATA]) {
          let incMeta = keysData[KEYS.TIMETABLE_METADATA];
          if (typeof incMeta === 'string') {
            try { incMeta = JSON.parse(incMeta); } catch {}
          }
          if (incMeta && typeof incMeta.revisionId === 'number') {
            incRev = incMeta.revisionId;
          }
        }
        if (!incRev && payload && typeof payload === 'object' && typeof (payload as any)._revisionId === 'number') {
          incRev = (payload as any)._revisionId;
        }

        if (incRev > 0 && incRev < curRev) {
          return;
        }

        const currentMemStr = memGet(k);
        let currentClassesCount = 0;
        try {
          const parsed = currentMemStr ? JSON.parse(currentMemStr) : null;
          if (parsed && typeof parsed === 'object') currentClassesCount = Object.keys(parsed).length;
        } catch {}

        let newClassesCount = 0;
        let parsedNew: any = payload;
        try {
          if (typeof payload === 'string') parsedNew = JSON.parse(payload);
          if (parsedNew && typeof parsedNew === 'object') newClassesCount = Object.keys(parsedNew).length;
        } catch {}

        if (newClassesCount > 0 || currentClassesCount === 0) {
          const valStr = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
          if (valStr !== currentMemStr) {
            memSet(k, valStr);
            changed = true;
          }
        }
      } else if (k === KEYS.TIMETABLE_DRAFT || k === KEYS.SETTINGS || k === KEYS.THEME) {
        const valStr = typeof payload === 'string' && k !== KEYS.THEME ? payload : JSON.stringify(payload);
        if (valStr !== memGet(k)) {
          memSet(k, valStr);
          changed = true;
        }
      } else {
        if (k === KEYS.TEACHERS && isPublicProjectionFromApi) {
          return;
        }

        let items: any[] = [];
        if (Array.isArray(payload)) {
          items = payload.filter((i: any) => i !== null && i !== undefined);
        } else if (payload && typeof payload === 'object') {
          items = safeParseArray(JSON.stringify(payload), []);
        }

        if (k === KEYS.TEACHERS) {
          const deletedIds = this.getDeletedTeacherIds();
          const currentTeachers: Teacher[] = safeParseArray(memGet(KEYS.TEACHERS), []);

          items = items
            .filter((it: any) => {
              if (!it || !it.id || deletedIds.includes(it.id)) return false;
              const id = String(it.id || '').toLowerCase();
              const uname = (it.username || '').toLowerCase().trim();
              const name = (it.name || '').toLowerCase().trim();
              const email = (it.contactEmail || '').toLowerCase().trim();
              if (id.startsWith('tch_demo_') || id === 't_1793095260406_a8f1a4' || id === 't_1793633708715_af1a80') return false;
              if (uname === 'qq' || name === 'qq') return false;
              if (uname === 'adalovelace' || name === 'ada lovelace') return false;
              if (uname.startsWith('sync_') || name.includes('alan turing')) return false;
              if (uname.startsWith('matrix_') || name.includes('matrix faculty')) return false;
              if (email.includes('matrix_teach_') || email.includes('sync_teach_') || email.endsWith('@otaacademy.edu')) return false;
              return true;
            })
            .map((it: any) => {
              const localT = currentTeachers.find(lt => lt && lt.id === it.id);
              const merged = { ...it };
              if (localT && !merged.profilePicture && localT.profilePicture) {
                merged.profilePicture = localT.profilePicture;
              }
              if (localT && localT.isCompleted && !merged.isCompleted && (localT.updatedAt || 0) >= (merged.updatedAt || 0)) {
                merged.isCompleted = true;
                if ((!merged.assignedClasses || merged.assignedClasses.length === 0) && localT.assignedClasses?.length) {
                  merged.assignedClasses = localT.assignedClasses;
                }
                if ((!merged.subjectsTaught || merged.subjectsTaught.length === 0) && localT.subjectsTaught?.length) {
                  merged.subjectsTaught = localT.subjectsTaught;
                }
              }
              return merged;
            });
        }

        const valStr = JSON.stringify(items);
        if (valStr !== memGet(k)) {
          memSet(k, valStr);
          changed = true;
        }
      }
    });

    return changed;
  }

  public reconnectSSE() {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    try {
      if (this.sseSource) {
        this.sseSource.close();
        this.sseSource = null;
      }
      const token = memGet(KEYS.AUTH_TOKEN);
      const sseUrl = token ? `/api/sync/events?token=${encodeURIComponent(token)}` : '/api/sync/events';
      const evtSource = new EventSource(sseUrl);
      this.sseSource = evtSource;

      evtSource.onopen = () => {
        this.updateConnectionStatus(true, undefined);
      };

      evtSource.addEventListener('init', (e: MessageEvent) => {
        try {
          this.updateConnectionStatus(true, undefined);
          const data = JSON.parse(e.data);
          if (data && data.version && data.keys) {
            this.serverSyncVersion = Math.max(this.serverSyncVersion, data.version);
            const changed = this.applyKeysToStore(data.keys, 'SSE');
            this.markReady();
            if (changed) this.notify(true);
          }
        } catch {}
      });

      evtSource.addEventListener('update', (e: MessageEvent) => {
        try {
          this.updateConnectionStatus(true, undefined);
          const data = JSON.parse(e.data);
          if (data && data.version) {
            this.serverSyncVersion = Math.max(this.serverSyncVersion, data.version);
            let changed = false;
            if (data.changedKeys) {
              changed = this.applyKeysToStore(data.changedKeys, 'SSE');
            } else if (data.keys) {
              changed = this.applyKeysToStore(data.keys, 'SSE');
            } else if (data.key && data.data !== undefined) {
              changed = this.applyKeysToStore({ [data.key]: data.data }, 'SSE');
            }
            if (changed) this.notify(true);
          }
        } catch {}
      });

      evtSource.addEventListener('reset', (e: MessageEvent) => {
        try {
          SYNC_KEYS.forEach(k => memRemove(k));
          const data = e.data ? JSON.parse(e.data) : null;
          if (data && data.keys) {
            this.applyKeysToStore(data.keys, 'SSE');
          }
          this.notify(true);
        } catch {}
      });

      evtSource.onerror = () => {
        // Native EventSource handles auto-reconnect
      };
    } catch {}
  }

  private initSSESync() {
    this.reconnectSSE();
  }

  private startFallbackSyncLoop() {
    if (this.syncInterval) clearInterval(this.syncInterval);

    const pollFn = async () => {
      try {
        const headers: Record<string, string> = {};
        const token = memGet(KEYS.AUTH_TOKEN);
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`/api/sync/state?v=${this.serverSyncVersion}`, { headers });
        if (res.ok) {
          this.updateConnectionStatus(true, undefined);
          const data = await res.json();
          if (data && data.unchanged) {
            return;
          }
          if (data && data.version && data.version > this.serverSyncVersion) {
            this.serverSyncVersion = data.version;
            if (data.keys) {
              const changed = this.applyKeysToStore(data.keys, 'API');
              if (changed) {
                this.notify(true);
              }
            }
          }
        }
      } catch {}
    };

    pollFn();
    this.syncInterval = setInterval(pollFn, 3000);
  }

  private async pushToServerApi(payloadObj: { key?: string; item_id?: string; data?: any; isDelete?: boolean; updates?: Record<string, any> }) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = memGet(KEYS.AUTH_TOKEN);
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/sync/update', {
        method: 'POST',
        headers,
        body: JSON.stringify(payloadObj)
      });
      if (res.ok) {
        this.updateConnectionStatus(true, undefined);
        const data = await res.json();
        if (data && data.version) {
          this.serverSyncVersion = Math.max(this.serverSyncVersion, data.version);
        }
      }
    } catch {}
  }

  private initFirebaseSync() {
    setTimeout(() => this.markReady(), 1200);

    // Subscribe live to the entire ota_app_store collection so ALL synced features reflect instantly
    try {
      onSnapshot(collection(db, 'ota_app_store'), (snapshot) => {
        this.updateConnectionStatus(undefined, true);
        this.markReady();

        const incomingBatch: Record<string, any> = {};
        snapshot.docChanges().forEach((change) => {
          const k = change.doc.id;
          if (INTERNAL_FIRESTORE_KEYS.has(k) || !SYNC_KEYS.includes(k)) return;

          if (change.type === 'removed') {
            incomingBatch[k] = null;
            return;
          }

          const data = change.doc.data();
          if (data && data.payload !== undefined) {
            this.lastFirestoreTimestamps[k] = data.updatedAt || Date.now();
            incomingBatch[k] = data.payload;
          }
        });

        if (Object.keys(incomingBatch).length > 0) {
          const changed = this.applyKeysToStore(incomingBatch, 'FIRESTORE');
          if (changed) {
            this.notify(true);
          }
        }
      }, (err) => {
        this.logSyncError('onSnapshot(ota_app_store)', err);
      });
    } catch (err) {
      this.logSyncError('collectionListener(ota_app_store)', err);
    }

    // Subscribe live to /schools collection so institutions added from any device appear everywhere
    try {
      onSnapshot(collection(db, 'schools'), (snapshot) => {
        this.updateConnectionStatus(undefined, true);
        const existingSchools = safeParseArray<School>(memGet(KEYS.SCHOOLS), []);
        let modified = false;

        snapshot.docChanges().forEach((change) => {
          const sData = change.doc.data();
          const sId = sData?.id || change.doc.id;
          if (!sId || sId === 'ota_total_academy') return;

          if (change.type === 'removed') {
            const next = existingSchools.filter(s => s && s.id !== sId);
            if (next.length !== existingSchools.length) {
              existingSchools.splice(0, existingSchools.length, ...next);
              modified = true;
            }
          } else if (sData && sData.name) {
            const idx = existingSchools.findIndex(s => s && s.id === sId);
            if (idx >= 0) {
              if (JSON.stringify(existingSchools[idx]) !== JSON.stringify(sData)) {
                existingSchools[idx] = sData as School;
                modified = true;
              }
            } else {
              existingSchools.push(sData as School);
              modified = true;
            }
          }
        });

        if (modified) {
          memSet(KEYS.SCHOOLS, JSON.stringify(existingSchools));
          this.notify(true);
        }
      }, (err) => {
        this.logSyncError('onSnapshot(schools)', err);
      });
    } catch (err) {
      this.logSyncError('collectionListener(schools)', err);
    }
  }

  onReady(listener: () => void) {
    if (this.ready) listener();
    else this.readyListeners.push(listener);
  }

  subscribe(listener: (showIndicator?: boolean) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  subscribeConnectionStatus(listener: (connected: boolean) => void) {
    this.connectionListeners.push(listener);
    listener(this.isConnected);
    return () => {
      this.connectionListeners = this.connectionListeners.filter(l => l !== listener);
    };
  }

  notify(showIndicator: boolean = true) {
    setTimeout(() => {
      this.listeners.forEach(l => l(showIndicator));
    }, 0);
  }

  public async fetchLatestFromApi(forceFull: boolean = false): Promise<boolean> {
    try {
      const hasTimetable = !!memGet(KEYS.TIMETABLE);
      const reqVersion = (forceFull || !hasTimetable) ? 0 : this.serverSyncVersion;
      const headers: Record<string, string> = {};
      const token = memGet(KEYS.AUTH_TOKEN);
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/sync/state?v=${reqVersion}`, { headers });
      if (res.ok) {
        this.updateConnectionStatus(true, undefined);
        const data = await res.json();
        if (data && data.unchanged) {
          return true;
        }
        if (data && data.version) {
          this.serverSyncVersion = Math.max(this.serverSyncVersion, data.version);
          if (data.keys) {
            const changed = this.applyKeysToStore(data.keys, 'API');
            this.markReady();
            if (changed) {
              this.notify(true);
            }
          }
        }
        return true;
      }
    } catch {}
    return false;
  }

  async pushItem(key: string, id: string, item: any, skipNotify: boolean = false) {
    if (!skipNotify) this.notify();
    const safeItemForCloud = key === KEYS.TEACHERS ? sanitizeTeacherForFirestore(item) : item;
    this.pushToServerApi({ key, item_id: id, data: safeItemForCloud });

    try {
      const dataStr = memGet(key);
      const arr: any[] = safeParseArray(dataStr, []);
      const idx = arr.findIndex((i: any) => i && i.id === id);
      if (idx >= 0) arr[idx] = item;
      else arr.push(item);
      memSet(key, JSON.stringify(arr));

      const cleanCloudItem = JSON.parse(JSON.stringify(safeItemForCloud));
      const now = Date.now();
      this.lastFirestoreTimestamps[key] = now;

      await runTransaction(db, async (tx) => {
        const docRef = doc(db, 'ota_app_store', key);
        const snap = await tx.get(docRef);
        const existingRaw = snap.exists() ? snap.data()?.payload : null;
        let currentArr: any[] = Array.isArray(existingRaw)
          ? [...existingRaw]
          : (existingRaw && typeof existingRaw === 'object' ? Object.values(existingRaw) : []);
        currentArr = currentArr.filter(x => x && typeof x === 'object');
        const cIdx = currentArr.findIndex((i: any) => i && i.id === id);
        if (cIdx >= 0) currentArr[cIdx] = cleanCloudItem;
        else currentArr.push(cleanCloudItem);
        tx.set(docRef, { payload: currentArr, updatedAt: now });
      });
    } catch (e) {
      this.logSyncError(`pushItem(${key}, ${id})`, e);
    }
  }

  async deleteItem(key: string, id: string, skipNotify: boolean = false) {
    if (!skipNotify) this.notify();
    this.pushToServerApi({ key, item_id: id, isDelete: true });

    try {
      const dataStr = memGet(key);
      let arr: any[] = safeParseArray(dataStr, []);
      arr = arr.filter((i: any) => i && i.id !== id);
      memSet(key, JSON.stringify(arr));

      const now = Date.now();
      this.lastFirestoreTimestamps[key] = now;

      await runTransaction(db, async (tx) => {
        const docRef = doc(db, 'ota_app_store', key);
        const snap = await tx.get(docRef);
        const existingRaw = snap.exists() ? snap.data()?.payload : null;
        let currentArr: any[] = Array.isArray(existingRaw)
          ? [...existingRaw]
          : (existingRaw && typeof existingRaw === 'object' ? Object.values(existingRaw) : []);
        currentArr = currentArr.filter((i: any) => i && i.id !== id);
        tx.set(docRef, { payload: currentArr, updatedAt: now });
      });
    } catch (e) {
      this.logSyncError(`deleteItem(${key}, ${id})`, e);
    }
  }

  async pushObject(key: string, obj: any, skipNotify: boolean = false) {
    if (!skipNotify) this.notify();
    this.pushToServerApi({ key, data: obj });

    try {
      const cleanObj = obj !== undefined && obj !== null && typeof obj === 'object'
        ? JSON.parse(JSON.stringify(obj))
        : obj;
      const now = Date.now();
      this.lastFirestoreTimestamps[key] = now;
      await setDoc(doc(db, 'ota_app_store', key), { payload: cleanObj, updatedAt: now });
    } catch (e) {
      this.logSyncError(`pushObject(${key})`, e);
    }
  }

  async deleteKey(key: string, skipNotify: boolean = false) {
    memRemove(key);
    if (!skipNotify) this.notify();
    this.pushToServerApi({ key, isDelete: true });
    try {
      await deleteDoc(doc(db, 'ota_app_store', key));
    } catch (e) {
      this.logSyncError(`deleteKey(${key})`, e);
    }
  }

  async pushUpdates(updates: Record<string, any>, skipNotify: boolean = false) {
    if (!skipNotify) this.notify();

    // Never transmit passwords inside teacher updates
    const safeUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k.startsWith(`${KEYS.TEACHERS}.`) && v && typeof v === 'object') {
        safeUpdates[k] = sanitizeTeacherForFirestore(v);
      } else if (k === KEYS.TEACHERS && Array.isArray(v)) {
        safeUpdates[k] = v.map(sanitizeTeacherForFirestore);
      } else {
        safeUpdates[k] = v;
      }
    }

    this.pushToServerApi({ updates: safeUpdates });

    const keysToSync = new Set<string>();
    Object.keys(updates).forEach(pathKey => {
      const rootKey = pathKey.split('.')[0];
      if (SYNC_KEYS.includes(rootKey)) {
        keysToSync.add(rootKey);
      }
    });

    const sortedKeys = Array.from(keysToSync).sort((a, b) => {
      if (a === KEYS.TIMETABLE) return -1;
      if (b === KEYS.TIMETABLE) return 1;
      return 0;
    });

    for (const key of sortedKeys) {
      try {
        const dataStr = memGet(key);
        if (dataStr) {
          let payload = JSON.parse(dataStr);
          if (key !== KEYS.TIMETABLE && key !== KEYS.TIMETABLE_DRAFT && key !== KEYS.TIMETABLE_METADATA && key !== KEYS.SETTINGS && key !== KEYS.THEME) {
            payload = safeParseArray(dataStr, []);
          }
          if (key === KEYS.TEACHERS && Array.isArray(payload)) {
            payload = payload.map(sanitizeTeacherForFirestore);
          }
          const cleanPayload = JSON.parse(JSON.stringify(payload));
          const now = Date.now();
          this.lastFirestoreTimestamps[key] = now;
          await setDoc(doc(db, 'ota_app_store', key), { payload: cleanPayload, updatedAt: now });
        }
      } catch (err) {
        this.logSyncError(`pushUpdates(${key})`, err);
      }
    }
  }

  async resetServer() {
    try {
      for (const key of SYNC_KEYS) {
        await deleteDoc(doc(db, 'ota_app_store', key));
      }
    } catch (e) {
      this.logSyncError('resetServer', e);
    }
  }
}

const cloud = new CloudSync();

// --- TEACHERS GENERATOR ---
export function generateFullFaculty(subjectsList: Subject[] = ALL_SUBJECTS, classesList: Class[] = ALL_CLASSES): Teacher[] {
  return [];
}

export const storage = {
  // --- SUBSCRIPTION ---
  subscribe: (listener: (showIndicator?: boolean) => void) => cloud.subscribe(listener),
  subscribeConnectionStatus: (listener: (connected: boolean) => void) => cloud.subscribeConnectionStatus(listener),
  isReady: () => cloud.ready,
  onReady: (listener: () => void) => cloud.onReady(listener),
  forceSync: (): Promise<boolean> => cloud.fetchLatestFromApi(false),
  setFirebaseCustomToken: (customToken: string) => {
    if (customToken) {
      memSet(KEYS.FIREBASE_CUSTOM_TOKEN, customToken);
      if (auth) {
        signInWithCustomToken(auth, customToken).catch(() => {});
      }
    }
  },

  // --- TUTORIALS ---
  hasSeenTutorial: (): boolean => {
    const data = memGet(KEYS.TUTORIAL_SEEN);
    try { return data ? JSON.parse(data) === 'true' : false; } catch { return data === 'true'; }
  },

  setTutorialSeen: () => {
    memSet(KEYS.TUTORIAL_SEEN, JSON.stringify('true'));
    cloud.notify(false);
  },

  hasSeenAppWalkthrough: (): boolean => {
    const data = memGet(KEYS.APP_WALKTHROUGH);
    try { return data ? JSON.parse(data) === 'true' : false; } catch { return data === 'true'; }
  },

  setAppWalkthroughSeen: () => {
    memSet(KEYS.APP_WALKTHROUGH, JSON.stringify('true'));
    cloud.notify(false);
  },

  // --- LEVEL HELPERS ---
  normalizeLevel: (val?: string): AcademicLevel => {
    if (!val) return 'JUNIOR';
    const upper = val.toUpperCase();
    if (upper === 'JSS' || upper === 'JUNIOR' || upper.startsWith('JS') || upper.startsWith('JSS_')) return 'JUNIOR';
    return 'SENIOR';
  },

  normalizeSubject: (sub: any): Subject => {
    const level: AcademicLevel = sub.level
      ? (sub.level === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')
      : (sub.category === 'JSS' || sub.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');

    const periodsPerWeek = typeof sub.defaultPeriodCount === 'number' && sub.defaultPeriodCount > 0
      ? sub.defaultPeriodCount
      : (typeof sub.periodsPerWeek === 'number' && sub.periodsPerWeek > 0 ? sub.periodsPerWeek : 3);

    const stream = sub.stream || (level === 'SENIOR' ? getSubjectStream(sub) : 'ALL');

    return {
      id: sub.id,
      name: sub.name,
      code: sub.code || (sub.name ? sub.name.substring(0, 4).toUpperCase() : 'SUBJ'),
      category: level,
      level,
      stream,
      eligibleClassIds: Array.isArray(sub.eligibleClassIds) ? sub.eligibleClassIds : undefined,
      isCore: !!sub.isCore,
      defaultPeriodCount: periodsPerWeek,
      periodsPerWeek,
      maxPerDay: typeof sub.maxPerDay === 'number' && sub.maxPerDay > 0 ? sub.maxPerDay : (periodsPerWeek >= 4 && sub.isCore ? 2 : 1),
      preferredTeacherId: sub.preferredTeacherId,
      assignedTeacherIds: Array.isArray(sub.assignedTeacherIds) ? sub.assignedTeacherIds : [],
      color: sub.color
    };
  },

  normalizeClass: (cls: any): Class => {
    const level: AcademicLevel = cls.level
      ? (cls.level === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')
      : (cls.category === 'JSS' || cls.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');

    const stream = cls.stream || (level === 'SENIOR' ? getClassStream(cls) : 'GENERAL');

    return {
      id: cls.id,
      name: cls.name,
      category: level,
      level,
      stream,
      eligibleSubjectIds: Array.isArray(cls.eligibleSubjectIds) ? cls.eligibleSubjectIds : undefined,
      gradeLevel: cls.gradeLevel,
      assignedTeacherId: cls.assignedTeacherId,
      roomNumber: cls.roomNumber
    };
  },

  // --- CLASSES ---
  getClasses: (): Class[] => {
    const data = memGet(KEYS.CLASSES);
    const rawClasses = safeParseArray<any>(data, []);
    if (rawClasses.length > 0) {
      return rawClasses.map(c => storage.normalizeClass(c));
    }
    const initial = ALL_CLASSES.map(c => storage.normalizeClass(c));
    memSet(KEYS.CLASSES, JSON.stringify(initial));
    return initial;
  },
  getClassesByLevel: (level: AcademicLevel): Class[] => {
    return storage.getClasses().filter(c => c.level === level);
  },
  saveClass: (cls: Class) => {
    const normalized = storage.normalizeClass(cls);
    const classes = storage.getClasses();
    const idx = classes.findIndex(c => c.id === normalized.id);
    if (idx >= 0) classes[idx] = normalized;
    else classes.push(normalized);
    memSet(KEYS.CLASSES, JSON.stringify(classes));
    cloud.pushItem(KEYS.CLASSES, normalized.id, normalized);
  },
  deleteClass: (id: string) => {
    const classes = storage.getClasses();
    const updated = classes.filter(c => c.id !== id);
    memSet(KEYS.CLASSES, JSON.stringify(updated));
    cloud.deleteItem(KEYS.CLASSES, id);
  },

  // --- SUBJECTS ---
  getSubjects: (): Subject[] => {
    const data = memGet(KEYS.SUBJECTS);
    const rawSubjects = safeParseArray<any>(data, []);
    const currentSchool = storage.getCurrentSchool();
    const isOta = !currentSchool || currentSchool.isOta || currentSchool.code === 'OTA' || currentSchool.id === 'ota_total_academy';

    if (rawSubjects.length > 0) {
      let normalized = rawSubjects
        .filter(s => s && (s.id || s.name))
        .filter(s => s.id !== 'eco_sci' && s.id !== 'yor_sci')
        .map(s => storage.normalizeSubject(s));

      const sciSubs = normalized.filter(s => s.level === 'SENIOR' && (s.stream === 'SCIENCE' || s.id?.endsWith('_sci') || ['phy_sci', 'chem_sci', 'bio_sci'].includes(s.id)));
      const sciTotal = sciSubs.reduce((sum, s) => sum + (s.defaultPeriodCount || s.periodsPerWeek || 0), 0);
      if (sciTotal === 33) {
        normalized = normalized.map(s => {
          if (s.id === 'phy_sci') return { ...s, defaultPeriodCount: 5, periodsPerWeek: 5 };
          if (s.id === 'chem_sci') return { ...s, defaultPeriodCount: 5, periodsPerWeek: 5 };
          if (s.id === 'bio_sci') return { ...s, defaultPeriodCount: 5, periodsPerWeek: 5 };
          if (s.id === 'td_sci') return { ...s, defaultPeriodCount: 4, periodsPerWeek: 4 };
          if (s.id === 'dgt_sci') return { ...s, defaultPeriodCount: 3, periodsPerWeek: 3 };
          return s;
        });
        memSet(KEYS.SUBJECTS, JSON.stringify(normalized));
      }

      if (isOta) {
        return normalized.filter(s => {
          const code = (s.code || s.id || s.name || '').toUpperCase();
          const name = (s.name || '').toUpperCase();
          return !(code.startsWith('GEOG') || code.startsWith('GEO') || name.includes('GEOGRAPHY'));
        });
      }
      return normalized;
    }
    const initial = ALL_SUBJECTS.map(s => storage.normalizeSubject(s));
    memSet(KEYS.SUBJECTS, JSON.stringify(initial));
    return initial;
  },
  getSubjectsByLevel: (level: AcademicLevel): Subject[] => {
    return storage.getSubjects().filter(s => s.level === level);
  },
  saveSubject: (sub: Subject) => {
    const normalized = storage.normalizeSubject(sub);
    const subjects = storage.getSubjects();
    const idx = subjects.findIndex(s => s.id === normalized.id);
    if (idx >= 0) subjects[idx] = normalized;
    else subjects.push(normalized);
    memSet(KEYS.SUBJECTS, JSON.stringify(subjects));
    cloud.pushItem(KEYS.SUBJECTS, normalized.id, normalized);
  },
  deleteSubject: (id: string) => {
    const subjects = storage.getSubjects();
    const updated = subjects.filter(s => s.id !== id);
    memSet(KEYS.SUBJECTS, JSON.stringify(updated));
    cloud.deleteItem(KEYS.SUBJECTS, id);
  },

  // --- TIMETABLE SLOT BUDGET CALCULATOR ---
  calculateSlotBudget: (level: AcademicLevel, customTotalSlots?: number): SlotBudgetInfo => {
    const settings = storage.getSettings();
    const daysCount = settings.enableSaturday ? 6 : 5;
    const periodsPerDay = settings.periodsPerDay || 8;
    const totalSlots = customTotalSlots || (daysCount * periodsPerDay);

    const subjects = storage.getSubjects().filter(s => s.level === level);
    const assignedSlots = subjects.reduce((sum, s) => sum + (s.defaultPeriodCount || s.periodsPerWeek || 0), 0);
    const remainingSlots = totalSlots - assignedSlots;

    return {
      level,
      totalSlots,
      assignedSlots,
      remainingSlots,
      isOverallocated: remainingSlots < 0,
      isBalanced: remainingSlots >= 0 && remainingSlots <= 2,
      subjectsCount: subjects.length
    };
  },

  getDeletedTeacherIds: (): string[] => {
    const now = Date.now();
    for (const [id, ts] of recentDeletedTeacherTombstones.entries()) {
      if (now - ts > 30000) recentDeletedTeacherTombstones.delete(id);
    }
    return Array.from(recentDeletedTeacherTombstones.keys());
  },

  scrubTeacherFromLocalTimetable: (teacherId: string) => {
    const data = memGet(KEYS.TIMETABLE);
    if (!data) return;
    try {
      const timetable = JSON.parse(data);
      if (timetable && typeof timetable === 'object') {
        let changed = false;
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
                  cell.teacherName = 'Unassigned';
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
        if (changed) {
          memSet(KEYS.TIMETABLE, JSON.stringify(timetable));
        }
      }
    } catch {}
  },

  sanitizeTimetableGrid: (grid: TimetableGrid): TimetableGrid => {
    if (!grid || typeof grid !== 'object') return grid;
    const bcSubjectKeywords = ['ECONOMICS', 'YORUBA', 'COMMERCE', 'ACCOUNTING', 'BOOK KEEPING', 'STORE MANAGEMENT', 'LITERATURE', 'GOVERNMENT'];
    const sanitized = JSON.parse(JSON.stringify(grid));

    for (const classId in sanitized) {
      const isScienceClass = /SS\d+A\d*/i.test(classId);
      if (!isScienceClass) continue;

      const days = sanitized[classId];
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
          }
        }
      }
    }
    return sanitized;
  },

  // --- TEACHERS ---
  getTeachers: (): Teacher[] => {
    const deletedIds = storage.getDeletedTeacherIds();
    const data = memGet(KEYS.TEACHERS);
    let teachers: Teacher[] = safeParseArray<Teacher>(data, []);
    if (!teachers) teachers = [];

    teachers = teachers.filter(t => {
      if (!t || !t.id || deletedIds.includes(t.id)) return false;
      const uname = (t.username || '').toLowerCase();
      const name = (t.name || '').toLowerCase();
      if (uname === 'qq' || name === 'qq') return false;
      if (uname.startsWith('sync_') || name.includes('alan turing')) return false;
      if (uname.startsWith('matrix_') || name.includes('matrix faculty')) return false;
      if (t.id === 't_1793095260406_a8f1a4' || t.id === 't_1793633708715_af1a80') return false;
      return true;
    });

    teachers.forEach(t => {
      if (t && t.isApproved === undefined && t.approvalStatus === undefined) {
        t.isApproved = true;
        t.approvalStatus = 'APPROVED';
        t.schoolId = t.schoolId || 'ota_total_academy';
      }
    });

    return teachers;
  },

  getTeacherProfilePicture: (id: string): string | undefined => {
    if (!id) return undefined;
    return storage.getTeachers().find(t => t.id === id)?.profilePicture;
  },

  mergeTeacherInMemory: (teacher: Teacher) => {
    if (!teacher || !teacher.id) return;
    recentDeletedTeacherTombstones.delete(teacher.id);
    const teachers = storage.getTeachers();
    const idx = teachers.findIndex(t => t.id === teacher.id);
    if (idx >= 0) teachers[idx] = { ...teachers[idx], ...teacher };
    else teachers.push(teacher);
    memSet(KEYS.TEACHERS, JSON.stringify(teachers));
    cloud.notify(false);
  },

  applyTeacherApprovalResultInMemory: (teacherId: string, action: 'APPROVE' | 'REJECT' | 'DELETE', updatedTeacher?: Teacher | null) => {
    const teachers = storage.getTeachers();
    if (action === 'DELETE') {
      recentDeletedTeacherTombstones.set(teacherId, Date.now());
      const next = teachers.filter(t => t.id !== teacherId);
      memSet(KEYS.TEACHERS, JSON.stringify(next));
      storage.scrubTeacherFromLocalTimetable(teacherId);
    } else if (updatedTeacher) {
      const idx = teachers.findIndex(t => t.id === teacherId);
      if (idx >= 0) teachers[idx] = { ...teachers[idx], ...updatedTeacher };
      else teachers.push(updatedTeacher);
      memSet(KEYS.TEACHERS, JSON.stringify(teachers));
    }
    cloud.notify(false);
  },

  saveTeacher: (teacher: Teacher) => {
    const teachers = storage.getTeachers();
    const formatted: Teacher = {
      ...teacher,
      updatedAt: Date.now(),
      password: teacher.password ? (/^\$2[aby]\$/.test(teacher.password) ? teacher.password : bcrypt.hashSync(teacher.password, 10)) : undefined
    };
    const index = teachers.findIndex(t => t.id === formatted.id);
    if (index >= 0) teachers[index] = formatted;
    else teachers.push(formatted);

    memSet(KEYS.TEACHERS, JSON.stringify(teachers));
    cloud.pushItem(KEYS.TEACHERS, formatted.id, formatted);

    if (formatted.id && typeof window !== 'undefined') {
      const token = memGet(KEYS.AUTH_TOKEN);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      fetch(`/api/teachers/${formatted.id}/profile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: formatted.name,
          profilePicture: formatted.profilePicture,
          bio: formatted.bio,
          contactEmail: formatted.contactEmail,
          contactPhone: formatted.contactPhone,
          isCompleted: formatted.isCompleted,
          assignedClasses: formatted.assignedClasses,
          subjectsTaught: formatted.subjectsTaught,
          classSubjects: formatted.classSubjects,
          availability: formatted.availability,
          uiTheme: formatted.uiTheme
        })
      })
        .then(async (res) => {
          if (!res.ok) return;
          const result = await res.json().catch(() => null);
          if (!result || !result.success) return;
          let dirty = false;
          if (result.timetable && typeof result.timetable === 'object') {
            memSet(KEYS.TIMETABLE, JSON.stringify(result.timetable));
            dirty = true;
          }
          if (result.draftTimetable && typeof result.draftTimetable === 'object') {
            memSet(KEYS.TIMETABLE_DRAFT, JSON.stringify(result.draftTimetable));
            dirty = true;
          }
          if (result.version) {
            cloud.serverSyncVersion = Math.max(cloud.serverSyncVersion, result.version);
          }
          if (dirty) {
            cloud.notify(true);
          }
        })
        .catch(() => {});
    }
  },

  replaceAllTeachers: (teachersList: Teacher[]) => {
    const clean = teachersList.map(sanitizeTeacherForFirestore);
    memSet(KEYS.TEACHERS, JSON.stringify(clean));
    cloud.pushObject(KEYS.TEACHERS, clean);
  },

  clearAllTeachers: () => {
    const teachers = storage.getTeachers();
    teachers.forEach(t => {
      if (t.id) {
        recentDeletedTeacherTombstones.set(t.id, Date.now());
        storage.scrubTeacherFromLocalTimetable(t.id);
      }
    });
    memSet(KEYS.TEACHERS, JSON.stringify([]));
    cloud.pushObject(KEYS.TEACHERS, []);
    if (typeof window !== 'undefined') {
      const token = memGet(KEYS.AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch('/api/teachers/clear-all', { method: 'POST', headers }).catch(() => {});
    }
    cloud.notify(true);
  },

  saveTeachers: (newTeachers: Teacher[]) => {
    if (newTeachers.length === 0) {
      storage.clearAllTeachers();
      return;
    }
    const teachers = storage.getTeachers();
    const updates: Record<string, any> = {};

    newTeachers.forEach(teacher => {
      const clean = sanitizeTeacherForFirestore(teacher);
      const index = teachers.findIndex(t => t.id === clean.id);
      if (index >= 0) teachers[index] = clean;
      else teachers.push(clean);
      updates[`${KEYS.TEACHERS}.${clean.id}`] = clean;
    });

    memSet(KEYS.TEACHERS, JSON.stringify(teachers));
    cloud.pushUpdates(updates);
  },

  deleteTeacher: (id: string) => {
    recentDeletedTeacherTombstones.set(id, Date.now());
    const teachers = storage.getTeachers();
    const updated = teachers.filter(t => t.id !== id);
    memSet(KEYS.TEACHERS, JSON.stringify(updated));
    storage.scrubTeacherFromLocalTimetable(id);
    if (typeof window !== 'undefined') {
      const token = memGet(KEYS.AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch(`/api/teachers/${id}`, { method: 'DELETE', headers }).catch(() => {});
    }
    cloud.deleteItem(KEYS.TEACHERS, id);
  },

  updateTeacherPassword: (id: string, newPass: string) => {
    const teachers = storage.getTeachers();
    const index = teachers.findIndex(t => t.id === id);
    if (index !== -1) {
      const updatedTeacher = {
        ...teachers[index],
        password: /^\$2[aby]\$/.test(newPass) ? newPass : bcrypt.hashSync(newPass, 10),
        mustChangePassword: false,
        recoveryCode: Math.random().toString(36).substring(2, 8).toUpperCase()
      };
      teachers[index] = updatedTeacher;
      memSet(KEYS.TEACHERS, JSON.stringify(teachers));
      cloud.pushItem(KEYS.TEACHERS, id, updatedTeacher);
    }
  },

  updateTeacherPresence: (id: string) => {
    const teachers = storage.getTeachers();
    const idx = teachers.findIndex(t => t.id === id);
    if (idx !== -1) {
      const now = Date.now();
      if (!teachers[idx].lastActive || now - teachers[idx].lastActive > 30000) {
        teachers[idx].lastActive = now;
        memSet(KEYS.TEACHERS, JSON.stringify(teachers));
        cloud.pushItem(KEYS.TEACHERS, id, teachers[idx], true);
      }
    }
  },

  // --- ADMINS ---
  getAdmins: (): AdminUser[] => {
    const data = memGet(KEYS.ADMINS);
    const admins = safeParseArray<AdminUser>(data, []);
    if (admins.length === 0) {
      const def: AdminUser = {
        id: 'admin1',
        username: 'admin',
        password: '',
        name: 'Super Admin',
        tier: 'SUPER_ADMIN'
      };
      return [def];
    }
    return admins;
  },

  saveAdmin: (admin: AdminUser) => {
    const admins = storage.getAdmins();
    const formatted = {
      ...admin,
      password: admin.password ? (/^\$2[aby]\$/.test(admin.password) ? admin.password : bcrypt.hashSync(admin.password, 10)) : ''
    };
    const idx = admins.findIndex(a => a.id === formatted.id);
    if (idx >= 0) admins[idx] = formatted;
    else admins.push(formatted);
    memSet(KEYS.ADMINS, JSON.stringify(admins));
    cloud.pushItem(KEYS.ADMINS, formatted.id, formatted);
  },

  changeAdminPassword: async (adminId: string, newPass: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const admins = storage.getAdmins();
      const idx = admins.findIndex(a => a.id === adminId);
      if (idx === -1) {
        return { success: false, error: 'Administrator account not found.' };
      }
      if (!newPass || newPass.trim().length < 8) {
        return { success: false, error: 'Security requirement: New password must be at least 8 characters long.' };
      }
      if (newPass.trim() === 'admin123' || newPass.trim() === 'admin') {
        return { success: false, error: 'Security violation: You cannot reuse the default password.' };
      }

      const token = memGet(KEYS.AUTH_TOKEN);
      const res = await fetch('/api/auth/change-admin-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ adminId, newPassword: newPass.trim() })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return { success: false, error: errData.error || 'Failed to update password on server.' };
      }

      admins[idx].mustChangePassword = false;
      memSet(KEYS.ADMINS, JSON.stringify(admins));

      storage.addAuditLog({
        actorName: admins[idx].name || 'Administrator',
        actorRole: 'ADMIN',
        action: 'ADMIN_PASSWORD_HARDENED',
        details: 'Default administrator credentials replaced with cryptographically secure password.'
      });

      cloud.notify();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update password.' };
    }
  },

  updateAdmin: (id: string, updates: Partial<AdminUser>) => {
    const admins = storage.getAdmins();
    const idx = admins.findIndex(a => a.id === id);
    if (idx !== -1) {
      const formattedUpdates = { ...updates };
      if (formattedUpdates.password && !/^\$2[aby]\$/.test(formattedUpdates.password)) {
        formattedUpdates.password = bcrypt.hashSync(formattedUpdates.password, 10);
      }
      admins[idx] = { ...admins[idx], ...formattedUpdates };
      memSet(KEYS.ADMINS, JSON.stringify(admins));
      cloud.pushItem(KEYS.ADMINS, id, admins[idx]);
    }
  },

  updateAdminPresence: (id: string) => {
    const admins = storage.getAdmins();
    const idx = admins.findIndex(a => a.id === id);
    if (idx !== -1) {
      const now = Date.now();
      if (!admins[idx].lastActive || now - admins[idx].lastActive > 30000) {
        admins[idx].lastActive = now;
        memSet(KEYS.ADMINS, JSON.stringify(admins));
        cloud.pushItem(KEYS.ADMINS, id, admins[idx], true);
      }
    }
  },

  deleteAdmin: (id: string) => {
    const admins = storage.getAdmins();
    const updated = admins.filter(a => a.id !== id);
    memSet(KEYS.ADMINS, JSON.stringify(updated));
    cloud.deleteItem(KEYS.ADMINS, id);
  },

  // --- TIMETABLE & DRAFT MANAGEMENT ---
  getTimetableMetadata: (): TimetableMetadata => {
    const raw = memGet(KEYS.TIMETABLE_METADATA);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.revisionId === 'number') {
          return parsed;
        }
      } catch {}
    }
    const hasPublished = !!memGet(KEYS.TIMETABLE);
    if (!hasPublished) {
      return {
        revisionId: 0,
        publishedAt: 0,
        publishedBy: '',
        status: 'DRAFT'
      };
    }
    return {
      revisionId: 1,
      publishedAt: Date.now(),
      publishedBy: 'System',
      status: 'PUBLISHED'
    };
  },

  getTimetable: (): TimetableGrid | null => {
    const data = memGet(KEYS.TIMETABLE);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          return parsed;
        }
      } catch {}
    }
    return null;
  },

  recoverCanonicalTimetable: async (): Promise<TimetableGrid | null> => {
    try {
      const res = await fetch('/api/public/timetable');
      if (res.ok) {
        const data = await res.json();
        if (data && data.timetable && Object.keys(data.timetable).length > 0) {
          memSet(KEYS.TIMETABLE, JSON.stringify(data.timetable));
          if (data.metadata) {
            memSet(KEYS.TIMETABLE_METADATA, JSON.stringify(data.metadata));
          }
          cloud.notify(true);
          return data.timetable;
        }
      }
    } catch {}
    return null;
  },

  getDraftTimetable: (): TimetableGrid | null => {
    const data = memGet(KEYS.TIMETABLE_DRAFT);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          return parsed;
        }
      } catch {}
    }
    return null;
  },

  hasUnpublishedDraft: (): boolean => {
    const draft = storage.getDraftTimetable();
    return !!draft && Object.keys(draft).length > 0;
  },

  saveDraftTimetable: (grid: TimetableGrid) => {
    const sanitizedGrid = storage.sanitizeTimetableGrid(grid);
    memSet(KEYS.TIMETABLE_DRAFT, JSON.stringify(sanitizedGrid));
    cloud.pushObject(KEYS.TIMETABLE_DRAFT, sanitizedGrid);
    cloud.notify(false);
  },

  discardDraftTimetable: () => {
    cloud.deleteKey(KEYS.TIMETABLE_DRAFT, true);
    cloud.notify(false);
  },

  publishTimetable: async (grid: TimetableGrid, user: string = 'System', baseRevisionId?: number, force: boolean = false): Promise<TimetableMetadata> => {
    const sanitizedGrid = storage.sanitizeTimetableGrid(grid);
    const token = storage.getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const currentMeta = storage.getTimetableMetadata();
    const revisionToSubmit = typeof baseRevisionId === 'number' ? baseRevisionId : (currentMeta?.revisionId ?? 0);

    const res = await fetch('/api/timetable/publish', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        timetable: sanitizedGrid,
        baseRevisionId: revisionToSubmit,
        publisher: user,
        force
      })
    });

    if (!res.ok) {
      let errMsg = 'Failed to publish timetable on server';
      let errData: any = null;
      try {
        errData = await res.json();
        if (errData && errData.error) errMsg = errData.error;
      } catch {}

      if (res.status === 409 || errMsg.includes('Conflict')) {
        const rev = (errData && typeof errData.currentRevisionId === 'number')
          ? errData.currentRevisionId
          : (typeof currentMeta?.revisionId === 'number' ? currentMeta.revisionId + 1 : 1);
        const syncedMeta: TimetableMetadata = {
          revisionId: rev,
          publishedAt: Date.now(),
          publishedBy: 'System',
          status: 'PUBLISHED'
        };
        memSet(KEYS.TIMETABLE_METADATA, JSON.stringify(syncedMeta));
      }

      const error: any = new Error(errMsg);
      error.status = res.status === 409 || errMsg.includes('Conflict') ? 409 : res.status;
      error.currentRevisionId = errData?.currentRevisionId;
      throw error;
    }

    const result = await res.json();
    const canonicalMeta: TimetableMetadata = result.metadata || {
      revisionId: result.revisionId,
      publishedAt: Date.now(),
      publishedBy: user,
      status: 'PUBLISHED'
    };
    const canonicalTimetable = result.timetable || sanitizedGrid;

    memSet(KEYS.TIMETABLE, JSON.stringify(canonicalTimetable));
    memSet(KEYS.TIMETABLE_METADATA, JSON.stringify(canonicalMeta));
    memRemove(KEYS.TIMETABLE_DRAFT);

    if (result.version) {
      cloud.serverSyncVersion = Math.max(cloud.serverSyncVersion, result.version);
    }

    try {
      const now = Date.now();
      cloud.lastFirestoreTimestamps[KEYS.TIMETABLE] = now;
      cloud.lastFirestoreTimestamps[KEYS.TIMETABLE_METADATA] = now;
      setDoc(doc(db, 'ota_app_store', KEYS.TIMETABLE), { payload: canonicalTimetable, updatedAt: now }).catch(() => {});
      setDoc(doc(db, 'ota_app_store', KEYS.TIMETABLE_METADATA), { payload: canonicalMeta, updatedAt: now }).catch(() => {});
      deleteDoc(doc(db, 'ota_app_store', KEYS.TIMETABLE_DRAFT)).catch(() => {});
    } catch {}

    cloud.notify(false);
    return canonicalMeta;
  },

  saveTimetable: (grid: TimetableGrid, user: string = 'System', baseRevisionId?: number, force: boolean = false) => {
    return storage.publishTimetable(grid, user, baseRevisionId, force);
  },

  saveLessonNote: async (classId: string, day: number, period: number, note: string, link: string) => {
    const currentGrid = storage.getTimetable();
    if (currentGrid && currentGrid[classId]?.[day]?.[period]) {
      currentGrid[classId][day][period].lessonNote = note;
      currentGrid[classId][day][period].lessonLink = link;
      memSet(KEYS.TIMETABLE, JSON.stringify(currentGrid));
      cloud.notify(false);
    }
    const token = storage.getAuthToken();
    if (token) {
      await fetch('/api/timetable/lesson-note', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ classId, day, period, note, link })
      }).catch(() => {});
    }
  },

  // --- SESSIONS & AUTH (Strictly In-Memory) ---
  setAuthToken: (token: string | null) => {
    if (token) memSet(KEYS.AUTH_TOKEN, token);
    else memRemove(KEYS.AUTH_TOKEN);
    cloud.reconnectSSE();
    cloud.fetchLatestFromApi(true).catch(() => {});
  },

  getAuthToken: (): string | null => {
    return memGet(KEYS.AUTH_TOKEN);
  },

  setAdminSession: (adminId: string | null) => {
    const current = memGet(KEYS.ADMIN_SESSION);
    if (current === adminId) return;
    if (adminId) memSet(KEYS.ADMIN_SESSION, adminId);
    else memRemove(KEYS.ADMIN_SESSION);
  },

  isAdminLoggedIn: (): boolean => {
    return !!memGet(KEYS.ADMIN_SESSION);
  },

  getLoggedInAdminId: (): string | null => {
    return memGet(KEYS.ADMIN_SESSION);
  },

  setTeacherSession: (teacherId: string | null) => {
    const current = memGet(KEYS.TEACHER_SESSION);
    if (current === teacherId) return;
    if (teacherId) memSet(KEYS.TEACHER_SESSION, teacherId);
    else memRemove(KEYS.TEACHER_SESSION);
  },

  getLoggedInTeacherId: (): string | null => {
    return memGet(KEYS.TEACHER_SESSION);
  },

  // --- HISTORY ---
  getHistory: (): HistoryEntry[] => {
    const data = memGet(KEYS.HISTORY);
    return safeParseArray<HistoryEntry>(data, []);
  },
  addHistory: (entry: HistoryEntry) => {
    const history = storage.getHistory();
    if (history.length > 50) {
      const oldest = history.shift();
      if (oldest) cloud.deleteItem(KEYS.HISTORY, oldest.id);
    }
    history.push(entry);
    memSet(KEYS.HISTORY, JSON.stringify(history));
    cloud.pushItem(KEYS.HISTORY, entry.id, entry);
  },
  restoreTimetable: (snapshot: TimetableGrid) => {
    const current = storage.getTimetable();
    if (current) {
      const newHistory: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        action: 'Restored Backup',
        user: 'Admin',
        snapshot: current
      };
      storage.addHistory(newHistory);
    }
    storage.publishTimetable(snapshot, 'Admin (Restore)', undefined, true).catch(() => {});

    storage.addNotification({
      recipientId: 'ALL',
      title: 'Timetable Rolled Back',
      message: 'The timetable has been restored to a previous version by Admin.',
      details: 'Any recent changes might have been reverted. Please review your schedule.',
      type: 'ALERT',
      category: 'TIMETABLE'
    });
  },

  // --- REQUESTS ---
  getRequests: (): SwapRequest[] => {
    const data = memGet(KEYS.REQUESTS);
    return safeParseArray<SwapRequest>(data, []);
  },
  addRequest: (req: SwapRequest) => {
    const reqs = storage.getRequests();
    reqs.push(req);
    memSet(KEYS.REQUESTS, JSON.stringify(reqs));
    cloud.pushItem(KEYS.REQUESTS, req.id, req);

    storage.addNotification({
      recipientId: 'ADMIN',
      title: 'New Request Received',
      message: `${req.teacherName} submitted a ${req.type} request.`,
      details: req.details,
      type: 'INFO',
      category: 'REQUEST'
    });
  },
  updateRequest: (req: SwapRequest) => {
    const reqs = storage.getRequests();
    const idx = reqs.findIndex(r => r.id === req.id);
    if (idx !== -1) {
      reqs[idx] = req;
      memSet(KEYS.REQUESTS, JSON.stringify(reqs));
      cloud.pushItem(KEYS.REQUESTS, req.id, req);

      if (req.status === 'APPROVED' && req.type === 'AUTOMATED_SWAP' && req.requestData) {
        const grid = storage.getTimetable();
        if (grid) {
          const data = req.requestData;
          const targetCell = grid[data.targetClassId]?.[data.targetDay]?.[data.targetPeriod];
          const offerCell = grid[data.offerClassId]?.[data.offerDay]?.[data.offerPeriod];

          if (targetCell && offerCell) {
            grid[data.targetClassId][data.targetDay][data.targetPeriod] = {
              ...offerCell,
              isManual: false
            };
            grid[data.offerClassId][data.offerDay][data.offerPeriod] = {
              ...targetCell,
              isManual: false
            };

            storage.publishTimetable(grid, 'Swap Approval System', undefined, true).catch(() => {});

            const newHistory: HistoryEntry = {
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              action: 'Swap Approved',
              user: 'System',
              snapshot: grid
            };
            storage.addHistory(newHistory);
          }
        }
      }

      storage.addNotification({
        recipientId: req.teacherId,
        title: `Request ${req.status}`,
        message: `Your ${req.type} request has been processed.`,
        details: `Status: ${req.status}. ${req.status === 'APPROVED' ? 'Changes have been applied.' : 'Please contact admin for details.'}`,
        type: req.status === 'APPROVED' ? 'SUCCESS' : 'ALERT',
        category: 'REQUEST'
      });
    }
  },

  // --- ROOMS ---
  getRooms: (): Room[] => {
    const data = memGet(KEYS.ROOMS);
    const rooms = safeParseArray<Room>(data, []);
    if (rooms.length === 0) {
      const defaults: Room[] = [
        { id: 'rm1', name: 'Science Laboratory 1', capacity: 35, type: 'LAB', description: 'Physics & Chemistry lab with experiment benches' },
        { id: 'rm2', name: 'Computer Science Lab', capacity: 30, type: 'LAB', description: '30 Workstations with ICT facilities' },
        { id: 'rm3', name: 'Main Assembly Hall', capacity: 300, type: 'HALL', description: 'Multipurpose hall for exams & events' },
        { id: 'rm4', name: 'Sports Field', capacity: 200, type: 'FIELD', description: 'Outdoor track and football pitch' },
        { id: 'rm5', name: 'SS3 Science Block', capacity: 40, type: 'CLASSROOM', description: 'Senior Secondary classroom' }
      ];
      memSet(KEYS.ROOMS, JSON.stringify(defaults));
      return defaults;
    }
    return rooms;
  },
  saveRoom: (room: Room) => {
    const rooms = storage.getRooms();
    const idx = rooms.findIndex(r => r.id === room.id);
    if (idx >= 0) rooms[idx] = room;
    else rooms.push(room);
    memSet(KEYS.ROOMS, JSON.stringify(rooms));
    cloud.pushItem(KEYS.ROOMS, room.id, room);
  },
  deleteRoom: (id: string) => {
    const rooms = storage.getRooms();
    const updated = rooms.filter(r => r.id !== id);
    memSet(KEYS.ROOMS, JSON.stringify(updated));
    cloud.deleteItem(KEYS.ROOMS, id);
  },

  // --- EXAM SESSIONS ---
  getExamSessions: (): ExamSession[] => {
    const data = memGet(KEYS.EXAMS);
    return safeParseArray<ExamSession>(data, []);
  },
  saveExamSession: (exam: ExamSession) => {
    const exams = storage.getExamSessions();
    const idx = exams.findIndex(e => e.id === exam.id);
    if (idx >= 0) exams[idx] = exam;
    else exams.push(exam);
    memSet(KEYS.EXAMS, JSON.stringify(exams));
    cloud.pushItem(KEYS.EXAMS, exam.id, exam);
  },
  deleteExamSession: (id: string) => {
    const exams = storage.getExamSessions();
    const updated = exams.filter(e => e.id !== id);
    memSet(KEYS.EXAMS, JSON.stringify(updated));
    cloud.deleteItem(KEYS.EXAMS, id);
  },

  // --- EMAIL DISPATCH ---
  sendEmailNotification: async (recipientEmail: string, title: string, message: string) => {
    try {
      await fetch('/api/notifications/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail, title, message })
      });
    } catch (e) {
      console.warn('[Mailer] Could not send email notification:', e);
    }
  },

  // --- NOTIFICATIONS ---
  getNotifications: (recipientId: string): AppNotification[] => {
    const data = memGet(KEYS.NOTIFICATIONS);
    const all: AppNotification[] = safeParseArray<AppNotification>(data, []);
    return all.filter(n => n && (n.recipientId === recipientId || n.recipientId === 'ALL')).sort((a, b) => b.timestamp - a.timestamp);
  },
  addNotification: (note: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => {
    const data = memGet(KEYS.NOTIFICATIONS);
    const all: AppNotification[] = safeParseArray<AppNotification>(data, []);

    const newNote: AppNotification = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      isRead: false,
      ...note
    };

    all.push(newNote);
    if (all.length > 300) {
      const oldest = all.shift();
      if (oldest) cloud.deleteItem(KEYS.NOTIFICATIONS, oldest.id);
    }
    memSet(KEYS.NOTIFICATIONS, JSON.stringify(all));
    cloud.pushItem(KEYS.NOTIFICATIONS, newNote.id, newNote);

    if (note.category === 'REQUEST' || note.category === 'TIMETABLE') {
      const teachers = storage.getTeachers();
      const teacher = teachers.find(t => t.id === note.recipientId);
      if (teacher && teacher.contactEmail && teacher.preferences?.emailNotifications !== false) {
        storage.sendEmailNotification(teacher.contactEmail, note.title, note.message);
      }
    }
  },
  markRead: (id: string) => {
    const data = memGet(KEYS.NOTIFICATIONS);
    const all: AppNotification[] = safeParseArray<AppNotification>(data, []);
    const idx = all.findIndex(n => n.id === id);
    if (idx !== -1) {
      all[idx].isRead = true;
      memSet(KEYS.NOTIFICATIONS, JSON.stringify(all));
      cloud.pushItem(KEYS.NOTIFICATIONS, id, all[idx]);
    }
  },
  markAllRead: (recipientId: string) => {
    const data = memGet(KEYS.NOTIFICATIONS);
    let all: AppNotification[] = safeParseArray<AppNotification>(data, []);
    const updates: Record<string, any> = {};
    all = all.map(n => {
      if ((n.recipientId === recipientId || n.recipientId === 'ALL') && !n.isRead) {
        const updated = { ...n, isRead: true };
        updates[`${KEYS.NOTIFICATIONS}.${n.id}`] = updated;
        return updated;
      }
      return n;
    });
    memSet(KEYS.NOTIFICATIONS, JSON.stringify(all));
    cloud.pushUpdates(updates);
  },
  deleteNotification: (id: string) => {
    const data = memGet(KEYS.NOTIFICATIONS);
    if (data) {
      const all: AppNotification[] = safeParseArray<AppNotification>(data, []);
      const updated = all.filter(n => n.id !== id);
      memSet(KEYS.NOTIFICATIONS, JSON.stringify(updated));
      cloud.deleteItem(KEYS.NOTIFICATIONS, id);
    }
  },
  clearNotifications: (recipientId: string) => {
    const data = memGet(KEYS.NOTIFICATIONS);
    let all: AppNotification[] = safeParseArray<AppNotification>(data, []);
    const remaining = all.filter(n => n.recipientId !== recipientId);
    memSet(KEYS.NOTIFICATIONS, JSON.stringify(remaining));
    cloud.pushObject(KEYS.NOTIFICATIONS, remaining);
  },

  // --- CHAT ---
  getChatMessages: (): ChatMessage[] => {
    const data = memGet(KEYS.CHAT);
    return safeParseArray<ChatMessage>(data, []);
  },
  addChatMessage: (msg: ChatMessage) => {
    const msgs = storage.getChatMessages();
    msgs.push(msg);
    if (msgs.length > 500) {
      const oldest = msgs.shift();
      if (oldest) cloud.deleteItem(KEYS.CHAT, oldest.id);
    }
    memSet(KEYS.CHAT, JSON.stringify(msgs));
    cloud.pushItem(KEYS.CHAT, msg.id, msg);

    if (msg.isFlagged) {
      storage.addNotification({
        recipientId: 'ADMIN',
        title: 'Content Moderation Alert',
        message: `Flagged message from ${msg.senderName}`,
        details: `Content: "${msg.content}"\nSent at: ${new Date(msg.timestamp).toLocaleString()}`,
        type: 'ALERT',
        category: 'CHAT'
      });
    }
  },
  flagMessage: (id: string, reason: string) => {
    const msgs = storage.getChatMessages();
    const idx = msgs.findIndex(m => m.id === id);
    if (idx !== -1) {
      msgs[idx].isFlagged = true;
      msgs[idx].handled = false;
      memSet(KEYS.CHAT, JSON.stringify(msgs));
      cloud.pushItem(KEYS.CHAT, id, msgs[idx]);

      storage.addNotification({
        recipientId: 'ADMIN',
        title: 'Message Flagged',
        message: `Inappropriate content detected from ${msgs[idx].senderName}`,
        details: `Reason: ${reason}\nContent: "${msgs[idx].content}"`,
        type: 'ALERT',
        category: 'CHAT'
      });
    }
  },
  resolveFlaggedMessage: (id: string) => {
    const msgs = storage.getChatMessages();
    const idx = msgs.findIndex(m => m.id === id);
    if (idx !== -1) {
      msgs[idx].handled = true;
      memSet(KEYS.CHAT, JSON.stringify(msgs));
      cloud.pushItem(KEYS.CHAT, id, msgs[idx]);
    }
  },

  // --- THEME & SETTINGS ---
  getTheme: (): string => {
    const data = memGet(KEYS.THEME);
    try { return data ? JSON.parse(data) : 'DEFAULT'; } catch { return data || 'DEFAULT'; }
  },
  setTheme: (theme: string) => {
    memSet(KEYS.THEME, JSON.stringify(theme));
    cloud.pushObject(KEYS.THEME, theme);
  },
  getSettings: (): AppSettings => {
    const data = memGet(KEYS.SETTINGS);
    const defaults: AppSettings = {
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
    if (!data) return defaults;
    try {
      return { ...defaults, ...JSON.parse(data) };
    } catch {
      return defaults;
    }
  },
  saveSettings: (settings: AppSettings) => {
    memSet(KEYS.SETTINGS, JSON.stringify(settings));
    cloud.pushObject(KEYS.SETTINGS, settings);
  },

  // --- TEACHER ABSENCES ---
  getAbsences: (): TeacherAbsence[] => {
    const data = memGet(KEYS.ABSENCES);
    return safeParseArray<TeacherAbsence>(data, []);
  },
  saveAbsence: (absence: TeacherAbsence) => {
    const list = storage.getAbsences();
    const idx = list.findIndex(a => a.id === absence.id);
    if (idx >= 0) list[idx] = absence;
    else list.unshift(absence);
    memSet(KEYS.ABSENCES, JSON.stringify(list));
    cloud.pushItem(KEYS.ABSENCES, absence.id, absence);
  },
  deleteAbsence: (id: string) => {
    const list = storage.getAbsences();
    const updated = list.filter(a => a.id !== id);
    memSet(KEYS.ABSENCES, JSON.stringify(updated));
    cloud.deleteItem(KEYS.ABSENCES, id);
  },

  // --- AUDIT LOGS ---
  getAuditLogs: (): AuditLogEntry[] => {
    const data = memGet(KEYS.AUDIT_LOGS);
    return safeParseArray<AuditLogEntry>(data, []);
  },
  addAuditLog: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => {
    const logs = storage.getAuditLogs();
    const newLog: AuditLogEntry = {
      ...entry,
      id: 'audit_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      timestamp: Date.now()
    };
    logs.unshift(newLog);
    if (logs.length > 500) logs.pop();
    memSet(KEYS.AUDIT_LOGS, JSON.stringify(logs));
    cloud.pushItem(KEYS.AUDIT_LOGS, newLog.id, newLog);
  },

  // --- SCHOOLS & MULTI-SCHOOL PORTAL ---
  getSchools: (): School[] => {
    const data = memGet(KEYS.SCHOOLS);
    let schools = safeParseArray<School>(data, []);
    schools = schools.filter(s => s && (s.id === 'ota_total_academy' || (typeof s.id === 'string' && s.id.startsWith('sch_'))));

    if (!schools || schools.length === 0) {
      schools = [DEFAULT_SCHOOLS[0]];
      memSet(KEYS.SCHOOLS, JSON.stringify(schools));
    } else {
      const hasOta = schools.some(s => s.id === 'ota_total_academy');
      if (!hasOta) {
        schools.unshift(DEFAULT_SCHOOLS[0]);
      }
      memSet(KEYS.SCHOOLS, JSON.stringify(schools));
    }
    return schools;
  },

  saveSchool: (school: School) => {
    const schools = storage.getSchools();
    const idx = schools.findIndex(s => s.id === school.id);
    if (idx >= 0) schools[idx] = school;
    else schools.push(school);
    memSet(KEYS.SCHOOLS, JSON.stringify(schools));
    if (school.id !== 'ota_total_academy') {
      cloud.pushItem(KEYS.SCHOOLS, school.id, school);
    }
    cloud.notify();
  },

  registerSchoolSecurely: async (payload: {
    name: string;
    code: string;
    motto?: string;
    address?: string;
    themeColor?: string;
    adminEmail?: string;
    adminPhone?: string;
    accreditationNumber?: string;
    adminPasskey?: string;
    adminUsername?: string;
    adminPassword?: string;
  }): Promise<{ success: boolean; school?: School; error?: string }> => {
    try {
      const token = memGet(KEYS.AUTH_TOKEN);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/schools', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data?.school) {
        return {
          success: false,
          error: data?.error || `Failed to register school (status ${res.status}).`
        };
      }

      const newSchool: School = data.school;
      const schools = storage.getSchools();
      const idx = schools.findIndex(s => s.id === newSchool.id);
      if (idx >= 0) schools[idx] = newSchool;
      else schools.push(newSchool);
      memSet(KEYS.SCHOOLS, JSON.stringify(schools));

      cloud.fetchLatestFromApi(true).catch(() => {});
      cloud.notify();
      return { success: true, school: newSchool };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Unable to reach registration server.' };
    }
  },

  deleteSchoolSecurely: async (schoolId: string, adminPasskey?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = memGet(KEYS.AUTH_TOKEN);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/schools/${schoolId}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ adminPasskey })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: data?.error || 'Authorization rejected.' };
      }

      const schools = storage.getSchools().filter(s => s.id !== schoolId);
      memSet(KEYS.SCHOOLS, JSON.stringify(schools));
      cloud.deleteItem(KEYS.SCHOOLS, schoolId);
      deleteDoc(doc(db, 'schools', schoolId)).catch(() => {});

      cloud.notify();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error deleting school' };
    }
  },

  getCurrentSchool: (): School => {
    const currentStr = memGet(KEYS.CURRENT_SCHOOL);
    if (currentStr) {
      try {
        const parsed = JSON.parse(currentStr);
        if (parsed && parsed.name) return parsed;
      } catch {}
    }
    const schools = storage.getSchools();
    const ota = schools.find(s => s && s.id === 'ota_total_academy') || schools[0] || DEFAULT_SCHOOLS[0];
    return ota;
  },

  setCurrentSchool: (school: School | null) => {
    if (school) {
      memSet(KEYS.CURRENT_SCHOOL, JSON.stringify(school));
    } else {
      memRemove(KEYS.CURRENT_SCHOOL);
    }
    cloud.notify(false);
  },

  // --- TEACHER APPROVALS & ANTI-IMPOSTER GATE ---
  getPendingTeachers: (schoolId?: string): Teacher[] => {
    const teachers = storage.getTeachers();
    return teachers.filter(t => {
      const isPending = t.isApproved === false || t.approvalStatus === 'PENDING';
      if (!isPending) return false;
      if (schoolId) return t.schoolId === schoolId;
      return true;
    });
  },

  approveTeacher: (teacherId: string, adminName: string = 'Administrator') => {
    const teachers = storage.getTeachers();
    const idx = teachers.findIndex(t => t.id === teacherId);
    if (idx !== -1) {
      teachers[idx] = {
        ...teachers[idx],
        isApproved: true,
        approvalStatus: 'APPROVED',
        rejectionReason: undefined
      };
      memSet(KEYS.TEACHERS, JSON.stringify(teachers));
      cloud.pushItem(KEYS.TEACHERS, teacherId, teachers[idx]);

      storage.addNotification({
        recipientId: teacherId,
        title: 'Faculty Verification Approved ✅',
        message: `Welcome to the faculty! Your identity has been verified by ${adminName}. You now have full access to your school timetable and dashboard.`,
        details: 'All security checks passed. Anti-imposter verification complete.',
        type: 'SUCCESS',
        category: 'SYSTEM'
      });

      storage.addAuditLog({
        actorName: adminName,
        actorRole: 'ADMIN',
        action: 'TEACHER_VERIFIED',
        details: `Approved genuine faculty account for ${teachers[idx].name} (@${teachers[idx].username}). Imposter check passed.`
      });

      cloud.notify();
    }
  },

  rejectTeacher: (teacherId: string, reason: string = 'Unverified identity / Imposter suspected', adminName: string = 'Administrator', deleteAccount: boolean = false) => {
    const teachers = storage.getTeachers();
    const teacher = teachers.find(t => t.id === teacherId);
    if (!teacher) return;

    if (deleteAccount) {
      storage.deleteTeacher(teacherId);
    } else {
      const idx = teachers.findIndex(t => t.id === teacherId);
      if (idx !== -1) {
        teachers[idx] = {
          ...teachers[idx],
          isApproved: false,
          approvalStatus: 'REJECTED',
          rejectionReason: reason
        };
        memSet(KEYS.TEACHERS, JSON.stringify(teachers));
        cloud.pushItem(KEYS.TEACHERS, teacherId, teachers[idx]);
      }
    }

    storage.addAuditLog({
      actorName: adminName,
      actorRole: 'ADMIN',
      action: 'TEACHER_REJECTED',
      details: `Flagged and denied unverified account ${teacher.name} (@${teacher.username}). Reason: ${reason}`
    });

    cloud.notify();
  },

  resetSystem: async () => {
    const keepKeys = new Set([KEYS.AUTH_TOKEN, KEYS.ADMIN_SESSION, KEYS.TEACHER_SESSION]);
    for (const k of Object.values(KEYS)) {
      if (!keepKeys.has(k)) {
        memRemove(k);
      }
    }

    try {
      const token = storage.getAuthToken();
      await fetch('/api/sync/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-developer-password': 'proxonline26',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ password: 'proxonline26' })
      });
    } catch {}

    try {
      await cloud.resetServer();
    } catch {}

    await cloud.fetchLatestFromApi(true);
    cloud.notify();
  },

  cloudSync: cloud,
  getRecentErrors: () => cloud.getRecentErrors(),
  fetchLatestFromApi: (forceFull?: boolean) => cloud.fetchLatestFromApi(forceFull)
};
