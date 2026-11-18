import React, { useState, useEffect, useRef } from 'react';
import {
  Lock,
  Trash2,
  RefreshCw,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  X,
  Eye,
  EyeOff,
  Loader2,
  RotateCcw,
  Sparkles,
  Activity,
  ShieldAlert,
  BookOpen,
  Users,
  Database,
  Key,
  Copy,
  Check,
  Search,
  Radio,
  Mail,
  ShieldCheck,
  UserCheck,
  UserX,
  FileJson,
  Send,
  Clock,
  Plus,
  Save,
  HardDrive,
  Code2,
  FolderOpen,
} from 'lucide-react';
import { storage } from '../services/storage';
import { SyncDiagnostics } from './SyncDiagnostics';
import { Teacher } from '../types';

interface DeveloperConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSystemResetCompleted?: () => void;
}

interface TelemetryData {
  status: string;
  uptimeSeconds: number;
  storeVersion: number;
  classCount: number;
  teacherCount: number;
  pendingApprovals?: number;
  pendingVerifications?: number;
  subjectCount: number;
  timetableClasses: number;
  requestCount?: number;
  sseClients?: number;
  emailConfigured?: {
    resend: boolean;
    smtp: boolean;
  };
  projectId: string;
  databaseId: string;
}

interface PendingVerificationItem {
  email: string;
  name: string;
  username: string;
  code: string;
  expiresAt: number;
  createdAt: number;
}

interface IntegrityAuditResult {
  healthy: boolean;
  summary: {
    teachers: number;
    classes: number;
    orphanedSlots: number;
    teacherDoubleBookings: number;
    roomDoubleBookings: number;
    streamViolations: number;
    pendingApprovals: number;
  };
  issues: {
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    category: string;
    message: string;
  }[];
}

interface StoreKeyInfo {
  key: string;
  type: string;
  count: number;
  bytes: number;
  preview: string;
}

interface FirebaseExplorerDoc {
  collection: 'ota_app_store' | 'schools' | 'ota_sync_diagnostics';
  id: string;
  updatedAt: number | null;
  bytes: number;
  itemCount: number;
  data?: any;
}

const LARGE_DOC_BYTES_THRESHOLD = 184320; // 180 KB threshold to avoid <textarea> DOM freeze

type DevTab = 'FIREBASE' | 'ACTIONS' | 'FACULTY' | 'EMAIL' | 'DIAGNOSTICS' | 'TELEMETRY';

const DEV_PASS = 'proxonline26';

