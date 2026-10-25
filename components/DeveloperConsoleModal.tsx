import React, { useState, useEffect, useRef } from 'react';
import { 
  Lock, Trash2, RefreshCw, Download, Upload, AlertTriangle, 
  CheckCircle2, X, Eye, EyeOff, Loader2, RotateCcw, 
  Sparkles, Activity, ShieldAlert, BookOpen, Users, Database,
  Key, Copy, Check, Search, Radio
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
  subjectCount: number;
  timetableClasses: number;
  projectId: string;
  databaseId: string;
}

export const DeveloperConsoleModal: React.FC<DeveloperConsoleModalProps> = ({
  isOpen,
  onClose,
  onSystemResetCompleted
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [activeTab, setActiveTab] = useState<'ACTIONS' | 'DIAGNOSTICS' | 'RECOVERY_CODES' | 'TELEMETRY'>('ACTIONS');
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setPassword('');
      setErrorMsg('');
      setSuccessMsg('');
      setConfirmWipe(false);
      setIsAuthenticated(false);
      setTelemetry(null);
      setActiveTab('ACTIONS');
      setTeacherSearch('');
      setCopiedCodeId(null);
    } else {
      setTeachersList(storage.getTeachers());
    }
  }, [isOpen]);

  const loadTeachers = () => {
    setTeachersList(storage.getTeachers());
  };

  const handleRegenerateRecoveryCode = (teacherId: string) => {
    const list = storage.getTeachers();
    const idx = list.findIndex(t => t.id === teacherId);
    if (idx !== -1) {
      const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      list[idx].recoveryCode = newCode;
      storage.saveTeacher(list[idx]);
      setTeachersList([...list]);
      setSuccessMsg(`Generated new recovery code for ${list[idx].name}: ${newCode}`);
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  const fetchTelemetry = async () => {
    try {
      const res = await fetch('/api/developer/telemetry?password=proxonline26');
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
      }
    } catch {}
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (password.trim() === 'proxonline26') {
      setIsAuthenticated(true);
      setErrorMsg('');
      fetchTelemetry();
    } else {
      setErrorMsg('Incorrect developer password.');
    }
  };

  // 1. Delete All App Data (Factory Reset)
  const handleExecuteWipe = async () => {
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      try {
        const res = await fetch('/api/developer/reset-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'proxonline26' })
        });
        if (!res.ok) {
          await fetch('/api/sync/reset', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-developer-password': 'proxonline26'
            },
            body: JSON.stringify({ password: 'proxonline26' })
          });
        }
      } catch (networkErr) {
        console.warn('Server reset fetch failed, proceeding with client reset:', networkErr);
      }

      storage.resetSystem();
      try {
        localStorage.clear();
      } catch (e) {
        console.warn('localStorage clear note:', e);
      }

      setSuccessMsg('All application data has been wiped. Reloading fresh...');
      if (onSystemResetCompleted) {
        onSystemResetCompleted();
      }

      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to complete reset.');
      setIsLoading(false);
    }
  };

  // 2. Fix Stream Violations: Remove Yoruba/Economics from Science Classes
  const handleFixStreamViolations = async () => {
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/developer/fix-stream-violations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'proxonline26' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to apply stream fix');
      }

      // Also sanitize local timetable in localStorage
      const localGrid = storage.getTimetable();
      if (localGrid) {
        const sanitized = storage.sanitizeTimetableGrid(localGrid);
        localStorage.setItem('ota_timetable_v2', JSON.stringify(sanitized));
      }

      // Filter out rogue subjects locally
      const localSubs = storage.getSubjects();
      const cleanedSubs = localSubs.filter(s => s.id !== 'eco_sci' && s.id !== 'yor_sci');
      localStorage.setItem('ota_subjects_v2', JSON.stringify(cleanedSubs));

      setSuccessMsg(data.message || `Stream fix applied: removed ${data.cleanedSlots || 0} BC subjects from Science classes.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      fetchTelemetry();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to clean stream violations.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Purge Orphaned / Ghost Teachers
  const handlePurgeOrphanedTeachers = async () => {
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/developer/purge-orphaned-teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'proxonline26' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to purge orphaned teachers');
      }

      setSuccessMsg(data.message || `Purged ${data.purgedCount || 0} ghost teacher slot assignments.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      fetchTelemetry();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to purge orphaned teachers.');
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Selective Purge
  const handleSelectivePurge = async (target: 'timetable' | 'teachers' | 'logs') => {
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/developer/selective-purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'proxonline26', target })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Purge failed');
      }

      if (target === 'timetable') {
        localStorage.removeItem('ota_timetable_v2');
        localStorage.removeItem('ota_history_v2');
      } else if (target === 'teachers') {
        localStorage.removeItem('ota_teachers_v3');
      } else if (target === 'logs') {
        localStorage.removeItem('ota_audit_logs_v1');
        localStorage.removeItem('ota_chat_messages');
        localStorage.removeItem('ota_notifications_v2');
      }

      setSuccessMsg(`Successfully cleared ${target}.`);
      setTimeout(() => setSuccessMsg(''), 3000);
      fetchTelemetry();
    } catch (err: any) {
      setErrorMsg(err.message || 'Action failed');
    } finally {
      setIsLoading(false);
    }
  };

  // 5. Force Cloud Re-Sync
  const handleForceSync = async () => {
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/developer/force-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'proxonline26', direction: 'pull' })
      });
      if (res.ok) {
        await storage.forceSync();
        setSuccessMsg('Cloud Firestore synchronization complete.');
        setTimeout(() => setSuccessMsg(''), 3000);
        fetchTelemetry();
      } else {
        throw new Error('Sync failed');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Sync error');
    } finally {
      setIsLoading(false);
    }
  };

  // 6. Download System Backup JSON
  const handleDownloadBackup = async () => {
    try {
      const res = await fetch('/api/sync/store');
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
      setSuccessMsg('Backup JSON downloaded successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {
      setErrorMsg('Failed to download backup.');
    }
  };

  // 7. Restore Master Backup from File
  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

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
        body: JSON.stringify({ password: 'proxonline26', keys })
      });

      if (!res.ok) {
        throw new Error('Server rejected backup restore payload.');
      }

      // Update client local storage with restored keys
      Object.keys(keys).forEach(k => {
        const val = keys[k];
        if (typeof val === 'string') localStorage.setItem(k, val);
        else localStorage.setItem(k, JSON.stringify(val));
      });

      setSuccessMsg('Backup restored successfully! Reloading...');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to restore backup file.');
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <Lock size={15} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                Developer Maintenance Console
                <span className="text-[10px] font-mono bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded">v2.6</span>
              </h3>
              <p className="text-[11px] text-slate-400">Master database controls & maintenance</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        {!isAuthenticated ? (
          <form onSubmit={handleVerify} className="p-6 space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Enter the master developer password to unlock maintenance and data controls:
            </p>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Developer password"
                autoFocus
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-800 outline-none focus:border-blue-600 transition"
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
              <div className="p-2.5 rounded-lg bg-red-50 text-red-600 text-xs font-medium flex items-center gap-2">
                <AlertTriangle size={14} />
                {errorMsg}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white transition shadow-sm"
              >
                Unlock Console
              </button>
            </div>
          </form>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
            
            {/* Tab Selector */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto">
              <button
                onClick={() => setActiveTab('ACTIONS')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 whitespace-nowrap ${
                  activeTab === 'ACTIONS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Activity size={13} /> Tools
              </button>
              <button
                onClick={() => setActiveTab('DIAGNOSTICS')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 whitespace-nowrap ${
                  activeTab === 'DIAGNOSTICS' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Radio size={13} /> Sync Diagnostics
              </button>
              <button
                onClick={() => { setActiveTab('RECOVERY_CODES'); loadTeachers(); }}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 whitespace-nowrap ${
                  activeTab === 'RECOVERY_CODES' ? 'bg-white text-purple-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Key size={13} /> Recovery Codes
              </button>
              <button
                onClick={() => { setActiveTab('TELEMETRY'); fetchTelemetry(); }}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 whitespace-nowrap ${
                  activeTab === 'TELEMETRY' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Database size={13} /> Telemetry
              </button>
            </div>

            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                {successMsg}
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-50 text-red-700 border border-red-200 text-xs font-medium flex items-center gap-2">
                <AlertTriangle size={15} className="text-red-600 shrink-0" />
                {errorMsg}
              </div>
            )}

            {activeTab === 'ACTIONS' && (
              <>
                {/* 1. Critical Curriculm & Integrity Fixes */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Curriculum & Faculty Integrity Fixes
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      onClick={handleFixStreamViolations}
                      disabled={isLoading}
                      className="p-3.5 rounded-xl border border-purple-200 bg-purple-50/50 hover:bg-purple-100/60 text-left transition group"
                    >
                      <div className="text-xs font-black text-purple-900 flex items-center gap-1.5">
                        <Sparkles size={14} className="text-purple-600" />
                        Clean Stream Violations
                      </div>
                      <div className="text-[10px] text-purple-700/80 mt-1 leading-tight">
                        Removes Yoruba & Economics from all Science ("A") classes and syncs across all devices.
                      </div>
                    </button>

                    <button
                      onClick={handlePurgeOrphanedTeachers}
                      disabled={isLoading}
                      className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/50 hover:bg-blue-100/60 text-left transition group"
                    >
                      <div className="text-xs font-black text-blue-900 flex items-center gap-1.5">
                        <Users size={14} className="text-blue-600" />
                        Purge Orphaned Teachers
                      </div>
                      <div className="text-[10px] text-blue-700/80 mt-1 leading-tight">
                        Scans timetable slots and clears references to deleted teachers so they never resurrect.
                      </div>
                    </button>
                  </div>
                </div>

                {/* 2. Selective Resets */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Selective Reset Controls
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      onClick={() => handleSelectivePurge('timetable')}
                      disabled={isLoading}
                      className="p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition"
                    >
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <RotateCcw size={13} className="text-blue-600" />
                        Reset Timetable
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Clears schedule grid only</div>
                    </button>

                    <button
                      onClick={() => handleSelectivePurge('teachers')}
                      disabled={isLoading}
                      className="p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition"
                    >
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Trash2 size={13} className="text-amber-600" />
                        Reset Teachers
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Clears registered teachers</div>
                    </button>

                    <button
                      onClick={() => handleSelectivePurge('logs')}
                      disabled={isLoading}
                      className="p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition"
                    >
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <BookOpen size={13} className="text-indigo-600" />
                        Clear Audit Logs
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Clears logs & notifications</div>
                    </button>
                  </div>
                </div>

                {/* 3. Cloud Sync & Backup / Restore */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Database, Backup & Restore
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      onClick={handleForceSync}
                      disabled={isLoading}
                      className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                      Force Cloud Sync
                    </button>

                    <button
                      onClick={handleDownloadBackup}
                      disabled={isLoading}
                      className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
                    >
                      <Download size={13} />
                      Download Backup
                    </button>

                    <label className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer">
                      <Upload size={13} />
                      Restore JSON
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

                {/* 4. Danger Zone: Factory Reset */}
                <div className="p-4 rounded-xl bg-red-50/70 border border-red-200 space-y-3">
                  <div>
                    <h4 className="font-bold text-sm text-red-950 flex items-center gap-1.5">
                      <ShieldAlert size={16} className="text-red-600" />
                      Factory Reset System
                    </h4>
                    <p className="text-xs text-red-800/80 mt-1 leading-relaxed">
                      Permanently wipes all timetables, teachers, classes, subjects, and resets both server disk store and Cloud Firestore to a fresh factory baseline.
                    </p>
                  </div>

                  {!confirmWipe ? (
                    <button
                      onClick={() => setConfirmWipe(true)}
                      disabled={isLoading}
                      className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2"
                    >
                      <Trash2 size={14} />
                      Factory Reset System
                    </button>
                  ) : (
                    <div className="space-y-2 pt-1 border-t border-red-200/80">
                      <p className="text-xs font-bold text-red-900">
                        Are you sure? This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleExecuteWipe}
                          disabled={isLoading}
                          className="flex-1 py-2 bg-red-700 hover:bg-red-800 text-white font-bold text-xs rounded-lg transition flex items-center justify-center gap-1.5"
                        >
                          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          Yes, Delete Everything
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
              </>
            )}

            {activeTab === 'DIAGNOSTICS' && (
              <div className="space-y-4">
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
                  <div className="font-bold flex items-center gap-1.5 mb-1">
                    <Radio size={14} className="text-blue-600 animate-pulse" />
                    <span>Real-Time Cloud Diagnostics Console</span>
                  </div>
                  <span>Monitor live multi-device channel pings, network latency, Firestore synchronization state, and inspect recent cloud sync error logs.</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-2xl border border-slate-200">
                  <SyncDiagnostics />
                </div>
              </div>
            )}

            {activeTab === 'RECOVERY_CODES' && (
              <div className="space-y-4">
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900">
                  <div className="font-bold flex items-center gap-1.5 mb-1">
                    <Key size={14} className="text-purple-600" />
                    <span>Faculty Access & Account Recovery Codes</span>
                  </div>
                  <span>Confidential developer escrow. These emergency recovery codes allow developers and super-administrators to recover locked faculty accounts. Teachers cannot view these codes.</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Search faculty by name or username..."
                      value={teacherSearch}
                      onChange={e => setTeacherSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <button
                    onClick={loadTeachers}
                    className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1"
                    title="Refresh List"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>

                <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar">
                  {teachersList
                    .filter(t => !teacherSearch || (t.name || '').toLowerCase().includes(teacherSearch.toLowerCase()) || (t.username || '').toLowerCase().includes(teacherSearch.toLowerCase()))
                    .map(t => {
                      const recoveryCode = t.recoveryCode || 'NOT_SET';
                      const isCopied = copiedCodeId === t.id;

                      return (
                        <div key={t.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-sm">{t.name}</span>
                              <span className="text-slate-400 font-mono">@{t.username}</span>
                              <span className={`px-2 py-0.2 rounded-full text-[10px] font-bold uppercase ${
                                t.isApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                              }`}>
                                {t.isApproved ? 'Approved' : 'Pending'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {t.contactEmail ? `Email: ${t.contactEmail}` : 'No email attached'} • Classes: {t.assignedClasses?.length || 0}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="px-3 py-1.5 bg-slate-900 text-purple-300 font-mono font-bold rounded-lg tracking-widest text-xs border border-slate-700">
                              {recoveryCode}
                            </div>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(recoveryCode);
                                setCopiedCodeId(t.id);
                                setTimeout(() => setCopiedCodeId(null), 2000);
                              }}
                              className="p-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 transition"
                              title="Copy Recovery Code"
                            >
                              {isCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                            </button>
                            <button
                              onClick={() => handleRegenerateRecoveryCode(t.id)}
                              className="px-2.5 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg font-bold text-[11px] transition"
                              title="Regenerate new recovery code"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      );
                    })}

                  {teachersList.length === 0 && (
                    <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
                      No faculty members registered in system.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'TELEMETRY' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Server Status</span>
                    <span className="font-extrabold text-emerald-600 flex items-center gap-1.5 mt-0.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      {telemetry?.status || 'ONLINE'}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Server Uptime</span>
                    <span className="font-mono font-bold text-slate-800 mt-0.5 block">
                      {telemetry?.uptimeSeconds ? `${Math.floor(telemetry.uptimeSeconds / 60)}m ${Math.floor(telemetry.uptimeSeconds % 60)}s` : 'Active'}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Faculty Registered</span>
                    <span className="font-black text-slate-900 text-base mt-0.5 block">
                      {telemetry?.teacherCount ?? '—'} Teachers
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Classes Configured</span>
                    <span className="font-black text-slate-900 text-base mt-0.5 block">
                      {telemetry?.classCount ?? '—'} Classes
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Curriculum Subjects</span>
                    <span className="font-black text-slate-900 text-base mt-0.5 block">
                      {telemetry?.subjectCount ?? '—'} Subjects
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Timetable Grid Arms</span>
                    <span className="font-black text-blue-600 text-base mt-0.5 block">
                      {telemetry?.timetableClasses ?? '—'} Arms Scheduled
                    </span>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-900 text-slate-300 rounded-xl text-xs space-y-1 font-mono">
                  <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Firestore Configuration</div>
                  <div className="truncate"><span className="text-slate-400">Project:</span> {telemetry?.projectId || 'ota-smart-timetable'}</div>
                  <div className="truncate"><span className="text-slate-400">Database:</span> {telemetry?.databaseId || 'ai-studio-otasmarttimetabl-...'}</div>
                  <div><span className="text-slate-400">Store Version:</span> {telemetry?.storeVersion || Date.now()}</div>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span>Database: ai-studio-otasmarttimetabl-...</span>
              <button
                onClick={onClose}
                className="font-bold text-slate-600 hover:text-slate-900 transition"
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
