import { ALL_CLASSES, ALL_SUBJECTS, PARALLEL_SUBJECTS } from '../constants';
import { Class, Subject, Teacher, TimetableCell, TimetableGrid } from '../types';
import { isSubjectEligibleForClass, isTeacherQualifiedForSubject } from './curriculum_eligibility';

export interface AutoBindResult {
  updated: boolean;
  grid: TimetableGrid;
  boundSlotsCount: number;
  claimedClasses: string[];
}

function buildMergedSubjects(configuredSubjects?: Subject[]): Subject[] {
  const byId = new Map<string, Subject>();
  for (const s of ALL_SUBJECTS) {
    if (s?.id) byId.set(s.id, s);
  }
  if (Array.isArray(configuredSubjects)) {
    for (const s of configuredSubjects) {
      if (s?.id) byId.set(s.id, s);
    }
  }
  return Array.from(byId.values());
}

function buildMergedClasses(configuredClasses?: Class[]): Class[] {
  const byId = new Map<string, Class>();
  for (const c of ALL_CLASSES) {
    if (c?.id) byId.set(c.id, c);
  }
  if (Array.isArray(configuredClasses)) {
    for (const c of configuredClasses) {
      if (c?.id) byId.set(c.id, c);
    }
  }
  return Array.from(byId.values());
}

function findSubjectForCell(
  cell: TimetableCell,
  subjectCatalog: Subject[]
): Subject | undefined {
  const subId = (cell.subjectId || '').trim();
  const subName = ((cell as any).subjectName || '').trim();
  const lowerId = subId.toLowerCase();
  const lowerName = subName.toLowerCase();

  return (
    subjectCatalog.find(s => s.id === subId) ||
    subjectCatalog.find(s => s.id.toLowerCase() === lowerId) ||
    subjectCatalog.find(s => (s.code || '').toLowerCase() === lowerId) ||
    (lowerName ? subjectCatalog.find(s => s.name.toLowerCase() === lowerName) : undefined) ||
    subjectCatalog.find(s => s.name.toLowerCase() === lowerId)
  );
}

function matchesSubjectTokens(
  tokens: string[],
  cellSubjectId: string,
  resolvedSubject?: Subject
): boolean {
  if (!Array.isArray(tokens) || tokens.length === 0) return false;

  const targetIds = new Set<string>();
  const targetNamesAndCodes = new Set<string>();

  if (cellSubjectId) {
    targetIds.add(cellSubjectId.trim().toUpperCase());
  }
  if (resolvedSubject) {
    if (resolvedSubject.id) targetIds.add(resolvedSubject.id.trim().toUpperCase());
    if (resolvedSubject.code) targetNamesAndCodes.add(resolvedSubject.code.trim().toUpperCase());
    if (resolvedSubject.name) targetNamesAndCodes.add(resolvedSubject.name.trim().toUpperCase());
  }

  return tokens.some(tok => {
    if (!tok || typeof tok !== 'string') return false;
    const clean = tok.trim().toUpperCase();
    return targetIds.has(clean) || targetNamesAndCodes.has(clean);
  });
}

function isPlaceholderTeacherId(id?: string): boolean {
  if (!id) return true;
  const clean = id.trim().toLowerCase();
  return clean === '' || clean === 'unassigned' || clean === 'none' || clean === 'null';
}

function extractAssignedTeacherIds(cell: TimetableCell): string[] {
  const result: string[] = [];
  if (!isPlaceholderTeacherId(cell.teacherId)) {
    result.push(cell.teacherId.trim());
  }
  if (Array.isArray(cell.teacherIds)) {
    for (const id of cell.teacherIds) {
      if (!isPlaceholderTeacherId(id) && !result.includes(id.trim())) {
        result.push(id.trim());
      }
    }
  }
  return result;
}

/**
 * Pure, clash-free auto-binder that claims unassigned matching slots (or parallel co-teaching slots)
 * on an already-published or draft timetable grid when a teacher signs up, gets approved, or logs in,
 * without regenerating a new timetable batch.
 */
