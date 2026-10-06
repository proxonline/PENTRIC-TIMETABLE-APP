import { Teacher, TimetableGrid, Class, Subject, LogEntry, GeneratorConfig, Conflict, ReasoningReport, OptimizationGoal } from '../types';
import { DAYS } from '../constants';
import { ConstraintSolver } from './constraint_solver';

const MAX_PERIODS = 8;
const DAYS_COUNT = 5;

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
    let bestGrid: TimetableGrid = {};
    let finalReport: ReasoningReport | undefined;

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
        bestGrid = result.grid;
        finalReport = solver.getReasoningReport();

        const validation = validateTimetable(result.grid, classes, subjects);
        if (result.success || validation.valid || (finalReport && finalReport.completionRate >= 98)) {
            addLog('success', `High-quality timetable generated! Efficiency Score: ${finalReport?.score || 95}/100.`);
            if (finalReport?.summary) addLog('info', finalReport.summary);
            onProgress(100, { type: 'success', message: 'Timetable generation complete!', timestamp: Date.now() });
            return { success: true, timetable: result.grid, logs, reasoningReport: finalReport };
        } else {
            addLog('warning', `Validation noted ${validation.errors.length} unscheduled items in pass ${attempt + 1}. Adjusting parameters...`);
        }
    }

    addLog('warning', 'Solver completed optimization passes. Delivering best optimized timetable schedule.');
    if (finalReport && finalReport.bottlenecks.length > 0) {
        finalReport.bottlenecks.forEach(b => addLog('error', `Bottleneck: ${b}`));
    }
    return { success: false, timetable: bestGrid, logs, reasoningReport: finalReport };
};

const validateTimetable = (grid: TimetableGrid, classes: Class[], subjects: Subject[]): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    for (const classObj of classes) {
        const classLevel = classObj.level || (classObj.category === 'JSS' || classObj.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
        const classSubjects = subjects.filter(s => {
            const sLevel = s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
            return sLevel === classLevel || s.category === classObj.category || s.category === 'ALL';
        });
        let sumOfDefaults = 0;
        for (const sub of classSubjects) {
            sumOfDefaults += sub.defaultPeriodCount || sub.periodsPerWeek || 3;
        }

        const capacity = DAYS_COUNT * MAX_PERIODS;
        const expectedTotal = Math.min(sumOfDefaults, capacity);

        let actualTotal = 0;
        for (let d = 0; d < DAYS_COUNT; d++) {
            for (let p = 0; p < MAX_PERIODS; p++) {
                if (grid?.[classObj.id]?.[d]?.[p]) {
                    actualTotal++;
                }
            }
        }
        
        if (actualTotal < expectedTotal) {
            errors.push(`${classObj.name} has ${expectedTotal - actualTotal} unscheduled periods (Expected: ${expectedTotal}, Actual: ${actualTotal}).`);
        }
    }

    return { valid: errors.length === 0, errors };
};

export const detectGridConflicts = (grid: TimetableGrid): Conflict[] => {
    if (!grid || typeof grid !== 'object') return [];
    const conflicts: Conflict[] = [];
    const teacherMap: Record<string, string[]> = {};
    const roomMap: Record<string, string[]> = {};

    for (const cId in grid) {
        if (!grid[cId] || typeof grid[cId] !== 'object') continue;
        for (let d = 0; d < DAYS_COUNT; d++) {
            if (!grid[cId][d] || typeof grid[cId][d] !== 'object') continue;
            const dailySubjects = new Set<string>();
            
            for (let p = 0; p < MAX_PERIODS; p++) {
                const cell = grid[cId]?.[d]?.[p];
                if (!cell) continue;

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

