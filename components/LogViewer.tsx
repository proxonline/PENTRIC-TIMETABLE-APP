import React, { useMemo } from 'react';
import { LogEntry } from '../types';
import { AlertTriangle, CheckCircle, Info, XCircle, Wrench } from 'lucide-react';

interface Props {
  logs: LogEntry[];
  onClose?: () => void;
}

export const LogViewer: React.FC<Props> = ({ logs, onClose }) => {
  
  const analyzedLogs = useMemo(() => {
    return logs.map(log => {
      let fix = '';
      if (log.type === 'error' || log.type === 'warning') {
        if (log.message.includes('unscheduled periods')) {
          fix = 'Total subject periods exceed available slots. Reduce subject frequencies in "Curriculum" or add more periods.';
        } else if (log.message.includes('Missing Arabic')) {
          fix = 'Ensure "Arabic" is added to the class subjects and has a teacher assigned.';
        } else if (log.message.includes('Solver finished but failed')) {
          fix = 'The constraints are too tight. Try adding more teachers, reducing subject loads, or allowing more double periods.';
        } else if (log.message.includes('Validation failed')) {
          fix = 'The generated timetable did not meet strict requirements. Check subject frequencies and teacher availability.';
        }
      }
      return { ...log, fix };
    });
  }, [logs]);

  const errorCount = logs.filter(l => l.type === 'error').length;
  const warningCount = logs.filter(l => l.type === 'warning').length;

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[80vh]">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <div>
          <h3 className="text-xl font-black text-slate-800">Generation Report</h3>
          <div className="flex gap-3 mt-1 text-sm font-medium">
            <span className={errorCount > 0 ? 'text-red-600' : 'text-slate-400'}>{errorCount} Errors</span>
            <span className="text-slate-300">•</span>
            <span className={warningCount > 0 ? 'text-amber-600' : 'text-slate-400'}>{warningCount} Warnings</span>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <XCircle size={24} className="text-slate-400"/>
          </button>
        )}
      </div>

      <div className="overflow-y-auto p-6 space-y-3 custom-scrollbar flex-1">
        {analyzedLogs.length === 0 ? (
          <div className="text-center py-10 text-slate-400">No logs available.</div>
        ) : (
          analyzedLogs.map((log, idx) => (
            <div key={idx} className={`p-4 rounded-xl border flex gap-4 ${
              log.type === 'error' ? 'bg-red-50 border-red-100' :
              log.type === 'warning' ? 'bg-amber-50 border-amber-100' :
              log.type === 'success' ? 'bg-emerald-50 border-emerald-100' :
              'bg-slate-50 border-slate-100'
            }`}>
              <div className={`mt-1 ${
                log.type === 'error' ? 'text-red-500' :
                log.type === 'warning' ? 'text-amber-500' :
                log.type === 'success' ? 'text-emerald-500' :
                'text-blue-500'
              }`}>
                {log.type === 'error' ? <XCircle size={20}/> :
                 log.type === 'warning' ? <AlertTriangle size={20}/> :
                 log.type === 'success' ? <CheckCircle size={20}/> :
                 <Info size={20}/>}
              </div>
              
              <div className="flex-1">
                <div className={`font-bold text-sm mb-1 ${
                  log.type === 'error' ? 'text-red-900' :
                  log.type === 'warning' ? 'text-amber-900' :
                  log.type === 'success' ? 'text-emerald-900' :
                  'text-slate-700'
                }`}>
                  {log.message}
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </div>

                {log.fix && (
                  <div className="mt-3 flex items-start gap-2 bg-white/60 p-3 rounded-lg border border-black/5">
                    <Wrench size={14} className="mt-0.5 text-slate-500"/>
                    <div>
                      <span className="text-xs font-bold text-slate-600 uppercase block mb-0.5">Suggested Fix</span>
                      <span className="text-sm text-slate-700">{log.fix}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
