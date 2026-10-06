import React from 'react';
import { Teacher, Room, TimetableGrid as TGridType } from '../types';
import { DAYS, ALL_SUBJECTS } from '../constants';
import { storage } from '../services/storage';
import { Lock, Clock, Sparkles, BookOpen } from 'lucide-react';

interface Props {
  timetable: TGridType | null;
  classId: string;
  onCellClick?: (d: number, p: number) => void;
  isEditable?: boolean;
  isLoading?: boolean;
  teachers?: Teacher[];
  rooms?: Room[];
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

// Color mapping for subjects
const SUBJECT_COLORS: Record<string, string> = {
  MTH: 'bg-blue-50 text-blue-700 border-blue-200/80 hover:bg-blue-100',
  ENG: 'bg-indigo-50 text-indigo-700 border-indigo-200/80 hover:bg-indigo-100',
  PHY: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100',
  CHM: 'bg-teal-50 text-teal-700 border-teal-200/80 hover:bg-teal-100',
  BIO: 'bg-green-50 text-green-700 border-green-200/80 hover:bg-green-100',
  GOV: 'bg-purple-50 text-purple-700 border-purple-200/80 hover:bg-purple-100',
  LIT: 'bg-violet-50 text-violet-700 border-violet-200/80 hover:bg-violet-100',
  ACC: 'bg-amber-50 text-amber-700 border-amber-200/80 hover:bg-amber-100',
  ECO: 'bg-rose-50 text-rose-700 border-rose-200/80 hover:bg-rose-100',
};

export const TimetableGrid: React.FC<Props> = ({ timetable, classId, onCellClick, isEditable, isLoading, teachers: propsTeachers, rooms: propsRooms }) => {
  const teachers = propsTeachers || storage.getTeachers();
  const rooms = propsRooms || storage.getRooms();
  const classData = timetable ? timetable[classId] : null;

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl bg-white/80 border border-slate-200/80 shadow-sm animate-pulse p-4">
        <div className="h-12 bg-slate-100 rounded-xl mb-3"></div>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex gap-2 mb-2">
            <div className="w-16 h-20 bg-slate-100 rounded-lg"></div>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => (
              <div key={j} className="flex-1 h-20 bg-slate-50/80 rounded-lg"></div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  const getSubjectName = (id: string) => {
    if (id === 'FREE') return 'FREE';
    if (id.includes('(') && id.includes(')')) return id;
    const s = ALL_SUBJECTS.find(sub => sub.id === id);
    return s ? s.name : id;
  };

  const getTeacherNames = (cell: any) => {
    if (cell.teacherId === 'SYSTEM') return '';
    const ids = cell.teacherIds && cell.teacherIds.length > 0 ? cell.teacherIds : [cell.teacherId];
    const names = ids.map((id: string) => {
      const t = teachers.find(t => t.id === id);
      return t ? t.name.split(' ').pop() : 'Staff';
    });
    return names.join(' / ');
  };

  if (!classData) return (
    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50 p-8 text-center">
      <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center mb-3">
        <Sparkles className="w-6 h-6" />
      </div>
      <h3 className="text-base font-bold text-slate-800 mb-1">No Schedule Generated</h3>
      <p className="text-xs text-slate-500 max-w-sm">Use the Timetable Workbench to generate an AI-optimized schedule for this class.</p>
    </div>
  );

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm relative custom-scrollbar">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
            <th className="p-3 sticky left-0 z-20 bg-slate-100/90 border-r border-slate-200/80 w-20 text-center">Day</th>
            {GRID_COLUMNS.map((col, i) => (
              <th key={i} className="p-3 border-r border-slate-200/80 min-w-[125px] text-center last:border-r-0">
                {col.type === 'PERIOD' ? (
                  <div>
                    <div className="text-xs font-black text-slate-800">{col.label}</div>
                    <div className="text-[10px] font-semibold text-slate-400 font-mono mt-0.5">{col.time}</div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-1">
                    <span className="text-[10px] font-extrabold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/60">
                      {col.label}
                    </span>
                    <span className="text-[9px] text-amber-500 font-mono mt-0.5">{col.sub}</span>
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-xs">
          {DAYS.map((day, d) => (
            <tr key={day} className="hover:bg-slate-50/50 transition-colors">
              <td className="sticky left-0 z-10 p-3 font-extrabold text-slate-700 bg-slate-50/90 border-r border-slate-200/80 text-center uppercase tracking-wide">
                {day.substring(0, 3)}
              </td>
              {GRID_COLUMNS.map((col, i) => {
                if (col.type === 'BREAK') {
                  return (
                    <td key={i} className="bg-slate-50/60 border-r border-slate-100 text-center p-2">
                      <div className="h-16 flex items-center justify-center opacity-30 text-amber-500 text-[10px] font-extrabold tracking-widest uppercase">
                        {col.label}
                      </div>
                    </td>
                  );
                }

                const cell = classData?.[d]?.[col.index!];
                const subName = cell ? getSubjectName(cell.subjectId) : '';
                const teacherName = cell ? getTeacherNames(cell) : '';
                const displayClass = (cell as any)?._displayClass;
                const roomObj = cell?.roomId ? rooms.find(r => r.id === cell.roomId) : null;
                const roomLabel = roomObj ? roomObj.name : cell?.roomId;
                const styleClass = cell && SUBJECT_COLORS[cell.subjectId] ? SUBJECT_COLORS[cell.subjectId] : 'bg-slate-100 text-slate-800 border-slate-200';

                return (
                  <td
                    key={i}
                    onClick={() => onCellClick && onCellClick(d, col.index!)}
                    className={`p-1.5 border-r border-slate-100 h-20 text-center relative transition-all duration-150 last:border-r-0 ${
                      onCellClick ? 'cursor-pointer hover:bg-blue-50/60' : ''
                    }`}
                  >
                    {cell ? (
                      <div className={`h-full w-full rounded-xl p-2 border flex flex-col justify-between transition-all shadow-2xs relative ${
                        cell.subjectId === 'FREE' ? 'bg-slate-50 border-slate-200/60 text-slate-400' : styleClass
                      }`}>
                        {cell.isManual && (
                          <div className="absolute top-1 right-1 text-amber-500" title="Manual Lock">
                            <Lock className="w-3 h-3" />
                          </div>
                        )}
                        {cell.isDouble && (
                          <div className="absolute top-1 left-1 bg-blue-500 text-white text-[8px] font-bold px-1 rounded" title="Double Period">
                            2X
                          </div>
                        )}
                        {cell.lessonNote && (
                          <div className="absolute bottom-1 right-1 bg-indigo-600 text-white p-0.5 rounded-full" title="Lesson Note attached">
                            <BookOpen className="w-2.5 h-2.5" />
                          </div>
                        )}

                        <div className="font-extrabold text-[11px] leading-tight truncate mt-1">
                          {subName}
                        </div>

                        {cell.subjectId !== 'FREE' && (
                          <div className="text-[10px] font-bold opacity-80 truncate font-mono mt-0.5 flex flex-col">
                            <span>{displayClass || teacherName}</span>
                            {roomLabel && (
                              <span className="text-[9px] text-indigo-600 font-extrabold">{roomLabel}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full w-full rounded-xl border border-dashed border-slate-200/70 hover:border-blue-300 flex items-center justify-center text-slate-300 transition-colors">
                        <span className="text-xs font-semibold">+</span>
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
  );
};
