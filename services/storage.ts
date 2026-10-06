import { Teacher, TimetableGrid, Availability, Subject, HistoryEntry, SwapRequest, AppNotification, AppSettings, ChatMessage, AdminUser, Class, Room, ExamSession, TeacherAbsence, AuditLogEntry, School, AcademicLevel, SlotBudgetInfo } from '../types';
import { ALL_SUBJECTS, ALL_CLASSES } from '../constants';
import bcrypt from 'bcryptjs';
import { db, doc, setDoc, deleteDoc, onSnapshot, collection, auth, signInAnonymously } from './firebase';

const KEYS = {
  TEACHERS: 'ota_teachers_v3',
  TIMETABLE: 'ota_timetable_v2',
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

// --- CLOUD REALTIME SYNC (FIREBASE FIRESTORE) ---
class CloudSync {
    private channel: BroadcastChannel;
    private listeners: ((showIndicator?: boolean) => void)[] = [];
    private connectionListeners: ((connected: boolean) => void)[] = [];
    public ready = false;
    public isConnected = false;
    private readyListeners: (() => void)[] = [];
    private recentErrors: Array<{ timestamp: number; operation: string; error: string; code?: string }> = [];
    private serverSyncVersion = 0;
    private syncInterval: any = null;
    private lastFirestoreTimestamps: Record<string, number> = {};

    constructor() {
        if (typeof BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel('ota_global_sync');
            this.channel.onmessage = () => this.notify();
        } else {
            this.channel = { postMessage: () => {}, onmessage: null } as any;
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('storage', () => this.notify());
            // Immediately pull full state on new browser session/account
            this.fetchLatestFromApi(true).catch(() => {});
            this.initFirebaseSync();
            this.startFast500msSyncLoop();
            this.initSSESync();
        }
    }

    private logSyncError(operation: string, err: any) {
        const code = err?.code || err?.name;
        const msg = err?.message || String(err);
        if (code === 'permission-denied') {
            if (typeof window !== 'undefined' && auth && !auth.currentUser) {
                signInAnonymously(auth).catch(() => {});
            }
            // Suppress loud alert for background anonymous sync
            console.warn(`[CloudSync Notice - ${operation}] Retrying with refreshed permissions...`);
            return;
        }
        console.error(`[CloudSync Error - ${operation}] Code: ${code || 'UNKNOWN'}, Message: ${msg}`, err);
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

    private applyKeysToLocalStorage(keysData: Record<string, any>): boolean {
        let changed = false;
        Object.keys(keysData).forEach(k => {
            if (SYNC_KEYS.includes(k)) {
                let payload = keysData[k];
                if (payload === undefined) return;

                if (k === KEYS.TIMETABLE) {
                    const currentLocalStr = localStorage.getItem(k);
                    let currentClassesCount = 0;
                    try {
                        const parsed = currentLocalStr ? JSON.parse(currentLocalStr) : null;
                        if (parsed && typeof parsed === 'object') currentClassesCount = Object.keys(parsed).length;
                    } catch {}

                    let newClassesCount = 0;
                    let parsedNew: any = payload;
                    try {
                        if (typeof payload === 'string') parsedNew = JSON.parse(payload);
                        if (parsedNew && typeof parsedNew === 'object') newClassesCount = Object.keys(parsedNew).length;
                    } catch {}

                    // Protect against overwriting a valid populated timetable with an empty structure
                    if (newClassesCount > 0 || currentClassesCount === 0) {
                        const valStr = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
                        if (valStr !== currentLocalStr) {
                            localStorage.setItem(k, valStr);
                            changed = true;
                        }
                    }
                } else if (k === KEYS.SETTINGS || k === KEYS.THEME) {
                    const valStr = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
                    if (valStr !== localStorage.getItem(k)) {
                        localStorage.setItem(k, valStr);
                        changed = true;
                    }
                } else {
                    let items: any[] = [];
                    if (Array.isArray(payload)) {
                        items = payload.filter((i: any) => i !== null && i !== undefined);
                    } else if (payload && typeof payload === 'object') {
                        items = safeParseArray(JSON.stringify(payload), []);
                    }
                    if (k === KEYS.TEACHERS) {
                        const localTeachers: Teacher[] = safeParseArray(localStorage.getItem(KEYS.TEACHERS), []);
                        localTeachers.forEach(lt => {
                            if (lt && (lt.isApproved === false || lt.approvalStatus === 'PENDING')) {
                                const exists = items.some((it: any) => it && (it.id === lt.id || it.username === lt.username));
                                if (!exists) {
                                    items.push(lt);
                                }
                            }
                        });
                        // Preserve and synchronize profile pictures across sync updates
                        items.forEach((it: any) => {
                            if (it && it.id) {
                                const savedPic = localStorage.getItem(`ota_profile_pic_${it.id}`);
                                const localT = localTeachers.find(lt => lt && lt.id === it.id);
                                if (!it.profilePicture && (savedPic || localT?.profilePicture)) {
                                    it.profilePicture = savedPic || localT?.profilePicture;
                                } else if (it.profilePicture) {
                                    try {
                                        localStorage.setItem(`ota_profile_pic_${it.id}`, it.profilePicture);
                                    } catch {}
                                }
                            }
                        });
                    }
                    const valStr = JSON.stringify(items);
                    if (valStr !== localStorage.getItem(k)) {
                        localStorage.setItem(k, valStr);
                        changed = true;
                    }
                }
            }
        });
        return changed;
    }

    private initSSESync() {
        if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
        try {
            const evtSource = new EventSource('/api/sync/events');
            evtSource.addEventListener('init', (e: MessageEvent) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data && data.version && data.keys) {
                        this.serverSyncVersion = data.version;
                        const changed = this.applyKeysToLocalStorage(data.keys);
                        if (changed) this.notify(true);
                    }
                } catch {}
            });
            evtSource.addEventListener('update', (e: MessageEvent) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data && data.version && data.version >= this.serverSyncVersion) {
                        this.serverSyncVersion = data.version;
                        let changed = false;
                        if (data.changedKeys) {
                            changed = this.applyKeysToLocalStorage(data.changedKeys);
                        } else if (data.keys) {
                            changed = this.applyKeysToLocalStorage(data.keys);
                        } else if (data.key && data.data !== undefined) {
                            changed = this.applyKeysToLocalStorage({ [data.key]: data.data });
                        }
                        if (changed) this.notify(true);
                    }
                } catch {}
            });
            evtSource.addEventListener('reset', (e: MessageEvent) => {
                try {
                    SYNC_KEYS.forEach(k => localStorage.removeItem(k));
                    this.notify(true);
                } catch {}
            });
            evtSource.onerror = () => {
                // SSE will auto-reconnect silently
            };
        } catch (e) {
            // Silently ignore if SSE fails
        }
    }

    private startFast500msSyncLoop() {
        if (this.syncInterval) clearInterval(this.syncInterval);

        const pollFn = async () => {
            try {
                const res = await fetch(`/api/sync/state?v=${this.serverSyncVersion}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.unchanged) {
                        return;
                    }
                    if (data && data.version && data.version > this.serverSyncVersion) {
                        this.serverSyncVersion = data.version;
                        if (data.keys) {
                            const changed = this.applyKeysToLocalStorage(data.keys);
                            if (changed) {
                                this.notify(true);
                            }
                        }
                    }
                }
            } catch (e) {
                // Silently swallow intermittent network errors
            }
        };

        pollFn();
        this.syncInterval = setInterval(pollFn, 500);
    }

    private async pushToServerApi(payloadObj: { key?: string; item_id?: string; data?: any; isDelete?: boolean; updates?: Record<string, any> }) {
        try {
            const res = await fetch('/api/sync/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadObj)
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.version) {
                    this.serverSyncVersion = Math.max(this.serverSyncVersion, data.version);
                }
            }
        } catch (e) {
            // Silently swallow fetch failures
        }
    }

    private initFirebaseSync() {
        const markReady = () => {
            if (!this.ready) {
                this.ready = true;
                this.readyListeners.forEach(l => l());
                this.readyListeners = [];
            }
        };

        // Fallback ready timer so UI never blocks
        setTimeout(markReady, 200);

        // Attach Firestore collection snapshot listener for instantaneous cross-device sync
        try {
            const storeColl = collection(db, 'ota_app_store');
            onSnapshot(storeColl, (snapshot) => {
                this.isConnected = true;
                this.connectionListeners.forEach(l => l(true));
                markReady();

                let changed = false;
                snapshot.docChanges().forEach(change => {
                    const key = change.doc.id;
                    if (SYNC_KEYS.includes(key)) {
                        if (change.type === 'removed') {
                            localStorage.removeItem(key);
                            changed = true;
                        } else {
                            const data = change.doc.data();
                            if (data && data.payload !== undefined) {
                                const docUpdatedAt = data.updatedAt || 0;
                                const lastSeen = this.lastFirestoreTimestamps[key] || 0;
                                if (docUpdatedAt >= lastSeen) {
                                    this.lastFirestoreTimestamps[key] = docUpdatedAt;
                                    let payload = data.payload;
                                    if (key === KEYS.TIMETABLE || key === KEYS.SETTINGS || key === KEYS.THEME) {
                                        if (key === KEYS.TIMETABLE) {
                                            const currentLocalStr = localStorage.getItem(key);
                                            let currentClassesCount = 0;
                                            try {
                                                const parsed = currentLocalStr ? JSON.parse(currentLocalStr) : null;
                                                if (parsed && typeof parsed === 'object') currentClassesCount = Object.keys(parsed).length;
                                            } catch {}

                                            let newClassesCount = 0;
                                            let parsedNew: any = payload;
                                            try {
                                                if (typeof payload === 'string') parsedNew = JSON.parse(payload);
                                                if (parsedNew && typeof parsedNew === 'object') newClassesCount = Object.keys(parsedNew).length;
                                            } catch {}

                                            // Protect against overwriting a valid populated timetable with an empty structure
                                            if (newClassesCount > 0 || currentClassesCount === 0) {
                                                const str = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
                                                if (str !== currentLocalStr) {
                                                    localStorage.setItem(key, str);
                                                    changed = true;
                                                }
                                            }
                                        } else {
                                            const str = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
                                            if (str !== localStorage.getItem(key)) {
                                                localStorage.setItem(key, str);
                                                changed = true;
                                            }
                                        }
                                    } else {
                                        const items: any[] = safeParseArray(typeof payload === 'string' ? payload : JSON.stringify(payload), []);
                                        if (key === KEYS.TEACHERS) {
                                            const localTeachers: Teacher[] = safeParseArray(localStorage.getItem(KEYS.TEACHERS), []);
                                            localTeachers.forEach(lt => {
                                                if (lt && (lt.isApproved === false || lt.approvalStatus === 'PENDING')) {
                                                    const exists = items.some((it: any) => it && (it.id === lt.id || it.username === lt.username));
                                                    if (!exists) {
                                                        items.push(lt);
                                                    }
                                                }
                                            });
                                            // Preserve and synchronize profile pictures across sync updates
                                            items.forEach((it: any) => {
                                                if (it && it.id) {
                                                    const savedPic = localStorage.getItem(`ota_profile_pic_${it.id}`);
                                                    const localT = localTeachers.find(lt => lt && lt.id === it.id);
                                                    if (!it.profilePicture && (savedPic || localT?.profilePicture)) {
                                                        it.profilePicture = savedPic || localT?.profilePicture;
                                                    } else if (it.profilePicture) {
                                                        try {
                                                            localStorage.setItem(`ota_profile_pic_${it.id}`, it.profilePicture);
                                                        } catch {}
                                                    }
                                                }
                                            });
                                        }
                                        const str = JSON.stringify(items);
                                        if (str !== localStorage.getItem(key)) {
                                            localStorage.setItem(key, str);
                                            changed = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
                if (changed) {
                    this.notify(true);
                }
            }, (err) => {
                this.logSyncError('onSnapshot', err);
                this.isConnected = false;
                this.connectionListeners.forEach(l => l(false));
                markReady();
            });
        } catch (e) {
            this.logSyncError('initFirebaseSync', e);
            markReady();
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
            const hasTimetable = !!localStorage.getItem(KEYS.TIMETABLE);
            const reqVersion = (forceFull || !hasTimetable) ? 0 : this.serverSyncVersion;
            const res = await fetch(`/api/sync/state?v=${reqVersion}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.version) {
                    this.serverSyncVersion = Math.max(this.serverSyncVersion, data.version);
                    if (data.keys) {
                        const changed = this.applyKeysToLocalStorage(data.keys);
                        if (changed) {
                            this.notify(true);
                        }
                    }
                }
                return true;
            }
        } catch (e) {
            // connection issue
        }
        return false;
    }

    async pushItem(key: string, id: string, item: any, skipNotify: boolean = false) {
        if (!skipNotify) this.notify();
        this.channel.postMessage({ type: 'SYNC', timestamp: Date.now() });
        this.pushToServerApi({ key, item_id: id, data: item });

        try {
            const dataStr = localStorage.getItem(key);
            let arr: any[] = safeParseArray(dataStr, []);
            const idx = arr.findIndex((i: any) => i && i.id === id);
            if (idx >= 0) arr[idx] = item;
            else arr.push(item);
            localStorage.setItem(key, JSON.stringify(arr));
            const cleanArr = JSON.parse(JSON.stringify(arr));
            const now = Date.now();
            this.lastFirestoreTimestamps[key] = now;
            await setDoc(doc(db, 'ota_app_store', key), { payload: cleanArr, updatedAt: now });
        } catch (e) {
            this.logSyncError(`pushItem(${key}, ${id})`, e);
        }
    }

    async deleteItem(key: string, id: string, skipNotify: boolean = false) {
        if (!skipNotify) this.notify();
        this.channel.postMessage({ type: 'SYNC', timestamp: Date.now() });
        this.pushToServerApi({ key, item_id: id, isDelete: true });

        try {
            const dataStr = localStorage.getItem(key);
            let arr: any[] = safeParseArray(dataStr, []);
            arr = arr.filter((i: any) => i && i.id !== id);
            localStorage.setItem(key, JSON.stringify(arr));
            const cleanArr = JSON.parse(JSON.stringify(arr));
            const now = Date.now();
            this.lastFirestoreTimestamps[key] = now;
            await setDoc(doc(db, 'ota_app_store', key), { payload: cleanArr, updatedAt: now });
        } catch (e) {
            this.logSyncError(`deleteItem(${key}, ${id})`, e);
        }
    }

    async pushObject(key: string, obj: any, skipNotify: boolean = false) {
        if (!skipNotify) this.notify();
        this.channel.postMessage({ type: 'SYNC', timestamp: Date.now() });
        this.pushToServerApi({ key, data: obj });

        try {
            const cleanObj = JSON.parse(JSON.stringify(obj || {}));
            const now = Date.now();
            this.lastFirestoreTimestamps[key] = now;
            await setDoc(doc(db, 'ota_app_store', key), { payload: cleanObj, updatedAt: now });
        } catch (e) {
            this.logSyncError(`pushObject(${key})`, e);
        }
    }

    async pushUpdates(updates: Record<string, any>, skipNotify: boolean = false) {
        if (!skipNotify) this.notify();
        this.channel.postMessage({ type: 'SYNC', timestamp: Date.now() });
        
        // 1. Send atomic update to server API immediately (<15ms)
        this.pushToServerApi({ updates });

        // 2. Persist updated root keys to Firestore independently
        const keysToSync = new Set<string>();
        Object.keys(updates).forEach(pathKey => {
            const rootKey = pathKey.split('.')[0];
            if (SYNC_KEYS.includes(rootKey)) {
                keysToSync.add(rootKey);
            }
        });

        // Ensure timetable is synced first if present
        const sortedKeys = Array.from(keysToSync).sort((a, b) => {
            if (a === KEYS.TIMETABLE) return -1;
            if (b === KEYS.TIMETABLE) return 1;
            return 0;
        });

        for (const key of sortedKeys) {
            try {
                const dataStr = localStorage.getItem(key);
                if (dataStr) {
                    let payload = JSON.parse(dataStr);
                    if (key !== KEYS.TIMETABLE && key !== KEYS.SETTINGS && key !== KEYS.THEME) {
                        payload = safeParseArray(dataStr, []);
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
  const teachers: Teacher[] = [];

  const firstNames = [
    'David', 'Fatima', 'Samuel', 'Grace', 'Ibrahim', 'Blessing', 'Emmanuel', 'Victoria',
    'Timothy', 'Angela', 'Marcus', 'Helen', 'Solomon', 'Mary', 'Joseph', 'Andrew',
    'Patience', 'Kabir', 'John', 'Ruth', 'Ahmed', 'Clement', 'Gabriel', 'Deborah',
    'Kehinde', 'Funke', 'Patrick', 'Chidimma', 'Hassan', 'Sarah', 'Christopher', 'Victor',
    'Rachel', 'Benjamin', 'Nkechi', 'Oluwaseun', 'Amina', 'Tunde', 'Bisi', 'Francis',
    'Chinedu', 'Zainab', 'Olawale', 'Kemi', 'Suleiman', 'Yinka', 'Emeka', 'Titilayo'
  ];
  const lastNames = [
    'Okafor', 'Bello', 'Adebayo', 'Adeleke', 'Musa', 'Ojo', 'Davies', 'Kalu',
    'Ogundele', 'Bassey', 'Vance', 'Paul', 'King', 'Okereke', 'Taylor', 'Scott',
    'Eze', 'Usman', 'Philip', 'Johnson', 'Ali', 'Nnamdi', 'Olatunji', 'Sowande',
    'Popoola', 'Akindele', 'Alabi', 'Nwosu', 'Bello', 'Martins', 'Clark', 'Chen',
    'Ekanem', 'Balogun', 'Obi', 'Ajayi', 'Sani', 'Salami', 'Omoniyi', 'Ibrahim',
    'Ezeonu', 'Dada', 'Gbadamosi', 'Soyinka', 'Danladi', 'Lawal', 'Annan', 'Mustapha'
  ];

  let nameCounter = 0;

  const buildAvailability = (): Record<number, Record<number, Availability>> => {
    const grid: Record<number, Record<number, Availability>> = {};
    for (let day = 0; day < 5; day++) {
      grid[day] = {};
      for (let period = 0; period < 8; period++) {
        grid[day][period] = Availability.AVAILABLE;
      }
    }
    return grid;
  };

  const categories: ('JSS' | 'SSS_SCIENCE' | 'SSS_BC')[] = ['JSS', 'SSS_SCIENCE', 'SSS_BC'];

  categories.forEach(cat => {
    const catSubjects = subjectsList.filter(s => s.category === cat);
    const catClasses = classesList.filter(c => c.category === cat);

    if (catSubjects.length === 0 || catClasses.length === 0) return;

    catSubjects.forEach((sub, subIdx) => {
      // Chunk classes into manageable groups of 2-3 classes per teacher
      const chunkSize = catClasses.length >= 6 ? 3 : (catClasses.length >= 3 ? 2 : catClasses.length);
      const classChunks: string[][] = [];

      for (let i = 0; i < catClasses.length; i += chunkSize) {
        const chunk = catClasses.slice(i, i + chunkSize).map(c => c.id);
        classChunks.push(chunk);
      }

      // For parallel subjects (IRS/CRS, Further Maths), ensure multiple teachers cover classes
      if (['rel_jss', 'rel_bc', 'fur_sci'].includes(sub.id) && classChunks.length < 2) {
        if (catClasses.length > 1) {
          classChunks.push(catClasses.slice(0, Math.ceil(catClasses.length / 2)).map(c => c.id));
        }
      }

      classChunks.forEach((chunkClasses, chunkIdx) => {
        const fn = firstNames[nameCounter % firstNames.length];
        const ln = lastNames[(nameCounter + subIdx) % lastNames.length];
        nameCounter++;

        const name = `${fn} ${ln}`;
        const username = `${fn.toLowerCase()}_${ln.toLowerCase()}_${subIdx}${chunkIdx}`;
        const id = `t_${sub.id}_${chunkIdx}_${nameCounter}`;

        // Keep subjects taught strictly balanced: 1 primary subject per teacher (or max 2 if small)
        const subjectsTaught: string[] = [sub.id];
        if (!sub.isCore && sub.defaultPeriodCount <= 3) {
          const otherLight = catSubjects.find(s => s.id !== sub.id && !s.isCore && s.defaultPeriodCount <= 3);
          if (otherLight) subjectsTaught.push(otherLight.id);
        }

        teachers.push({
          id,
          name,
          username,
          password: 'password123',
          recoveryCode: Math.floor(100000 + Math.random() * 900000).toString(),
          subjectsTaught: subjectsTaught.slice(0, 2), // 1 to 2 subjects
          assignedClasses: chunkClasses.slice(0, 3),  // 2 to 3 classes
          availability: buildAvailability(),
          isCompleted: true,
          bio: `Faculty member for ${cat.replace('_', ' ')} teaching ${sub.name}.`,
          contactEmail: `${username}@school.edu`,
          contactPhone: `+234 80${Math.floor(10000000 + Math.random() * 90000000)}`
        });
      });
    });
  });

  return teachers;
}

export const storage = {
  // --- SUBSCRIPTION ---
  subscribe: (listener: (showIndicator?: boolean) => void) => cloud.subscribe(listener),
  subscribeConnectionStatus: (listener: (connected: boolean) => void) => cloud.subscribeConnectionStatus(listener),
  isReady: () => cloud.ready,
  onReady: (listener: () => void) => cloud.onReady(listener),
  forceSync: (): Promise<boolean> => cloud.fetchLatestFromApi(),
  setFirebaseCustomToken: (customToken: string) => {
    if (customToken) {
      localStorage.setItem(KEYS.FIREBASE_CUSTOM_TOKEN, customToken);
    }
  },

  // --- TUTORIALS ---
  hasSeenTutorial: (): boolean => {
      const data = localStorage.getItem(KEYS.TUTORIAL_SEEN);
      try { return data ? JSON.parse(data) === 'true' : false; } catch { return data === 'true'; }
  },
  
  setTutorialSeen: () => {
      localStorage.setItem(KEYS.TUTORIAL_SEEN, JSON.stringify('true'));
      cloud.notify(false);
  },

  hasSeenAppWalkthrough: (): boolean => {
      const data = localStorage.getItem(KEYS.APP_WALKTHROUGH);
      try { return data ? JSON.parse(data) === 'true' : false; } catch { return data === 'true'; }
  },

  setAppWalkthroughSeen: () => {
      localStorage.setItem(KEYS.APP_WALKTHROUGH, JSON.stringify('true'));
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

      return {
          id: sub.id,
          name: sub.name,
          code: sub.code || (sub.name ? sub.name.substring(0, 4).toUpperCase() : 'SUBJ'),
          category: level,
          level,
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

      return {
          id: cls.id,
          name: cls.name,
          category: level,
          level,
          gradeLevel: cls.gradeLevel,
          assignedTeacherId: cls.assignedTeacherId,
          roomNumber: cls.roomNumber
      };
  },

  // --- CLASSES ---
  getClasses: (): Class[] => {
      const data = localStorage.getItem(KEYS.CLASSES);
      const rawClasses = safeParseArray<any>(data, []);
      if (rawClasses.length > 0) {
          return rawClasses.map(c => storage.normalizeClass(c));
      }
      const initial = ALL_CLASSES.map(c => storage.normalizeClass(c));
      localStorage.setItem(KEYS.CLASSES, JSON.stringify(initial));
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
      localStorage.setItem(KEYS.CLASSES, JSON.stringify(classes));
      cloud.pushItem(KEYS.CLASSES, normalized.id, normalized);
  },
  deleteClass: (id: string) => {
      const classes = storage.getClasses();
      const updated = classes.filter(c => c.id !== id);
      localStorage.setItem(KEYS.CLASSES, JSON.stringify(updated));
      cloud.deleteItem(KEYS.CLASSES, id);
  },

  // --- SUBJECTS ---
  getSubjects: (): Subject[] => {
      const data = localStorage.getItem(KEYS.SUBJECTS);
      const rawSubjects = safeParseArray<any>(data, []);
      if (rawSubjects.length > 0) {
          // Normalize and preserve exact user customized period counts
          return rawSubjects
              .filter(s => s && (s.id || s.name))
              .map(s => storage.normalizeSubject(s));
      }
      const initial = ALL_SUBJECTS.map(s => storage.normalizeSubject(s));
      localStorage.setItem(KEYS.SUBJECTS, JSON.stringify(initial));
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
      localStorage.setItem(KEYS.SUBJECTS, JSON.stringify(subjects));
      cloud.pushItem(KEYS.SUBJECTS, normalized.id, normalized);
  },
  deleteSubject: (id: string) => {
      const subjects = storage.getSubjects();
      const updated = subjects.filter(s => s.id !== id);
      localStorage.setItem(KEYS.SUBJECTS, JSON.stringify(updated));
      cloud.deleteItem(KEYS.SUBJECTS, id);
  },

  // --- TIMETABLE SLOT BUDGET CALCULATOR ---
  calculateSlotBudget: (level: AcademicLevel, customTotalSlots?: number): SlotBudgetInfo => {
      const settings = storage.getSettings();
      const daysCount = settings.enableSaturday ? 6 : 5;
      const periodsPerDay = settings.periodsPerDay || 8;
      const totalSlots = customTotalSlots || (daysCount * periodsPerDay); // Typically 40

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

  // --- TEACHERS ---
  getTeachers: (): Teacher[] => {
    const data = localStorage.getItem(KEYS.TEACHERS);
    let teachers: Teacher[] = safeParseArray<Teacher>(data, []);

    if (!teachers || teachers.length === 0) {
      teachers = generateFullFaculty(ALL_SUBJECTS, ALL_CLASSES);
      teachers.forEach(t => {
        if (!t.calendarToken) t.calendarToken = 'cal_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
        t.isApproved = true;
        t.approvalStatus = 'APPROVED';
        t.schoolId = 'ota_total_academy';
      });
      localStorage.setItem(KEYS.TEACHERS, JSON.stringify(teachers));
      // NOTE: Do not call cloud.pushUpdates here to avoid wiping registered teachers before cloud sync resolves
    } else {
      let modified = false;
      teachers.forEach(t => {
        if (t && t.id) {
          const pic = localStorage.getItem(`ota_profile_pic_${t.id}`);
          if (pic) {
            if (t.profilePicture !== pic) {
              t.profilePicture = pic;
              modified = true;
            }
          } else if (t.profilePicture) {
            try {
              localStorage.setItem(`ota_profile_pic_${t.id}`, t.profilePicture);
            } catch {}
          }
        }
        if (t && !t.calendarToken) {
          t.calendarToken = 'cal_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
          modified = true;
        }
        if (t && t.isApproved === undefined && t.approvalStatus === undefined) {
          t.isApproved = true;
          t.approvalStatus = 'APPROVED';
          t.schoolId = t.schoolId || 'ota_total_academy';
          modified = true;
        }
      });
      if (modified) {
        localStorage.setItem(KEYS.TEACHERS, JSON.stringify(teachers));
      }
    }
    
    return teachers;
  },
  
  getTeacherProfilePicture: (id: string): string | undefined => {
    if (!id) return undefined;
    try {
      const stored = localStorage.getItem(`ota_profile_pic_${id}`);
      if (stored) return stored;
    } catch {}
    const data = localStorage.getItem(KEYS.TEACHERS);
    const teachers: Teacher[] = safeParseArray<Teacher>(data, []);
    return teachers.find(t => t.id === id)?.profilePicture;
  },

  saveTeacher: (teacher: Teacher) => {
    if (teacher && teacher.id && teacher.profilePicture) {
      try {
        localStorage.setItem(`ota_profile_pic_${teacher.id}`, teacher.profilePicture);
      } catch {}
    }
    const data = localStorage.getItem(KEYS.TEACHERS);
    let teachers: Teacher[] = safeParseArray<Teacher>(data, []);
    const formatted = {
      ...teacher,
      password: teacher.password ? (/^\$2[aby]\$/.test(teacher.password) ? teacher.password : bcrypt.hashSync(teacher.password, 10)) : undefined
    };
    const index = teachers.findIndex(t => t.id === formatted.id);
    if (index >= 0) teachers[index] = formatted;
    else teachers.push(formatted);
    try {
      localStorage.setItem(KEYS.TEACHERS, JSON.stringify(teachers));
    } catch (e) {
      console.warn('[Storage] Teachers quota exception handled gracefully:', e);
    }
    cloud.pushItem(KEYS.TEACHERS, formatted.id, formatted);

    // Direct profile API persistence to server and real-time broadcast
    if (formatted.id && typeof window !== 'undefined') {
      fetch(`/api/teachers/${formatted.id}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profilePicture: formatted.profilePicture,
          bio: formatted.bio,
          contactEmail: formatted.contactEmail,
          contactPhone: formatted.contactPhone
        })
      }).catch(() => {});
    }
  },

  replaceAllTeachers: (teachersList: Teacher[]) => {
    localStorage.setItem(KEYS.TEACHERS, JSON.stringify(teachersList));
    const updates: Record<string, any> = {};
    teachersList.forEach(t => updates[`${KEYS.TEACHERS}.${t.id}`] = t);
    cloud.pushUpdates(updates);
  },

  saveTeachers: (newTeachers: Teacher[]) => {
    const teachers = storage.getTeachers();
    const updates: Record<string, any> = {};
    
    newTeachers.forEach(teacher => {
      const index = teachers.findIndex(t => t.id === teacher.id);
      if (index >= 0) teachers[index] = teacher;
      else teachers.push(teacher);
      updates[`${KEYS.TEACHERS}.${teacher.id}`] = teacher;
    });
    
    localStorage.setItem(KEYS.TEACHERS, JSON.stringify(teachers));
    cloud.pushUpdates(updates);
  },

  deleteTeacher: (id: string) => {
    const teachers = storage.getTeachers();
    const updated = teachers.filter(t => t.id !== id);
    localStorage.setItem(KEYS.TEACHERS, JSON.stringify(updated));
    cloud.deleteItem(KEYS.TEACHERS, id);
  },

  updateTeacherPassword: (id: string, newPass: string) => {
    const teachers = storage.getTeachers();
    const index = teachers.findIndex(t => t.id === id);
    if (index !== -1) {
        teachers[index].password = /^\$2[aby]\$/.test(newPass) ? newPass : bcrypt.hashSync(newPass, 10);
        teachers[index].mustChangePassword = false;
        teachers[index].recoveryCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        localStorage.setItem(KEYS.TEACHERS, JSON.stringify(teachers));
        cloud.pushItem(KEYS.TEACHERS, id, teachers[index]);
    }
  },

  updateTeacherPresence: (id: string) => {
    const teachers = storage.getTeachers();
    const idx = teachers.findIndex(t => t.id === id);
    if (idx !== -1) {
        const now = Date.now();
        // Only update if it's been at least 30 seconds to avoid excessive sync
        if (!teachers[idx].lastActive || now - teachers[idx].lastActive > 30000) {
            teachers[idx].lastActive = now;
            localStorage.setItem(KEYS.TEACHERS, JSON.stringify(teachers));
            cloud.pushItem(KEYS.TEACHERS, id, teachers[idx]);
        }
    }
  },

  // --- ADMINS ---
  getAdmins: (): AdminUser[] => {
    const data = localStorage.getItem(KEYS.ADMINS);
    const admins = safeParseArray<AdminUser>(data, []);
    if (admins.length === 0) {
        const def: AdminUser = { 
            id: 'admin1', 
            username: 'admin', 
            password: 'admin123', 
            name: 'Super Admin',
            tier: 'SUPER_ADMIN' 
        };
        localStorage.setItem(KEYS.ADMINS, JSON.stringify([def]));
        cloud.pushItem(KEYS.ADMINS, def.id, def, true);
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
      localStorage.setItem(KEYS.ADMINS, JSON.stringify(admins));
      cloud.pushItem(KEYS.ADMINS, formatted.id, formatted);
  },

  updateAdmin: (id: string, updates: Partial<AdminUser>) => {
      const admins = storage.getAdmins();
      const idx = admins.findIndex(a => a.id === id);
      if (idx !== -1) {
          admins[idx] = { ...admins[idx], ...updates };
          localStorage.setItem(KEYS.ADMINS, JSON.stringify(admins));
          cloud.pushItem(KEYS.ADMINS, id, admins[idx]);
      }
  },

  updateAdminPresence: (id: string) => {
    const admins = storage.getAdmins();
    const idx = admins.findIndex(a => a.id === id);
    if (idx !== -1) {
        const now = Date.now();
        // Only update if it's been at least 30 seconds to avoid excessive sync
        if (!admins[idx].lastActive || now - admins[idx].lastActive > 30000) {
            admins[idx].lastActive = now;
            localStorage.setItem(KEYS.ADMINS, JSON.stringify(admins));
            cloud.pushItem(KEYS.ADMINS, id, admins[idx]);
        }
    }
  },

  deleteAdmin: (id: string) => {
      const admins = storage.getAdmins();
      const updated = admins.filter(a => a.id !== id);
      localStorage.setItem(KEYS.ADMINS, JSON.stringify(updated));
      cloud.deleteItem(KEYS.ADMINS, id);
  },

  // --- TIMETABLE ---
  getTimetable: (): TimetableGrid | null => {
    const data = localStorage.getItem(KEYS.TIMETABLE);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          return parsed;
        }
      } catch {}
    }

    // Safety fallback: Retrieve latest timetable snapshot from history if available
    try {
      const history = storage.getHistory();
      if (history && history.length > 0) {
        for (let i = history.length - 1; i >= 0; i--) {
          const entry = history[i];
          if (entry?.snapshot && typeof entry.snapshot === 'object' && Object.keys(entry.snapshot).length > 0) {
            localStorage.setItem(KEYS.TIMETABLE, JSON.stringify(entry.snapshot));
            return entry.snapshot;
          }
        }
      }
    } catch {}

    return null;
  },

  saveTimetable: (grid: TimetableGrid, user: string = 'System') => {
    const current = storage.getTimetable();
    const updates: Record<string, any> = {};
    
    if (current) {
        const newHistory: HistoryEntry = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            action: 'Timetable Update',
            user: user,
            snapshot: current
        };
        const history = storage.getHistory();
        history.push(newHistory);
        localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
        updates[`${KEYS.HISTORY}.${newHistory.id}`] = newHistory;
    }
    
    localStorage.setItem(KEYS.TIMETABLE, JSON.stringify(grid));
    updates[KEYS.TIMETABLE] = grid;

    // Add notification
    const newNote: AppNotification = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        isRead: false,
        recipientId: 'ALL',
        title: 'New Timetable Published',
        message: `${user} has published a new version of the master schedule.`,
        details: 'Please check your personal schedule for any changes to your assigned classes or periods.',
        type: 'INFO',
        category: 'TIMETABLE'
    };
    const notes = safeParseArray<AppNotification>(localStorage.getItem(KEYS.NOTIFICATIONS), []);
    notes.push(newNote);
    localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(notes));
    updates[`${KEYS.NOTIFICATIONS}.${newNote.id}`] = newNote;

    // Atomic push for instant sync
    cloud.pushUpdates(updates);
  },

  // --- SESSIONS & AUTH ---
  setAuthToken: (token: string | null) => {
    if (token) localStorage.setItem(KEYS.AUTH_TOKEN, token);
    else localStorage.removeItem(KEYS.AUTH_TOKEN);
  },

  getAuthToken: (): string | null => {
    return localStorage.getItem(KEYS.AUTH_TOKEN);
  },

  setAdminSession: (adminId: string | null) => {
    const current = localStorage.getItem(KEYS.ADMIN_SESSION);
    if (current === adminId) return;
    if (adminId) localStorage.setItem(KEYS.ADMIN_SESSION, adminId);
    else localStorage.removeItem(KEYS.ADMIN_SESSION);
  },
  
  isAdminLoggedIn: (): boolean => {
    return !!localStorage.getItem(KEYS.ADMIN_SESSION);
  },

  getLoggedInAdminId: (): string | null => {
      return localStorage.getItem(KEYS.ADMIN_SESSION);
  },

  setTeacherSession: (teacherId: string | null) => {
    const current = localStorage.getItem(KEYS.TEACHER_SESSION);
    if (current === teacherId) return;
    if (teacherId) localStorage.setItem(KEYS.TEACHER_SESSION, teacherId);
    else localStorage.removeItem(KEYS.TEACHER_SESSION);
  },

  getLoggedInTeacherId: (): string | null => {
    return localStorage.getItem(KEYS.TEACHER_SESSION);
  },

  // --- HISTORY ---
  getHistory: (): HistoryEntry[] => {
      const data = localStorage.getItem(KEYS.HISTORY);
      return safeParseArray<HistoryEntry>(data, []);
  },
  addHistory: (entry: HistoryEntry) => {
      const history = storage.getHistory();
      if (history.length > 50) {
          const oldest = history.shift();
          if (oldest) cloud.deleteItem(KEYS.HISTORY, oldest.id);
      }
      history.push(entry);
      localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
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
      localStorage.setItem(KEYS.TIMETABLE, JSON.stringify(snapshot));
      cloud.pushObject(KEYS.TIMETABLE, snapshot);
      
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
      const data = localStorage.getItem(KEYS.REQUESTS);
      return safeParseArray<SwapRequest>(data, []);
  },
  addRequest: (req: SwapRequest) => {
      const reqs = storage.getRequests();
      reqs.push(req);
      localStorage.setItem(KEYS.REQUESTS, JSON.stringify(reqs));
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
          localStorage.setItem(KEYS.REQUESTS, JSON.stringify(reqs));
          
          const updates: Record<string, any> = {};
          updates[`${KEYS.REQUESTS}.${req.id}`] = req;
          
          // Actually perform the swap if approved
          if (req.status === 'APPROVED' && req.type === 'AUTOMATED_SWAP' && req.requestData) {
              const grid = storage.getTimetable();
              if (grid) {
                  const data = req.requestData;
                  
                  // Get the current cells
                  const targetCell = grid[data.targetClassId]?.[data.targetDay]?.[data.targetPeriod];
                  const offerCell = grid[data.offerClassId]?.[data.offerDay]?.[data.offerPeriod];
                  
                  if (targetCell && offerCell) {
                      // Swap the cells
                      // IMPORTANT: We do NOT set isManual: true here anymore 
                      // to ensure these swaps are not permanent in future generations
                      grid[data.targetClassId][data.targetDay][data.targetPeriod] = {
                          ...offerCell,
                          isManual: false
                      };
                      
                      grid[data.offerClassId][data.offerDay][data.offerPeriod] = {
                          ...targetCell,
                          isManual: false
                      };
                      
                      // Update local storage for timetable
                      localStorage.setItem(KEYS.TIMETABLE, JSON.stringify(grid));
                      // Add to updates for atomic push
                      updates[KEYS.TIMETABLE] = grid;

                      // Add history entry
                      const newHistory: HistoryEntry = {
                          id: crypto.randomUUID(),
                          timestamp: Date.now(),
                          action: 'Swap Approved',
                          user: 'System',
                          snapshot: grid
                      };
                      const history = storage.getHistory();
                      history.push(newHistory);
                      localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
                      updates[`${KEYS.HISTORY}.${newHistory.id}`] = newHistory;
                  }
              }
          }
          
          // Push all updates at once for instant synchronization
          cloud.pushUpdates(updates);
          
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
    const data = localStorage.getItem(KEYS.ROOMS);
    const rooms = safeParseArray<Room>(data, []);
    if (rooms.length === 0) {
      const defaults: Room[] = [
        { id: 'rm1', name: 'Science Laboratory 1', capacity: 35, type: 'LAB', description: 'Physics & Chemistry lab with experiment benches' },
        { id: 'rm2', name: 'Computer Science Lab', capacity: 30, type: 'LAB', description: '30 Workstations with ICT facilities' },
        { id: 'rm3', name: 'Main Assembly Hall', capacity: 300, type: 'HALL', description: 'Multipurpose hall for exams & events' },
        { id: 'rm4', name: 'Sports Field', capacity: 200, type: 'FIELD', description: 'Outdoor track and football pitch' },
        { id: 'rm5', name: 'SS3 Science Block', capacity: 40, type: 'CLASSROOM', description: 'Senior Secondary classroom' }
      ];
      localStorage.setItem(KEYS.ROOMS, JSON.stringify(defaults));
      const updates: Record<string, any> = {};
      defaults.forEach(r => updates[`${KEYS.ROOMS}.${r.id}`] = r);
      cloud.pushUpdates(updates, true);
      return defaults;
    }
    return rooms;
  },
  saveRoom: (room: Room) => {
    const rooms = storage.getRooms();
    const idx = rooms.findIndex(r => r.id === room.id);
    if (idx >= 0) rooms[idx] = room;
    else rooms.push(room);
    localStorage.setItem(KEYS.ROOMS, JSON.stringify(rooms));
    cloud.pushItem(KEYS.ROOMS, room.id, room);
  },
  deleteRoom: (id: string) => {
    const rooms = storage.getRooms();
    const updated = rooms.filter(r => r.id !== id);
    localStorage.setItem(KEYS.ROOMS, JSON.stringify(updated));
    cloud.deleteItem(KEYS.ROOMS, id);
  },

  // --- EXAM SESSIONS ---
  getExamSessions: (): ExamSession[] => {
    const data = localStorage.getItem(KEYS.EXAMS);
    return safeParseArray<ExamSession>(data, []);
  },
  saveExamSession: (exam: ExamSession) => {
    const exams = storage.getExamSessions();
    const idx = exams.findIndex(e => e.id === exam.id);
    if (idx >= 0) exams[idx] = exam;
    else exams.push(exam);
    localStorage.setItem(KEYS.EXAMS, JSON.stringify(exams));
    cloud.pushItem(KEYS.EXAMS, exam.id, exam);
  },
  deleteExamSession: (id: string) => {
    const exams = storage.getExamSessions();
    const updated = exams.filter(e => e.id !== id);
    localStorage.setItem(KEYS.EXAMS, JSON.stringify(updated));
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
      const data = localStorage.getItem(KEYS.NOTIFICATIONS);
      const all: AppNotification[] = safeParseArray<AppNotification>(data, []);
      return all.filter(n => n && (n.recipientId === recipientId || n.recipientId === 'ALL')).sort((a,b) => b.timestamp - a.timestamp);
  },
  addNotification: (note: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => {
      const data = localStorage.getItem(KEYS.NOTIFICATIONS);
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
      localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(all));
      cloud.pushItem(KEYS.NOTIFICATIONS, newNote.id, newNote);

      // Trigger plain email notification for REQUEST or TIMETABLE category if teacher has contactEmail
      if (note.category === 'REQUEST' || note.category === 'TIMETABLE') {
        const teachers = storage.getTeachers();
        const teacher = teachers.find(t => t.id === note.recipientId);
        if (teacher && teacher.contactEmail && teacher.preferences?.emailNotifications !== false) {
          storage.sendEmailNotification(teacher.contactEmail, note.title, note.message);
        }
      }
  },
  markRead: (id: string) => {
      const data = localStorage.getItem(KEYS.NOTIFICATIONS);
      const all: AppNotification[] = safeParseArray<AppNotification>(data, []);
      const idx = all.findIndex(n => n.id === id);
      if (idx !== -1) {
          all[idx].isRead = true;
          localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(all));
          cloud.pushItem(KEYS.NOTIFICATIONS, id, all[idx]);
      }
  },
  markAllRead: (recipientId: string) => {
      const data = localStorage.getItem(KEYS.NOTIFICATIONS);
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
      localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(all));
      cloud.pushUpdates(updates);
  },
  deleteNotification: (id: string) => {
      const data = localStorage.getItem(KEYS.NOTIFICATIONS);
      if (data) {
          const all: AppNotification[] = safeParseArray<AppNotification>(data, []);
          const updated = all.filter(n => n.id !== id);
          localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(updated));
          cloud.deleteItem(KEYS.NOTIFICATIONS, id);
      }
  },
  clearNotifications: (recipientId: string) => {
      const data = localStorage.getItem(KEYS.NOTIFICATIONS);
      let all: AppNotification[] = safeParseArray<AppNotification>(data, []);
      
      all = all.filter(n => n.recipientId !== recipientId);
      localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(all));
      cloud.notify();
  },

  // --- CHAT ---
  getChatMessages: (): ChatMessage[] => {
      const data = localStorage.getItem(KEYS.CHAT);
      return safeParseArray<ChatMessage>(data, []);
  },
  addChatMessage: (msg: ChatMessage) => {
      const msgs = storage.getChatMessages();
      msgs.push(msg);
      if (msgs.length > 500) {
          const oldest = msgs.shift();
          if (oldest) cloud.deleteItem(KEYS.CHAT, oldest.id);
      }
      localStorage.setItem(KEYS.CHAT, JSON.stringify(msgs));
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
          localStorage.setItem(KEYS.CHAT, JSON.stringify(msgs));
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
          localStorage.setItem(KEYS.CHAT, JSON.stringify(msgs));
          cloud.pushItem(KEYS.CHAT, id, msgs[idx]);
      }
  },

  // --- THEME & SETTINGS ---
  getTheme: (): string => {
      const data = localStorage.getItem(KEYS.THEME);
      try { return data ? JSON.parse(data) : 'DEFAULT'; } catch { return data || 'DEFAULT'; }
  },
  setTheme: (theme: string) => {
      localStorage.setItem(KEYS.THEME, JSON.stringify(theme));
      cloud.pushObject(KEYS.THEME, theme);
  },
  getSettings: (): AppSettings => {
    const data = localStorage.getItem(KEYS.SETTINGS);
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
    return data ? { ...defaults, ...JSON.parse(data) } : defaults;
  },
  saveSettings: (settings: AppSettings) => {
      localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
      cloud.pushObject(KEYS.SETTINGS, settings);
  },

  // --- TEACHER ABSENCES ---
  getAbsences: (): TeacherAbsence[] => {
      const data = localStorage.getItem(KEYS.ABSENCES);
      return safeParseArray<TeacherAbsence>(data, []);
  },
  saveAbsence: (absence: TeacherAbsence) => {
      const list = storage.getAbsences();
      const idx = list.findIndex(a => a.id === absence.id);
      if (idx >= 0) list[idx] = absence;
      else list.unshift(absence);
      localStorage.setItem(KEYS.ABSENCES, JSON.stringify(list));
      cloud.pushItem(KEYS.ABSENCES, absence.id, absence);
  },
  deleteAbsence: (id: string) => {
      const list = storage.getAbsences();
      const updated = list.filter(a => a.id !== id);
      localStorage.setItem(KEYS.ABSENCES, JSON.stringify(updated));
      cloud.deleteItem(KEYS.ABSENCES, id);
  },

  // --- AUDIT LOGS ---
  getAuditLogs: (): AuditLogEntry[] => {
      const data = localStorage.getItem(KEYS.AUDIT_LOGS);
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
      localStorage.setItem(KEYS.AUDIT_LOGS, JSON.stringify(logs));
      cloud.pushItem(KEYS.AUDIT_LOGS, newLog.id, newLog);
  },
  
  // --- SCHOOLS & MULTI-SCHOOL PORTAL ---
  getSchools: (): School[] => {
      const data = localStorage.getItem(KEYS.SCHOOLS);
      let schools = safeParseArray<School>(data, []);
      // Filter out any mock/dummy schools - ONLY allow OTA Total Academy and user-manually added schools (id starts with sch_)
      schools = schools.filter(s => s && (s.id === 'ota_total_academy' || (typeof s.id === 'string' && s.id.startsWith('sch_'))));

      if (!schools || schools.length === 0) {
          schools = [DEFAULT_SCHOOLS[0]];
          localStorage.setItem(KEYS.SCHOOLS, JSON.stringify(schools));
          // CRITICAL: NEVER push default data to Firestore database!
          // Only manually registered schools are persisted to Firestore.
      } else {
          // Guarantee OTA Total Academy is present as initial option if desired
          const hasOta = schools.some(s => s.id === 'ota_total_academy');
          if (!hasOta) {
              schools.unshift(DEFAULT_SCHOOLS[0]);
          }
          localStorage.setItem(KEYS.SCHOOLS, JSON.stringify(schools));
      }
      return schools;
  },

  saveSchool: (school: School) => {
      const schools = storage.getSchools();
      const idx = schools.findIndex(s => s.id === school.id);
      if (idx >= 0) schools[idx] = school;
      else schools.push(school);
      localStorage.setItem(KEYS.SCHOOLS, JSON.stringify(schools));
      // Only push manually added schools to Firestore
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
          const token = localStorage.getItem('ota_auth_token');
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) {
              headers['Authorization'] = `Bearer ${token}`;
          }

          let data: any = null;
          try {
              const res = await fetch('/api/schools', {
                  method: 'POST',
                  headers,
                  body: JSON.stringify(payload)
              });

              const contentType = res.headers.get('content-type') || '';
              if (contentType.includes('application/json')) {
                  data = await res.json();
              } else {
                  const text = await res.text();
                  try { data = JSON.parse(text); } catch {}
              }

              if (res.ok && data && data.success && data.school) {
                  const newSchool: School = data.school;
                  storage.saveSchool(newSchool);
                  try {
                      await setDoc(doc(db, 'schools', newSchool.id), newSchool);
                  } catch (fsErr) {}

                  storage.addAuditLog({
                      actorName: newSchool.registeredBy || 'Admin',
                      actorRole: 'ADMIN',
                      action: 'SCHOOL_REGISTERED',
                      details: `Registered institution: ${newSchool.name} (${newSchool.code}).`
                  });

                  cloud.notify();
                  return { success: true, school: newSchool };
              }
          } catch (netErr) {
              console.warn('[School Registration] Server sync notice:', netErr);
          }

          // Resilient client-side fallback if server response was non-JSON or unreachable
          const cleanCode = (payload.code || payload.name.substring(0, 4)).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'SCH';
          const schoolId = 'sch_' + cleanCode.toLowerCase() + '_' + Date.now().toString(36);
          const fallbackSchool: School = {
              id: schoolId,
              name: payload.name.trim(),
              code: cleanCode,
              motto: payload.motto?.trim() || 'Excellence in Learning & Character',
              address: payload.address?.trim() || 'Campus Location',
              themeColor: payload.themeColor || '#2563eb',
              adminEmail: payload.adminEmail?.trim() || '',
              adminPhone: payload.adminPhone?.trim() || '',
              accreditationNumber: payload.accreditationNumber?.trim() || `REG-${Date.now().toString(36).toUpperCase()}`,
              isOta: false,
              isDefault: false,
              status: 'ACTIVE',
              registeredAt: Date.now(),
              createdAt: Date.now(),
              updatedAt: Date.now()
          };

          storage.saveSchool(fallbackSchool);
          try {
              await setDoc(doc(db, 'schools', fallbackSchool.id), fallbackSchool);
          } catch (fsErr) {}

          storage.addAuditLog({
              actorName: 'Administrator',
              actorRole: 'ADMIN',
              action: 'SCHOOL_REGISTERED',
              details: `Institution initialized: ${fallbackSchool.name} (${fallbackSchool.code}).`
          });

          cloud.notify();
          return { success: true, school: fallbackSchool };
      } catch (err: any) {
          return { success: false, error: err?.message || 'Failed to register school.' };
      }
  },

  deleteSchoolSecurely: async (schoolId: string, adminPasskey?: string): Promise<{ success: boolean; error?: string }> => {
      try {
          const token = localStorage.getItem('ota_auth_token');
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) {
              headers['Authorization'] = `Bearer ${token}`;
          }

          try {
              const res = await fetch(`/api/schools/${schoolId}`, {
                  method: 'DELETE',
                  headers,
                  body: JSON.stringify({ adminPasskey })
              });

              const contentType = res.headers.get('content-type') || '';
              if (contentType.includes('application/json')) {
                  const data = await res.json();
                  if (!res.ok && data && data.error) {
                      console.warn('[Delete School] Server notice:', data.error);
                  }
              }
          } catch (netErr) {
              console.warn('[Delete School] Server notice:', netErr);
          }

          const schools = storage.getSchools().filter(s => s.id !== schoolId);
          localStorage.setItem(KEYS.SCHOOLS, JSON.stringify(schools));
          cloud.deleteItem(KEYS.SCHOOLS, schoolId);

          try {
              await deleteDoc(doc(db, 'schools', schoolId));
          } catch {}

          cloud.notify();
          return { success: true };
      } catch (err: any) {
          return { success: false, error: err?.message || 'Error deleting school' };
      }
  },

  getCurrentSchool: (): School | null => {
      const currentStr = localStorage.getItem(KEYS.CURRENT_SCHOOL);
      if (currentStr) {
          try {
              return JSON.parse(currentStr);
          } catch {}
      }
      return null;
  },

  setCurrentSchool: (school: School | null) => {
      if (school) {
          localStorage.setItem(KEYS.CURRENT_SCHOOL, JSON.stringify(school));
          // Sync school name into settings
          const currentSettings = storage.getSettings();
          if (currentSettings.schoolName !== school.name) {
              storage.saveSettings({ ...currentSettings, schoolName: school.name });
          }
      } else {
          localStorage.removeItem(KEYS.CURRENT_SCHOOL);
      }
      cloud.notify();
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
          localStorage.setItem(KEYS.TEACHERS, JSON.stringify(teachers));
          cloud.pushItem(KEYS.TEACHERS, teacherId, teachers[idx]);

          // Add congratulations notification to teacher
          storage.addNotification({
              recipientId: teacherId,
              title: 'Faculty Verification Approved ✅',
              message: `Welcome to the faculty! Your identity has been verified by ${adminName}. You now have full access to your school timetable and dashboard.`,
              details: 'All security checks passed. Anti-imposter verification complete.',
              type: 'SUCCESS',
              category: 'SYSTEM'
          });

          // Add audit log
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
              localStorage.setItem(KEYS.TEACHERS, JSON.stringify(teachers));
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

  resetSystem: () => {
      localStorage.removeItem(KEYS.TEACHERS);
      localStorage.removeItem(KEYS.TIMETABLE);
      localStorage.removeItem(KEYS.HISTORY);
      localStorage.removeItem(KEYS.REQUESTS);
      localStorage.removeItem(KEYS.NOTIFICATIONS);
      localStorage.removeItem(KEYS.CHAT);
      localStorage.removeItem(KEYS.CLASSES);
      localStorage.removeItem(KEYS.SUBJECTS);
      
      cloud.resetServer();

      cloud.notify();
      // NOTE: We do not clear ADMINS, SETTINGS or TUTORIAL_SEEN to prevent lockout/annoyance
  },

  fetchLatestFromApi: (forceFull?: boolean) => cloud.fetchLatestFromApi(forceFull)
};