export function bindTeacherToTimetableGrid(params: {
  teacher: Partial<Teacher> & { id: string; name?: string; approvalStatus?: string; isDisabled?: boolean; status?: string };
  grid: TimetableGrid | null | undefined;
  subjects?: Subject[];
  classes?: Class[];
}): AutoBindResult {
  const { teacher, grid, subjects, classes } = params;

  if (!grid || typeof grid !== 'object' || Object.keys(grid).length === 0) {
    return { updated: false, grid: (grid || {}) as TimetableGrid, boundSlotsCount: 0, claimedClasses: [] };
  }

  if (
    !teacher ||
    !teacher.id ||
    teacher.isApproved === false ||
    teacher.approvalStatus === 'PENDING' ||
    teacher.approvalStatus === 'REJECTED' ||
    teacher.isDisabled === true ||
    teacher.status === 'DISABLED' ||
    teacher.isCompleted === false
  ) {
    return { updated: false, grid, boundSlotsCount: 0, claimedClasses: [] };
  }

  const assignedClasses = Array.isArray(teacher.assignedClasses) ? teacher.assignedClasses : [];
  const classSubjectsMap = teacher.classSubjects && typeof teacher.classSubjects === 'object' ? teacher.classSubjects : undefined;
  const classSubjectKeys = classSubjectsMap ? Object.keys(classSubjectsMap).filter(k => (classSubjectsMap[k]?.length || 0) > 0) : [];
  const allowedClassSet = new Set<string>([...assignedClasses, ...classSubjectKeys]);

  const hasSubjects =
    (Array.isArray(teacher.subjectsTaught) && teacher.subjectsTaught.length > 0) ||
    classSubjectKeys.length > 0;

  if (!hasSubjects || allowedClassSet.size === 0) {
    return { updated: false, grid, boundSlotsCount: 0, claimedClasses: [] };
  }

  const subjectCatalog = buildMergedSubjects(subjects);
  const classCatalog = buildMergedClasses(classes);

  // 1. Pre-scan all classes in the existing grid to know which (day, period) slots
  // this teacher already teaches so we NEVER introduce double-bookings.
  const occupiedSlots = new Set<string>();
  for (const cId of Object.keys(grid)) {
    if (cId === '_revisionId') continue;
    const days = grid[cId];
    if (!days || typeof days !== 'object') continue;
    for (const dStr of Object.keys(days)) {
      const d = Number(dStr);
      if (Number.isNaN(d)) continue;
      const periods = days[d];
      if (!periods || typeof periods !== 'object') continue;
      for (const pStr of Object.keys(periods)) {
        const p = Number(pStr);
        if (Number.isNaN(p)) continue;
        const cell = periods[p];
        if (!cell || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;
        const assignedIds = extractAssignedTeacherIds(cell);
        if (assignedIds.includes(teacher.id)) {
          occupiedSlots.add(`${d}:${p}`);
        }
      }
    }
  }

  // Clone lazily: copy grid only if we actually bind at least one cell
  let nextGrid: TimetableGrid | null = null;
  let boundSlotsCount = 0;
  const claimedClasses = new Set<string>();

  const candidateClassIds = Object.keys(grid)
    .filter(cId => cId !== '_revisionId' && allowedClassSet.has(cId))
    .sort((a, b) => a.localeCompare(b));

  for (const classId of candidateClassIds) {
    const classObj = classCatalog.find(c => c.id === classId);
    const days = grid[classId];
    if (!days || typeof days !== 'object') continue;

    const dayIndices = Object.keys(days)
      .map(Number)
      .filter(n => !Number.isNaN(n))
      .sort((a, b) => a - b);

    for (const d of dayIndices) {
      const periods = days[d];
      if (!periods || typeof periods !== 'object') continue;

      const periodIndices = Object.keys(periods)
        .map(Number)
        .filter(n => !Number.isNaN(n))
        .sort((a, b) => a - b);

      for (const p of periodIndices) {
        const cell = periods[p];
        if (!cell || !cell.subjectId) continue;
        if (cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP' || cell.teacherId === 'SYSTEM') continue;

        // Respect teacher unavailability
        if (teacher.availability?.[d]?.[p] === 'UNAVAILABLE') continue;

        // Never double-book the teacher at the same (day, period) across different classes
        if (occupiedSlots.has(`${d}:${p}`)) continue;

        const resolvedSubject = findSubjectForCell(cell, subjectCatalog);

        // Enforce curriculum stream eligibility (e.g. Science vs BC) if class/subject metadata exists
        if (classObj && resolvedSubject && !isSubjectEligibleForClass(resolvedSubject, classObj, true)) {
          continue;
        }

        // Check per-class subject selection if provided, otherwise fall back to overall subjectsTaught
        const classSpecificTokens = classSubjectsMap?.[classId];
        let isQualified = false;
        if (Array.isArray(classSpecificTokens) && classSpecificTokens.length > 0) {
          isQualified = matchesSubjectTokens(classSpecificTokens, cell.subjectId, resolvedSubject);
        } else if (resolvedSubject) {
          isQualified = isTeacherQualifiedForSubject(teacher as Teacher, resolvedSubject);
        } else {
          isQualified = matchesSubjectTokens(teacher.subjectsTaught || [], cell.subjectId, undefined);
        }

        if (!isQualified) continue;

        const existingIds = extractAssignedTeacherIds(cell);
        if (existingIds.includes(teacher.id)) continue;

        const resolvedSubId = resolvedSubject?.id || cell.subjectId;
        const isParallelSubject = PARALLEL_SUBJECTS.includes(resolvedSubId);

        // Only claim unassigned cells, or parallel split-class subjects that co-assign multiple teachers
        if (existingIds.length > 0 && !isParallelSubject) continue;

        if (!nextGrid) {
          nextGrid = JSON.parse(JSON.stringify(grid)) as TimetableGrid;
        }

        const targetCell = nextGrid[classId]?.[d]?.[p];
        if (!targetCell) continue;

        const updatedTeacherIds = Array.from(new Set([...existingIds, teacher.id]));
        targetCell.teacherIds = updatedTeacherIds;
        if (isPlaceholderTeacherId(targetCell.teacherId)) {
          targetCell.teacherId = teacher.id;
          if (teacher.name) {
            (targetCell as any).teacherName = teacher.name;
          }
        }

        occupiedSlots.add(`${d}:${p}`);
        claimedClasses.add(classId);
        boundSlotsCount += 1;
      }
    }
  }

  return {
    updated: boundSlotsCount > 0,
    grid: nextGrid || grid,
    boundSlotsCount,
    claimedClasses: Array.from(claimedClasses)
  };
}
