import React, { useState, useEffect, useRef } from 'react';
import { storage } from '../services/storage';
import { Class, TimetableGrid as TGridType } from '../types';
import { ALL_SUBJECTS, DAYS } from '../constants';
import { Calendar, School, ArrowLeft, Search, Clock, Sparkles, UserCheck, ShieldCheck, QrCode, X, Download } from 'lucide-react';
import QRCode from 'qrcode';

interface Props {
  onBackToLogin: () => void;
}

const GRID_COLUMNS = [
  { type: 'PERIOD', index: 0, label: 'P1', time: '8:05 - 8:45' },
  { type: 'PERIOD', index: 1, label: 'P2', time: '8:45 - 9:25' },
  { type: 'PERIOD', index: 2, label: 'P3', time: '9:25 - 10:05' },
  { type: 'PERIOD', index: 3, label: 'P4', time: '10:05 - 10:45' },
  { type: 'BREAK', label: 'SHORT BREAK', sub: '15 MIN', time: '10:45 - 11:00' },
  { type: 'PERIOD', index: 4, label: 'P5', time: '11:00 - 11:40' },
  { type: 'PERIOD', index: 5, label: 'P6', time: '11:40 - 12:20' },
  { type: 'PERIOD', index: 6, label: 'P7', time: '12:20 - 1:00' },
  { type: 'BREAK', label: 'LUNCH BREAK', sub: '30 MIN', time: '1:00 - 1:30' },
  { type: 'PERIOD', index: 7, label: 'P8', time: '1:30 - 2:10' },
];