export const DeveloperConsoleModal: React.FC<DeveloperConsoleModalProps> = ({
  isOpen,
  onClose,
  onSystemResetCompleted,
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [schoolReadyClearTeachers, setSchoolReadyClearTeachers] = useState(false);
  const [activeTab, setActiveTab] = useState<DevTab>('ACTIONS');

  // Telemetry & Integrity
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [integrityReport, setIntegrityReport] = useState<IntegrityAuditResult | null>(null);

  // Faculty & Verification Codes
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [pendingVerifications, setPendingVerifications] = useState<PendingVerificationItem[]>([]);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [facultyFilter, setFacultyFilter] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [passwordEditTeacherId, setPasswordEditTeacherId] = useState<string | null>(null);
  const [newTeacherPassword, setNewTeacherPassword] = useState('');
  const [confirmDeleteTeacherId, setConfirmDeleteTeacherId] = useState<string | null>(null);

  // Email Diagnostic
  const [testEmailTarget, setTestEmailTarget] = useState('');
  const [emailDiagnosticResult, setEmailDiagnosticResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Store Key Inspector
  const [storeKeys, setStoreKeys] = useState<StoreKeyInfo[]>([]);
  const [selectedStoreKey, setSelectedStoreKey] = useState<string | null>(null);
  const [copiedStoreKey, setCopiedStoreKey] = useState<string | null>(null);

  // Full Live Firebase Firestore Explorer & Editor
  const [firebaseDocs, setFirebaseDocs] = useState<FirebaseExplorerDoc[]>([]);
  const [firebaseCollectionStats, setFirebaseCollectionStats] = useState<Record<string, { count: number; totalBytes: number }>>({});
  const [firebaseMeta, setFirebaseMeta] = useState<{ projectId: string; databaseId: string } | null>(null);
  const [firebaseCollectionFilter, setFirebaseCollectionFilter] = useState<
    'ALL' | 'ota_app_store' | 'schools' | 'ota_sync_diagnostics'
  >('ALL');
  const [firebaseSearch, setFirebaseSearch] = useState('');
  const [selectedFirebaseDocKey, setSelectedFirebaseDocKey] = useState<string | null>(null);
  const [editorJson, setEditorJson] = useState('');
  const [editorJsonError, setEditorJsonError] = useState('');
  const [isNewDocMode, setIsNewDocMode] = useState(false);
  const [newDocCollection, setNewDocCollection] = useState<'ota_app_store' | 'schools' | 'ota_sync_diagnostics'>('ota_app_store');
  const [newDocId, setNewDocId] = useState('');
  const [confirmDeleteDocKey, setConfirmDeleteDocKey] = useState<string | null>(null);
  const [firebaseLoading, setFirebaseLoading] = useState(false);
  const [firebaseDocLoading, setFirebaseDocLoading] = useState(false);
  const [loadedDocData, setLoadedDocData] = useState<any>(undefined);
  const [largeDocExpanded, setLargeDocExpanded] = useState(false);
  const [copiedDocJson, setCopiedDocJson] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const firebaseDocCacheRef = useRef<Map<string, any>>(new Map());
  const docAbortRef = useRef<AbortController | null>(null);
  const jsonValidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) {
      docAbortRef.current?.abort();
      if (jsonValidationTimerRef.current) clearTimeout(jsonValidationTimerRef.current);
      firebaseDocCacheRef.current.clear();
      setPassword('');
      setErrorMsg('');
      setSuccessMsg('');
      setConfirmWipe(false);
      setIsAuthenticated(false);
      setTelemetry(null);
      setIntegrityReport(null);
      setActiveTab('ACTIONS');
      setTeacherSearch('');
      setFacultyFilter('ALL');
      setCopiedCodeId(null);
      setPasswordEditTeacherId(null);
      setNewTeacherPassword('');
      setConfirmDeleteTeacherId(null);
      setEmailDiagnosticResult(null);
      setStoreKeys([]);
      setSelectedStoreKey(null);
      setFirebaseDocs([]);
      setFirebaseCollectionStats({});
      setFirebaseMeta(null);
      setFirebaseCollectionFilter('ALL');
      setFirebaseSearch('');
      setSelectedFirebaseDocKey(null);
      setEditorJson('');
      setEditorJsonError('');
      setLoadedDocData(undefined);
      setLargeDocExpanded(false);
      setFirebaseDocLoading(false);
      setIsNewDocMode(false);
      setNewDocId('');
      setConfirmDeleteDocKey(null);
    } else {
      setTeachersList(storage.getTeachers());
    }
  }, [isOpen]);

  const showSuccess = (msg: string, duration = 4000) => {
    setErrorMsg('');
    setSuccessMsg(msg);
    if (duration > 0) {
      setTimeout(() => setSuccessMsg(''), duration);
    }
  };

  const loadTeachers = async () => {
    try {
      const res = await fetch(`/api/developer/teachers?password=${DEV_PASS}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.teachers)) setTeachersList(data.teachers);
        if (Array.isArray(data.pendingVerifications)) setPendingVerifications(data.pendingVerifications);
        return;
      }
    } catch {}
    setTeachersList(storage.getTeachers());
  };

  const fetchTelemetry = async () => {
    try {
      const res = await fetch(`/api/developer/telemetry?password=${DEV_PASS}`);
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
      }
    } catch {}
  };

  const loadStoreKeys = async () => {
    try {
      const res = await fetch(`/api/developer/store-keys?password=${DEV_PASS}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.keys)) {
          setStoreKeys(data.keys);
          if (!selectedStoreKey && data.keys.length > 0) {
            setSelectedStoreKey(data.keys[0].key);
          }
        }
      }
    } catch {}
  };

  const applyLoadedDocToEditor = (docData: any, bytes: number, forceExpand = false) => {
    setLoadedDocData(docData);
    setEditorJsonError('');
    if (!forceExpand && bytes > LARGE_DOC_BYTES_THRESHOLD) {
      setLargeDocExpanded(false);
      setEditorJson('');
    } else {
      setLargeDocExpanded(true);
      setEditorJson(JSON.stringify(docData ?? null, null, 2));
    }
  };

  const loadSingleFirebaseDoc = async (docItem: FirebaseExplorerDoc, forceRefresh = false) => {
    const key = `${docItem.collection}/${docItem.id}`;
    setSelectedFirebaseDocKey(key);
    setIsNewDocMode(false);
    setConfirmDeleteDocKey(null);
    setEditorJsonError('');

    if (!forceRefresh && firebaseDocCacheRef.current.has(key)) {
      const cached = firebaseDocCacheRef.current.get(key);
      applyLoadedDocToEditor(cached.data, cached.bytes ?? docItem.bytes);
      setFirebaseDocLoading(false);
      return;
    }

    docAbortRef.current?.abort();
    const controller = new AbortController();
    docAbortRef.current = controller;
    setFirebaseDocLoading(true);

    try {
      const url = `/api/developer/firebase/doc?password=${encodeURIComponent(DEV_PASS)}&collectionName=${encodeURIComponent(
        docItem.collection
      )}&docId=${encodeURIComponent(docItem.id)}`;
      const res = await fetch(url, { signal: controller.signal });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || `Failed to load ${key}`);
      }
      const fetched = payload.document;
      firebaseDocCacheRef.current.set(key, { data: fetched.data, bytes: fetched.bytes });
      applyLoadedDocToEditor(fetched.data, fetched.bytes ?? docItem.bytes);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setErrorMsg(err?.message || `Failed to fetch document ${key}.`);
    } finally {
      if (docAbortRef.current === controller) {
        setFirebaseDocLoading(false);
      }
    }
  };

  const loadFirebaseExplorer = async (preserveSelectionKey?: string | null, forceRefresh = false) => {
    setFirebaseLoading(true);
    setErrorMsg('');
    if (forceRefresh) {
      firebaseDocCacheRef.current.clear();
    }
    try {
      const res = await fetch(`/api/developer/firebase/explorer?password=${DEV_PASS}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to read Cloud Firestore');
      }
      const docs: FirebaseExplorerDoc[] = Array.isArray(data.documents) ? data.documents : [];
      setFirebaseDocs(docs);
      setFirebaseCollectionStats(data.collectionStats || {});
      setFirebaseMeta({
        projectId: data.projectId || 'ota-smart-timetable',
        databaseId: data.databaseId || 'ai-studio-otasmarttimetabl-5b72f609-12f9-471e-8ea2-d4f3daede4d4',
      });

      const targetKey = preserveSelectionKey !== undefined ? preserveSelectionKey : selectedFirebaseDocKey;
      const matched = docs.find(d => `${d.collection}/${d.id}` === targetKey) || docs[0] || null;
      if (matched && !isNewDocMode) {
        await loadSingleFirebaseDoc(matched, forceRefresh);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load live Firebase documents.');
    } finally {
      setFirebaseLoading(false);
    }
  };

  const handleSelectFirebaseDoc = (docItem: FirebaseExplorerDoc) => {
    loadSingleFirebaseDoc(docItem, false);
  };

  const handleStartNewDoc = () => {
    docAbortRef.current?.abort();
    setFirebaseDocLoading(false);
    setIsNewDocMode(true);
    setConfirmDeleteDocKey(null);
    setSelectedFirebaseDocKey(null);
    setLoadedDocData(undefined);
    setLargeDocExpanded(true);
    const defaultCol = firebaseCollectionFilter === 'ALL' ? 'ota_app_store' : firebaseCollectionFilter;
    setNewDocCollection(defaultCol);
    setNewDocId('');
    const template =
      defaultCol === 'schools'
        ? { id: 'new_school_id', name: 'New School Name', code: 'NSN', motto: 'Academic Excellence' }
        : defaultCol === 'ota_sync_diagnostics'
          ? { deviceId: 'diag_device_1', timestamp: Date.now(), note: 'Diagnostic ping' }
          : { example: true, updatedBy: 'dev_console' };
    setEditorJson(JSON.stringify(template, null, 2));
    setEditorJsonError('');
  };

  const handleEditorJsonChange = (val: string) => {
    setEditorJson(val);
    if (jsonValidationTimerRef.current) clearTimeout(jsonValidationTimerRef.current);
    jsonValidationTimerRef.current = setTimeout(() => {
      try {
        JSON.parse(val);
        setEditorJsonError('');
      } catch (err: any) {
        setEditorJsonError(err?.message || 'Invalid JSON syntax');
      }
    }, 250);
  };

  const handleFormatEditorJson = () => {
    try {
      const parsed = JSON.parse(editorJson);
      setEditorJson(JSON.stringify(parsed, null, 2));
      setEditorJsonError('');
    } catch (err: any) {
      setEditorJsonError(err?.message || 'Cannot format invalid JSON');
    }
  };

  const handleSaveFirebaseDoc = async () => {
    let parsed: any;
    try {
      parsed = JSON.parse(editorJson);
      setEditorJsonError('');
    } catch (err: any) {
      setEditorJsonError(err?.message || 'Invalid JSON syntax');
      return;
    }

    let collectionName: 'ota_app_store' | 'schools' | 'ota_sync_diagnostics';
    let docId: string;

    if (isNewDocMode) {
      collectionName = newDocCollection;
      docId = newDocId.trim();
      if (!docId) {
        setErrorMsg('Please enter a valid Document ID.');
        return;
      }
    } else if (selectedFirebaseDocKey) {
      const slashIdx = selectedFirebaseDocKey.indexOf('/');
      collectionName = selectedFirebaseDocKey.slice(0, slashIdx) as any;
      docId = selectedFirebaseDocKey.slice(slashIdx + 1);
    } else {
      return;
    }

    setFirebaseLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/firebase/set-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: DEV_PASS,
          collectionName,
          docId,
          data: parsed,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed writing document to Firebase');

      const savedKey = `${collectionName}/${docId}`;
      firebaseDocCacheRef.current.delete(savedKey);
      setIsNewDocMode(false);
      setSelectedFirebaseDocKey(savedKey);
      await loadFirebaseExplorer(savedKey, true);
      await storage.fetchLatestFromApi(true);
      await loadTeachers();
      await fetchTelemetry();
      showSuccess(data.message || `Saved ${savedKey} to Cloud Firestore.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save document to Firebase.');
    } finally {
      setFirebaseLoading(false);
    }
  };

  const handleDeleteFirebaseDoc = async (collectionName: string, docId: string) => {
    setFirebaseLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/firebase/delete-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: DEV_PASS,
          collectionName,
          docId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed deleting Firestore document');

      firebaseDocCacheRef.current.delete(`${collectionName}/${docId}`);
      setConfirmDeleteDocKey(null);
      setSelectedFirebaseDocKey(null);
      setLoadedDocData(undefined);
      setEditorJson('');
      await loadFirebaseExplorer(null, false);
      await storage.fetchLatestFromApi(true);
      await loadTeachers();
      await fetchTelemetry();
      showSuccess(data.message || `Deleted ${collectionName}/${docId} from Cloud Firestore.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete document from Firebase.');
    } finally {
      setFirebaseLoading(false);
    }
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (password.trim() === DEV_PASS) {
      setIsAuthenticated(true);
      fetchTelemetry();
      loadTeachers();
    } else {
      setErrorMsg('Incorrect developer password.');
    }
  };

  // System Integrity Scan
  const handleScanIntegrity = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/scan-integrity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Integrity scan failed');
      setIntegrityReport(data);
      showSuccess(
        data.healthy
          ? 'System integrity audit passed with zero critical issues.'
          : `Integrity audit detected ${data.issues.length} item(s) to review.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to run system integrity scan.');
    } finally {
      setIsLoading(false);
    }
  };

  // Purge Fake / Test Teachers
  const handlePurgeFakeTeachers = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/purge-fake-teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Purge failed');
      await storage.fetchLatestFromApi(true);
      await loadTeachers();
      await fetchTelemetry();
      if (integrityReport) await handleScanIntegrity();
      showSuccess(data.message || 'Fake/test teacher accounts purged.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to purge fake teachers.');
    } finally {
      setIsLoading(false);
    }
  };

  // Clean Stream Violations
  const handleFixStreamViolations = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/fix-stream-violations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to apply stream fix');
      await storage.fetchLatestFromApi(true);
      await fetchTelemetry();
      showSuccess(data.message || `Removed ${data.cleanedSlots || 0} stream violations.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to clean stream violations.');
    } finally {
      setIsLoading(false);
    }
  };

  // Purge Orphaned Teachers
  const handlePurgeOrphanedTeachers = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/purge-orphaned-teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to purge orphaned teachers');
      await storage.fetchLatestFromApi(true);
      await fetchTelemetry();
      showSuccess(data.message || `Purged ${data.purgedCount || 0} ghost teacher slot assignments.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to purge orphaned teachers.');
    } finally {
      setIsLoading(false);
    }
  };

  // Selective Purge
  const handleSelectivePurge = async (target: 'timetable' | 'teachers' | 'logs' | 'draft' | 'requests') => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/selective-purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS, target }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Purge failed');
      await storage.fetchLatestFromApi(true);
      await loadTeachers();
      await fetchTelemetry();
      showSuccess(`Successfully cleared ${target}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Selective purge failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // Force Sync (Pull or Push)
  const handleForceSync = async (direction: 'pull' | 'push') => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/force-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS, direction }),
      });
      if (!res.ok) throw new Error('Sync failed');
      await storage.forceSync();
      await fetchTelemetry();
      await loadTeachers();
      showSuccess(
        direction === 'pull'
          ? 'Pulled authoritative Cloud Firestore state to server.'
          : 'Pushed live server store to Cloud Firestore.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Sync error');
    } finally {
      setIsLoading(false);
    }
  };

  // Download System Backup JSON
  const handleDownloadBackup = async () => {
    try {
      const res = await fetch(`/api/sync/store?password=${DEV_PASS}`);
      if (!res.ok) throw new Error('Backup download rejected by server');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pentric_backup_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccess('Backup JSON downloaded successfully.');
    } catch {
      setErrorMsg('Failed to download backup.');
    }
  };

  // Restore Backup
  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setErrorMsg('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const keys = parsed.keys || parsed;
      if (!keys || typeof keys !== 'object') {
        throw new Error('Invalid backup file structure: missing keys payload.');
      }
      const res = await fetch('/api/developer/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS, keys }),
      });
      if (!res.ok) throw new Error('Server rejected backup restore payload.');
      await storage.fetchLatestFromApi(true);
      showSuccess('Backup restored to Cloud Firestore! Reloading...', 0);
      setTimeout(() => window.location.reload(), 1400);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to restore backup file.');
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Factory Reset
  const handleExecuteWipe = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/reset-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS }),
      });
      if (!res.ok) {
        await fetch('/api/sync/reset', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-developer-password': DEV_PASS,
          },
          body: JSON.stringify({ password: DEV_PASS }),
        });
      }
      await storage.resetSystem();
      showSuccess('All application data wiped from Cloud Firestore. Reloading...', 0);
      if (onSystemResetCompleted) onSystemResetCompleted();
      setTimeout(() => window.location.reload(), 1200);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to complete reset.');
      setIsLoading(false);
    }
  };

  // 1-Click School Handover Preparation (Draft 0, No Published Timetable, 0 Inbox Mails)
  const handlePrepareSchoolReady = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/prepare-school-ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: DEV_PASS,
          clearTeachers: schoolReadyClearTeachers,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to prepare app for school handover.');
      }
      firebaseDocCacheRef.current.clear();
      setSelectedFirebaseDocKey(null);
      setLoadedDocData(undefined);
      setEditorJson('');
      await storage.fetchLatestFromApi(true);
      await Promise.all([fetchTelemetry(), loadTeachers()]);
      if (firebaseDocs.length > 0) {
        await loadFirebaseExplorer(null, true);
      }
      showSuccess(
        data.message ||
          'App is ready for school handover: Draft 0, no published timetable, 0 inbox mails.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to prepare app for school handover.');
    } finally {
      setIsLoading(false);
    }
  };

  // Faculty Actions
  const handleTeacherAction = async (
    teacherId: string,
    action: 'APPROVE' | 'REJECT' | 'RESET_ONBOARDING' | 'SET_PASSWORD' | 'DELETE',
    extra?: { newPassword?: string; reason?: string }
  ) => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/teacher-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: DEV_PASS,
          teacherId,
          action,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Teacher action failed');
      await storage.fetchLatestFromApi(true);
      await loadTeachers();
      await fetchTelemetry();
      setPasswordEditTeacherId(null);
      setNewTeacherPassword('');
      setConfirmDeleteTeacherId(null);
      showSuccess(data.message || 'Faculty record updated.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update faculty record.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegenerateRecoveryCode = async (teacherId: string) => {
    try {
      const res = await fetch('/api/developer/regenerate-recovery-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS, teacherId }),
      });
      if (res.ok) {
        const data = await res.json();
        setTeachersList(prev =>
          prev.map(t => (t.id === teacherId ? { ...t, recoveryCode: data.recoveryCode } : t))
        );
        showSuccess(`New recovery code generated: ${data.recoveryCode}`);
        return;
      }
    } catch {}
    setErrorMsg('Failed to regenerate recovery code on server.');
  };

  // Email Diagnostic & OTPs
  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailTarget.trim()) return;
    setIsLoading(true);
    setEmailDiagnosticResult(null);
    setErrorMsg('');
    try {
      const res = await fetch('/api/developer/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS, toEmail: testEmailTarget.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setEmailDiagnosticResult({
          success: true,
          message: `Dispatched successfully via ${data.transport || 'Email Transport'} (${data.sender || 'configured sender'}).`,
        });
      } else {
        setEmailDiagnosticResult({
          success: false,
          message: data.error || 'Server could not deliver the test email.',
        });
      }
    } catch (err: any) {
      setEmailDiagnosticResult({
        success: false,
        message: err?.message || 'Request failed.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePendingVerification = async (email: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/developer/delete-pending-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEV_PASS, email }),
      });
      if (res.ok) {
        setPendingVerifications(prev => prev.filter(p => p.email !== email));
        fetchTelemetry();
        showSuccess(`Cleared pending OTP verification for ${email}.`);
      }
    } catch {
      setErrorMsg('Failed to remove pending verification.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const filteredTeachers = teachersList.filter(t => {
    const matchesSearch =
      !teacherSearch ||
      (t.name || '').toLowerCase().includes(teacherSearch.toLowerCase()) ||
      (t.username || '').toLowerCase().includes(teacherSearch.toLowerCase()) ||
      (t.contactEmail || '').toLowerCase().includes(teacherSearch.toLowerCase());
    if (!matchesSearch) return false;
    if (facultyFilter === 'PENDING') return !t.isApproved && t.approvalStatus !== 'REJECTED';
    if (facultyFilter === 'APPROVED') return t.isApproved !== false;
    return true;
  });

  const activeStoreKeyObj = storeKeys.find(k => k.key === selectedStoreKey) || storeKeys[0] || null;

  const filteredFirebaseDocs = firebaseDocs.filter(d => {
    if (firebaseCollectionFilter !== 'ALL' && d.collection !== firebaseCollectionFilter) return false;
    if (!firebaseSearch.trim()) return true;
    const q = firebaseSearch.trim().toLowerCase();
    return d.id.toLowerCase().includes(q) || d.collection.toLowerCase().includes(q);
  });

  const activeFirebaseDoc =
    !isNewDocMode && selectedFirebaseDocKey
      ? firebaseDocs.find(d => `${d.collection}/${d.id}` === selectedFirebaseDocKey) || null
      : null;

  const totalFirebaseBytes = Object.values(firebaseCollectionStats).reduce((acc, s) => acc + (s?.totalBytes || 0), 0);

  return (
    <div className="fixed inset-0 z-[999999] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
      <div
        className={`bg-white rounded-xl w-full ${
          isAuthenticated ? 'max-w-5xl' : 'max-w-lg'
        } shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[93vh] transition-all`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-blue-100 flex items-center justify-between bg-gradient-to-r from-white via-sky-50/70 to-blue-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-sky-500 text-white flex items-center justify-center shrink-0 shadow-sm shadow-blue-500/25">
              <Lock size={16} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <span>Developer Maintenance Console</span>
                <span className="text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md">
                  v3.1
                </span>
              </h3>
              <p className="text-xs text-slate-500">Live Firebase Firestore editor, system integrity, faculty controls & email OTPs</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close developer console"
            className="w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Auth Gate */}
        {!isAuthenticated ? (
          <form onSubmit={handleVerify} className="p-6 space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Enter the developer master passphrase to unlock maintenance, account overrides, email diagnostics, and Firestore inspector tools.
            </p>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Developer passphrase"
                autoFocus
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 outline-none focus:border-blue-600 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
                <AlertTriangle size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition"
              >
                Unlock Console
              </button>
            </div>
          </form>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 custom-scrollbar bg-slate-50/40">
            {/* Navigation Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              <button
                onClick={() => {
                  setActiveTab('FIREBASE');
                  if (firebaseDocs.length === 0) {
                    loadFirebaseExplorer();
                  }
                }}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'FIREBASE' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <HardDrive size={13} />
                <span>Firebase DB{firebaseDocs.length > 0 ? ` (${firebaseDocs.length})` : ''}</span>
              </button>
              <button
                onClick={() => setActiveTab('ACTIONS')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'ACTIONS' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <Activity size={13} />
                <span>Tools</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('FACULTY');
                  loadTeachers();
                }}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'FACULTY' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <Users size={13} />
                <span>Faculty ({teachersList.length})</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('EMAIL');
                  loadTeachers();
                  fetchTelemetry();
                }}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'EMAIL' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <Mail size={13} />
                <span>Email & OTPs</span>
              </button>
              <button
                onClick={() => setActiveTab('DIAGNOSTICS')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'DIAGNOSTICS' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <Radio size={13} />
                <span>Sync</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('TELEMETRY');
                  fetchTelemetry();
                  loadStoreKeys();
                }}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'TELEMETRY' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <Database size={13} />
                <span>Telemetry</span>
              </button>
            </div>

            {successMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-medium flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                  <span>{successMsg}</span>
                </div>
                <button onClick={() => setSuccessMsg('')} className="text-emerald-600 hover:text-emerald-800">
                  <X size={14} />
                </button>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 text-xs font-medium flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className="text-rose-600 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
                <button onClick={() => setErrorMsg('')} className="text-rose-600 hover:text-rose-800">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* TAB 0: FULL LIVE FIREBASE STORAGE / FIRESTORE EXPLORER & EDITOR */}
            {activeTab === 'FIREBASE' && (
              <div className="space-y-4">
                {/* Summary & Top Controls */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <HardDrive size={16} className="text-blue-600" />
                        <span>Live Firebase Firestore Browser & Editor</span>
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5 font-mono">
                        Project: {firebaseMeta?.projectId || 'ota-smart-timetable'} · Docs: {firebaseDocs.length} · Size:{' '}
                        {(totalFirebaseBytes / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => loadFirebaseExplorer(selectedFirebaseDocKey, true)}
                        disabled={firebaseLoading}
                        className="px-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <RefreshCw size={13} className={firebaseLoading ? 'animate-spin' : ''} />
                        <span>Refresh from Firebase</span>
                      </button>
                      <button
                        onClick={handleStartNewDoc}
                        className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Plus size={14} />
                        <span>+ New Document</span>
                      </button>
                    </div>
                  </div>

                  {/* Collection Filters + Search */}
                  <div className="flex flex-col md:flex-row md:items-center gap-2 pt-2 border-t border-slate-100">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { id: 'ALL', label: `All (${firebaseDocs.length})` },
                          {
                            id: 'ota_app_store',
                            label: `ota_app_store (${firebaseCollectionStats['ota_app_store']?.count ?? 0})`,
                          },
                          {
                            id: 'schools',
                            label: `schools (${firebaseCollectionStats['schools']?.count ?? 0})`,
                          },
                          {
                            id: 'ota_sync_diagnostics',
                            label: `ota_sync_diagnostics (${firebaseCollectionStats['ota_sync_diagnostics']?.count ?? 0})`,
                          },
                        ] as const
                      ).map(col => (
                        <button
                          key={col.id}
                          onClick={() => setFirebaseCollectionFilter(col.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition whitespace-nowrap ${
                            firebaseCollectionFilter === col.id
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {col.label}
                        </button>
                      ))}
                    </div>
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                      <input
                        type="text"
                        value={firebaseSearch}
                        onChange={e => setFirebaseSearch(e.target.value)}
                        placeholder="Filter document IDs..."
                        className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Master-Detail Split Browser + JSON Editor */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  {/* Left Document List */}
                  <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-700">
                      <span className="flex items-center gap-1.5">
                        <FolderOpen size={14} className="text-blue-600" />
                        <span>Documents ({filteredFirebaseDocs.length})</span>
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">Live Firestore</span>
                    </div>
                    <div className="max-h-[450px] overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
                      {firebaseLoading && firebaseDocs.length === 0 ? (
                        <div className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                          <Loader2 size={15} className="animate-spin text-blue-600" />
                          <span>Loading Firestore documents...</span>
                        </div>
                      ) : filteredFirebaseDocs.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500">
                          No Firestore documents match this filter.
                        </div>
                      ) : (
                        filteredFirebaseDocs.map(docItem => {
                          const docKey = `${docItem.collection}/${docItem.id}`;
                          const isSelected = !isNewDocMode && selectedFirebaseDocKey === docKey;
                          return (
                            <button
                              key={docKey}
                              onClick={() => handleSelectFirebaseDoc(docItem)}
                              className={`w-full text-left px-3.5 py-2.5 transition flex flex-col gap-0.5 ${
                                isSelected ? 'bg-blue-50/90 border-r-2 border-blue-600' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`font-mono text-xs font-bold truncate ${isSelected ? 'text-blue-800' : 'text-slate-900'}`}>
                                  {docItem.id}
                                </span>
                                <span className="text-[10px] font-mono text-slate-500 shrink-0 tabular-nums">
                                  {(docItem.bytes / 1024).toFixed(1)} KB
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
                                <span className="truncate">{docItem.collection}</span>
                                <span className="shrink-0 tabular-nums">
                                  {docItem.itemCount} {docItem.itemCount === 1 ? 'item' : 'items'}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Right Live JSON Editor */}
                  <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
                    <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                      {isNewDocMode ? (
                        <div className="flex flex-wrap items-center gap-2 w-full">
                          <span className="text-xs font-bold text-blue-700">Create New Doc:</span>
                          <select
                            value={newDocCollection}
                            onChange={e => setNewDocCollection(e.target.value as any)}
                            className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-semibold text-slate-800 outline-none focus:border-blue-600"
                          >
                            <option value="ota_app_store">ota_app_store</option>
                            <option value="schools">schools</option>
                            <option value="ota_sync_diagnostics">ota_sync_diagnostics</option>
                          </select>
                          <input
                            type="text"
                            value={newDocId}
                            onChange={e => setNewDocId(e.target.value)}
                            placeholder="Document ID (letters, numbers, _ or -)"
                            className="flex-1 min-w-[180px] px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-800 outline-none focus:border-blue-600"
                          />
                        </div>
                      ) : activeFirebaseDoc ? (
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-bold text-slate-900 truncate flex items-center gap-1.5">
                            <Code2 size={14} className="text-blue-600 shrink-0" />
                            <span>
                              {activeFirebaseDoc.collection} / {activeFirebaseDoc.id}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                            {(activeFirebaseDoc.bytes / 1024).toFixed(2)} KB ·{' '}
                            {activeFirebaseDoc.updatedAt
                              ? `Updated ${new Date(activeFirebaseDoc.updatedAt).toLocaleString()}`
                              : 'Timestamp not set'}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500">Select a Firestore document or click "+ New Document"</div>
                      )}
                    </div>

                    {activeFirebaseDoc?.id === 'ota_server_vault_v1' && (
                      <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 font-medium">
                        Note: <span className="font-mono font-bold">ota_server_vault_v1</span> holds AES-encrypted credential hashes. Edit carefully.
                      </div>
                    )}

                    <div className="p-3 bg-slate-950 relative min-h-[330px] flex flex-col">
                      {firebaseDocLoading ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-sky-200 gap-2.5 py-12">
                          <Loader2 size={22} className="animate-spin text-sky-400" />
                          <span className="text-xs font-mono">Fetching single document from Cloud Firestore...</span>
                        </div>
                      ) : activeFirebaseDoc && !isNewDocMode && !largeDocExpanded ? (
                        <div className="flex-1 flex flex-col justify-between p-4 text-slate-100 space-y-4">
                          <div className="space-y-2">
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-400/30 text-amber-200 text-[11px] font-semibold">
                              <AlertTriangle size={13} />
                              <span>
                                Large Document Safeguard ({(activeFirebaseDoc.bytes / 1024).toFixed(1)} KB) — deferred raw text mount to keep UI instant
                              </span>
                            </div>
                            <div className="text-xs text-slate-300 font-mono leading-relaxed pt-1">
                              {Array.isArray(loadedDocData) ? (
                                <span>Array with {loadedDocData.length} item(s).</span>
                              ) : loadedDocData && typeof loadedDocData === 'object' ? (
                                <span>
                                  Object with {Object.keys(loadedDocData).length} top-level key(s):{' '}
                                  <span className="text-sky-300">
                                    {Object.keys(loadedDocData).slice(0, 12).join(', ')}
                                    {Object.keys(loadedDocData).length > 12 ? ', ...' : ''}
                                  </span>
                                </span>
                              ) : (
                                <span>Primitive payload ready.</span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-2">
                            <button
                              type="button"
                              onClick={() => applyLoadedDocToEditor(loadedDocData, activeFirebaseDoc.bytes, true)}
                              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center gap-1.5"
                            >
                              <Code2 size={14} />
                              <span>Load Full JSON in Editor ({(activeFirebaseDoc.bytes / 1024).toFixed(0)} KB)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const raw = JSON.stringify(loadedDocData ?? null, null, 2);
                                const blob = new Blob([raw], { type: 'application/json' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `${activeFirebaseDoc.collection}_${activeFirebaseDoc.id}.json`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                              }}
                              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold transition flex items-center gap-1.5"
                            >
                              <Download size={13} />
                              <span>Download JSON</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <textarea
                          value={editorJson}
                          onChange={e => handleEditorJsonChange(e.target.value)}
                          spellCheck={false}
                          placeholder="Select a document to view or edit its live JSON..."
                          disabled={!isNewDocMode && !activeFirebaseDoc}
                          className="w-full h-[330px] bg-slate-950 text-sky-100 font-mono text-xs leading-relaxed outline-none resize-y custom-scrollbar p-2"
                        />
                      )}
                    </div>

                    <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-medium">
                        {editorJsonError ? (
                          <span className="text-rose-600 font-semibold">{editorJsonError}</span>
                        ) : editorJson ? (
                          <span className="text-emerald-700 font-semibold">Valid JSON ready to save</span>
                        ) : loadedDocData !== undefined && !largeDocExpanded ? (
                          <span className="text-slate-600 font-medium">Click "Load Full JSON in Editor" to edit inline</span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleFormatEditorJson}
                          disabled={!editorJson || !largeDocExpanded}
                          className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 text-slate-700 rounded-lg text-xs font-semibold transition"
                        >
                          Format JSON
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const textToCopy = editorJson || (loadedDocData !== undefined ? JSON.stringify(loadedDocData, null, 2) : '');
                            if (!textToCopy) return;
                            navigator.clipboard.writeText(textToCopy);
                            setCopiedDocJson(true);
                            setTimeout(() => setCopiedDocJson(false), 2000);
                          }}
                          disabled={!editorJson && loadedDocData === undefined}
                          className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 text-slate-700 rounded-lg text-xs font-semibold transition flex items-center gap-1"
                        >
                          {copiedDocJson ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                          <span>{copiedDocJson ? 'Copied' : 'Copy JSON'}</span>
                        </button>
                        {activeFirebaseDoc && !isNewDocMode && (
                          <button
                            type="button"
                            onClick={() => {
                              const raw = editorJson || JSON.stringify(loadedDocData ?? null, null, 2);
                              const blob = new Blob([raw], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${activeFirebaseDoc.collection}_${activeFirebaseDoc.id}.json`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                            }}
                            disabled={loadedDocData === undefined && !editorJson}
                            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 text-slate-700 rounded-lg text-xs font-semibold transition flex items-center gap-1"
                          >
                            <Download size={12} />
                            <span>Download</span>
                          </button>
                        )}
                        {activeFirebaseDoc && !isNewDocMode && (
                          <>
                            {confirmDeleteDocKey === `${activeFirebaseDoc.collection}/${activeFirebaseDoc.id}` ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteFirebaseDoc(activeFirebaseDoc.collection, activeFirebaseDoc.id)}
                                  disabled={firebaseLoading}
                                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition"
                                >
                                  Confirm Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteDocKey(null)}
                                  className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteDocKey(`${activeFirebaseDoc.collection}/${activeFirebaseDoc.id}`)}
                                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold transition flex items-center gap-1"
                              >
                                <Trash2 size={12} />
                                <span>Delete Doc</span>
                              </button>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={handleSaveFirebaseDoc}
                          disabled={firebaseLoading || !!editorJsonError || (!isNewDocMode && (!activeFirebaseDoc || !largeDocExpanded))}
                          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap"
                        >
                          {firebaseLoading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                          <span>Save to Firebase</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 1: TOOLS & INTEGRITY */}
            {activeTab === 'ACTIONS' && (
              <div className="space-y-5">
                {/* 1-Click School Handover Preparation */}
                <div className="bg-gradient-to-br from-blue-50 via-white to-indigo-50/70 p-4 rounded-xl border border-blue-200 shadow-2xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <Sparkles size={16} className="text-blue-600" />
                        <span>1-Click Prepare App for School Handover</span>
                      </h4>
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                        Instantly sets the app + Cloud Firestore to a clean school launch state: resets schedule to{' '}
                        <strong className="text-slate-800">Draft #0</strong> (no published timetable yet), wipes{' '}
                        <strong className="text-slate-800">all inbox mails, swap requests, absences, chat & audit logs</strong>,
                        and keeps your classes, curriculum subjects, rooms & school settings intact.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePrepareSchoolReady}
                      disabled={isLoading}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
                    >
                      {isLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                      <span>Set School Ready (1-Click)</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-blue-100 text-[11px] text-slate-600">
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={schoolReadyClearTeachers}
                        onChange={e => setSchoolReadyClearTeachers(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>Also clear all registered teacher accounts (start with 0 teachers)</span>
                    </label>
                    <span className="text-blue-700 font-semibold">
                      {schoolReadyClearTeachers
                        ? 'Will wipe all teachers + pending signups'
                        : 'Keeps real faculty • purges synthetic test accounts'}
                    </span>
                  </div>
                </div>

                {/* Integrity Scanner */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <ShieldCheck size={16} className="text-blue-600" />
                        <span>System Integrity & Fake Account Scanner</span>
                      </h4>
                      <p className="text-xs text-slate-500">
                        Audits Firestore & timetable for unapproved test accounts, clashes, orphaned slots, and stream issues.
                      </p>
                    </div>
                    <button
                      onClick={handleScanIntegrity}
                      disabled={isLoading}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                      <span>Scan System Integrity</span>
                    </button>
                  </div>

                  {integrityReport && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg">
                          <span className="text-[10px] text-slate-500 block">Teachers</span>
                          <span className="font-bold text-slate-900 tabular-nums">{integrityReport.summary.teachers}</span>
                        </div>
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg">
                          <span className="text-[10px] text-slate-500 block">Double-Bookings</span>
                          <span className="font-bold text-slate-900 tabular-nums">
                            {integrityReport.summary.teacherDoubleBookings + integrityReport.summary.roomDoubleBookings}
                          </span>
                        </div>
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg">
                          <span className="text-[10px] text-slate-500 block">Orphaned Slots</span>
                          <span className="font-bold text-slate-900 tabular-nums">{integrityReport.summary.orphanedSlots}</span>
                        </div>
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg">
                          <span className="text-[10px] text-slate-500 block">Stream Issues</span>
                          <span className="font-bold text-slate-900 tabular-nums">{integrityReport.summary.streamViolations}</span>
                        </div>
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg">
                          <span className="text-[10px] text-slate-500 block">Pending Review</span>
                          <span className="font-bold text-slate-900 tabular-nums">{integrityReport.summary.pendingApprovals}</span>
                        </div>
                      </div>

                      {integrityReport.issues.length === 0 ? (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-800">
                          Zero integrity issues detected across faculty, classes, rooms, and timetable slots.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {integrityReport.issues.map((issue, idx) => (
                            <div
                              key={idx}
                              className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                                issue.severity === 'HIGH'
                                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                                  : issue.severity === 'MEDIUM'
                                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                                    : 'bg-blue-50 border-blue-200 text-blue-900'
                              }`}
                            >
                              <div>
                                <span className="font-bold mr-2">[{issue.category}]</span>
                                <span>{issue.message}</span>
                              </div>
                              <span className="px-2 py-0.5 rounded-md bg-white/80 font-mono text-[10px] font-bold shrink-0">
                                {issue.severity}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                    <button
                      onClick={handlePurgeFakeTeachers}
                      disabled={isLoading}
                      className="px-3 py-2.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold transition flex items-center justify-center gap-1.5"
                    >
                      <UserX size={14} />
                      <span>Purge Fake/Test Teachers</span>
                    </button>
                    <button
                      onClick={handleFixStreamViolations}
                      disabled={isLoading}
                      className="px-3 py-2.5 rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-900 text-xs font-bold transition flex items-center justify-center gap-1.5"
                    >
                      <Sparkles size={14} />
                      <span>Clean Stream Violations</span>
                    </button>
                    <button
                      onClick={handlePurgeOrphanedTeachers}
                      disabled={isLoading}
                      className="px-3 py-2.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold transition flex items-center justify-center gap-1.5"
                    >
                      <Users size={14} />
                      <span>Purge Orphaned Slots</span>
                    </button>
                  </div>
                </div>

                {/* Selective Resets */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2.5">
                  <label className="text-xs font-bold text-slate-700 block">Selective Data Resets</label>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <button
                      onClick={() => handleSelectivePurge('timetable')}
                      disabled={isLoading}
                      className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                    >
                      <RotateCcw size={13} className="text-blue-600" />
                      <span>Reset Grid</span>
                    </button>
                    <button
                      onClick={() => handleSelectivePurge('draft')}
                      disabled={isLoading}
                      className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                    >
                      <X size={13} className="text-slate-600" />
                      <span>Discard Draft</span>
                    </button>
                    <button
                      onClick={() => handleSelectivePurge('requests')}
                      disabled={isLoading}
                      className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                    >
                      <Clock size={13} className="text-indigo-600" />
                      <span>Clear Requests</span>
                    </button>
                    <button
                      onClick={() => handleSelectivePurge('teachers')}
                      disabled={isLoading}
                      className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                    >
                      <Trash2 size={13} className="text-amber-600" />
                      <span>Clear Teachers</span>
                    </button>
                    <button
                      onClick={() => handleSelectivePurge('logs')}
                      disabled={isLoading}
                      className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                    >
                      <BookOpen size={13} className="text-slate-600" />
                      <span>Clear Logs</span>
                    </button>
                  </div>
                </div>

                {/* Sync, Backup & Restore */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2.5">
                  <label className="text-xs font-bold text-slate-700 block">Cloud Firestore Sync & Backup</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      onClick={() => handleForceSync('pull')}
                      disabled={isLoading}
                      className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                      <span>Pull Firestore</span>
                    </button>
                    <button
                      onClick={() => handleForceSync('push')}
                      disabled={isLoading}
                      className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5"
                    >
                      <Upload size={13} />
                      <span>Push to Firestore</span>
                    </button>
                    <button
                      onClick={handleDownloadBackup}
                      disabled={isLoading}
                      className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5"
                    >
                      <Download size={13} />
                      <span>Download JSON</span>
                    </button>
                    <label className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer">
                      <Upload size={13} />
                      <span>Restore JSON</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleRestoreFile}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="p-4 rounded-xl bg-rose-50/70 border border-rose-200 space-y-3">
                  <div>
                    <h4 className="font-bold text-sm text-rose-950 flex items-center gap-1.5">
                      <ShieldAlert size={16} className="text-rose-600" />
                      <span>Factory Reset System</span>
                    </h4>
                    <p className="text-xs text-rose-800/80 mt-1 leading-relaxed">
                      Wipes all timetables, teachers, requests, and resets Cloud Firestore to a clean institutional baseline.
                    </p>
                  </div>

                  {!confirmWipe ? (
                    <button
                      onClick={() => setConfirmWipe(true)}
                      disabled={isLoading}
                      className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg transition flex items-center justify-center gap-2"
                    >
                      <Trash2 size={14} />
                      <span>Factory Reset System</span>
                    </button>
                  ) : (
                    <div className="space-y-2 pt-2 border-t border-rose-200">
                      <p className="text-xs font-bold text-rose-900">Confirm permanent wipe across all devices?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleExecuteWipe}
                          disabled={isLoading}
                          className="flex-1 py-2 bg-rose-700 hover:bg-rose-800 text-white font-bold text-xs rounded-lg transition flex items-center justify-center gap-1.5"
                        >
                          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          <span>Yes, Delete Everything</span>
                        </button>
                        <button
                          onClick={() => setConfirmWipe(false)}
                          disabled={isLoading}
                          className="px-4 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold text-xs rounded-lg transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: FACULTY & AUTH */}
            {activeTab === 'FACULTY' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Search faculty by name, @username, or email..."
                      value={teacherSearch}
                      onChange={e => setTeacherSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(['ALL', 'PENDING', 'APPROVED'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setFacultyFilter(f)}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                          facultyFilter === f
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {f === 'ALL' ? 'All' : f === 'PENDING' ? 'Pending' : 'Approved'}
                      </button>
                    ))}
                    <button
                      onClick={loadTeachers}
                      className="p-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg transition"
                      title="Refresh Faculty"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5 max-h-[400px] overflow-y-auto custom-scrollbar pr-0.5">
                  {filteredTeachers.map(t => {
                    const recoveryCode = t.recoveryCode || 'NOT_SET';
                    const isCopied = copiedCodeId === t.id;
                    const isPending = !t.isApproved && t.approvalStatus !== 'REJECTED';
                    const isEditingPass = passwordEditTeacherId === t.id;
                    const isConfirmingDelete = confirmDeleteTeacherId === t.id;

                    return (
                      <div key={t.id} className="p-4 bg-white rounded-xl border border-slate-200 space-y-3 text-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-slate-900 text-sm">{t.name}</span>
                              <span className="text-slate-500 font-mono">@{t.username}</span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                  t.isApproved
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : t.approvalStatus === 'REJECTED'
                                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {t.isApproved ? 'Approved' : t.approvalStatus === 'REJECTED' ? 'Rejected' : 'Pending'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-1">
                              {t.contactEmail ? t.contactEmail : 'No email'} · {t.subjectsTaught?.length || 0} subjects ·{' '}
                              {t.assignedClasses?.length || 0} classes
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="px-2.5 py-1.5 bg-slate-900 text-purple-200 font-mono font-bold rounded-lg tracking-wider text-[11px]">
                              {recoveryCode}
                            </div>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(recoveryCode);
                                setCopiedCodeId(t.id);
                                setTimeout(() => setCopiedCodeId(null), 2000);
                              }}
                              className="p-1.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 transition"
                              title="Copy Recovery Code"
                            >
                              {isCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                            </button>
                            <button
                              onClick={() => handleRegenerateRecoveryCode(t.id)}
                              className="px-2.5 py-1.5 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-800 rounded-lg font-semibold text-[11px] transition"
                              title="Regenerate Recovery Code"
                            >
                              New Code
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                          {!t.isApproved && (
                            <button
                              onClick={() => handleTeacherAction(t.id, 'APPROVE')}
                              disabled={isLoading}
                              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-[11px] flex items-center gap-1 transition"
                            >
                              <UserCheck size={13} />
                              <span>Approve</span>
                            </button>
                          )}
                          {isPending && (
                            <button
                              onClick={() => handleTeacherAction(t.id, 'REJECT')}
                              disabled={isLoading}
                              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg font-semibold text-[11px] flex items-center gap-1 transition"
                            >
                              <UserX size={13} />
                              <span>Reject</span>
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setPasswordEditTeacherId(isEditingPass ? null : t.id);
                              setNewTeacherPassword('');
                            }}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-[11px] flex items-center gap-1 transition"
                          >
                            <Key size={12} />
                            <span>Set Password</span>
                          </button>
                          <button
                            onClick={() => handleTeacherAction(t.id, 'RESET_ONBOARDING')}
                            disabled={isLoading}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-[11px] flex items-center gap-1 transition"
                          >
                            <RotateCcw size={12} />
                            <span>Reset Setup</span>
                          </button>

                          {!isConfirmingDelete ? (
                            <button
                              onClick={() => setConfirmDeleteTeacherId(t.id)}
                              className="ml-auto px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-semibold text-[11px] flex items-center gap-1 transition"
                            >
                              <Trash2 size={12} />
                              <span>Delete</span>
                            </button>
                          ) : (
                            <div className="ml-auto flex items-center gap-1.5">
                              <button
                                onClick={() => handleTeacherAction(t.id, 'DELETE')}
                                disabled={isLoading}
                                className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-[11px]"
                              >
                                Confirm Delete
                              </button>
                              <button
                                onClick={() => setConfirmDeleteTeacherId(null)}
                                className="px-2.5 py-1.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-[11px]"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>

                        {isEditingPass && (
                          <div className="flex items-center gap-2 pt-2">
                            <input
                              type="text"
                              value={newTeacherPassword}
                              onChange={e => setNewTeacherPassword(e.target.value)}
                              placeholder="Enter new password (min 6 chars)"
                              className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-800 outline-none focus:border-blue-600"
                            />
                            <button
                              onClick={() =>
                                handleTeacherAction(t.id, 'SET_PASSWORD', { newPassword: newTeacherPassword })
                              }
                              disabled={isLoading || newTeacherPassword.length < 6}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-bold text-xs"
                            >
                              Save Password
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {filteredTeachers.length === 0 && (
                    <div className="p-8 text-center text-slate-500 text-xs bg-white border border-dashed border-slate-200 rounded-xl">
                      No faculty members match the current filter.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: EMAIL & REGISTRATION OTPS */}
            {activeTab === 'EMAIL' && (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Email Transport & Delivery Test</h4>
                      <p className="text-xs text-slate-500">
                        Verify live OTP email dispatch and inspect active sender configuration.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      <span
                        className={`px-2 py-1 rounded-md border ${
                          telemetry?.emailConfigured?.resend
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        Resend: {telemetry?.emailConfigured?.resend ? 'Ready' : 'Unset'}
                      </span>
                      <span
                        className={`px-2 py-1 rounded-md border ${
                          telemetry?.emailConfigured?.smtp
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        SMTP: {telemetry?.emailConfigured?.smtp ? 'Ready' : 'Unset'}
                      </span>
                    </div>
                  </div>

                  <form onSubmit={handleSendTestEmail} className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      value={testEmailTarget}
                      onChange={e => setTestEmailTarget(e.target.value)}
                      placeholder="recipient@example.com"
                      required
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none focus:border-blue-600"
                    />
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      <span>Send Test Email</span>
                    </button>
                  </form>

                  {emailDiagnosticResult && (
                    <div
                      className={`p-3 rounded-lg border text-xs font-medium ${
                        emailDiagnosticResult.success
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                    >
                      {emailDiagnosticResult.message}
                    </div>
                  )}
                </div>

                {/* Pending Email Verifications */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Pending Registration Verification Codes</h4>
                      <p className="text-xs text-slate-500">
                        Active 6-digit OTPs waiting to be confirmed during faculty signup.
                      </p>
                    </div>
                    <button
                      onClick={loadTeachers}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1"
                    >
                      <RefreshCw size={12} />
                      <span>Refresh</span>
                    </button>
                  </div>

                  {pendingVerifications.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                      No pending email verification OTPs right now.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {pendingVerifications.map(item => {
                        const minsLeft = Math.max(1, Math.round((item.expiresAt - Date.now()) / 60000));
                        const isCopied = copiedCodeId === `otp_${item.email}`;
                        return (
                          <div
                            key={item.email}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <div className="font-bold text-slate-900">
                                {item.name} <span className="font-mono text-slate-500">@{item.username}</span>
                              </div>
                              <div className="text-slate-600">{item.email}</div>
                              <div className="text-[11px] text-slate-400">Expires in ~{minsLeft} min</div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="px-3 py-1.5 bg-slate-900 text-emerald-300 font-mono font-bold rounded-lg tracking-widest">
                                {item.code}
                              </span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(item.code);
                                  setCopiedCodeId(`otp_${item.email}`);
                                  setTimeout(() => setCopiedCodeId(null), 2000);
                                }}
                                className="p-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600"
                                title="Copy OTP"
                              >
                                {isCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                              </button>
                              <button
                                onClick={() => handleDeletePendingVerification(item.email)}
                                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-semibold text-[11px]"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: SYNC DIAGNOSTICS */}
            {activeTab === 'DIAGNOSTICS' && (
              <div className="space-y-4">
                <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
                  <div className="font-bold flex items-center gap-1.5 mb-1">
                    <Radio size={14} className="text-blue-600" />
                    <span>Real-Time Cloud Diagnostics</span>
                  </div>
                  <span>
                    Monitor live multi-device channel pings, network latency, Firestore synchronization state, and inspect recent sync logs.
                  </span>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <SyncDiagnostics />
                </div>
              </div>
            )}

            {/* TAB 5: TELEMETRY & STORE INSPECTOR */}
            {activeTab === 'TELEMETRY' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Status</span>
                    <span className="font-bold text-emerald-700 mt-0.5 block">{telemetry?.status || 'ONLINE'}</span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Uptime</span>
                    <span className="font-mono font-bold text-slate-800 mt-0.5 block tabular-nums">
                      {telemetry?.uptimeSeconds
                        ? `${Math.floor(telemetry.uptimeSeconds / 60)}m ${Math.floor(telemetry.uptimeSeconds % 60)}s`
                        : 'Active'}
                    </span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Faculty</span>
                    <span className="font-bold text-slate-900 text-sm mt-0.5 block tabular-nums">
                      {telemetry?.teacherCount ?? '—'} ({telemetry?.pendingApprovals ?? 0} pending)
                    </span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Live SSE Clients</span>
                    <span className="font-bold text-blue-600 text-sm mt-0.5 block tabular-nums">
                      {telemetry?.sseClients ?? '—'}
                    </span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Classes</span>
                    <span className="font-bold text-slate-900 text-sm mt-0.5 block tabular-nums">
                      {telemetry?.classCount ?? '—'}
                    </span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Subjects</span>
                    <span className="font-bold text-slate-900 text-sm mt-0.5 block tabular-nums">
                      {telemetry?.subjectCount ?? '—'}
                    </span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Scheduled Arms</span>
                    <span className="font-bold text-slate-900 text-sm mt-0.5 block tabular-nums">
                      {telemetry?.timetableClasses ?? '—'}
                    </span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Requests / OTPs</span>
                    <span className="font-bold text-slate-900 text-sm mt-0.5 block tabular-nums">
                      {telemetry?.requestCount ?? 0} req · {telemetry?.pendingVerifications ?? 0} otp
                    </span>
                  </div>
                </div>

                {/* Store Key Inspector */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <FileJson size={15} className="text-blue-600" />
                        <span>Live Firestore Store Key Inspector</span>
                      </h4>
                      <p className="text-xs text-slate-500">
                        Project: {telemetry?.projectId || 'ota-smart-timetable'} · Version: {telemetry?.storeVersion || '—'}
                      </p>
                    </div>
                    <button
                      onClick={loadStoreKeys}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1"
                    >
                      <RefreshCw size={12} />
                      <span>Reload Keys</span>
                    </button>
                  </div>

                  {storeKeys.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-5 space-y-1 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                        {storeKeys.map(k => (
                          <button
                            key={k.key}
                            onClick={() => setSelectedStoreKey(k.key)}
                            className={`w-full text-left px-2.5 py-2 rounded-lg border text-xs transition ${
                              activeStoreKeyObj?.key === k.key
                                ? 'bg-blue-50 border-blue-300 text-blue-900 font-bold'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <div className="truncate font-mono text-[11px]">{k.key}</div>
                            <div className="text-[10px] text-slate-500 font-normal tabular-nums">
                              {k.count} item(s) · {(k.bytes / 1024).toFixed(1)} KB
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="sm:col-span-7 bg-slate-900 text-slate-200 rounded-lg p-3 flex flex-col max-h-[220px]">
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[11px]">
                          <span className="font-mono text-blue-300 truncate">{activeStoreKeyObj?.key}</span>
                          {activeStoreKeyObj && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(activeStoreKeyObj.preview);
                                setCopiedStoreKey(activeStoreKeyObj.key);
                                setTimeout(() => setCopiedStoreKey(null), 2000);
                              }}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md flex items-center gap-1 text-[10px]"
                            >
                              {copiedStoreKey === activeStoreKeyObj.key ? <Check size={11} /> : <Copy size={11} />}
                              <span>{copiedStoreKey === activeStoreKeyObj.key ? 'Copied' : 'Copy'}</span>
                            </button>
                          )}
                        </div>
                        <pre className="text-[11px] font-mono overflow-auto custom-scrollbar whitespace-pre-wrap break-all flex-1 text-slate-300">
                          {activeStoreKeyObj?.preview || 'Select a key to preview'}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
              <span className="truncate">Firestore DB: ai-studio-otasmarttimetabl-5b72f609</span>
              <button
                onClick={onClose}
                className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg transition whitespace-nowrap shrink-0"
              >
                Close Console
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
