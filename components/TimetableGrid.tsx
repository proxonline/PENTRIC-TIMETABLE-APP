import React from 'react';
import { Teacher, Room, Subject, TimetableGrid as TGridType } from '../types';
import { DAYS, ALL_SUBJECTS } from '../constants';
import { storage } from '../services/storage';
import { Lock, Clock, BookOpen, Calendar } from 'lucide-react';

interface Props {
  timetable: TGridType | null;
  classId: string;
  onCellClick?: (d: number, p: number) => void;
  isEditable?: boolean;
  isLoading?: boolean;
  teachers?: Teacher[];
  rooms?: Room[];
  subjects?: Subject[];
  themeVariant?: 'light' | 'dark_purple' | 'dark_cyan';
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

const SUBJECT_COLOR_BY_KEY: Record<string, string> = {
  MTH: 'bg-blue-50/90 text-blue-900 border-blue-200/80 hover:bg-blue-100/80',
  MATH: 'bg-blue-50/90 text-blue-900 border-blue-200/80 hover:bg-blue-100/80',
  ENG: 'bg-indigo-50/90 text-indigo-900 border-indigo-200/80 hover:bg-indigo-100/80',
  ENGL: 'bg-indigo-50/90 text-indigo-900 border-indigo-200/80 hover:bg-indigo-100/80',
  PHY: 'bg-emerald-50/90 text-emerald-900 border-emerald-200/80 hover:bg-emerald-100/80',
  PHYS: 'bg-emerald-50/90 text-emerald-900 border-emerald-200/80 hover:bg-emerald-100/80',
  CHM: 'bg-teal-50/90 text-teal-900 border-teal-200/80 hover:bg-teal-100/80',
  CHEM: 'bg-teal-50/90 text-teal-900 border-teal-200/80 hover:bg-teal-100/80',
  BIO: 'bg-green-50/90 text-green-900 border-green-200/80 hover:bg-green-100/80',
  BIOL: 'bg-green-50/90 text-green-900 border-green-200/80 hover:bg-green-100/80',
  GOV: 'bg-slate-100 text-slate-900 border-slate-300/80 hover:bg-slate-200/70',
  GOVE: 'bg-slate-100 text-slate-900 border-slate-300/80 hover:bg-slate-200/70',
  LIT: 'bg-sky-50/90 text-sky-900 border-sky-200/80 hover:bg-sky-100/80',
  LITE: 'bg-sky-50/90 text-sky-900 border-sky-200/80 hover:bg-sky-100/80',
  ACC: 'bg-amber-50/90 text-amber-900 border-amber-200/80 hover:bg-amber-100/80',
  ACCO: 'bg-amber-50/90 text-amber-900 border-amber-200/80 hover:bg-amber-100/80',
  ECO: 'bg-rose-50/90 text-rose-900 border-rose-200/80 hover:bg-rose-100/80',
  ECON: 'bg-rose-50/90 text-rose-900 border-rose-200/80 hover:bg-rose-100/80',
  DGT: 'bg-cyan-50/90 text-cyan-900 border-cyan-200/80 hover:bg-cyan-100/80',
  CIVI: 'bg-stone-100 text-stone-900 border-stone-200 hover:bg-stone-200/70',
  BUSI: 'bg-orange-50/90 text-orange-900 border-orange-200/80 hover:bg-orange-100/80',
};

const DARK_SUBJECT_COLOR_BY_KEY: Record<string, string> = {
  MTH: 'bg-violet-500/20 text-violet-100 border-violet-400/40 hover:bg-violet-500/30',
  MATH: 'bg-violet-500/20 text-violet-100 border-violet-400/40 hover:bg-violet-500/30',
  ENG: 'bg-indigo-500/20 text-indigo-100 border-indigo-400/40 hover:bg-indigo-500/30',
  ENGL: 'bg-indigo-500/20 text-indigo-100 border-indigo-400/40 hover:bg-indigo-500/30',
  PHY: 'bg-emerald-500/20 text-emerald-100 border-emerald-400/40 hover:bg-emerald-500/30',
  PHYS: 'bg-emerald-500/20 text-emerald-100 border-emerald-400/40 hover:bg-emerald-500/30',
  CHM: 'bg-teal-500/20 text-teal-100 border-teal-400/40 hover:bg-teal-500/30',
  CHEM: 'bg-teal-500/20 text-teal-100 border-teal-400/40 hover:bg-teal-500/30',
  BIO: 'bg-green-500/20 text-green-100 border-green-400/40 hover:bg-green-500/30',
  BIOL: 'bg-green-500/20 text-green-100 border-green-400/40 hover:bg-green-500/30',
  GOV: 'bg-purple-500/20 text-purple-100 border-purple-400/40 hover:bg-purple-500/30',
  GOVE: 'bg-purple-500/20 text-purple-100 border-purple-400/40 hover:bg-purple-500/30',
  LIT: 'bg-sky-500/20 text-sky-100 border-sky-400/40 hover:bg-sky-500/30',
  LITE: 'bg-sky-500/20 text-sky-100 border-sky-400/40 hover:bg-sky-500/30',
  ACC: 'bg-amber-500/20 text-amber-100 border-amber-400/40 hover:bg-amber-500/30',
  ACCO: 'bg-amber-500/20 text-amber-100 border-amber-400/40 hover:bg-amber-500/30',
  ECO: 'bg-rose-500/20 text-rose-100 border-rose-400/40 hover:bg-rose-500/30',
  ECON: 'bg-rose-500/20 text-rose-100 border-rose-400/40 hover:bg-rose-500/30',
  DGT: 'bg-cyan-500/20 text-cyan-100 border-cyan-400/40 hover:bg-cyan-500/30',
  CIVI: 'bg-fuchsia-500/20 text-fuchsia-100 border-fuchsia-400/40 hover:bg-fuchsia-500/30',
  BUSI: 'bg-orange-500/20 text-orange-100 border-orange-400/40 hover:bg-orange-500/30',
};

function getSubjectStyle(subjectId: string, subjectCode?: string, isDark?: boolean): string {
  const map = isDark ? DARK_SUBJECT_COLOR_BY_KEY : SUBJECT_COLOR_BY_KEY;
  if (map[subjectId]) return map[subjectId];
  const upperCode = (subjectCode || '').toUpperCase();
  if (upperCode && map[upperCode]) return map[upperCode];
  const prefix = (subjectId || '').split('_')[0].toUpperCase();
  if (map[prefix]) return map[prefix];
  return isDark
    ? 'bg-purple-500/15 text-slate-100 border-purple-400/35 hover:bg-purple-500/25'
    : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100/80';
}

export const TimetableGrid: React.FC<Props> = ({
  timetable,
  classId,
  onCellClick,
  isLoading,
  teachers: propsTeachers,
  rooms: propsRooms,
  subjects: propsSubjects,
  themeVariant = 'light',
}) => {
  const teachers = propsTeachers || storage.getTeachers();
  const rooms = propsRooms || storage.getRooms();
  const configuredSubjects = propsSubjects || storage.getSubjects();
  const classData = timetable ? timetable[classId] : null;

  const isDark = themeVariant !== 'light';
  const isPurpleDark = themeVariant === 'dark_purple';
  const darkSurface = isPurpleDark
    ? 'bg-[#0E091C]/85 border-purple-400/25'
    : 'bg-[#061322]/85 border-cyan-400/25';
  const darkHeaderRow = isPurpleDark
    ? 'bg-[#170F2D]/95 border-purple-400/25 text-purple-200'
    : 'bg-[#0A1D33]/95 border-cyan-400/25 text-cyan-200';
  const darkStickyCol = isPurpleDark
    ? 'bg-[#150D29]/95 border-purple-400/25 text-purple-100'
    : 'bg-[#091A2E]/95 border-cyan-400/25 text-cyan-100';
  const darkCellBorder = isPurpleDark ? 'border-purple-400/20' : 'border-cyan-400/20';

  if (isLoading) {
    return (
      <div className={`overflow-hidden rounded-2xl border p-4 ${isDark ? darkSurface : 'bg-white border-slate-200'}`}>
        <div className={`h-12 rounded-xl mb-3 ${isDark ? 'bg-white/10' : 'bg-slate-100'}`}></div>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex gap-2 mb-2">
            <div className={`w-16 h-20 rounded-lg ${isDark ? 'bg-white/10' : 'bg-slate-100'}`}></div>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => (
              <div key={j} className={`flex-1 h-20 rounded-lg ${isDark ? 'bg-white/5' : 'bg-slate-50'}`}></div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  const resolveSubject = (id: string) => {
    return configuredSubjects.find(sub => sub.id === id) || ALL_SUBJECTS.find(sub => sub.id === id);
  };

  const getSubjectName = (id: string) => {
    if (id === 'FREE') return 'FREE';
    if (id === 'WORSHIP') return 'Worship';
    if (id.includes('(') && id.includes(')')) return id;
    const s = resolveSubject(id);
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
    <div
      className={`flex flex-col items-center justify-center h-64 border border-dashed rounded-2xl p-8 text-center ${
        isDark ? `${darkSurface} text-slate-200` : 'border-slate-200 bg-slate-50/70'
      }`}
    >
      <div
        className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-3 ${
          isPurpleDark
            ? 'bg-violet-500/20 border-violet-400/30 text-violet-300'
            : isDark
              ? 'bg-cyan-500/20 border-cyan-400/30 text-cyan-300'
              : 'bg-blue-50 border-blue-100 text-blue-600'
        }`}
      >
        <Calendar className="w-5 h-5" />
      </div>
      <h3 className={`text-base font-bold mb-1 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>No Schedule Published</h3>
      <p className={`text-xs max-w-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        No timetable slots have been published for this view yet.
      </p>
    </div>
  );

  return (
    <div className="space-y-2">
      <div
        className={`md:hidden flex items-center justify-between text-[11px] font-semibold px-3 py-2 rounded-xl border ${
          isDark ? `${darkSurface} text-slate-200` : 'text-slate-600 bg-slate-100 border-slate-200'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <Clock size={12} className={isPurpleDark ? 'text-violet-400 shrink-0' : isDark ? 'text-cyan-400 shrink-0' : 'text-blue-600 shrink-0'} />
          <span>Swipe horizontally to view P1 to P8</span>
        </span>
        <span className={`text-[10px] font-bold tabular-nums ${isPurpleDark ? 'text-violet-300' : isDark ? 'text-cyan-300' : 'text-blue-700'}`}>
          8 Periods
        </span>
      </div>
      <div className={`overflow-x-auto rounded-xl border relative custom-scrollbar ${isDark ? darkSurface : 'border-slate-200 bg-white'}`}>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className={`border-b text-[11px] font-semibold uppercase tracking-wider ${isDark ? darkHeaderRow : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
              <th className={`p-2.5 sticky left-0 z-20 border-r w-16 text-center ${isDark ? darkStickyCol : 'bg-slate-100 border-slate-200'}`}>Day</th>
              {GRID_COLUMNS.map((col, i) => (
                <th
                  key={i}
                  className={`p-2 border-r ${col.type === 'BREAK' ? 'min-w-[66px] w-16' : 'min-w-[88px] xl:min-w-[96px]'} text-center last:border-r-0 ${isDark ? darkCellBorder : 'border-slate-200'}`}
                >
                  {col.type === 'PERIOD' ? (
                    <div>
                      <div className={`text-xs font-bold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}>{col.label}</div>
                      <div className={`text-[10px] font-medium font-mono tabular-nums mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{col.time}</div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-1">
                      <span className={`text-[9px] font-bold tracking-wider leading-tight ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                        {col.label}
                      </span>
                      <span className={`text-[9px] font-mono tabular-nums mt-0.5 ${isDark ? 'text-amber-400/80' : 'text-amber-600'}`}>{col.sub}</span>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={`divide-y text-xs ${isDark ? (isPurpleDark ? 'divide-purple-400/15' : 'divide-cyan-400/15') : 'divide-slate-200/80'}`}>
            {DAYS.map((day, d) => (
              <tr key={day} className={`transition-colors ${isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-slate-50/40'}`}>
                <td className={`sticky left-0 z-10 p-2.5 font-bold border-r text-center uppercase tracking-wide ${isDark ? darkStickyCol : 'text-slate-800 bg-slate-50 border-slate-200'}`}>
                  {day.substring(0, 3)}
                </td>
                {GRID_COLUMNS.map((col, i) => {
                  if (col.type === 'BREAK') {
                    return (
                      <td key={i} className={`border-r text-center p-2 ${isDark ? `bg-amber-500/5 ${darkCellBorder}` : 'bg-amber-50/30 border-slate-200/70'}`}>
                        <div className={`h-16 flex items-center justify-center text-[10px] font-bold tracking-widest uppercase ${isDark ? 'text-amber-300/60' : 'text-amber-700/50'}`}>
                          {col.label.split(' ')[0]}
                        </div>
                      </td>
                    );
                  }

                  const rawCell = classData?.[d]?.[col.index!];
                  const cell = (rawCell && rawCell.classId && rawCell.classId !== classId && classId !== 'MY_SCHEDULE') ? null : rawCell;
                  const isWorship = cell?.subjectId === 'WORSHIP';
                  const subObj = cell ? resolveSubject(cell.subjectId) : undefined;
                  const subName = cell ? (isWorship ? 'Worship' : getSubjectName(cell.subjectId)) : '';
                  const teacherName = cell && !isWorship ? getTeacherNames(cell) : '';
                  const displayClass = (cell as any)?._displayClass;
                  const roomObj = cell?.roomId ? rooms.find(r => r.id === cell.roomId) : null;
                  const roomLabel = roomObj ? roomObj.name : cell?.roomId;
                  const styleClass = isWorship
                    ? isDark
                      ? 'bg-amber-500/20 text-amber-100 border-amber-400/40 font-bold'
                      : 'bg-amber-50 text-amber-900 border-amber-200 font-bold'
                    : (cell ? getSubjectStyle(cell.subjectId, subObj?.code, isDark) : '');

                  return (
                    <td
                      key={i}
                      onClick={() => onCellClick && onCellClick(d, col.index!)}
                      className={`p-1.5 border-r h-20 text-center relative transition-colors last:border-r-0 ${isDark ? darkCellBorder : 'border-slate-200/70'} ${
                        onCellClick ? (isDark ? 'cursor-pointer hover:bg-white/5' : 'cursor-pointer hover:bg-blue-50/50') : ''
                      }`}
                    >
                      {cell ? (
                        <div className={`h-full w-full rounded-lg p-2 border flex flex-col justify-between transition-colors relative ${
                          cell.subjectId === 'FREE'
                            ? isDark
                              ? 'bg-white/5 border-white/10 text-slate-400'
                              : 'bg-slate-50 border-slate-200/70 text-slate-400'
                            : styleClass
                        }`}>
                          {cell.isManual && !isWorship && (
                            <div className={`absolute top-1 right-1 ${isDark ? 'text-amber-300' : 'text-amber-600'}`} title="Manual Lock">
                              <Lock className="w-3 h-3" />
                            </div>
                          )}
                          {cell.isDouble && (
                            <div
                              className={`absolute top-1 left-1 text-white text-[8px] font-bold px-1 rounded ${
                                isPurpleDark ? 'bg-violet-600' : isDark ? 'bg-cyan-600' : 'bg-blue-600'
                              }`}
                              title="Double Period"
                            >
                              2X
                            </div>
                          )}
                          {cell.lessonNote && (
                            <div
                              className={`absolute bottom-1 right-1 text-white p-0.5 rounded ${
                                isPurpleDark ? 'bg-violet-600' : isDark ? 'bg-cyan-600' : 'bg-blue-600'
                              }`}
                              title="Lesson Note attached"
                            >
                              <BookOpen className="w-2.5 h-2.5" />
                            </div>
                          )}

                          <div className={`font-bold text-[11px] leading-tight truncate mt-0.5 ${isWorship ? (isDark ? 'text-amber-200 tracking-wide uppercase' : 'text-amber-800 tracking-wide uppercase') : ''}`}>
                            {subName}
                          </div>

                          {cell.subjectId !== 'FREE' && (
                            <div className="text-[10px] font-semibold opacity-90 truncate font-mono tabular-nums mt-0.5 flex flex-col">
                              {isWorship ? (
                                <span className={`text-[9px] font-semibold ${isDark ? 'text-amber-200/80' : 'text-amber-700'}`}>Non-Teaching</span>
                              ) : (
                                <>
                                  <span>{displayClass || teacherName}</span>
                                  {roomLabel && (
                                    <span className={`text-[9px] font-bold ${isPurpleDark ? 'text-violet-300' : isDark ? 'text-cyan-300' : 'text-blue-700'}`}>
                                      {roomLabel}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div
                          className={`h-full w-full rounded-lg border border-dashed flex items-center justify-center transition-colors ${
                            isDark
                              ? 'border-white/15 hover:border-purple-400/50 text-slate-500'
                              : 'border-slate-200 hover:border-blue-300 text-slate-300'
                          }`}
                        >
                          <span className="text-[10px] font-medium">—</span>
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
    </div>
  );
};

