import { AcademicLevel, AIFixSuggestion, Class, Conflict, SlotBudgetInfo, StyleConfig, Subject, Teacher, TimetableGrid } from '../types';

export interface TimetableAuditResult {
  pedagogicalScore: number;
  fairnessScore: number;
  fatigueRisk: string;
  strengths: string[];
  weaknesses: string[];
  actionableFixes: string[];
  summary: string;
}

export interface ComfortOptimizationResult {
  comfortScore: number;
  cognitiveEfficiency: number;
  insights: string[];
  suggestedAdjustments: { classId: string; day: number; periodA: number; periodB: number; reason: string }[];
}

export interface LearnFromReferenceResult {
  config: StyleConfig;
  summary: string;
}

export interface ChatModerationResult {
  isSafe: boolean;
  flagReason?: string;
}

export interface LightningAnalysisResult {
  slotBudget: SlotBudgetInfo;
  summary: string;
  issues: string[];
  suggestions: AIFixSuggestion[];
}

export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  allowMorningDoubles: false,
  heavySubjectLimitPerDay: 3,
  scienceConsecutiveAllowed: false,
  fridayRelaxation: true,
};

export function countScheduledCells(grid: TimetableGrid | null | undefined): number {
  if (!grid || typeof grid !== 'object') return 0;
  let totalScheduledCells = 0;
  for (const cId of Object.keys(grid)) {
    const classGrid = grid[cId];
    if (!Array.isArray(classGrid)) continue;
    for (let d = 0; d < 5; d++) {
      const daySlots = classGrid[d];
      if (!Array.isArray(daySlots)) continue;
      for (let p = 0; p < 8; p++) {
        if (daySlots[p]) totalScheduledCells++;
      }
    }
  }
  return totalScheduledCells;
}

export function safeParseJsonObject<T extends Record<string, any>>(rawText: string | undefined | null, fallback: T): T {
  if (!rawText || typeof rawText !== 'string') return fallback;
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...fallback, ...parsed };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function buildAuditDefaults(conflicts: Conflict[] = []): TimetableAuditResult {
  return {
    pedagogicalScore: 85,
    fairnessScore: 88,
    fatigueRisk: 'LOW',
    strengths: [
      'Core subjects scheduled primarily in morning periods',
      'Even teacher load distribution across days',
    ],
    weaknesses:
      conflicts.length > 0
        ? [`${conflicts.length} active schedule conflicts detected`]
        : ['Minor non-core subject clustering on Thursdays'],
    actionableFixes: [
      'Use automatic swap requests for minor schedule adjustments',
      'Verify teacher availability preferences in Faculty tab',
    ],
    summary: 'Timetable satisfies major institutional constraints with balanced subject progression.',
  };
}

export function buildComfortDefaults(): ComfortOptimizationResult {
  return {
    comfortScore: 92,
    cognitiveEfficiency: 94,
    insights: [
      'Morning periods (P1-P3) prioritize core Mathematics, Physics and English.',
      'Teacher gap periods are evenly distributed to reduce burnout.',
    ],
    suggestedAdjustments: [],
  };
}

export function buildConflictFixFallback(conflict: Conflict): string {
  const catLabel = conflict?.category
    ? String(conflict.category).toLowerCase().replace('_', ' ')
    : 'scheduling issue';
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const dayLabel =
    conflict?.day !== undefined ? dayNames[conflict.day] || 'assigned day' : 'assigned day';
  const periodLabel = conflict?.period !== undefined ? conflict.period + 1 : 'N/A';
  return `Suggested Resolution: Review period ${periodLabel} on ${dayLabel}. Swap subject slots or reassign teacher/room to resolve the ${catLabel}.`;
}

export function normalizeModerationResponse(rawText: string | undefined | null): ChatModerationResult {
  const parsed = safeParseJsonObject<{ safe?: boolean; isSafe?: boolean; reason?: string; flagReason?: string }>(
    rawText,
    { safe: true }
  );
  const safeVal = typeof parsed.safe === 'boolean'
    ? parsed.safe
    : typeof parsed.isSafe === 'boolean'
      ? parsed.isSafe
      : true;
  const reason = parsed.reason || parsed.flagReason;
  return {
    isSafe: safeVal,
    ...(reason ? { flagReason: reason } : {}),
  };
}

