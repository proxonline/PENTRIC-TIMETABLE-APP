import React, { useState, useEffect } from 'react';
import { 
  Lock, Trash2, RefreshCw, Download, AlertTriangle, 
  CheckCircle2, X, Eye, EyeOff, Loader2, RotateCcw
} from 'lucide-react';
import { storage } from '../services/storage';

interface DeveloperConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSystemResetCompleted?: () => void;
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

  useEffect(() => {
    if (!isOpen) {
      setPassword('');
      setErrorMsg('');
      setSuccessMsg('');
      setConfirmWipe(false);
      setIsAuthenticated(false);
    }
  }, [isOpen]);

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (password.trim() === 'proxonline26') {
      setIsAuthenticated(true);
      setErrorMsg('');
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
      // 1. Call server developer endpoint
      try {
        const res = await fetch('/api/developer/reset-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'proxonline26' })
        });
        if (!res.ok) {
          // Backup fallback to sync reset
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

      // 2. Clear client storage & system
      storage.resetSystem();
      try {
        localStorage.clear();
      } catch (e) {
        console.warn('localStorage clear note:', e);
      }

      setSuccessMsg('All app data has been deleted. Reloading...');
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

  // 2. Selective Purge
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

      setSuccessMsg(`Successfully reset ${target}.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Action failed');
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Force Cloud Re-Sync
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
      } else {
        throw new Error('Sync failed');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Sync error');
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Download System Backup JSON
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
      setSuccessMsg('Backup downloaded.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {
      setErrorMsg('Failed to download backup.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <Lock size={15} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Developer Settings</h3>
              <p className="text-[11px] text-slate-500">System maintenance & data controls</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        {!isAuthenticated ? (
          <form onSubmit={handleVerify} className="p-6 space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Enter the developer password to access data reset and system settings:
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
                Unlock
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-5">
            
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

            {/* Main Action: Delete All App Data */}
            <div className="p-4 rounded-xl bg-red-50/70 border border-red-200 space-y-3">
              <div>
                <h4 className="font-bold text-sm text-red-950 flex items-center gap-1.5">
                  <Trash2 size={16} className="text-red-600" />
                  Delete All App Data (Factory Reset)
                </h4>
                <p className="text-xs text-red-800/80 mt-1 leading-relaxed">
                  Permanently deletes all timetables, teachers, classes, subjects, and resets the app and Cloud Firestore to a fresh factory state.
                </p>
              </div>

              {!confirmWipe ? (
                <button
                  onClick={() => setConfirmWipe(true)}
                  disabled={isLoading}
                  className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} />
                  Delete All App Data
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

            {/* Quick Actions */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Selective Reset Actions
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleSelectivePurge('timetable')}
                  disabled={isLoading}
                  className="p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition group"
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
                  className="p-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition group"
                >
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Trash2 size={13} className="text-amber-600" />
                    Clear Teachers
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Clears registered teachers</div>
                </button>
              </div>
            </div>

            {/* Firestore & Backup */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Database & Cloud Sync
              </label>

              <div className="flex gap-2">
                <button
                  onClick={handleForceSync}
                  disabled={isLoading}
                  className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
                >
                  <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                  Force Cloud Re-Sync
                </button>

                <button
                  onClick={handleDownloadBackup}
                  disabled={isLoading}
                  className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
                >
                  <Download size={13} />
                  Download Backup
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span>Database: ai-studio-otasmarttimetabl-...</span>
              <button
                onClick={onClose}
                className="font-bold text-slate-600 hover:text-slate-900 transition"
              >
                Close
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};