const SUBJECT_COLORS: Record<string, string> = {
  MTH: 'bg-blue-50 text-blue-700 border-blue-200',
  ENG: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  PHY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CHM: 'bg-teal-50 text-teal-700 border-teal-200',
  BIO: 'bg-green-50 text-green-700 border-green-200',
  GOV: 'bg-purple-50 text-purple-700 border-purple-200',
  LIT: 'bg-violet-50 text-violet-700 border-violet-200',
  ACC: 'bg-amber-50 text-amber-700 border-amber-200',
  ECO: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const PublicTimetable: React.FC<Props> = ({ onBackToLogin }) => {
  const currentSchool = storage.getCurrentSchool() || { name: 'OTA Total Academy', code: 'OTA' };
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [grid, setGrid] = useState<TGridType | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const clsList = storage.getClasses();
    setClasses(clsList);
    if (clsList && clsList.length > 0 && clsList[0]?.id) {
      setSelectedClassId(clsList[0].id);
    }
    setGrid(storage.getTimetable());

    const unsub = storage.subscribe(() => {
      setGrid(storage.getTimetable());
      setClasses(storage.getClasses());
    });
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    if (showQRModal && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, window.location.href, { width: 220, margin: 2 }).catch(() => {});
    }
  }, [showQRModal]);

  const getSubjectName = (id: string) => {
    if (id === 'FREE') return 'FREE';
    const s = ALL_SUBJECTS.find(sub => sub.id === id);
    return s ? s.name : id;
  };

  const selectedClass = classes.find(c => c.id === selectedClassId);
  const classData = grid && selectedClassId ? grid[selectedClassId] : null;

  return (
    <div className="min-h-screen bg-slate-50 font-sans p-4 md:p-8">
      {/* Top Navigation */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-200/80">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToLogin}
            className="p-2.5 rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition flex items-center justify-center"
            title="Back to Staff Login"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <School className="w-5 h-5 text-blue-600" />
              <h1 className="text-xl font-black text-slate-900 tracking-tight">{currentSchool.name}</h1>
            </div>
            <p className="text-xs text-slate-500 font-medium">{currentSchool.name} Student & Parent Timetable Portal</p>
          </div>
        </div>

        {/* Class Selection Dropdown & QR Code */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowQRModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold text-xs rounded-2xl border border-blue-200 transition"
            title="Scan or Share Timetable QR Code"
          >
            <QrCode className="w-4 h-4" />
            <span className="hidden sm:inline">Share QR</span>
          </button>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Select Class:</label>
          <div className="relative">
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="appearance-none bg-slate-100 text-slate-800 font-bold text-sm px-4 py-2.5 pr-10 rounded-2xl border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} ({cls.category})
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              ▼
            </div>
          </div>
        </div>
      </div>

      {/* Main Timetable Content */}
      <div className="max-w-7xl mx-auto">
        {selectedClass && (
          <div className="mb-4 flex items-center justify-between bg-blue-50/80 border border-blue-200/80 p-4 rounded-2xl text-blue-900">
            <div>
              <span className="text-xs uppercase tracking-wider font-extrabold text-blue-600">Active Schedule</span>
              <h2 className="text-lg font-black text-slate-900">{selectedClass.name} Timetable</h2>
            </div>
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-blue-200 text-xs font-bold text-blue-700">
              <ShieldCheck className="w-4 h-4 text-blue-600" /> Official Academic Schedule
            </div>
          </div>
        )}

        {!classData ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-200">
            <Sparkles className="w-12 h-12 text-blue-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-800 mb-1">No Schedule Available</h3>
            <p className="text-xs text-slate-500">A timetable has not yet been published for this class.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm custom-scrollbar">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                  <th className="p-3.5 sticky left-0 z-20 bg-slate-200/90 border-r border-slate-200 w-24 text-center">Day</th>
                  {GRID_COLUMNS.map((col, i) => (
                    <th key={i} className="p-3.5 border-r border-slate-200 min-w-[130px] text-center last:border-r-0">
                      {col.type === 'PERIOD' ? (
                        <div>
                          <div className="text-xs font-black text-slate-800">{col.label}</div>
                          <div className="text-[10px] font-semibold text-slate-400 font-mono mt-0.5">{col.time}</div>
                        </div>
                      ) : (
                        <div className="py-1">
                          <span className="text-[10px] font-extrabold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                            {col.label}
                          </span>
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {DAYS.map((day, d) => (
                  <tr key={day} className="hover:bg-slate-50/50">
                    <td className="sticky left-0 z-10 p-3.5 font-black text-slate-700 bg-slate-100/90 border-r border-slate-200 text-center uppercase tracking-wider">
                      {day.substring(0, 3)}
                    </td>
                    {GRID_COLUMNS.map((col, i) => {
                      if (col.type === 'BREAK') {
                        return (
                          <td key={i} className="bg-slate-50/60 border-r border-slate-100 text-center p-2">
                            <div className="h-16 flex items-center justify-center opacity-40 text-amber-600 text-[10px] font-black uppercase tracking-widest">
                              {col.label}
                            </div>
                          </td>
                        );
                      }

                      const cell = classData?.[d]?.[col.index!];
                      const subName = cell ? getSubjectName(cell.subjectId) : '';
                      const styleClass = cell && SUBJECT_COLORS[cell.subjectId] ? SUBJECT_COLORS[cell.subjectId] : 'bg-slate-100 text-slate-800 border-slate-200';

                      return (
                        <td key={i} className="p-2 border-r border-slate-100 h-20 text-center relative last:border-r-0">
                          {cell ? (
                            <div className={`h-full w-full rounded-2xl p-2 border flex flex-col justify-between relative shadow-2xs ${
                              cell.subjectId === 'FREE' ? 'bg-slate-50 border-slate-200 text-slate-400' : styleClass
                            }`}>
                              {cell.isManual && (
                                <div className="absolute top-1 right-1 flex items-center gap-1 bg-amber-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-xs" title="Substitute Assigned">
                                  <UserCheck className="w-2.5 h-2.5" /> substitute today
                                </div>
                              )}
                              {cell.isDouble && (
                                <div className="absolute top-1 left-1 bg-blue-600 text-white text-[8px] font-bold px-1 rounded">
                                  2X
                                </div>
                              )}
                              <div className="font-extrabold text-[12px] leading-tight truncate mt-1">
                                {subName}
                              </div>
                            </div>
                          ) : (
                            <div className="h-full w-full rounded-2xl border border-dashed border-slate-200 flex items-center justify-center text-slate-300">
                              -
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QR CODE MODAL */}
      {showQRModal && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative border border-slate-100">
            <button
              onClick={() => setShowQRModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <QrCode className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-1">Live Timetable QR</h3>
            <p className="text-xs text-slate-500 mb-6">Scan with any smartphone camera to open this schedule on mobile</p>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 inline-block mb-6">
              <canvas ref={canvasRef} className="mx-auto rounded-xl"></canvas>
            </div>
            <p className="text-[11px] text-slate-400 font-mono break-all">{window.location.href}</p>
          </div>
        </div>
      )}
    </div>
  );
};
