import { ALL_CLASSES, ALL_SUBJECTS, DAYS, PERIODS, TIMETABLE_CONFIG } from '../constants';
import { Class, Room, Subject, SwapRequest, Teacher, TimetableCell, TimetableGrid } from '../types';
import { isSubjectEligibleForClass } from './curriculum_eligibility';

export interface ResolvedClassRef {
  id: string;
  name: string;
}

export interface ResolvedTaughtSubject {
  id: string;
  name: string;
  code: string;
  levelLabel: string;
  category: string;
  isCore: boolean;
  weeklyPeriods: number;
  classes: ResolvedClassRef[];
  isFromProfile: boolean;
  isFromTimetable: boolean;
}

export interface AgendaPeriodItem {
  dayIndex: number;
  dayName: string;
  periodIndex: number;
  periodLabel: string;
  timeRange: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  roomName?: string;
  hasLessonNote: boolean;
  lessonNote?: string;
  lessonLink?: string;
  isDouble?: boolean;
}

export interface TeacherScheduleSummary {
  totalPeriods: number;
  freePeriods: number;
  dailyBreakdown: number[];
  maxConsecutivePeriods: number;
  fatigueWarning: boolean;
  activeClasses: ResolvedClassRef[];
  personalGrid: TimetableGrid | null;
  todayDayIndex: number;
  todayDayName: string;
  isWeekendPreview: boolean;
  todayAgenda: AgendaPeriodItem[];
}

