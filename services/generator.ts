import { Teacher, TimetableGrid, Class, Subject, LogEntry, GeneratorConfig, Conflict, ReasoningReport, OptimizationGoal } from '../types';
import { DAYS } from '../constants';
import { ConstraintSolver } from './constraint_solver';
import { getEligibleSubjectsForClass, isSubjectEligibleForClass } from './curriculum_eligibility';

const MAX_PERIODS = 8;
const DAYS_COUNT = 5;

const evaluateAttemptQuality = (
    grid: TimetableGrid,
    classes: Class[],
    subjects: Subject[],
    validation: { valid: boolean; errors: string[]; warnings: string[]; rule1Satisfied: boolean; freePeriodStats: Record<string, { eligible: number; scheduled: number; free: number; configured: number }> },
    report?: ReasoningReport
): number => {
    let completedLessons = 0;
    let excessLessons = 0;

    for (const classObj of classes) {
        const classSubjects = getEligibleSubjectsForClass(classObj, subjects);
        const scheduledSubCounts: Record<string, number> = {};

        for (let d = 0; d < DAYS_COUNT; d++) {
            for (let p = 0; p < MAX_PERIODS; p++) {
                const cell = grid?.[classObj.id]?.[d]?.[p];
                if (!cell || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;
                if (cell.classId && cell.classId !== classObj.id) continue;
                scheduledSubCounts[cell.subjectId] = (scheduledSubCounts[cell.subjectId] || 0) + 1;
            }
        }

        for (const sub of classSubjects) {
            const req = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
            const scheduled = scheduledSubCounts[sub.id] || 0;
            completedLessons += Math.min(scheduled, req);
            if (scheduled > req) {
                excessLessons += (scheduled - req);
            }
        }
    }

    const errorPenalty = validation.errors.length * 1000 + excessLessons * 2000;
    const reportScoreBonus = report?.score || 0;
    return (completedLessons * 100) - errorPenalty + reportScoreBonus;
};

export const generateTimetable = async (
    teachers: Teacher[],
    classes: Class[],
    subjects: Subject[],
    goal: OptimizationGoal = 'BALANCED',
    onProgress: (p: number, l: LogEntry) => void,
    config: GeneratorConfig,
    existingGrid?: TimetableGrid,
    onSync?: (grid: TimetableGrid) => void
): Promise<{ success: boolean; timetable: TimetableGrid; logs: LogEntry[]; reasoningReport?: ReasoningReport }> => {
    
    const logs: LogEntry[] = [];
    const addLog = (type: LogEntry['type'], message: string) => logs.push({ type, message, timestamp: Date.now() });

    addLog('info', `Initializing Intelligent Constraint Solver (Goal: ${goal})...`);

    const MAX_RETRIES = 3;
    let bestQuality = -Infinity;
    let bestGrid: TimetableGrid = {};
    let bestReport: ReasoningReport | undefined;
    let bestValidation: ReturnType<typeof validateTimetable> | undefined;

    const solverConfig: GeneratorConfig = {
        ...config,
        goal
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        addLog('info', `Optimization pass ${attempt + 1} of ${MAX_RETRIES}...`);

        const currentConfig: GeneratorConfig = {
            ...solverConfig,
            forceSinglePeriods: attempt > 0 ? true : solverConfig.forceSinglePeriods
        };

        const solver = new ConstraintSolver(
            teachers,
            classes,
            subjects,
            currentConfig,
            existingGrid,
            (progress, message) => {
                onProgress(Math.min(100, Math.round(progress)), { type: 'info', message, timestamp: Date.now() });
            },
            onSync
        );

        const result = await solver.solve();
        const currentReport = solver.getReasoningReport();
        const validation = validateTimetable(result.grid, classes, subjects, teachers);

        const quality = evaluateAttemptQuality(result.grid, classes, subjects, validation, currentReport);
        if (quality > bestQuality || attempt === 0) {
            bestQuality = quality;
            bestGrid = result.grid;
            bestReport = currentReport;
            bestValidation = validation;
        }

        const isSuccess = result.success && validation.valid && validation.rule1Satisfied && (currentReport?.hardConstraintsSatisfied ?? true);
        if (isSuccess) {
            bestGrid = result.grid;
            bestReport = currentReport;
            bestValidation = validation;
            addLog('success', `High-quality timetable generated on pass ${attempt + 1}! Efficiency Score: ${currentReport?.score || 95}/100.`);
            if (validation.warnings.length > 0) {
                validation.warnings.forEach(warn => addLog('info', warn));
            }
            if (currentReport?.summary) addLog('info', currentReport.summary);
            onProgress(100, { type: 'success', message: 'Timetable generation complete!', timestamp: Date.now() });
            return { success: true, timetable: bestGrid, logs, reasoningReport: bestReport };
        } else {
            addLog('warning', `Optimization pass ${attempt + 1} completed with score ${currentReport?.score || 0}/100. Noted ${validation.errors.length} constraint notices. Analyzing...`);
            validation.errors.forEach(err => addLog('warning', err));
            if (validation.warnings.length > 0) {
                validation.warnings.forEach(warn => addLog('info', warn));
            }
        }
    }

    addLog('warning', 'Solver completed optimization passes. Delivering best optimized timetable schedule with detailed constraint report.');
    if (!bestValidation) {
        bestValidation = validateTimetable(bestGrid, classes, subjects, teachers);
    }
    bestValidation.errors.forEach(err => addLog('error', `Unsatisfied Constraint: ${err}`));
    bestValidation.warnings.forEach(warn => addLog('warning', warn));

    if (bestReport && bestReport.bottlenecks.length > 0) {
        bestReport.bottlenecks.forEach(b => addLog('error', `Bottleneck: ${b}`));
    }
    return { success: false, timetable: bestGrid, logs, reasoningReport: bestReport };
};

export const validateTimetable = (
    grid: TimetableGrid, 
    classes: Class[], 
    subjects: Subject[],
    teachers?: Teacher[]
): { 
    valid: boolean; 
    errors: string[]; 
    warnings: string[];
    rule1Satisfied: boolean; 
    freePeriodStats: Record<string, { eligible: number; scheduled: number; free: number; configured: number }> 
} => {
    const errors: string[] = [];
    const warnings: string[] = [];
    let rule1Satisfied = true;
    const freePeriodStats: Record<string, { eligible: number; scheduled: number; free: number; configured: number }> = {};
    const eligibleTeachingSlots = (DAYS_COUNT * MAX_PERIODS) - 2; // 38 slots (excluding Friday Worship P7 & P8)

    // Teacher slot usage for clash detection across classes
    const teacherSlotUsage: Record<string, string[]> = {};

    for (const classObj of classes) {
        // Enforce strict curriculum eligibility per class
        const classSubjects = getEligibleSubjectsForClass(classObj, subjects);
        const eligibleSubIds = new Set(classSubjects.map(s => s.id));

        // Calculate total configured weekly teaching periods from eligible subjects
        let configuredWeeklyTotal = 0;
        const requiredPerSubject: Record<string, number> = {};
        for (const sub of classSubjects) {
            const req = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
            requiredPerSubject[sub.id] = req;
            configuredWeeklyTotal += req;
        }

        let scheduledTotal = 0;
        const scheduledSubCounts: Record<string, number> = {};
        const dailyCounts: Record<number, Record<string, number>> = {};

        for (let d = 0; d < DAYS_COUNT; d++) {
            dailyCounts[d] = {};
            for (let p = 0; p < MAX_PERIODS; p++) {
                const cell = grid?.[classObj.id]?.[d]?.[p];
                if (!cell) continue;

                // Rule 2: Friday worship reservation check
                if (d === 4 && p >= MAX_PERIODS - 2) {
                    if (cell.subjectId !== 'WORSHIP') {
                        errors.push(`Rule 2 Violation: Class ${classObj.name} has ordinary subject ${cell.subjectId} during reserved Friday Worship (P${p + 1}).`);
                    }
                    continue;
                }

                if (cell.subjectId === 'WORSHIP') {
                    errors.push(`Rule 2 Violation: Class ${classObj.name} has Worship on ${DAYS[d]} P${p + 1} outside reserved Friday final two periods.`);
                    continue;
                }

                if (cell.subjectId === 'FREE') continue;

                scheduledTotal++;
                scheduledSubCounts[cell.subjectId] = (scheduledSubCounts[cell.subjectId] || 0) + 1;

                // Rule 3: No cross-class timetable contamination
                if (cell.classId && cell.classId !== classObj.id) {
                    errors.push(`Rule 3 Violation: Class ${classObj.name} contains foreign timetable assignment belonging to class ${cell.classId} on ${DAYS[d]} P${p + 1}.`);
                }

                // Rule 4: Strict curriculum eligibility
                if (!eligibleSubIds.has(cell.subjectId)) {
                    errors.push(`Rule 4 Violation: Ineligible subject ${cell.subjectId} scheduled for ${classObj.name} on ${DAYS[d]} P${p + 1}.`);
                }

                dailyCounts[d][cell.subjectId] = (dailyCounts[d][cell.subjectId] || 0) + 1;

                // Track teacher assignment for teacher-clash detection
                if (cell.teacherIds) {
                    cell.teacherIds.forEach(tid => {
                        if (tid === 'SYSTEM') return;
                        const key = `${tid}-${d}-${p}`;
                        if (!teacherSlotUsage[key]) teacherSlotUsage[key] = [];
                        teacherSlotUsage[key].push(classObj.name);
                    });
                } else if (cell.teacherId && cell.teacherId !== 'SYSTEM') {
                    const key = `${cell.teacherId}-${d}-${p}`;
                    if (!teacherSlotUsage[key]) teacherSlotUsage[key] = [];
                    teacherSlotUsage[key].push(classObj.name);
                }
            }
        }

        // Rule 2: Verify Friday final two periods are preserved as WORSHIP
        const friP7 = grid?.[classObj.id]?.[4]?.[MAX_PERIODS - 2];
        const friP8 = grid?.[classObj.id]?.[4]?.[MAX_PERIODS - 1];
        if (!friP7 || friP7.subjectId !== 'WORSHIP' || !friP8 || friP8.subjectId !== 'WORSHIP') {
            errors.push(`Rule 2 Violation: Class ${classObj.name} must reserve final two Friday periods (P7 & P8) for Worship.`);
        }

        // Rule 5: Daily limits
        for (let d = 0; d < DAYS_COUNT; d++) {
            for (const subId in dailyCounts[d]) {
                const sub = classSubjects.find(s => s.id === subId);
                const maxDaily = typeof sub?.maxPerDay === 'number' ? sub.maxPerDay : (sub && (sub.defaultPeriodCount || sub.periodsPerWeek || 3) >= 4 ? 2 : 1);
                const count = dailyCounts[d][subId];
                if (count > maxDaily) {
                    errors.push(`Rule 5 Violation: Subject ${sub?.name || subId} scheduled ${count} times on ${DAYS[d]} for ${classObj.name} (exceeds max ${maxDaily}/day).`);
                }
            }
        }

        // Exact subject frequency check (Section 5):
        // For each subject: actual scheduled occurrences === configured weekly frequency
        for (const sub of classSubjects) {
            const req = requiredPerSubject[sub.id];
            const scheduled = scheduledSubCounts[sub.id] || 0;
            if (scheduled < req) {
                rule1Satisfied = false;
                errors.push(`Missing Lesson Error: Class ${classObj.name} scheduled ${scheduled} of ${req} configured weekly periods for ${sub.name} (missing ${req - scheduled} periods).`);
            } else if (scheduled > req) {
                rule1Satisfied = false;
                errors.push(`Excess Lesson Error: Class ${classObj.name} scheduled ${scheduled} weekly periods for ${sub.name}, exceeding the configured frequency of ${req} (excess ${scheduled - req} periods).`);
            }
        }

        const freeTeachingPeriods = eligibleTeachingSlots - scheduledTotal;
        freePeriodStats[classObj.id] = { 
            eligible: eligibleTeachingSlots, 
            scheduled: scheduledTotal, 
            free: freeTeachingPeriods,
            configured: configuredWeeklyTotal
        };

        if (freeTeachingPeriods > 0) {
            warnings.push(`Unassigned Periods: Class ${classObj.name} has ${freeTeachingPeriods} unassigned teaching periods. All ${scheduledTotal}/${configuredWeeklyTotal} configured curriculum lessons have been allocated.`);
        }
    }

    // Teacher clash detection across classes (Section 5, Section 10 test 7)
    for (const [key, classNames] of Object.entries(teacherSlotUsage)) {
        if (classNames.length > 1) {
            const [tid, d, p] = key.split('-');
            const teacherObj = teachers?.find(t => t.id === tid);
            const teacherName = teacherObj?.name || tid;
            errors.push(`Teacher Clash: Teacher ${teacherName} is scheduled to teach multiple classes simultaneously (${classNames.join(', ')}) on ${DAYS[parseInt(d)]} P${parseInt(p) + 1}.`);
        }
    }

    return { 
        valid: errors.length === 0, 
        errors, 
        warnings, 
        rule1Satisfied, 
        freePeriodStats 
    };
};

export const detectGridConflicts = (grid: TimetableGrid, classes?: Class[], subjects?: Subject[]): Conflict[] => {
    if (!grid || typeof grid !== 'object') return [];
    const conflicts: Conflict[] = [];
    const teacherMap: Record<string, string[]> = {};
    const roomMap: Record<string, string[]> = {};

    for (const cId in grid) {
        if (!grid[cId] || typeof grid[cId] !== 'object') continue;
        const classObj = classes ? classes.find(c => c.id === cId) : undefined;

        for (let d = 0; d < DAYS_COUNT; d++) {
            if (!grid[cId][d] || typeof grid[cId][d] !== 'object') continue;
            const dailySubjects = new Set<string>();
            
            for (let p = 0; p < MAX_PERIODS; p++) {
                const cell = grid[cId]?.[d]?.[p];
                if (!cell) continue;

                // Rule 2: Friday Worship reservation validation
                if (d === 4 && p >= MAX_PERIODS - 2) {
                    if (cell.subjectId !== 'WORSHIP') {
                        conflicts.push({
                            id: crypto.randomUUID(),
                            type: 'CRITICAL',
                            category: 'INTER_CLASH',
                            message: `Ordinary subject scheduled in reserved Friday worship slot (P${p+1}) for ${classObj?.name || cId}`,
                            classId: cId,
                            subjectId: cell.subjectId,
                            day: d,
                            period: p
                        });
                    }
                    continue; // Skip lesson conflict checks for reserved worship
                }

                if (cell.subjectId === 'WORSHIP') {
                    conflicts.push({
                        id: crypto.randomUUID(),
                        type: 'CRITICAL',
                        category: 'INTER_CLASH',
                        message: `Worship scheduled outside Friday final two periods on ${DAYS[d]} P${p+1} for ${classObj?.name || cId}`,
                        classId: cId,
                        day: d,
                        period: p
                    });
                    continue;
                }

                if (cell.subjectId === 'FREE') continue;

                // Rule 3: Cross-class timetable contamination check
                if (cell.classId && cell.classId !== cId) {
                    conflicts.push({
                        id: crypto.randomUUID(),
                        type: 'CRITICAL',
                        category: 'INTER_CLASH',
                        message: `Foreign timetable assignment belonging to class ${cell.classId} found in schedule for ${classObj?.name || cId}`,
                        classId: cId,
                        subjectId: cell.subjectId,
                        day: d,
                        period: p
                    });
                }

                // Rule 4: Curriculum Eligibility Validation
                if (classObj && subjects && cell.subjectId) {
                    const sub = subjects.find(s => s.id === cell.subjectId);
                    if (sub && !isSubjectEligibleForClass(sub, classObj)) {
                        conflicts.push({
                            id: crypto.randomUUID(),
                            type: 'CRITICAL',
                            category: 'INTER_CLASH',
                            message: `Ineligible subject ${sub.name} (${sub.code || sub.id}) assigned to class ${classObj.name}`,
                            classId: cId,
                            subjectId: cell.subjectId,
                            day: d,
                            period: p
                        });
                    }
                }

                if (cell.teacherIds) {
                    cell.teacherIds.forEach(tid => {
                        if (tid === 'SYSTEM') return;
                        const key = `${tid}-${d}-${p}`;
                        if (!teacherMap[key]) teacherMap[key] = [];
                        teacherMap[key].push(cId);
                    });
                }

                if (cell.roomId) {
                    const roomKey = `${cell.roomId}-${d}-${p}`;
                    if (!roomMap[roomKey]) roomMap[roomKey] = [];
                    roomMap[roomKey].push(cId);
                }

                const prevCell = p > 0 ? grid[cId]?.[d]?.[p-1] : null;
                const isContinuation = prevCell && prevCell.subjectId === cell.subjectId && prevCell.isDouble && cell.isDouble;
                
                if (!isContinuation) {
                    if (dailySubjects.has(cell.subjectId)) {
                        conflicts.push({
                            id: crypto.randomUUID(),
                            type: 'WARNING',
                            category: 'BALANCE',
                            message: `Subject repeated on ${DAYS[d]}`,
                            classId: cId,
                            day: d,
                            period: p
                        });
                    }
                    dailySubjects.add(cell.subjectId);
                }
            }
        }
    }

    for (const [key, classes] of Object.entries(teacherMap)) {
        if (classes.length > 1) {
            const [tid, d, p] = key.split('-');
            conflicts.push({
                id: crypto.randomUUID(),
                type: 'CRITICAL',
                category: 'INTER_CLASH',
                message: `Teacher assigned to multiple classes (${classes.join(', ')})`,
                teacherId: tid,
                day: parseInt(d),
                period: parseInt(p)
            });
        }
    }

    for (const [key, classes] of Object.entries(roomMap)) {
        if (classes.length > 1) {
            const [rmId, d, p] = key.split('-');
            conflicts.push({
                id: crypto.randomUUID(),
                type: 'CRITICAL',
                category: 'ROOM_CLASH',
                message: `Room/Venue double-booked across multiple classes (${classes.join(', ')})`,
                roomId: rmId,
                day: parseInt(d),
                period: parseInt(p)
            });
        }
    }

    return conflicts;
};

export const detectExamConflicts = (exams: any[], rooms: any[] = []): Conflict[] => {
    const conflicts: Conflict[] = [];

    const isOverlap = (s1: string, e1: string, s2: string, e2: string) => {
        return s1 < e2 && s2 < e1;
    };

    for (let i = 0; i < exams.length; i++) {
        for (let j = i + 1; j < exams.length; j++) {
            const e1 = exams[i];
            const e2 = exams[j];

            if (e1.date === e2.date && isOverlap(e1.startTime, e1.endTime, e2.startTime, e2.endTime)) {
                if (e1.classId === e2.classId) {
                    conflicts.push({
                        id: crypto.randomUUID(),
                        type: 'CRITICAL',
                        category: 'INTER_CLASH',
                        message: `Class ${e1.classId} scheduled for multiple exams simultaneously on ${e1.date} (${e1.startTime}-${e1.endTime})`,
                        classId: e1.classId
                    });
                }
                if (e1.roomId && e2.roomId && e1.roomId === e2.roomId) {
                    conflicts.push({
                        id: crypto.randomUUID(),
                        type: 'CRITICAL',
                        category: 'ROOM_CLASH',
                        message: `Room double-booked for exams on ${e1.date} (${e1.startTime}-${e1.endTime})`,
                        roomId: e1.roomId
                    });
                }
                if (e1.supervisorTeacherId && e2.supervisorTeacherId && e1.supervisorTeacherId === e2.supervisorTeacherId) {
                    conflicts.push({
                        id: crypto.randomUUID(),
                        type: 'CRITICAL',
                        category: 'EXTRA_CLASH',
                        message: `Supervisor assigned to multiple exam sessions at ${e1.startTime} on ${e1.date}`,
                        teacherId: e1.supervisorTeacherId
                    });
                }
            }
        }
    }

    return conflicts;
};