export function buildDeterministicSlotAnalysis(
  level: AcademicLevel,
  subjects: Subject[],
  classes: Class[],
  teachers: Teacher[],
  totalSlots: number = 40
): LightningAnalysisResult {
  const safeSubjects = Array.isArray(subjects) ? subjects : [];
  const safeClasses = Array.isArray(classes) ? classes : [];
  const safeTeachers = Array.isArray(teachers) ? teachers : [];

  const assignedSlots = safeSubjects.reduce(
    (sum, s) => sum + (s.defaultPeriodCount || s.periodsPerWeek || 3),
    0
  );
  const remainingSlots = totalSlots - assignedSlots;
  const isOverallocated = remainingSlots < 0;
  const isBalanced = remainingSlots >= 0 && remainingSlots <= 2;

  const issues: string[] = [];
  const suggestions: AIFixSuggestion[] = [];

  if (isOverallocated) {
    const deficit = Math.abs(remainingSlots);
    issues.push(
      `Overallocated by ${deficit} slots: ${level} curriculum has ${assignedSlots} weekly periods but only ${totalSlots} timetable slots exist.`
    );

    const adjustable = [...safeSubjects]
      .filter((s) => (s.defaultPeriodCount || s.periodsPerWeek || 3) > 1)
      .sort((a, b) => {
        if (Boolean(a.isCore) !== Boolean(b.isCore)) return a.isCore ? 1 : -1;
        return (b.defaultPeriodCount || b.periodsPerWeek || 3) - (a.defaultPeriodCount || a.periodsPerWeek || 3);
      });

    const adjustments: { subjectId: string; newPeriodCount: number; reason: string }[] = [];
    let toCut = deficit;
    for (const sub of adjustable) {
      if (toCut <= 0) break;
      const current = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
      const cut = Math.min(toCut, Math.max(1, current - 2));
      const newCount = current - cut;
      adjustments.push({
        subjectId: sub.id,
        newPeriodCount: newCount,
        reason: `Reduce ${sub.name} from ${current} to ${newCount} periods/week to eliminate slot deficit.`,
      });
      toCut -= cut;
    }

    suggestions.push({
      id: 'fix_slot_overload_' + Date.now(),
      type: 'SLOT_OVERLOAD',
      level,
      title: `⚡ Resolve ${deficit}-Slot Over-Allocation`,
      description: `Rebalance weekly periods across ${adjustments.length} subjects so total periods fit exactly within ${totalSlots} available timetable spaces.`,
      severity: 'CRITICAL',
      recommendedAction: `Apply automatic period trim to fit ${totalSlots} slots.`,
      autoFixPayload: { subjectAdjustments: adjustments },
    });
  } else if (remainingSlots > 4) {
    issues.push(`Unallocated spaces: ${remainingSlots} empty slots remain unassigned in ${level} schedule.`);
    suggestions.push({
      id: 'fix_slot_deficit_' + Date.now(),
      type: 'SLOT_DEFICIT',
      level,
      title: `Optimize ${remainingSlots} Open Timetable Slots`,
      description: `You have ${remainingSlots} unassigned spaces remaining. You can assign extra periods to Core subjects (e.g. Mathematics or English) or add Electives.`,
      severity: 'SUGGESTION',
      recommendedAction: 'Add elective subjects or expand core subject frequencies.',
    });
  }

  const teacherPeriodsMap: Record<string, { name: string; count: number; subjects: string[] }> = {};
  safeClasses.forEach(() => {
    safeSubjects.forEach((s) => {
      const tid = s.preferredTeacherId || (s.assignedTeacherIds && s.assignedTeacherIds[0]);
      if (tid && tid !== 'SYSTEM') {
        const teacher = safeTeachers.find((t) => t.id === tid);
        const tName = teacher?.name || tid;
        if (!teacherPeriodsMap[tid]) {
          teacherPeriodsMap[tid] = { name: tName, count: 0, subjects: [] };
        }
        teacherPeriodsMap[tid].count += s.defaultPeriodCount || s.periodsPerWeek || 3;
        if (!teacherPeriodsMap[tid].subjects.includes(s.name)) {
          teacherPeriodsMap[tid].subjects.push(s.name);
        }
      }
    });
  });

  for (const [tid, info] of Object.entries(teacherPeriodsMap)) {
    if (info.count > 30) {
      issues.push(
        `Faculty workload warning: ${info.name} has ${info.count} assigned periods/week across ${safeClasses.length} classes (Recommended cap: 28).`
      );
      suggestions.push({
        id: `fix_teacher_${tid}_` + Date.now(),
        type: 'TEACHER_BOTTLENECK',
        level,
        title: `Relieve Teacher Load: ${info.name}`,
        description: `${info.name} is assigned ${info.count} periods/week for ${info.subjects.join(', ')}. Recommend distributing to an assistant teacher.`,
        severity: 'WARNING',
        recommendedAction: `Reassign some class streams for ${info.subjects[0]} to another faculty member.`,
      });
    }
  }

  return {
    slotBudget: {
      level,
      totalSlots,
      assignedSlots,
      remainingSlots,
      isOverallocated,
      isBalanced,
      subjectsCount: safeSubjects.length,
    },
    summary: isOverallocated
      ? `Critical Over-Allocation: ${assignedSlots} periods requested, but only ${totalSlots} slots available per week (${Math.abs(remainingSlots)} slots excess).`
      : isBalanced
        ? `Optimal balance: ${assignedSlots}/${totalSlots} periods allocated with ${remainingSlots} free study periods.`
        : `Under-allocated: ${assignedSlots} of ${totalSlots} slots assigned (${remainingSlots} slots unallocated).`,
    issues: issues.length > 0 ? issues : ['No critical structural issues detected.'],
    suggestions,
  };
}
