import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, setDoc, doc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { storage } from '../services/storage';
import { Send, Activity, RefreshCw, AlertTriangle, CheckCircle, Smartphone, Clock, ShieldAlert } from 'lucide-react';

interface PingDoc {
  id: string;
  deviceId: string;
  deviceLabel: string;
  timestamp: number;
}

export const SyncDiagnostics: React.FC = () => {
  const [deviceId, setDeviceId] = useState<string>('');
  const [deviceLabel, setDeviceLabel] = useState<string>('');
  const [pings, setPings] = useState<PingDoc[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<boolean>(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [recentErrors, setRecentErrors] = useState<any[]>([]);

  useEffect(() => {
    // Generate or fetch unique persistent device ID
    let storedId = localStorage.getItem('ota_device_id');
    if (!storedId) {
      storedId = 'dev_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('ota_device_id', storedId);
    }
    setDeviceId(storedId);

    let storedLabel = localStorage.getItem('ota_device_label');
    if (!storedLabel) {
      storedLabel = `Device (${storedId.slice(-4)})`;
    }
    setDeviceLabel(storedLabel);

    // Initial load of recent errors from storage
    try {
      if ((storage as any).cloudSync) {
        setRecentErrors((storage as any).cloudSync.getRecentErrors() || []);
      }
    } catch {}

    // Live subscription to ota_sync_diagnostics Firestore collection
    let unsubscribe: () => void = () => {};
    try {
      const coll = collection(db, 'ota_sync_diagnostics');
      unsubscribe = onSnapshot(coll, (snapshot) => {
        setSubError(null);
        const docsList: PingDoc[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data) {
            docsList.push({
              id: docSnap.id,
              deviceId: data.deviceId || 'Unknown',
              deviceLabel: data.deviceLabel || 'Unnamed Device',
              timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now()
            });
          }
        });
        docsList.sort((a, b) => b.timestamp - a.timestamp);
        setPings(docsList);
      }, (err: any) => {
        const code = err?.code ? `[Code: ${err.code}] ` : '';
        const msg = err?.message || String(err);
        setSubError(`${code}${msg}`);
        console.error('Sync Diagnostics onSnapshot error:', err);
      });
    } catch (e: any) {
      setSubError(`Failed to attach snapshot listener: ${e?.message || String(e)}`);
    }

    return () => unsubscribe();
  }, []);

  const handleLabelChange = (val: string) => {
    setDeviceLabel(val);
    localStorage.setItem('ota_device_label', val);
  };

  const handleSendPing = async () => {
    setIsSending(true);
    setSendError(null);
    setSendSuccess(false);

    const pingId = `ping_${deviceId}_${Date.now()}`;
    const pingData = {
      deviceId,
      deviceLabel: deviceLabel.trim() || `Device (${deviceId.slice(-4)})`,
      timestamp: Date.now()
    };

    try {
      await setDoc(doc(db, 'ota_sync_diagnostics', pingId), pingData);
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 3000);
    } catch (err: any) {
      const code = err?.code ? `[Firestore Code: ${err.code}] ` : '';
      const msg = err?.message || String(err);
      setSendError(`${code}${msg}`);
      console.error('Send Test Ping failed:', err);
    } finally {
      setIsSending(false);
      // Refresh error log
      try {
        if ((storage as any).cloudSync) {
          setRecentErrors((storage as any).cloudSync.getRecentErrors() || []);
        }
      } catch {}
    }
  };

  const formatAgo = (ts: number) => {
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    return `${diffHrs}h ago`;
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white rounded-2xl p-6 shadow-xl flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-blue-400 animate-pulse" />
            <h1 className="text-2xl font-bold">Cross-Device Sync Diagnostics</h1>
          </div>
          <p className="text-blue-200 text-sm mt-1">
            Test real-time connectivity between devices and monitor Firestore synchronization health.
          </p>
        </div>
        <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl text-right">
          <div className="text-xs text-blue-200">Current Device ID</div>
          <div className="text-sm font-mono font-bold text-white">{deviceId || 'Initializing...'}</div>
        </div>
      </div>

      {/* Ping Controls */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-blue-600" />
          Send Test Ping
        </h2>
        <p className="text-sm text-slate-600">
          Sending a ping writes a test document to Firestore. Open this screen on another device to confirm live cross-device reception.
        </p>

        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Device Custom Label
            </label>
            <input
              type="text"
              value={deviceLabel}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="e.g. My Phone, Front Office PC"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800"
            />
          </div>
          <button
            onClick={handleSendPing}
            disabled={isSending}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
          >
            {isSending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send Test Ping
          </button>
        </div>

        {/* Success Alert */}
        {sendSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-center gap-3 text-sm animate-fade-in">
            <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <strong>Ping document written successfully!</strong> It should immediately appear in the live list below on all connected devices.
            </div>
          </div>
        )}

        {/* Write Error Alert */}
        {sendError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 flex items-start gap-3 text-sm animate-fade-in">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-rose-900">Firestore Write Failed</div>
              <div className="font-mono text-xs mt-1 break-all bg-rose-100 p-2 rounded">{sendError}</div>
            </div>
          </div>
        )}
      </div>

      {/* Subscription Error Alert */}
      {subError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 flex items-start gap-3 text-sm">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Live Listener Error</div>
            <div className="font-mono text-xs mt-1 bg-amber-100 p-2 rounded">{subError}</div>
          </div>
        </div>
      )}

      {/* Live Pings Stream */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-600" />
            Live Received Pings Stream
            <span className="ml-2 text-xs font-normal px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
              {pings.length} Total
            </span>
          </h2>
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Auto-updates live via Firestore onSnapshot
          </span>
        </div>

        {pings.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl text-slate-400">
            <Activity className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium">No pings received yet.</p>
            <p className="text-xs text-slate-400 mt-1">Tap "Send Test Ping" above to test live delivery.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
            {pings.map((p) => {
              const isThisDevice = p.deviceId === deviceId;
              return (
                <div
                  key={p.id}
                  className={`p-4 flex items-center justify-between transition-colors ${
                    isThisDevice ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isThisDevice ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 text-sm">{p.deviceLabel}</span>
                        {isThisDevice && (
                          <span className="text-[10px] uppercase font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">
                            This Device
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-slate-400 mt-0.5">ID: {p.deviceId}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-slate-700">{formatAgo(p.timestamp)}</div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {new Date(p.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Internal Sync Error Log */}
      {recentErrors.length > 0 && (
        <div className="bg-slate-900 text-slate-200 rounded-2xl p-6 shadow-md space-y-3">
          <h3 className="text-sm font-bold text-rose-400 flex items-center gap-2 uppercase tracking-wider">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            Recent Intercepted Sync Pipeline Errors ({recentErrors.length})
          </h3>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {recentErrors.map((err, idx) => (
              <div key={idx} className="bg-slate-800 p-3 rounded-lg text-xs font-mono border border-slate-700">
                <div className="flex justify-between text-slate-400 mb-1">
                  <span className="text-amber-400 font-bold">[{err.operation}]</span>
                  <span>{new Date(err.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="text-rose-300 break-all">{err.error}</div>
                {err.code && <div className="text-slate-500 mt-0.5">Code: {err.code}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