export function getTimeOfDayGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export function formatTeacherDateLabel(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function buildSubjectCatalog(configuredSubjects: Subject[]): Subject[] {
  const byId = new Map<string, Subject>();
  for (const s of ALL_SUBJECTS) {
    if (s?.id) byId.set(s.id, s);
  }
  for (const s of configuredSubjects) {
    if (s?.id) byId.set(s.id, s);
  }
  return Array.from(byId.values());
}

function buildClassCatalog(configuredClasses: Class[]): Class[] {
  const byId = new Map<string, Class>();
  for (const c of ALL_CLASSES) {
    if (c?.id) byId.set(c.id, c);
  }
  for (const c of configuredClasses) {
    if (c?.id) byId.set(c.id, c);
  }
  return Array.from(byId.values());
}

export function findSubjectMatch(rawToken: string, catalog: Subject[]): Subject | undefined {
  const token = (rawToken || '').trim();
  if (!token) return undefined;
  const lower = token.toLowerCase();
  return (
    catalog.find(s => s.id === token) ||
    catalog.find(s => s.id.toLowerCase() === lower) ||
    catalog.find(s => (s.code || '').toLowerCase() === lower) ||
    catalog.find(s => (s.name || '').toLowerCase() === lower)
  );
}

export function formatSubjectLevelLabel(subject?: Partial<Subject>): string {
  if (!subject) return 'General';
  const cat = (subject.category || '').toUpperCase();
  if (cat === 'SSS_SCIENCE') return 'SSS Science';
  if (cat === 'SSS_BC') return 'SSS Business & Humanities';
  if (cat === 'JSS' || subject.level === 'JUNIOR') return 'Junior Secondary';
  if (cat === 'SENIOR' || subject.level === 'SENIOR') return 'Senior Secondary';
  return 'General';
}

export function resolveClassDisplayName(classId: string, configuredClasses: Class[] = []): string {
  const catalog = buildClassCatalog(configuredClasses);
  const found = catalog.find(c => c.id === classId);
  return found?.name || classId;
}

export function resolveSubjectDisplayName(subjectId: string, configuredSubjects: Subject[] = []): string {
  if (subjectId === 'FREE') return 'Free Period';
  if (subjectId === 'WORSHIP') return 'Worship';
  const catalog = buildSubjectCatalog(configuredSubjects);
  return findSubjectMatch(subjectId, catalog)?.name || subjectId;
}

export function resolveTeacherDisplayName(teacherId: string, allTeachers: Teacher[] = []): string {
  if (!teacherId || teacherId === 'SYSTEM') return 'System';
  const found = allTeachers.find(t => t.id === teacherId);
  return found?.name || teacherId;
}

export function formatSwapRequestSummary(
  req: SwapRequest,
  configuredSubjects: Subject[] = [],
  configuredClasses: Class[] = [],
  allTeachers: Teacher[] = []
): string {
  if (req.type !== 'AUTOMATED_SWAP' || !req.requestData) {
    return req.details || 'General Request';
  }
  const d = req.requestData;
  const offerSub = resolveSubjectDisplayName(d.offerSubjectId, configuredSubjects);
  const offerCls = resolveClassDisplayName(d.offerClassId, configuredClasses);
  const offerDay = DAYS[d.offerDay]?.slice(0, 3) || `D${d.offerDay + 1}`;
  const offerPeriod = PERIODS[d.offerPeriod]?.label || `P${d.offerPeriod + 1}`;

  const targetSub = resolveSubjectDisplayName(d.targetSubjectId, configuredSubjects);
  const targetCls = resolveClassDisplayName(d.targetClassId, configuredClasses);
  const targetDay = DAYS[d.targetDay]?.slice(0, 3) || `D${d.targetDay + 1}`;
  const targetPeriod = PERIODS[d.targetPeriod]?.label || `P${d.targetPeriod + 1}`;
  const peerName = resolveTeacherDisplayName(d.targetTeacherId, allTeachers);

  return `Swap ${offerSub} (${offerCls}, ${offerDay} ${offerPeriod}) for ${targetSub} (${targetCls}, ${targetDay} ${targetPeriod}) with ${peerName}`;
}

export function resolveTaughtSubjectsSummary(params: {
  teacher: Teacher;
  configuredSubjects?: Subject[];
  configuredClasses?: Class[];
  grid?: TimetableGrid | null;
}): ResolvedTaughtSubject[] {
  const {
    teacher,
    configuredSubjects = [],
    configuredClasses = [],
    grid = null,
  } = params;

  const subjectCatalog = buildSubjectCatalog(configuredSubjects);
  const classCatalog = buildClassCatalog(configuredClasses);
  const assignedClassObjs = (teacher.assignedClasses || [])
    .map(cId => classCatalog.find(c => c.id === cId) || ({ id: cId, name: cId, category: cId.startsWith('SS') ? 'SENIOR' : 'JUNIOR' } as Class));

  const map = new Map<string, {
    subject?: Subject;
    rawId: string;
    name: string;
    code: string;
    levelLabel: string;
    category: string;
    isCore: boolean;
    weeklyPeriods: number;
    classIds: Set<string>;
    isFromProfile: boolean;
    isFromTimetable: boolean;
  }>();

  const ensureEntry = (rawToken: string) => {
    const clean = (rawToken || '').trim();
    if (!clean || clean === 'FREE' || clean === 'WORSHIP') return null;

    const matched = findSubjectMatch(clean, subjectCatalog);
    const key = matched ? matched.id : clean.toLowerCase();
    let entry = map.get(key);
    if (!entry) {
      entry = {
        subject: matched,
        rawId: matched ? matched.id : clean,
        name: matched ? matched.name : clean,
        code: matched ? (matched.code || matched.id.toUpperCase()) : clean.slice(0, 4).toUpperCase(),
        levelLabel: formatSubjectLevelLabel(matched),
        category: matched?.category || 'ALL',
        isCore: !!matched?.isCore,
        weeklyPeriods: 0,
        classIds: new Set<string>(),
        isFromProfile: false,
        isFromTimetable: false,
      };
      map.set(key, entry);
    }
    return entry;
  };

  for (const rawSub of teacher.subjectsTaught || []) {
    const entry = ensureEntry(rawSub);
    if (entry) {
      entry.isFromProfile = true;
    }
  }

  if (grid && typeof grid === 'object') {
    for (const cId of Object.keys(grid)) {
      const days = grid[cId];
      if (!days || typeof days !== 'object') continue;
      for (const dStr of Object.keys(days)) {
        const d = Number(dStr);
        const dayObj = days[d];
        if (!dayObj || typeof dayObj !== 'object') continue;
        for (const pStr of Object.keys(dayObj)) {
          const p = Number(pStr);
          const cell = dayObj[p];
          if (!cell || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;
          const isMine = cell.teacherId === teacher.id || cell.teacherIds?.includes(teacher.id);
          if (!isMine) continue;
          const entry = ensureEntry(cell.subjectId);
          if (entry) {
            entry.isFromTimetable = true;
            entry.weeklyPeriods += 1;
            entry.classIds.add(cId);
          }
        }
      }
    }
  }

  const results: ResolvedTaughtSubject[] = [];
  for (const entry of map.values()) {
    if (entry.classIds.size === 0 && assignedClassObjs.length > 0) {
      if (entry.subject) {
        const eligible = assignedClassObjs.filter(cls => isSubjectEligibleForClass(entry.subject!, cls, false));
        const fallbackList = eligible.length > 0 ? eligible : assignedClassObjs;
        fallbackList.forEach(cls => entry.classIds.add(cls.id));
      } else {
        assignedClassObjs.forEach(cls => entry.classIds.add(cls.id));
      }
    }

    const classes: ResolvedClassRef[] = Array.from(entry.classIds)
      .map(cId => {
        const cls = classCatalog.find(c => c.id === cId);
        return { id: cId, name: cls?.name || cId };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    results.push({
      id: entry.rawId,
      name: entry.name,
      code: entry.code,
      levelLabel: entry.levelLabel,
      category: entry.category,
      isCore: entry.isCore,
      weeklyPeriods: entry.weeklyPeriods,
      classes,
      isFromProfile: entry.isFromProfile,
      isFromTimetable: entry.isFromTimetable,
    });
  }

  return results.sort((a, b) => {
    if (b.weeklyPeriods !== a.weeklyPeriods) return b.weeklyPeriods - a.weeklyPeriods;
    if (a.isCore !== b.isCore) return a.isCore ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function buildTeacherScheduleSummary(params: {
  teacher: Teacher;
  grid?: TimetableGrid | null;
  configuredSubjects?: Subject[];
  configuredClasses?: Class[];
  rooms?: Room[];
  currentDate?: Date;
}): TeacherScheduleSummary {
  const {
    teacher,
    grid = null,
    configuredSubjects = [],
    configuredClasses = [],
    rooms = [],
    currentDate = new Date(),
  } = params;

  const subjectCatalog = buildSubjectCatalog(configuredSubjects);
  const classCatalog = buildClassCatalog(configuredClasses);

  const personalDayGrid: Record<number, Record<number, TimetableCell | null>> = {};
  for (let d = 0; d < DAYS.length; d++) {
    personalDayGrid[d] = {};
    for (let p = 0; p < TIMETABLE_CONFIG.PERIODS_PER_DAY; p++) {
      personalDayGrid[d][p] = null;
    }
  }

  const activeClassIdSet = new Set<string>(teacher.assignedClasses || []);
  let totalPeriods = 0;

  if (grid && typeof grid === 'object') {
    for (const cId of Object.keys(grid)) {
      const days = grid[cId];
      if (!days || typeof days !== 'object') continue;
      for (const dStr of Object.keys(days)) {
        const d = parseInt(dStr, 10);
        if (Number.isNaN(d) || !personalDayGrid[d]) continue;
        const dayObj = days[d];
        if (!dayObj || typeof dayObj !== 'object') continue;

        for (const pStr of Object.keys(dayObj)) {
          const p = parseInt(pStr, 10);
          if (Number.isNaN(p)) continue;
          const cell = dayObj[p];
          if (!cell || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;
          const isMine = cell.teacherId === teacher.id || cell.teacherIds?.includes(teacher.id);
          if (!isMine) continue;

          totalPeriods += 1;
          activeClassIdSet.add(cId);
          const className = classCatalog.find(c => c.id === cId)?.name || cId;
          personalDayGrid[d][p] = {
            ...cell,
            _realClassId: cId,
            _displayClass: className,
          };
        }
      }
    }
  }

  const dailyBreakdown = [0, 0, 0, 0, 0];
  let maxConsecutivePeriods = 0;
  for (let d = 0; d < DAYS.length; d++) {
    let streak = 0;
    for (let p = 0; p < TIMETABLE_CONFIG.PERIODS_PER_DAY; p++) {
      if (personalDayGrid[d][p]) {
        dailyBreakdown[d] += 1;
        streak += 1;
        if (streak > maxConsecutivePeriods) {
          maxConsecutivePeriods = streak;
        }
      } else {
        streak = 0;
      }
    }
  }

  const jsDay = currentDate.getDay();
  const isWeekendPreview = jsDay === 0 || jsDay === 6;
  const todayDayIndex = isWeekendPreview ? 0 : jsDay - 1;
  const todayDayName = DAYS[todayDayIndex] || 'Monday';

  const todayAgenda: AgendaPeriodItem[] = [];
  if (grid) {
    for (let p = 0; p < TIMETABLE_CONFIG.PERIODS_PER_DAY; p++) {
      const cell = personalDayGrid[todayDayIndex]?.[p];
      if (!cell) continue;
      const classId = cell._realClassId || '';
      const className = cell._displayClass || resolveClassDisplayName(classId, configuredClasses);
      const matchedSubject = findSubjectMatch(cell.subjectId, subjectCatalog);
      const roomObj = cell.roomId ? rooms.find(r => r.id === cell.roomId) : undefined;
      const periodMeta = PERIODS[p];

      todayAgenda.push({
        dayIndex: todayDayIndex,
        dayName: todayDayName,
        periodIndex: p,
        periodLabel: periodMeta?.label || `P${p + 1}`,
        timeRange: periodMeta?.time || '',
        classId,
        className,
        subjectId: cell.subjectId,
        subjectName: matchedSubject?.name || cell.subjectId,
        subjectCode: matchedSubject?.code || cell.subjectId.slice(0, 4).toUpperCase(),
        roomName: roomObj?.name || cell.roomId,
        hasLessonNote: !!(cell.lessonNote && cell.lessonNote.trim()),
        lessonNote: cell.lessonNote,
        lessonLink: cell.lessonLink,
        isDouble: cell.isDouble,
      });
    }
  }

  const activeClasses: ResolvedClassRef[] = Array.from(activeClassIdSet)
    .map(id => ({ id, name: resolveClassDisplayName(id, configuredClasses) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    totalPeriods,
    freePeriods: Math.max(0, TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS - totalPeriods),
    dailyBreakdown,
    maxConsecutivePeriods,
    fatigueWarning: maxConsecutivePeriods > 5,
    activeClasses,
    personalGrid: grid ? { MY_SCHEDULE: personalDayGrid } : null,
    todayDayIndex,
    todayDayName,
    isWeekendPreview,
    todayAgenda,
  };
}
