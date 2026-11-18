import {
    Teacher,
    Class,
    Subject,
    TimetableGrid,
    TimetableCell,
    GeneratorConfig,
    Availability,
    ReasoningReport,
    ClassAllocationSummary,
    SolverStrategy
} from '../types';
import { PARALLEL_SUBJECTS, DAYS, TIMETABLE_CONFIG } from '../constants';
import { getEligibleSubjectsForClass, resolveMaxPerDay, isTeacherQualifiedForSubject } from './curriculum_eligibility';

const MAX_PERIODS = TIMETABLE_CONFIG.PERIODS_PER_DAY;
const DAYS_COUNT = TIMETABLE_CONFIG.DAYS_COUNT;

// --- Types ---

interface Task {
    id: string;
    classId: string;
    subjectId: string;
    subjectName: string;
    teacherIds: string[];
    candidateTeacherSets: string[][];
    isParallel: boolean;
    duration: 1 | 2;
    isFixed: boolean;
    fixedDay?: number;
    fixedPeriod?: number;
    priority: number;
    teacherLoad: number;
    constraintScore: number;
    isCore: boolean;
}

interface SlotCandidate {
    d: number;
    p: number;
    teacherIds: string[];
    score: number;
}

interface SolverState {
    grid: TimetableGrid;
    teacherSchedule: string[][][]; // [teacherIndex][day][period] -> classId or ''
    teacherDailyLoad: number[][]; // [teacherIndex][day] -> lesson count
    teacherWeeklyLoad: number[]; // [teacherIndex] -> weekly lesson count
    classDailySubjects: Set<string>[][]; // [classIndex][day]
    classDailyLoad: number[][]; // [classIndex][day]
    classDailyCoreCount: number[][]; // [classIndex][day]
}

export class ConstraintSolver {
    private teachers: Teacher[];
    private classes: Class[];
    private subjects: Subject[];
    private config: GeneratorConfig;
    private strategy: SolverStrategy;
    private tasks: Task[] = [];
    private state: SolverState;
    private teacherToIndex: Map<string, number>;
    private classToIndex: Map<string, number>;
    private subjectMap: Map<string, Subject>;
    private teacherMap: Map<string, Teacher>;
    private classMap: Map<string, Class>;
    private bestSolution: TimetableGrid | null = null;
    private bestScore: number = -Infinity;
    private iterations = 0;
    private classSolveIterations = 0;
    private startTime = 0;
    private timeLimit = 25000;

    private onProgress?: (progress: number, message: string) => void;
    private onSync?: (grid: TimetableGrid) => void;
    private lastYieldTime = 0;
    private lastSyncTime = 0;

    private aborted = false;
    private totalRequiredSlots = 0;
    private totalCurriculumRequiredSlots = 0;
    private bottleneckList: Set<string> = new Set();

    constructor(
        teachers: Teacher[],
        classes: Class[],
        subjects: Subject[],
        config: GeneratorConfig,
        existingGrid?: TimetableGrid,
        onProgress?: (progress: number, message: string) => void,
        onSync?: (grid: TimetableGrid) => void
    ) {
        this.teachers = teachers;
        this.classes = classes;
        this.subjects = subjects;
        this.config = config;
        this.strategy = config.solverStrategy || 'CONSTRAINED_FIRST';
        this.onProgress = onProgress;
        this.onSync = onSync;

        this.teacherToIndex = new Map(teachers.map((t, i) => [t.id, i]));
        this.classToIndex = new Map(classes.map((c, i) => [c.id, i]));
        this.subjectMap = new Map(subjects.map(s => [s.id, s]));
        this.teacherMap = new Map(teachers.map(t => [t.id, t]));
        this.classMap = new Map(classes.map(c => [c.id, c]));

        // Initialize State
        this.state = {
            grid: {},
            teacherSchedule: Array.from({ length: teachers.length }, () =>
                Array.from({ length: DAYS_COUNT }, () => new Array(MAX_PERIODS).fill(''))
            ),
            teacherDailyLoad: Array.from({ length: teachers.length }, () => new Array(DAYS_COUNT).fill(0)),
            teacherWeeklyLoad: new Array(teachers.length).fill(0),
            classDailySubjects: Array.from({ length: classes.length }, () =>
                Array.from({ length: DAYS_COUNT }, () => new Set<string>())
            ),
            classDailyLoad: Array.from({ length: classes.length }, () => new Array(DAYS_COUNT).fill(0)),
            classDailyCoreCount: Array.from({ length: classes.length }, () => new Array(DAYS_COUNT).fill(0))
        };

        // Initialize Grid Structure and reserve Friday Worship (Rule 2)
        classes.forEach(c => {
            this.state.grid[c.id] = {};
            for (let d = 0; d < DAYS_COUNT; d++) {
                this.state.grid[c.id][d] = {};
                for (let p = 0; p < MAX_PERIODS; p++) {
                    if (d === 4 && p >= MAX_PERIODS - 2) {
                        this.state.grid[c.id][d][p] = {
                            subjectId: 'WORSHIP',
                            teacherId: 'SYSTEM',
                            teacherIds: ['SYSTEM'],
                            isManual: true,
                            isDouble: false,
                            classId: c.id
                        };
                    } else {
                        this.state.grid[c.id][d][p] = null;
                    }
                }
            }
        });

        // Prepare Tasks
        this.prepareTasks(existingGrid);
        this.checkTeacherOverbooking();
    }

    private isLayoutOnlyMode(): boolean {
        return !!this.config.classLayoutOnly || this.teachers.length === 0;
    }

    private getTeacherMaxWeeklyCap(teacher?: Teacher): number {
        const raw = (teacher as any)?.maxPeriodsPerWeek;
        return typeof raw === 'number' && raw > 0 ? Math.min(raw, 38) : 38;
    }

    private checkTeacherOverbooking() {
        const teacherTotalLoad: Record<string, number> = {};
        const teacherMorningCoreLoad: Record<string, number> = {};

        this.tasks.forEach(t => {
            if (t.candidateTeacherSets.length !== 1) return;
            const forcedIds = t.candidateTeacherSets[0];
            forcedIds.forEach(tid => {
                if (tid === 'SYSTEM') return;
                teacherTotalLoad[tid] = (teacherTotalLoad[tid] || 0) + t.duration;
                if (this.isStrictMorningCore(t.subjectId)) {
                    teacherMorningCoreLoad[tid] = (teacherMorningCoreLoad[tid] || 0) + t.duration;
                }
            });
        });

        for (const tid in teacherTotalLoad) {
            const load = teacherTotalLoad[tid];
            const teacher = this.teacherMap.get(tid);
            if (load > 38) {
                const msg = `Teacher ${teacher?.name || tid} is assigned ${load} periods/week (max physical capacity is 38).`;
                this.bottlenecks.add(msg);
                if (this.onProgress) {
                    this.onProgress(0, `Warning: ${msg}`);
                }
            }
            const morningLoad = teacherMorningCoreLoad[tid] || 0;
            if (morningLoad > 20) {
                const msg = `Morning Core Bottleneck: ${teacher?.name || tid} has ${morningLoad} strict morning lessons (only 20 P1-P4 slots exist per week).`;
                this.bottlenecks.add(msg);
            }
        }
    }

    private get bottlenecks(): Set<string> {
        return this.bottleneckList;
    }

    private isMandatedFreeSlot(_category: string, day: number, period: number): boolean {
        if (day === 4 && period >= MAX_PERIODS - 2) {
            return true;
        }
        return false;
    }

    private isStrictMorningCore(subjectId: string): boolean {
        const id = subjectId.toLowerCase();
        return id.startsWith('math') || id.includes('math') || id.startsWith('eng') || id.includes('eng');
    }

    private extractCellTeacherIds(cell?: TimetableCell | null): string[] {
        if (!cell) return [];
        if (cell.teacherIds && cell.teacherIds.length > 0) {
            return cell.teacherIds.filter(t => t && t !== 'SYSTEM');
        }
        if (cell.teacherId && cell.teacherId !== 'SYSTEM') {
            return [cell.teacherId];
        }
        return [];
    }

    private countTeacherAvailableSlots(teacher: Teacher, morningOnly: boolean): number {
        let count = 0;
        const maxP = morningOnly ? 4 : MAX_PERIODS;
        for (let d = 0; d < DAYS_COUNT; d++) {
            for (let p = 0; p < maxP; p++) {
                if (this.isMandatedFreeSlot('', d, p)) continue;
                if (teacher.availability?.[d]?.[p] === Availability.UNAVAILABLE) continue;
                count++;
            }
        }
        return count;
    }

    private prepareTasks(existingGrid?: TimetableGrid) {
        this.totalRequiredSlots = 0;
        this.totalCurriculumRequiredSlots = 0;

        // 1. Process Manual Locks from Existing Grid
        const manualSubjectCounts: Record<string, Record<string, number>> = {};
        const manualSubjectDays: Record<string, Record<string, Set<number>>> = {};

        if (existingGrid && this.config.preserveManualEdits) {
            for (const cId in existingGrid) {
                if (!this.state.grid[cId]) continue;
                if (!manualSubjectCounts[cId]) manualSubjectCounts[cId] = {};
                if (!manualSubjectDays[cId]) manualSubjectDays[cId] = {};

                for (let d = 0; d < DAYS_COUNT; d++) {
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        const cell = existingGrid[cId]?.[d]?.[p];
                        if (cell && cell.isManual && cell.subjectId !== 'FREE' && cell.subjectId !== 'WORSHIP') {
                            this.applyManualLock(cId, d, p, cell);
                            manualSubjectCounts[cId][cell.subjectId] = (manualSubjectCounts[cId][cell.subjectId] || 0) + 1;
                            if (!manualSubjectDays[cId][cell.subjectId]) {
                                manualSubjectDays[cId][cell.subjectId] = new Set();
                            }
                            manualSubjectDays[cId][cell.subjectId].add(d);
                        }
                    }
                }
            }
        }

        const projectedTeacherCounts = new Map<string, number>();
        for (let i = 0; i < this.teachers.length; i++) {
            if (this.state.teacherWeeklyLoad[i] > 0) {
                projectedTeacherCounts.set(this.teachers[i].id, this.state.teacherWeeklyLoad[i]);
            }
        }

        const eligibleTeachingSlotsPerClass = TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS; // 38 slots

        // Build ranked candidate teacher sets so the solver can switch dynamically if one teacher has a clash
        const resolveTeacherOptions = (
            classObj: Class,
            sub: Subject,
            countNeeded: number
        ): { primary: string[]; candidates: string[][]; isParallel: boolean } => {
            const isParallel = PARALLEL_SUBJECTS.includes(sub.id);

            if (this.isLayoutOnlyMode()) {
                return { primary: [], candidates: [], isParallel };
            }

            if (sub.preferredTeacherId) {
                const pref = this.teacherMap.get(sub.preferredTeacherId);
                if (pref && isTeacherQualifiedForSubject(pref, sub)) {
                    const primary = [pref.id];
                    const candidates: string[][] = [primary];
                    const others = this.teachers
                        .filter(t => t.id !== pref.id && isTeacherQualifiedForSubject(t, sub))
                        .sort((a, b) => (projectedTeacherCounts.get(a.id) || 0) - (projectedTeacherCounts.get(b.id) || 0));
                    for (const ot of others) {
                        candidates.push([ot.id]);
                    }
                    projectedTeacherCounts.set(pref.id, (projectedTeacherCounts.get(pref.id) || 0) + countNeeded);
                    return { primary, candidates, isParallel };
                }
            }

            if (sub.assignedTeacherIds && sub.assignedTeacherIds.length > 0) {
                const validTids = sub.assignedTeacherIds.filter(id => {
                    const t = this.teacherMap.get(id);
                    return t && isTeacherQualifiedForSubject(t, sub);
                });
                if (validTids.length > 0) {
                    if (isParallel) {
                        validTids.forEach(tid => projectedTeacherCounts.set(tid, (projectedTeacherCounts.get(tid) || 0) + countNeeded));
                        return { primary: validTids, candidates: [validTids], isParallel };
                    }
                    const sortedAssigned = [...validTids].sort(
                        (a, b) => (projectedTeacherCounts.get(a) || 0) - (projectedTeacherCounts.get(b) || 0)
                    );
                    const primary = [sortedAssigned[0]];
                    projectedTeacherCounts.set(primary[0], (projectedTeacherCounts.get(primary[0]) || 0) + countNeeded);
                    return {
                        primary,
                        candidates: sortedAssigned.map(id => [id]),
                        isParallel
                    };
                }
            }

            const classAssigned = this.teachers.filter(t => isTeacherQualifiedForSubject(t, sub) && t.assignedClasses.includes(classObj.id));
            const allQualified = this.teachers.filter(t => isTeacherQualifiedForSubject(t, sub));

            if (allQualified.length === 0) {
                this.bottlenecks.add(`Teacher Capacity Shortage: No qualified teacher available to teach ${sub.name} in ${classObj.name}.`);
                return { primary: [], candidates: [], isParallel };
            }

            if (isParallel) {
                const assignedTeachers = classAssigned.length > 0 ? classAssigned : allQualified;
                const sortedPool = [...assignedTeachers].sort(
                    (a, b) => (projectedTeacherCounts.get(a.id) || 0) - (projectedTeacherCounts.get(b.id) || 0)
                );
                const underloaded = sortedPool.filter(t => ((projectedTeacherCounts.get(t.id) || 0) + countNeeded) <= this.getTeacherMaxWeeklyCap(t));
                const fallbackCap = sortedPool.filter(t => ((projectedTeacherCounts.get(t.id) || 0) + countNeeded) <= 38);
                const selected = (underloaded.length > 0 ? underloaded : fallbackCap).slice(0, 2);
                const primary = selected.map(t => t.id);
                const candidates: string[][] = [];
                if (primary.length > 0) {
                    candidates.push(primary);
                    primary.forEach(tid => projectedTeacherCounts.set(tid, (projectedTeacherCounts.get(tid) || 0) + countNeeded));
                }
                for (const t of sortedPool) {
                    candidates.push([t.id]);
                }
                return { primary: primary.length > 0 ? primary : (candidates[0] || []), candidates, isParallel };
            }

            // Rank candidates: class-assigned underloaded -> school-wide underloaded -> remaining within cap
            const classIds = new Set(classAssigned.map(t => t.id));
            const ranked = [...allQualified].sort((a, b) => {
                const loadA = projectedTeacherCounts.get(a.id) || 0;
                const loadB = projectedTeacherCounts.get(b.id) || 0;
                const inClassA = classIds.has(a.id) ? 0 : 1;
                const inClassB = classIds.has(b.id) ? 0 : 1;
                const softCapA = loadA + countNeeded <= 28 ? 0 : (loadA + countNeeded <= 38 ? 1 : 2);
                const softCapB = loadB + countNeeded <= 28 ? 0 : (loadB + countNeeded <= 38 ? 1 : 2);

                if (softCapA !== softCapB) return softCapA - softCapB;
                if (inClassA !== inClassB && loadA <= 28 && loadB <= 28) return inClassA - inClassB;
                return loadA - loadB;
            });

            const candidates = ranked.map(t => [t.id]);
            const primary = candidates[0] || [];
            if (primary.length > 0) {
                projectedTeacherCounts.set(primary[0], (projectedTeacherCounts.get(primary[0]) || 0) + countNeeded);
            }
            return { primary, candidates, isParallel };
        };

        // 2. Generate Tasks for each class strictly matching configured curriculum frequencies
        for (const classObj of this.classes) {
            const classSubjects = getEligibleSubjectsForClass(classObj, this.subjects);
            let classCurriculumTotal = 0;

            for (const sub of classSubjects) {
                const manualCount = manualSubjectCounts[classObj.id]?.[sub.id] || 0;
                const requestedCount = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
                classCurriculumTotal += requestedCount;
                this.totalCurriculumRequiredSlots += requestedCount;
                this.totalRequiredSlots += requestedCount;

                const countNeeded = Math.max(0, requestedCount - manualCount);
                if (countNeeded <= 0) continue;

                const teacherOpt = resolveTeacherOptions(classObj, sub, countNeeded);
                const teacherLoad = teacherOpt.primary.reduce((acc, tid) => acc + (projectedTeacherCounts.get(tid) || 0), 0);

                // Tightness score (MRV priority)
                const isMorning = this.isStrictMorningCore(sub.id);
                let minAvail = 38;
                for (const tid of teacherOpt.primary) {
                    const tObj = this.teacherMap.get(tid);
                    if (tObj) {
                        minAvail = Math.min(minAvail, this.countTeacherAvailableSlots(tObj, isMorning));
                    }
                }
                const scarcityBonus = teacherOpt.candidates.length <= 1 ? 50 : Math.max(0, 30 - teacherOpt.candidates.length * 8);
                const availBonus = Math.max(0, 38 - minAvail) * 2;
                const morningBonus = isMorning ? 40 : (sub.isCore ? 20 : 0);
                const loadBonus = Math.min(40, teacherLoad);
                const constraintScore = scarcityBonus + availBonus + morningBonus + loadBonus;

                const lockedDays = manualSubjectDays[classObj.id]?.[sub.id] || new Set<number>();
                const availableDays = [0, 1, 2, 3, 4].filter(d => !lockedDays.has(d));

                for (let i = 0; i < countNeeded; i++) {
                    const isDailyCore = requestedCount === 5 && isMorning;
                    const fixedDay = isDailyCore && i < availableDays.length ? availableDays[i] : undefined;
                    this.tasks.push({
                        id: `${classObj.id}-${sub.id}-${i + 1}`,
                        classId: classObj.id,
                        subjectId: sub.id,
                        subjectName: sub.name,
                        teacherIds: teacherOpt.primary,
                        candidateTeacherSets: teacherOpt.candidates,
                        isParallel: teacherOpt.isParallel,
                        duration: 1,
                        isFixed: false,
                        fixedDay,
                        priority: sub.isCore ? 5 : 2,
                        teacherLoad,
                        constraintScore,
                        isCore: sub.isCore
                    });
                }
            }

            if (classCurriculumTotal > eligibleTeachingSlotsPerClass) {
                const excess = classCurriculumTotal - eligibleTeachingSlotsPerClass;
                this.bottlenecks.add(`${classObj.name} has ${classCurriculumTotal} configured curriculum periods, exceeding the ${eligibleTeachingSlotsPerClass} available teaching slots (excess of ${excess} periods).`);
            }
        }

        // Group tasks by class and interleave subjects round-robin with MRV awareness
        const classTaskMap = new Map<string, Task[]>();
        for (const task of this.tasks) {
            if (!classTaskMap.has(task.classId)) classTaskMap.set(task.classId, []);
            classTaskMap.get(task.classId)!.push(task);
        }

        const interleavedTasks: Task[] = [];
        for (const [, cTasks] of classTaskMap.entries()) {
            const coreTasks = cTasks.filter(t => t.isCore);
            const nonCoreTasks = cTasks.filter(t => !t.isCore);

            const interleaveGroup = (group: Task[]): Task[] => {
                const subMap = new Map<string, Task[]>();
                for (const t of group) {
                    if (!subMap.has(t.subjectId)) subMap.set(t.subjectId, []);
                    subMap.get(t.subjectId)!.push(t);
                }
                const subEntries = Array.from(subMap.entries()).sort((a, b) => {
                    const sA = a[1][0]?.constraintScore || 0;
                    const sB = b[1][0]?.constraintScore || 0;
                    return sB - sA;
                });

                const res: Task[] = [];
                let round = 0;
                let hasMore = true;
                while (hasMore) {
                    hasMore = false;
                    const offset = this.strategy === 'CONSTRAINED_FIRST' ? 0 : round % Math.max(1, subEntries.length);
                    for (let i = 0; i < subEntries.length; i++) {
                        const idx = (i + offset) % subEntries.length;
                        const subTasks = subEntries[idx][1];
                        if (round < subTasks.length) {
                            res.push(subTasks[round]);
                            hasMore = true;
                        }
                    }
                    round++;
                }
                return res;
            };

            interleavedTasks.push(...interleaveGroup(coreTasks), ...interleaveGroup(nonCoreTasks));
        }

        this.tasks = interleavedTasks;
    }

    private applyManualLock(classId: string, d: number, p: number, cell: TimetableCell) {
        const cIdx = this.classToIndex.get(classId);
        if (cIdx === undefined) return;

        this.state.grid[classId][d][p] = cell;

        const tids = this.extractCellTeacherIds(cell);
        tids.forEach(tid => {
            const tIdx = this.teacherToIndex.get(tid);
            if (tIdx !== undefined) {
                this.state.teacherSchedule[tIdx][d][p] = classId;
                this.state.teacherDailyLoad[tIdx][d]++;
                this.state.teacherWeeklyLoad[tIdx]++;
            }
        });

        this.state.classDailySubjects[cIdx][d].add(cell.subjectId);
        this.state.classDailyLoad[cIdx][d]++;
        const sub = this.subjectMap.get(cell.subjectId);
        if (sub?.isCore) {
            this.state.classDailyCoreCount[cIdx][d]++;
        }
    }

    private getOrderedClasses(classTaskMap: Map<string, Task[]>): Class[] {
        if (this.isLayoutOnlyMode()) {
            return [...this.classes];
        }

        const cMetrics = this.classes.map((c, origIdx) => {
            const cIdx = this.classToIndex.get(c.id)!;
            const cTasks = classTaskMap.get(c.id) || [];
            let manualLocks = 0;
            for (let d = 0; d < DAYS_COUNT; d++) {
                manualLocks += this.state.classDailyLoad[cIdx]?.[d] || 0;
            }
            const constraintSum = cTasks.reduce((acc, t) => acc + t.constraintScore, 0);
            const jitter = this.strategy === 'BALANCED_INTERLEAVE' ? (origIdx % 3) * 15 : 0;
            return {
                classObj: c,
                difficulty: cTasks.length * 10 + manualLocks * 25 + constraintSum / Math.max(1, cTasks.length) + jitter
            };
        });

        cMetrics.sort((a, b) => b.difficulty - a.difficulty);
        return cMetrics.map(m => m.classObj);
    }

    public async solve(): Promise<{ success: boolean; grid: TimetableGrid }> {
        this.startTime = Date.now();
        this.lastYieldTime = Date.now();
        this.iterations = 0;
        this.bestScore = -1;
        this.bestSolution = null;

        const classTaskMap = new Map<string, Task[]>();
        for (const classObj of this.classes) {
            classTaskMap.set(classObj.id, []);
        }
        for (const task of this.tasks) {
            if (classTaskMap.has(task.classId)) {
                classTaskMap.get(task.classId)!.push(task);
            }
        }

        const orderedClasses = this.getOrderedClasses(classTaskMap);

        // Solve most-constrained classes first
        for (const classObj of orderedClasses) {
            let classTasks = classTaskMap.get(classObj.id) || [];
            if (classTasks.length === 0) continue;

            if (classTasks.length > TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS) {
                classTasks = classTasks.slice(0, TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS);
            }

            this.classSolveIterations = 0;
            const classSuccess = await this.backtrackClass(classObj, classTasks, 0);
            if (!classSuccess) {
                this.fillUnplacedTasksForClass(classObj, classTasks);
            }
        }

        // Cross-class repair & fallback pass across all tasks
        this.fillUnplacedTasks();
        // Rescue any slots left without faculty using swaps / cross-class ejection
        this.repairUnassignedTeacherSlots();
        // Global cross-day multi-objective balance & variety optimization
        this.optimizeWeeklyVariety();
        this.rebuildStateFromGrid();

        if (this.onSync) {
            this.onSync(JSON.parse(JSON.stringify(this.state.grid)));
        }

        const isComplete = this.isCompleteGrid();
        return { success: isComplete, grid: this.state.grid };
    }

    private isTeacherValidAtSlot(
        tid: string,
        d: number,
        p: number,
        duration: 1 | 2,
        ignoreClassId?: string,
        checkWeeklyCap = true
    ): boolean {
        if (tid === 'SYSTEM') return true;
        const tIdx = this.teacherToIndex.get(tid);
        const teacher = this.teacherMap.get(tid);
        if (tIdx === undefined || !teacher) return true;

        const occupied1 = this.state.teacherSchedule[tIdx][d][p];
        if (occupied1 && occupied1 !== ignoreClassId) return false;
        if (duration === 2) {
            const occupied2 = this.state.teacherSchedule[tIdx][d][p + 1];
            if (occupied2 && occupied2 !== ignoreClassId) return false;
        }

        if (teacher.availability?.[d]?.[p] === Availability.UNAVAILABLE) return false;
        if (duration === 2 && teacher.availability?.[d]?.[p + 1] === Availability.UNAVAILABLE) return false;

        if (checkWeeklyCap && this.state.teacherWeeklyLoad[tIdx] + duration > 38) return false;

        const maxConsecutive = this.config.maxConsecutiveTeacherPeriods || 4;
        let consecutive = duration;
        let back = p - 1;
        while (back >= 0) {
            const occ = this.state.teacherSchedule[tIdx][d][back];
            if (!occ || occ === ignoreClassId) break;
            consecutive++;
            back--;
        }
        let fwd = p + duration;
        while (fwd < MAX_PERIODS) {
            const occ = this.state.teacherSchedule[tIdx][d][fwd];
            if (!occ || occ === ignoreClassId) break;
            consecutive++;
            fwd++;
        }

        return consecutive <= maxConsecutive;
    }

    private computeTeacherIdleGapsOnDay(tIdx: number, d: number, hypotheticalAddP?: number, hypotheticalRemoveP?: number): number {
        let firstP = -1;
        let lastP = -1;
        let taughtCount = 0;

        for (let p = 0; p < MAX_PERIODS; p++) {
            let active = Boolean(this.state.teacherSchedule[tIdx][d][p]);
            if (p === hypotheticalRemoveP) active = false;
            if (p === hypotheticalAddP) active = true;
            if (active) {
                if (firstP === -1) firstP = p;
                lastP = p;
                taughtCount++;
            }
        }

        if (taughtCount <= 1 || firstP === -1 || lastP <= firstP) return 0;
        return Math.max(0, (lastP - firstP + 1) - taughtCount);
    }

    private pickBestTeacherSetForSlot(task: Task, d: number, p: number): string[] | null {
        if (this.isLayoutOnlyMode() || task.candidateTeacherSets.length === 0) {
            return [];
        }

        const goal = this.config.goal || 'BALANCED';
        let bestSet: string[] | null = null;
        let bestTeacherScore = -Infinity;

        for (let idx = 0; idx < task.candidateTeacherSets.length; idx++) {
            const candidateSet = task.candidateTeacherSets[idx];
            if (candidateSet.length === 0) continue;

            let valid = true;
            let score = idx === 0 ? 15 : Math.max(0, 8 - idx * 2);

            for (const tid of candidateSet) {
                if (!this.isTeacherValidAtSlot(tid, d, p, task.duration)) {
                    valid = false;
                    break;
                }
                const tIdx = this.teacherToIndex.get(tid);
                const tObj = this.teacherMap.get(tid);
                if (tIdx !== undefined && tObj) {
                    const dayLoad = this.state.teacherDailyLoad[tIdx][d];
                    const dailyWeight = goal === 'TEACHER_FRIENDLY' ? 22 : 12;
                    score -= dayLoad * dailyWeight;

                    const weekLoad = this.state.teacherWeeklyLoad[tIdx];
                    score -= weekLoad * 0.8;

                    const gapAfter = this.computeTeacherIdleGapsOnDay(tIdx, d, p);
                    score -= gapAfter * (goal === 'TEACHER_FRIENDLY' ? 16 : 8);

                    const avail = tObj.availability?.[d]?.[p];
                    if (avail === Availability.PREFER) score += (goal === 'TEACHER_FRIENDLY' ? 40 : 20);
                    if (avail === Availability.AVOID) score -= (goal === 'TEACHER_FRIENDLY' ? 40 : 20);
                }
            }

            if (valid && score > bestTeacherScore) {
                bestTeacherScore = score;
                bestSet = candidateSet;
            }
        }

        return bestSet;
    }

    private computeDaySubjectCount(classId: string, d: number, subjectId: string): number {
        let count = 0;
        for (let p = 0; p < MAX_PERIODS; p++) {
            if (this.state.grid[classId]?.[d]?.[p]?.subjectId === subjectId) {
                count++;
            }
        }
        return count;
    }

    /**
     * Global multi-objective variety & teacher/student balance optimizer.
     * Supports same-day and cross-day swaps plus relocations into open slots while
     * strictly honoring curriculum limits, morning cores, unavailability, and consecutive rules.
     */
    public optimizeWeeklyVariety() {
        const goal = this.config.goal || 'BALANCED';
        const teacherWeightMult = goal === 'TEACHER_FRIENDLY' ? 2.0 : (goal === 'STUDENT_FRIENDLY' ? 0.8 : 1.3);
        const studentWeightMult = goal === 'STUDENT_FRIENDLY' ? 1.8 : (goal === 'TEACHER_FRIENDLY' ? 0.9 : 1.2);

        const computeClassScore = (cId: string): number => {
            const cIdx = this.classToIndex.get(cId);
            let penalty = 0;

            // 1. Same subject in same period across weekdays (Section 4.A)
            for (let p = 0; p < MAX_PERIODS; p++) {
                const subCounts: Record<string, number> = {};
                for (let d = 0; d < DAYS_COUNT; d++) {
                    const sid = this.state.grid[cId]?.[d]?.[p]?.subjectId;
                    if (sid && sid !== 'FREE' && sid !== 'WORSHIP') {
                        subCounts[sid] = (subCounts[sid] || 0) + 1;
                    }
                }
                for (const count of Object.values(subCounts)) {
                    if (count > 1) {
                        penalty += (count - 1) * 110 * studentWeightMult;
                    }
                }
            }

            // 2. Identical 2-subject sequences across different days (Section 4.B)
            for (let d1 = 0; d1 < DAYS_COUNT; d1++) {
                for (let d2 = d1 + 1; d2 < DAYS_COUNT; d2++) {
                    for (let p = 0; p < MAX_PERIODS - 1; p++) {
                        const s1A = this.state.grid[cId]?.[d1]?.[p]?.subjectId;
                        const s1B = this.state.grid[cId]?.[d1]?.[p + 1]?.subjectId;
                        const s2A = this.state.grid[cId]?.[d2]?.[p]?.subjectId;
                        const s2B = this.state.grid[cId]?.[d2]?.[p + 1]?.subjectId;
                        if (s1A && s1B && s1A === s2A && s1B === s2B && s1A !== 'FREE' && s1A !== 'WORSHIP') {
                            penalty += 45 * studentWeightMult;
                        }
                    }
                }
            }

            // 3. Student daily load & core balance variance across weekdays
            if (cIdx !== undefined) {
                const loads: number[] = [];
                const cores: number[] = [];
                for (let d = 0; d < DAYS_COUNT; d++) {
                    let dayLoad = 0;
                    let dayCore = 0;
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        const cell = this.state.grid[cId]?.[d]?.[p];
                        if (cell && cell.subjectId !== 'FREE' && cell.subjectId !== 'WORSHIP') {
                            dayLoad++;
                            if (this.subjectMap.get(cell.subjectId)?.isCore) dayCore++;
                        }
                    }
                    loads.push(dayLoad);
                    cores.push(dayCore);
                }
                const meanLoad = loads.reduce((a, b) => a + b, 0) / DAYS_COUNT;
                const meanCore = cores.reduce((a, b) => a + b, 0) / DAYS_COUNT;
                for (let d = 0; d < DAYS_COUNT; d++) {
                    const targetLoad = d === 4 ? Math.min(6, meanLoad) : meanLoad;
                    penalty += Math.pow(loads[d] - targetLoad, 2) * 18 * studentWeightMult;
                    penalty += Math.pow(cores[d] - meanCore, 2) * 14 * studentWeightMult;
                }
            }

            // 4. Same-day consecutive & duplicate subject penalties
            for (let d = 0; d < DAYS_COUNT; d++) {
                const daySubCounts: Record<string, number> = {};
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const sid = this.state.grid[cId]?.[d]?.[p]?.subjectId;
                    if (sid && sid !== 'FREE' && sid !== 'WORSHIP') {
                        daySubCounts[sid] = (daySubCounts[sid] || 0) + 1;
                    }
                    if (p < MAX_PERIODS - 1) {
                        const s2 = this.state.grid[cId]?.[d]?.[p + 1]?.subjectId;
                        if (sid && sid === s2 && sid !== 'FREE' && sid !== 'WORSHIP') {
                            penalty += 220;
                        }
                    }
                }
                for (const [sid, count] of Object.entries(daySubCounts)) {
                    if (count > 1) {
                        const subReq = this.subjectMap.get(sid)?.defaultPeriodCount || this.subjectMap.get(sid)?.periodsPerWeek || 3;
                        const weight = subReq <= 5 ? 480 * studentWeightMult : 200;
                        penalty += (count - 1) * weight;
                    }
                }
            }

            return penalty;
        };

        const computeTeacherPenaltyForIds = (tIds: string[]): number => {
            if (this.isLayoutOnlyMode() || tIds.length === 0) return 0;
            let penalty = 0;
            const seen = new Set<string>();
            for (const tid of tIds) {
                if (seen.has(tid) || tid === 'SYSTEM') continue;
                seen.add(tid);
                const tIdx = this.teacherToIndex.get(tid);
                const tObj = this.teacherMap.get(tid);
                if (tIdx === undefined || !tObj) continue;

                const dayCounts = this.state.teacherDailyLoad[tIdx];
                const total = dayCounts.reduce((a, b) => a + b, 0);
                if (total === 0) continue;

                const mean = total / DAYS_COUNT;
                for (let d = 0; d < DAYS_COUNT; d++) {
                    penalty += Math.pow(dayCounts[d] - mean, 2) * 28 * teacherWeightMult;
                    if (dayCounts[d] >= 6) {
                        penalty += (dayCounts[d] - 5) * 40 * teacherWeightMult;
                    }
                    penalty += this.computeTeacherIdleGapsOnDay(tIdx, d) * 20 * teacherWeightMult;

                    for (let p = 0; p < MAX_PERIODS; p++) {
                        if (this.state.teacherSchedule[tIdx][d][p]) {
                            const avail = tObj.availability?.[d]?.[p];
                            if (avail === Availability.AVOID) penalty += 35 * teacherWeightMult;
                            if (avail === Availability.PREFER) penalty -= 15 * teacherWeightMult;
                        }
                    }
                }
            }
            return penalty;
        };

        const canPlaceCellAt = (
            cId: string,
            cell: TimetableCell,
            targetD: number,
            targetP: number,
            swapPartnerCell: TimetableCell | null,
            srcD: number,
            srcP: number
        ): boolean => {
            if (this.isMandatedFreeSlot('', targetD, targetP)) return false;

            const sub = this.subjectMap.get(cell.subjectId);

            if (this.isStrictMorningCore(cell.subjectId) && targetP >= 4) return false;
            if (sub?.isCore && targetP >= 4 && swapPartnerCell && !this.subjectMap.get(swapPartnerCell.subjectId)?.isCore && srcP < 4) {
                return false;
            }

            if (targetD !== srcD) {
                const maxDaily = sub ? resolveMaxPerDay(sub) : 2;
                let countOnTarget = 0;
                for (let p = 0; p < MAX_PERIODS; p++) {
                    if (targetD === srcD && p === srcP) continue;
                    const c = this.state.grid[cId]?.[targetD]?.[p];
                    if (c?.subjectId === cell.subjectId) countOnTarget++;
                }
                if (swapPartnerCell && swapPartnerCell.subjectId === cell.subjectId) {
                    countOnTarget--;
                }
                if (countOnTarget + 1 > maxDaily) return false;
            }

            if (targetP > 0) {
                const prevCell = (targetD === srcD && targetP - 1 === srcP)
                    ? swapPartnerCell
                    : this.state.grid[cId]?.[targetD]?.[targetP - 1];
                if (prevCell?.subjectId === cell.subjectId) return false;
            }
            if (targetP < MAX_PERIODS - 1) {
                const nextCell = (targetD === srcD && targetP + 1 === srcP)
                    ? swapPartnerCell
                    : this.state.grid[cId]?.[targetD]?.[targetP + 1];
                if (nextCell?.subjectId === cell.subjectId) return false;
            }

            if (!this.isLayoutOnlyMode()) {
                const tids = this.extractCellTeacherIds(cell);
                const partnerTids = new Set(this.extractCellTeacherIds(swapPartnerCell));
                const maxConsec = this.config.maxConsecutiveTeacherPeriods || 4;

                for (const tid of tids) {
                    const tIdx = this.teacherToIndex.get(tid);
                    const tObj = this.teacherMap.get(tid);
                    if (tObj?.availability?.[targetD]?.[targetP] === Availability.UNAVAILABLE) return false;

                    if (tIdx !== undefined) {
                        const occ = this.state.teacherSchedule[tIdx][targetD][targetP];
                        if (occ && occ !== cId) return false;
                        if (occ === cId && !(targetD === srcD && targetP === srcP) && !partnerTids.has(tid)) {
                            return false;
                        }

                        let consec = 1;
                        let b = targetP - 1;
                        while (b >= 0) {
                            const isSelfAfterMove = (targetD === srcD && b === srcP)
                                ? partnerTids.has(tid)
                                : Boolean(this.state.teacherSchedule[tIdx][targetD][b]);
                            if (!isSelfAfterMove) break;
                            consec++;
                            b--;
                        }
                        let f = targetP + 1;
                        while (f < MAX_PERIODS) {
                            const isSelfAfterMove = (targetD === srcD && f === srcP)
                                ? partnerTids.has(tid)
                                : Boolean(this.state.teacherSchedule[tIdx][targetD][f]);
                            if (!isSelfAfterMove) break;
                            consec++;
                            f++;
                        }
                        if (consec > maxConsec) return false;
                    }
                }
            }

            return true;
        };

        const applyTeacherDelta = (cId: string, cell: TimetableCell | null, d: number, p: number, add: boolean) => {
            if (!cell || this.isLayoutOnlyMode()) return;
            const tids = this.extractCellTeacherIds(cell);
            for (const tid of tids) {
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx === undefined) continue;
                if (add) {
                    this.state.teacherSchedule[tIdx][d][p] = cId;
                    this.state.teacherDailyLoad[tIdx][d]++;
                } else {
                    if (this.state.teacherSchedule[tIdx][d][p] === cId) {
                        this.state.teacherSchedule[tIdx][d][p] = '';
                    }
                    this.state.teacherDailyLoad[tIdx][d] = Math.max(0, this.state.teacherDailyLoad[tIdx][d] - 1);
                }
            }
        };

        const isFastLayoutOnly = this.isLayoutOnlyMode();
        const maxPasses = isFastLayoutOnly ? 4 : 5;

        for (let pass = 0; pass < maxPasses; pass++) {
            let anyImproved = false;

            for (const classObj of this.classes) {
                const cId = classObj.id;
                let currentClassPenalty = computeClassScore(cId);

                for (let d1 = 0; d1 < DAYS_COUNT; d1++) {
                    for (let p1 = 0; p1 < MAX_PERIODS; p1++) {
                        const cell1 = this.state.grid[cId]?.[d1]?.[p1];
                        if (!cell1 || cell1.subjectId === 'WORSHIP' || cell1.subjectId === 'FREE' || cell1.isManual) continue;

                        let moved = false;
                        for (let d2 = 0; d2 < DAYS_COUNT && !moved; d2++) {
                            for (let p2 = 0; p2 < MAX_PERIODS; p2++) {
                                if (d2 < d1 || (d2 === d1 && p2 <= p1)) {
                                    // Check earlier empty slots too for cross-day load balancing, skip duplicate swaps
                                    const earlierCell = this.state.grid[cId]?.[d2]?.[p2];
                                    if (earlierCell) continue;
                                }
                                if (this.isMandatedFreeSlot('', d2, p2)) continue;
                                const cell2 = this.state.grid[cId]?.[d2]?.[p2] || null;
                                if (cell2) {
                                    if (cell2.subjectId === 'WORSHIP' || cell2.subjectId === 'FREE' || cell2.isManual) continue;
                                    if (cell1.subjectId === cell2.subjectId) continue;
                                }

                                if (isFastLayoutOnly && d2 !== d1 && cell2 && currentClassPenalty < 40) continue;

                                if (!canPlaceCellAt(cId, cell1, d2, p2, cell2, d1, p1)) continue;
                                if (cell2 && !canPlaceCellAt(cId, cell2, d1, p1, cell1, d2, p2)) continue;

                                const affectedTeachers = [
                                    ...this.extractCellTeacherIds(cell1),
                                    ...this.extractCellTeacherIds(cell2)
                                ];
                                const beforeTotal = currentClassPenalty + computeTeacherPenaltyForIds(affectedTeachers);

                                applyTeacherDelta(cId, cell1, d1, p1, false);
                                applyTeacherDelta(cId, cell2, d2, p2, false);
                                this.state.grid[cId][d2][p2] = cell1;
                                this.state.grid[cId][d1][p1] = cell2;
                                applyTeacherDelta(cId, cell1, d2, p2, true);
                                applyTeacherDelta(cId, cell2, d1, p1, true);

                                const afterClassPenalty = computeClassScore(cId);
                                const afterTotal = afterClassPenalty + computeTeacherPenaltyForIds(affectedTeachers);

                                if (afterTotal < beforeTotal - 0.5) {
                                    currentClassPenalty = afterClassPenalty;
                                    anyImproved = true;
                                    moved = true;
                                    break;
                                } else {
                                    applyTeacherDelta(cId, cell1, d2, p2, false);
                                    applyTeacherDelta(cId, cell2, d1, p1, false);
                                    this.state.grid[cId][d1][p1] = cell1;
                                    this.state.grid[cId][d2][p2] = cell2;
                                    applyTeacherDelta(cId, cell1, d1, p1, true);
                                    applyTeacherDelta(cId, cell2, d2, p2, true);
                                }
                            }
                        }
                    }
                }
            }

            if (!anyImproved) break;
        }

        this.rebuildStateFromGrid();
    }

    private rebuildStateFromGrid() {
        this.state.teacherSchedule = Array.from({ length: this.teachers.length }, () =>
            Array.from({ length: DAYS_COUNT }, () => new Array(MAX_PERIODS).fill(''))
        );
        this.state.teacherDailyLoad = Array.from({ length: this.teachers.length }, () => new Array(DAYS_COUNT).fill(0));
        this.state.teacherWeeklyLoad = new Array(this.teachers.length).fill(0);
        this.state.classDailySubjects = Array.from({ length: this.classes.length }, () =>
            Array.from({ length: DAYS_COUNT }, () => new Set<string>())
        );
        this.state.classDailyLoad = Array.from({ length: this.classes.length }, () => new Array(DAYS_COUNT).fill(0));
        this.state.classDailyCoreCount = Array.from({ length: this.classes.length }, () => new Array(DAYS_COUNT).fill(0));

        for (const classObj of this.classes) {
            const cIdx = this.classToIndex.get(classObj.id);
            if (cIdx === undefined) continue;

            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[classObj.id]?.[d]?.[p];
                    if (!cell || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;

                    this.state.classDailySubjects[cIdx][d].add(cell.subjectId);
                    this.state.classDailyLoad[cIdx][d]++;
                    const sub = this.subjectMap.get(cell.subjectId);
                    if (sub?.isCore) {
                        this.state.classDailyCoreCount[cIdx][d]++;
                    }

                    const tids = this.extractCellTeacherIds(cell);
                    tids.forEach(tid => {
                        const tIdx = this.teacherToIndex.get(tid);
                        if (tIdx !== undefined) {
                            this.state.teacherSchedule[tIdx][d][p] = classObj.id;
                            this.state.teacherDailyLoad[tIdx][d]++;
                            this.state.teacherWeeklyLoad[tIdx]++;
                        }
                    });
                }
            }
        }
    }

    private countPlacedTasks(): number {
        let placed = 0;
        for (const cId in this.state.grid) {
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[cId]?.[d]?.[p];
                    if (cell && cell.subjectId !== 'FREE' && cell.subjectId !== 'WORSHIP') placed++;
                }
            }
        }
        return placed;
    }

    private isCompleteGrid(): boolean {
        const placed = this.countPlacedTasks();
        const maxCapacityPossible = this.classes.length * TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS;
        return placed >= Math.min(this.totalRequiredSlots, maxCapacityPossible);
    }

    /**
     * Cross-Class 2-Step Ejection Chain Repair:
     * When `task` has no free qualified teacher in any open slot of `classObj`, finds an open slot (d, p)
     * where a qualified teacher T is busy in another non-manual class `otherClassId`, and moves or swaps
     * `otherClassId`'s cell to another valid slot so Teacher T becomes free for `task`.
     */
    private attemptCrossClassEjectionRepair(task: Task, classObj: Class, cIdx: number): boolean {
        if (this.isLayoutOnlyMode() || task.candidateTeacherSets.length === 0) return false;

        const sub = this.subjectMap.get(task.subjectId);
        if (!sub) return false;
        const maxDaily = resolveMaxPerDay(sub);

        const openTargetSlots: { d: number; p: number }[] = [];
        for (let d = 0; d < DAYS_COUNT; d++) {
            if (this.computeDaySubjectCount(classObj.id, d, task.subjectId) >= maxDaily) continue;
            for (let p = 0; p < MAX_PERIODS; p++) {
                if (this.state.grid[classObj.id]?.[d]?.[p]) continue;
                if (this.isMandatedFreeSlot(classObj.category, d, p)) continue;
                if (this.isStrictMorningCore(task.subjectId) && p >= 4) continue;
                if (p > 0 && this.state.grid[classObj.id]?.[d]?.[p - 1]?.subjectId === task.subjectId) continue;
                if (p < MAX_PERIODS - 1 && this.state.grid[classObj.id]?.[d]?.[p + 1]?.subjectId === task.subjectId) continue;
                openTargetSlots.push({ d, p });
            }
        }

        if (openTargetSlots.length === 0) return false;

        for (const candidateSet of task.candidateTeacherSets) {
            if (candidateSet.length !== 1) continue;
            const tid = candidateSet[0];
            const tIdx = this.teacherToIndex.get(tid);
            const teacherObj = this.teacherMap.get(tid);
            if (tIdx === undefined || !teacherObj) continue;
            if (this.state.teacherWeeklyLoad[tIdx] >= 38) continue;

            for (const slot of openTargetSlots) {
                const { d, p } = slot;
                if (teacherObj.availability?.[d]?.[p] === Availability.UNAVAILABLE) continue;

                const blockingClassId = this.state.teacherSchedule[tIdx][d][p];
                if (!blockingClassId || blockingClassId === classObj.id) continue;

                const otherClass = this.classMap.get(blockingClassId);
                const otherCIdx = this.classToIndex.get(blockingClassId);
                if (!otherClass || otherCIdx === undefined) continue;

                const blockingCell = this.state.grid[blockingClassId]?.[d]?.[p];
                if (!blockingCell || blockingCell.isManual || blockingCell.subjectId === 'FREE' || blockingCell.subjectId === 'WORSHIP') {
                    continue;
                }

                const blockingSub = this.subjectMap.get(blockingCell.subjectId);
                if (!blockingSub) continue;
                const blockingMaxDaily = resolveMaxPerDay(blockingSub);
                const blockingTids = this.extractCellTeacherIds(blockingCell);

                // Option 1: Relocate blockingCell cleanly to an empty slot (d2, p2) in blockingClassId
                for (let d2 = 0; d2 < DAYS_COUNT; d2++) {
                    if (d2 !== d && this.computeDaySubjectCount(blockingClassId, d2, blockingCell.subjectId) >= blockingMaxDaily) {
                        continue;
                    }
                    for (let p2 = 0; p2 < MAX_PERIODS; p2++) {
                        if (d2 === d && p2 === p) continue;
                        if (this.state.grid[blockingClassId]?.[d2]?.[p2]) continue;
                        if (this.isMandatedFreeSlot(otherClass.category, d2, p2)) continue;
                        if (this.isStrictMorningCore(blockingCell.subjectId) && p2 >= 4) continue;
                        if (p2 > 0 && !(d2 === d && p2 - 1 === p) && this.state.grid[blockingClassId]?.[d2]?.[p2 - 1]?.subjectId === blockingCell.subjectId) continue;
                        if (p2 < MAX_PERIODS - 1 && !(d2 === d && p2 + 1 === p) && this.state.grid[blockingClassId]?.[d2]?.[p2 + 1]?.subjectId === blockingCell.subjectId) continue;

                        let canRelocate = true;
                        for (const btid of blockingTids) {
                            if (!this.isTeacherValidAtSlot(btid, d2, p2, 1, blockingClassId, false)) {
                                canRelocate = false;
                                break;
                            }
                        }
                        if (!canRelocate) continue;

                        this.moveCellWithinClass(blockingClassId, otherCIdx, d, p, d2, p2);
                        if (this.isTeacherValidAtSlot(tid, d, p, 1)) {
                            this.applyTask({ ...task, teacherIds: [tid] }, d, p, cIdx);
                            return true;
                        } else {
                            this.moveCellWithinClass(blockingClassId, otherCIdx, d2, p2, d, p);
                        }
                    }
                }

                // Option 2: Swap blockingCell at (d, p) with another cell in blockingClassId at (d2, p2)
                for (let d2 = 0; d2 < DAYS_COUNT; d2++) {
                    for (let p2 = 0; p2 < MAX_PERIODS; p2++) {
                        if (d2 === d && p2 === p) continue;
                        const partnerCell = this.state.grid[blockingClassId]?.[d2]?.[p2];
                        if (!partnerCell || partnerCell.isManual || partnerCell.subjectId === 'FREE' || partnerCell.subjectId === 'WORSHIP') continue;
                        if (partnerCell.subjectId === blockingCell.subjectId) continue;

                        if (this.isStrictMorningCore(blockingCell.subjectId) && p2 >= 4) continue;
                        if (this.isStrictMorningCore(partnerCell.subjectId) && p >= 4) continue;

                        const partnerSub = this.subjectMap.get(partnerCell.subjectId);
                        if (!partnerSub) continue;
                        const partnerMaxDaily = resolveMaxPerDay(partnerSub);

                        if (d2 !== d) {
                            if (this.computeDaySubjectCount(blockingClassId, d2, blockingCell.subjectId) >= blockingMaxDaily) continue;
                            if (this.computeDaySubjectCount(blockingClassId, d, partnerCell.subjectId) >= partnerMaxDaily) continue;
                        }

                        if (p2 > 0 && !(d2 === d && p2 - 1 === p) && this.state.grid[blockingClassId]?.[d2]?.[p2 - 1]?.subjectId === blockingCell.subjectId) continue;
                        if (p2 < MAX_PERIODS - 1 && !(d2 === d && p2 + 1 === p) && this.state.grid[blockingClassId]?.[d2]?.[p2 + 1]?.subjectId === blockingCell.subjectId) continue;
                        if (p > 0 && !(d2 === d && p - 1 === p2) && this.state.grid[blockingClassId]?.[d]?.[p - 1]?.subjectId === partnerCell.subjectId) continue;
                        if (p < MAX_PERIODS - 1 && !(d2 === d && p + 1 === p2) && this.state.grid[blockingClassId]?.[d]?.[p + 1]?.subjectId === partnerCell.subjectId) continue;

                        const partnerTids = this.extractCellTeacherIds(partnerCell);
                        const blockingSet = new Set(blockingTids);
                        const partnerSet = new Set(partnerTids);

                        let swapValid = true;
                        for (const btid of blockingTids) {
                            if (partnerSet.has(btid)) continue;
                            if (!this.isTeacherValidAtSlot(btid, d2, p2, 1, blockingClassId, false)) {
                                swapValid = false;
                                break;
                            }
                        }
                        if (!swapValid) continue;

                        for (const ptid of partnerTids) {
                            if (blockingSet.has(ptid)) continue;
                            if (!this.isTeacherValidAtSlot(ptid, d, p, 1, blockingClassId, false)) {
                                swapValid = false;
                                break;
                            }
                        }
                        if (!swapValid) continue;

                        this.swapCellsWithinClass(blockingClassId, d, p, d2, p2);
                        if (this.isTeacherValidAtSlot(tid, d, p, 1)) {
                            this.applyTask({ ...task, teacherIds: [tid] }, d, p, cIdx);
                            return true;
                        } else {
                            this.swapCellsWithinClass(blockingClassId, d, p, d2, p2);
                        }
                    }
                }
            }
        }

        return false;
    }

    private moveCellWithinClass(cId: string, cIdx: number, fromD: number, fromP: number, toD: number, toP: number) {
        const cell = this.state.grid[cId][fromD][fromP];
        if (!cell) return;
        const tids = this.extractCellTeacherIds(cell);

        for (const tid of tids) {
            const tIdx = this.teacherToIndex.get(tid);
            if (tIdx !== undefined) {
                this.state.teacherSchedule[tIdx][fromD][fromP] = '';
                this.state.teacherDailyLoad[tIdx][fromD] = Math.max(0, this.state.teacherDailyLoad[tIdx][fromD] - 1);
                this.state.teacherSchedule[tIdx][toD][toP] = cId;
                this.state.teacherDailyLoad[tIdx][toD]++;
            }
        }

        this.state.grid[cId][toD][toP] = cell;
        this.state.grid[cId][fromD][fromP] = null;

        this.state.classDailyLoad[cIdx][fromD] = Math.max(0, this.state.classDailyLoad[cIdx][fromD] - 1);
        this.state.classDailyLoad[cIdx][toD]++;
        this.state.classDailySubjects[cIdx][toD].add(cell.subjectId);
        if (this.computeDaySubjectCount(cId, fromD, cell.subjectId) === 0) {
            this.state.classDailySubjects[cIdx][fromD].delete(cell.subjectId);
        }
        if (this.subjectMap.get(cell.subjectId)?.isCore) {
            this.state.classDailyCoreCount[cIdx][fromD] = Math.max(0, this.state.classDailyCoreCount[cIdx][fromD] - 1);
            this.state.classDailyCoreCount[cIdx][toD]++;
        }
    }

    private swapCellsWithinClass(cId: string, d1: number, p1: number, d2: number, p2: number) {
        const cell1 = this.state.grid[cId][d1][p1];
        const cell2 = this.state.grid[cId][d2][p2];
        const tids1 = this.extractCellTeacherIds(cell1);
        const tids2 = this.extractCellTeacherIds(cell2);

        if (!this.isLayoutOnlyMode()) {
            for (const tid of tids1) {
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx !== undefined) {
                    this.state.teacherSchedule[tIdx][d1][p1] = '';
                    this.state.teacherDailyLoad[tIdx][d1] = Math.max(0, this.state.teacherDailyLoad[tIdx][d1] - 1);
                }
            }
            for (const tid of tids2) {
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx !== undefined) {
                    this.state.teacherSchedule[tIdx][d2][p2] = '';
                    this.state.teacherDailyLoad[tIdx][d2] = Math.max(0, this.state.teacherDailyLoad[tIdx][d2] - 1);
                }
            }
        }

        this.state.grid[cId][d2][p2] = cell1;
        this.state.grid[cId][d1][p1] = cell2;

        if (!this.isLayoutOnlyMode()) {
            for (const tid of tids1) {
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx !== undefined) {
                    this.state.teacherSchedule[tIdx][d2][p2] = cId;
                    this.state.teacherDailyLoad[tIdx][d2]++;
                }
            }
            for (const tid of tids2) {
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx !== undefined) {
                    this.state.teacherSchedule[tIdx][d1][p1] = cId;
                    this.state.teacherDailyLoad[tIdx][d1]++;
                }
            }
        }
    }

    private attemptAugmentingVacancyShift(task: Task, classObj: Class, cIdx: number, requireTeacher = false): boolean {
        const sub = this.subjectMap.get(task.subjectId);
        if (!sub) return false;
        const maxDaily = resolveMaxPerDay(sub);

        const validTargetDays: number[] = [];
        for (let d = 0; d < DAYS_COUNT; d++) {
            if (this.computeDaySubjectCount(classObj.id, d, task.subjectId) < maxDaily) {
                validTargetDays.push(d);
            }
        }
        if (validTargetDays.length === 0) return false;

        const emptySlots: { d: number; p: number }[] = [];
        for (let d = 0; d < DAYS_COUNT; d++) {
            for (let p = 0; p < MAX_PERIODS; p++) {
                if (!this.state.grid[classObj.id]?.[d]?.[p] && !this.isMandatedFreeSlot(classObj.category, d, p)) {
                    emptySlots.push({ d, p });
                }
            }
        }
        if (emptySlots.length === 0) return false;

        for (const targetDay of validTargetDays) {
            for (let donorP = 0; donorP < MAX_PERIODS; donorP++) {
                const donorCell = this.state.grid[classObj.id]?.[targetDay]?.[donorP];
                if (!donorCell || donorCell.isManual || donorCell.subjectId === 'FREE' || donorCell.subjectId === 'WORSHIP') continue;
                if (donorCell.subjectId === task.subjectId) continue;

                const donorSub = this.subjectMap.get(donorCell.subjectId);
                if (!donorSub) continue;
                const donorMaxDaily = resolveMaxPerDay(donorSub);

                for (const emptySlot of emptySlots) {
                    if (emptySlot.d === targetDay) continue;
                    if (this.computeDaySubjectCount(classObj.id, emptySlot.d, donorCell.subjectId) >= donorMaxDaily) continue;
                    if (this.isStrictMorningCore(donorCell.subjectId) && emptySlot.p >= 4) continue;
                    if (this.isStrictMorningCore(task.subjectId) && donorP >= 4) continue;

                    let donorTeacherClash = false;
                    const donorTids = this.extractCellTeacherIds(donorCell);
                    if (!this.isLayoutOnlyMode() && donorTids.length > 0) {
                        for (const tid of donorTids) {
                            if (!this.isTeacherValidAtSlot(tid, emptySlot.d, emptySlot.p, 1, classObj.id, false)) {
                                donorTeacherClash = true;
                                break;
                            }
                        }
                    }
                    if (donorTeacherClash) continue;

                    let taskTeachers: string[] = [];
                    if (!this.isLayoutOnlyMode() && task.candidateTeacherSets.length > 0) {
                        const chosen = this.pickBestTeacherSetForSlot(task, targetDay, donorP);
                        if (chosen && chosen.length > 0) {
                            taskTeachers = chosen;
                        } else if (requireTeacher) {
                            continue;
                        }
                    }

                    this.moveCellWithinClass(classObj.id, cIdx, targetDay, donorP, emptySlot.d, emptySlot.p);
                    this.applyTask({ ...task, teacherIds: taskTeachers }, targetDay, donorP, cIdx);
                    return true;
                }
            }
        }
        return false;
    }

    private fillUnplacedTasksForClass(classObj: Class, classTasks: Task[]) {
        const cIdx = this.classToIndex.get(classObj.id);
        if (cIdx === undefined) return;

        const classSubjects = getEligibleSubjectsForClass(classObj, this.subjects);

        for (const task of classTasks) {
            const sub = classSubjects.find(s => s.id === task.subjectId);
            if (!sub) continue;

            let countPlaced = 0;
            for (let d = 0; d < DAYS_COUNT; d++) {
                countPlaced += this.computeDaySubjectCount(classObj.id, d, task.subjectId);
            }

            const requiredForSub = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
            if (countPlaced >= requiredForSub) continue;

            // 1. Valid slots with relaxed consecutive/core limits (dynamic teacher aware)
            const slots = this.findValidSlots(task, classObj, cIdx, true);
            if (slots.length > 0) {
                this.applyTask({ ...task, teacherIds: slots[0].teacherIds }, slots[0].d, slots[0].p, cIdx);
                continue;
            }

            // 2. Teacher-preserving intra-class shift & cross-class ejection chain
            if (!this.isLayoutOnlyMode() && task.candidateTeacherSets.length > 0) {
                if (this.attemptAugmentingVacancyShift(task, classObj, cIdx, true)) continue;
                if (this.attemptCrossClassEjectionRepair(task, classObj, cIdx)) continue;
            }

            // 3. Emergency placement relaxing consecutive limit while still finding a clash-free qualified teacher
            const maxDaily = resolveMaxPerDay(sub);
            let placedEmergency = false;
            if (!this.isLayoutOnlyMode() && task.candidateTeacherSets.length > 0) {
                for (let d = 0; d < DAYS_COUNT && !placedEmergency; d++) {
                    if (this.computeDaySubjectCount(classObj.id, d, task.subjectId) >= maxDaily) continue;
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        if (this.state.grid[classObj.id]?.[d]?.[p] || this.isMandatedFreeSlot(classObj.category, d, p)) continue;
                        const picked = this.pickBestTeacherSetForSlot(task, d, p);
                        if (picked && picked.length > 0) {
                            this.applyTask({ ...task, teacherIds: picked }, d, p, cIdx);
                            placedEmergency = true;
                            break;
                        }
                    }
                }
            } else if (this.isLayoutOnlyMode()) {
                for (let d = 0; d < DAYS_COUNT && !placedEmergency; d++) {
                    if (this.computeDaySubjectCount(classObj.id, d, task.subjectId) >= maxDaily) continue;
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        if (this.state.grid[classObj.id]?.[d]?.[p] || this.isMandatedFreeSlot(classObj.category, d, p)) continue;
                        this.applyTask({ ...task, teacherIds: [] }, d, p, cIdx);
                        placedEmergency = true;
                        break;
                    }
                }
            }

            // 4. Intra-class vacancy shift (without teacher requirement if faculty exhausted)
            if (!placedEmergency) {
                placedEmergency = this.attemptAugmentingVacancyShift(task, classObj, cIdx, false);
            }

            // 5. Last-resort capacity completion
            if (!placedEmergency) {
                for (let d = 0; d < DAYS_COUNT && !placedEmergency; d++) {
                    if (this.computeDaySubjectCount(classObj.id, d, task.subjectId) >= maxDaily) continue;
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        if (!this.state.grid[classObj.id]?.[d]?.[p] && !this.isMandatedFreeSlot(classObj.category, d, p)) {
                            this.applyTask({ ...task, teacherIds: [] }, d, p, cIdx);
                            placedEmergency = true;
                            if (!this.isLayoutOnlyMode()) {
                                this.bottlenecks.add(`Teacher Capacity Shortage: Scheduled ${sub.name} for ${classObj.name} with unassigned faculty to avoid dropped lesson.`);
                            }
                            break;
                        }
                    }
                }
            }

            if (!placedEmergency) {
                for (let d = 0; d < DAYS_COUNT && !placedEmergency; d++) {
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        if (!this.state.grid[classObj.id]?.[d]?.[p] && !this.isMandatedFreeSlot(classObj.category, d, p)) {
                            this.applyTask({ ...task, teacherIds: [] }, d, p, cIdx);
                            placedEmergency = true;
                            this.bottlenecks.add(`Schedule Compression: Scheduled ${sub.name} for ${classObj.name} in available slot to ensure 100% timetable completion.`);
                            break;
                        }
                    }
                }
            }
        }
    }

    private fillUnplacedTasks() {
        for (const classObj of this.classes) {
            const classTasks = this.tasks.filter(t => t.classId === classObj.id);
            if (classTasks.length > 0) {
                this.fillUnplacedTasksForClass(classObj, classTasks);
            }
        }
    }

    /**
     * Post-solve rescue pass for any lessons that received empty teacherIds during emergency completion.
     * Tries direct assignment, intra-class slot swap, or cross-class ejection chain to bind a real qualified teacher.
     */
    private repairUnassignedTeacherSlots() {
        if (this.isLayoutOnlyMode()) return;

        for (const classObj of this.classes) {
            const cId = classObj.id;
            const cIdx = this.classToIndex.get(cId);
            if (cIdx === undefined) continue;

            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[cId]?.[d]?.[p];
                    if (!cell || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;
                    if (this.extractCellTeacherIds(cell).length > 0) continue;

                    const sub = this.subjectMap.get(cell.subjectId);
                    if (!sub) continue;

                    const qualified = this.teachers
                        .filter(t => isTeacherQualifiedForSubject(t, sub))
                        .sort((a, b) => {
                            const wa = this.state.teacherWeeklyLoad[this.teacherToIndex.get(a.id) ?? -1] ?? 99;
                            const wb = this.state.teacherWeeklyLoad[this.teacherToIndex.get(b.id) ?? -1] ?? 99;
                            return wa - wb;
                        });
                    if (qualified.length === 0) continue;

                    // 1. Direct free qualified teacher at (d, p)
                    const directTeacher = qualified.find(t => this.isTeacherValidAtSlot(t.id, d, p, 1));
                    if (directTeacher) {
                        const tIdx = this.teacherToIndex.get(directTeacher.id)!;
                        cell.teacherId = directTeacher.id;
                        cell.teacherIds = [directTeacher.id];
                        this.state.teacherSchedule[tIdx][d][p] = cId;
                        this.state.teacherDailyLoad[tIdx][d]++;
                        this.state.teacherWeeklyLoad[tIdx]++;
                        continue;
                    }

                    // 2. Intra-class swap with another cell (d2, p2) where a qualified teacher IS free for cell
                    let rescued = false;
                    const subMaxDaily = resolveMaxPerDay(sub);

                    for (let d2 = 0; d2 < DAYS_COUNT && !rescued; d2++) {
                        for (let p2 = 0; p2 < MAX_PERIODS && !rescued; p2++) {
                            if (d2 === d && p2 === p) continue;
                            if (this.isMandatedFreeSlot(classObj.category, d2, p2)) continue;
                            const partner = this.state.grid[cId]?.[d2]?.[p2];
                            if (!partner || partner.isManual || partner.subjectId === 'FREE' || partner.subjectId === 'WORSHIP') continue;
                            if (partner.subjectId === cell.subjectId) continue;

                            if (this.isStrictMorningCore(cell.subjectId) && p2 >= 4) continue;
                            if (this.isStrictMorningCore(partner.subjectId) && p >= 4) continue;

                            const partnerSub = this.subjectMap.get(partner.subjectId);
                            if (!partnerSub) continue;
                            if (d2 !== d) {
                                if (this.computeDaySubjectCount(cId, d2, cell.subjectId) >= subMaxDaily) continue;
                                if (this.computeDaySubjectCount(cId, d, partner.subjectId) >= resolveMaxPerDay(partnerSub)) continue;
                            }

                            if (p2 > 0 && !(d2 === d && p2 - 1 === p) && this.state.grid[cId]?.[d2]?.[p2 - 1]?.subjectId === cell.subjectId) continue;
                            if (p2 < MAX_PERIODS - 1 && !(d2 === d && p2 + 1 === p) && this.state.grid[cId]?.[d2]?.[p2 + 1]?.subjectId === cell.subjectId) continue;
                            if (p > 0 && !(d2 === d && p - 1 === p2) && this.state.grid[cId]?.[d]?.[p - 1]?.subjectId === partner.subjectId) continue;
                            if (p < MAX_PERIODS - 1 && !(d2 === d && p + 1 === p2) && this.state.grid[cId]?.[d]?.[p + 1]?.subjectId === partner.subjectId) continue;

                            const altForCell = qualified.find(t => this.isTeacherValidAtSlot(t.id, d2, p2, 1));
                            if (!altForCell) continue;

                            const partnerTids = this.extractCellTeacherIds(partner);
                            const partnerValidAtDP = partnerTids.every(ptid => this.isTeacherValidAtSlot(ptid, d, p, 1, cId, false));
                            if (!partnerValidAtDP) continue;

                            this.swapCellsWithinClass(cId, d, p, d2, p2);
                            const tIdx = this.teacherToIndex.get(altForCell.id)!;
                            cell.teacherId = altForCell.id;
                            cell.teacherIds = [altForCell.id];
                            this.state.teacherSchedule[tIdx][d2][p2] = cId;
                            this.state.teacherDailyLoad[tIdx][d2]++;
                            this.state.teacherWeeklyLoad[tIdx]++;
                            rescued = true;
                        }
                    }

                    if (rescued) continue;

                    // 3. Cross-class 2-step ejection for this cell at (d, p)
                    for (const t of qualified) {
                        const tIdx = this.teacherToIndex.get(t.id);
                        if (tIdx === undefined || this.state.teacherWeeklyLoad[tIdx] >= 38) continue;
                        if (t.availability?.[d]?.[p] === Availability.UNAVAILABLE) continue;

                        const blockingClassId = this.state.teacherSchedule[tIdx][d][p];
                        if (!blockingClassId || blockingClassId === cId) continue;

                        const otherClass = this.classMap.get(blockingClassId);
                        const otherCIdx = this.classToIndex.get(blockingClassId);
                        if (!otherClass || otherCIdx === undefined) continue;

                        const blockingCell = this.state.grid[blockingClassId]?.[d]?.[p];
                        if (!blockingCell || blockingCell.isManual || blockingCell.subjectId === 'FREE' || blockingCell.subjectId === 'WORSHIP') continue;

                        const blockingSub = this.subjectMap.get(blockingCell.subjectId);
                        if (!blockingSub) continue;
                        const blockingMaxDaily = resolveMaxPerDay(blockingSub);
                        const blockingTids = this.extractCellTeacherIds(blockingCell);

                        // Try swapping blockingCell inside blockingClassId with another cell at (d2, p2)
                        for (let d2 = 0; d2 < DAYS_COUNT && !rescued; d2++) {
                            for (let p2 = 0; p2 < MAX_PERIODS && !rescued; p2++) {
                                if (d2 === d && p2 === p) continue;
                                const pCell = this.state.grid[blockingClassId]?.[d2]?.[p2];
                                if (!pCell || pCell.isManual || pCell.subjectId === 'FREE' || pCell.subjectId === 'WORSHIP') continue;
                                if (pCell.subjectId === blockingCell.subjectId) continue;
                                if (this.isStrictMorningCore(blockingCell.subjectId) && p2 >= 4) continue;
                                if (this.isStrictMorningCore(pCell.subjectId) && p >= 4) continue;

                                const pSub = this.subjectMap.get(pCell.subjectId);
                                if (!pSub) continue;
                                if (d2 !== d) {
                                    if (this.computeDaySubjectCount(blockingClassId, d2, blockingCell.subjectId) >= blockingMaxDaily) continue;
                                    if (this.computeDaySubjectCount(blockingClassId, d, pCell.subjectId) >= resolveMaxPerDay(pSub)) continue;
                                }

                                if (p2 > 0 && !(d2 === d && p2 - 1 === p) && this.state.grid[blockingClassId]?.[d2]?.[p2 - 1]?.subjectId === blockingCell.subjectId) continue;
                                if (p2 < MAX_PERIODS - 1 && !(d2 === d && p2 + 1 === p) && this.state.grid[blockingClassId]?.[d2]?.[p2 + 1]?.subjectId === blockingCell.subjectId) continue;
                                if (p > 0 && !(d2 === d && p - 1 === p2) && this.state.grid[blockingClassId]?.[d]?.[p - 1]?.subjectId === pCell.subjectId) continue;
                                if (p < MAX_PERIODS - 1 && !(d2 === d && p + 1 === p2) && this.state.grid[blockingClassId]?.[d]?.[p + 1]?.subjectId === pCell.subjectId) continue;

                                const pTids = this.extractCellTeacherIds(pCell);
                                const bSet = new Set(blockingTids);
                                const pSet = new Set(pTids);

                                const bOk = blockingTids.every(btid => pSet.has(btid) || this.isTeacherValidAtSlot(btid, d2, p2, 1, blockingClassId, false));
                                const pOk = pTids.every(ptid => bSet.has(ptid) || this.isTeacherValidAtSlot(ptid, d, p, 1, blockingClassId, false));
                                if (!bOk || !pOk) continue;

                                this.swapCellsWithinClass(blockingClassId, d, p, d2, p2);
                                if (this.isTeacherValidAtSlot(t.id, d, p, 1)) {
                                    cell.teacherId = t.id;
                                    cell.teacherIds = [t.id];
                                    this.state.teacherSchedule[tIdx][d][p] = cId;
                                    this.state.teacherDailyLoad[tIdx][d]++;
                                    this.state.teacherWeeklyLoad[tIdx]++;
                                    rescued = true;
                                } else {
                                    this.swapCellsWithinClass(blockingClassId, d, p, d2, p2);
                                }
                            }
                        }
                        if (rescued) break;
                    }
                }
            }
        }
    }

    private async backtrackClass(
        classObj: Class,
        classTasks: Task[],
        taskIdx: number
    ): Promise<boolean> {
        this.iterations++;
        this.classSolveIterations++;
        const now = Date.now();

        if (now - this.lastYieldTime > 50) {
            this.lastYieldTime = now;
            if (this.onProgress) {
                const totalEstimated = Math.max(1, this.tasks.length);
                const placedEstimate = this.countPlacedTasks();
                const pct = Math.min(0.99, placedEstimate / totalEstimated);
                this.onProgress(pct, `Optimizing timetable for ${classObj.name}... (${this.iterations} iterations)`);
            }
            if (this.onSync && now - this.lastSyncTime >= 250) {
                this.lastSyncTime = now;
                const gridCopy = JSON.parse(JSON.stringify(this.state.grid));
                this.onSync(gridCopy);
            }
            await new Promise(r => setTimeout(r, 0));
        }

        if (this.aborted) return false;
        const maxPerClassIters = this.isLayoutOnlyMode() ? 2000 : 3500;
        if (this.classSolveIterations > maxPerClassIters) {
            return false;
        }
        if (now - this.startTime > this.timeLimit) {
            this.aborted = true;
            this.bottlenecks.add(`Time limit reached (${Math.round(this.timeLimit / 1000)} seconds).`);
            return false;
        }

        if (taskIdx >= classTasks.length) {
            return true;
        }

        const task = classTasks[taskIdx];
        const cIdx = this.classToIndex.get(task.classId)!;

        const validSlots = this.findValidSlots(task, classObj, cIdx, false);

        for (const slot of validSlots) {
            const scopedTask: Task = { ...task, teacherIds: slot.teacherIds };
            this.applyTask(scopedTask, slot.d, slot.p, cIdx);

            const ok = await this.backtrackClass(classObj, classTasks, taskIdx + 1);
            if (ok) return true;

            this.revertTask(scopedTask, slot.d, slot.p, cIdx);
            if (this.aborted || this.classSolveIterations > maxPerClassIters) return false;
        }

        return false;
    }

    private findValidSlots(task: Task, classObj: Class, cIdx: number, relaxConstraints = false): SlotCandidate[] {
        const candidates: SlotCandidate[] = [];

        const classSubjects = getEligibleSubjectsForClass(classObj, this.subjects);
        const totalCorePeriods = classSubjects.filter(s => s.isCore).reduce((acc, s) => acc + (s.defaultPeriodCount || s.periodsPerWeek || 3), 0);
        const dynamicHeavyLimit = Math.max(6, Math.ceil(totalCorePeriods / 5) + 1);
        const heavyLimit = this.config.style?.heavySubjectLimitPerDay
            ? Math.max(this.config.style.heavySubjectLimitPerDay, dynamicHeavyLimit)
            : dynamicHeavyLimit;

        const sub = this.subjectMap.get(task.subjectId);
        const maxDaily = sub ? resolveMaxPerDay(sub) : 2;

        for (let d = 0; d < DAYS_COUNT; d++) {
            if (task.fixedDay !== undefined && task.fixedDay !== d) continue;
            if (this.computeDaySubjectCount(classObj.id, d, task.subjectId) >= maxDaily) continue;

            if (!relaxConstraints) {
                if (task.isCore && this.state.classDailyCoreCount[cIdx][d] >= heavyLimit) {
                    continue;
                }
            }

            const maxP = task.duration === 2 ? MAX_PERIODS - 1 : MAX_PERIODS;
            for (let p = 0; p < maxP; p++) {
                if (!this.canPlaceInClass(task, classObj, d, p, relaxConstraints)) continue;

                const pickedTeachers = this.pickBestTeacherSetForSlot(task, d, p);
                if (pickedTeachers === null) continue;

                const score = this.scoreSlot(d, p, task, pickedTeachers, classObj, cIdx);
                candidates.push({ d, p, teacherIds: pickedTeachers, score });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates;
    }

    private canPlaceInClass(task: Task, classObj: Class, d: number, p: number, allowConsecutive = false): boolean {
        if (this.isMandatedFreeSlot(classObj.category, d, p)) return false;
        if (task.duration === 2 && this.isMandatedFreeSlot(classObj.category, d, p + 1)) return false;

        if (this.state.grid[classObj.id][d][p]) return false;
        if (task.duration === 2 && this.state.grid[classObj.id][d][p + 1]) return false;

        if (this.isStrictMorningCore(task.subjectId)) {
            if (p >= 4) return false;
            if (task.duration === 2 && (p + 1) >= 4) return false;
        } else if (p < 4 && !allowConsecutive) {
            let otherMorningCount = 0;
            for (let mp = 0; mp < 4; mp++) {
                const cell = this.state.grid[classObj.id][d][mp];
                if (cell && !this.isStrictMorningCore(cell.subjectId)) {
                    otherMorningCount++;
                }
            }
            if (otherMorningCount >= 2) {
                return false;
            }
        }

        if (!allowConsecutive) {
            if (p > 0 && this.state.grid[classObj.id][d][p - 1]?.subjectId === task.subjectId) {
                return false;
            }
            if (p < MAX_PERIODS - 1 && this.state.grid[classObj.id][d][p + 1]?.subjectId === task.subjectId) {
                return false;
            }
        }

        return true;
    }

    private scoreSlot(
        d: number,
        p: number,
        task: Task,
        pickedTeachers: string[],
        classObj: Class,
        cIdx: number
    ): number {
        const goal = this.config.goal || 'BALANCED';
        let score = 0;

        // 1. Class daily load balance
        const load = this.state.classDailyLoad[cIdx][d];
        score -= load * (goal === 'STUDENT_FRIENDLY' ? 22 : 15);

        // 2. Core subjects timing discipline (P1..P4 morning)
        if (task.isCore) {
            const morningWeight = goal === 'STUDENT_FRIENDLY' ? 75 : (goal === 'BALANCED' ? 60 : 45);
            score += p < 4 ? morningWeight : -140;
        } else if (p >= 3) {
            score += 25;
        }

        // 3. Same subject at same period repetition penalty & period diversity bonus
        let samePeriodCount = 0;
        for (let od = 0; od < DAYS_COUNT; od++) {
            if (od !== d && this.state.grid[classObj.id][od]?.[p]?.subjectId === task.subjectId) {
                samePeriodCount++;
            }
        }
        if (samePeriodCount > 0) {
            score -= samePeriodCount * 95;
        } else {
            score += 40;
        }

        // 4. Identical 2-subject sequence penalty
        if (p > 0) {
            const prevSub = this.state.grid[classObj.id][d]?.[p - 1]?.subjectId;
            if (prevSub && prevSub !== 'FREE' && prevSub !== 'WORSHIP') {
                for (let od = 0; od < DAYS_COUNT; od++) {
                    if (
                        od !== d &&
                        this.state.grid[classObj.id][od]?.[p - 1]?.subjectId === prevSub &&
                        this.state.grid[classObj.id][od]?.[p]?.subjectId === task.subjectId
                    ) {
                        score -= 50;
                    }
                }
            }
        }

        // 5. Teacher balance, gap minimization, and preference scoring
        if (!this.isLayoutOnlyMode() && pickedTeachers.length > 0) {
            const teacherMult = goal === 'TEACHER_FRIENDLY' ? 2.0 : (this.strategy === 'TEACHER_SPREAD' ? 1.5 : 1.0);
            for (const tid of pickedTeachers) {
                const teacher = this.teacherMap.get(tid);
                const tIdx = this.teacherToIndex.get(tid);
                if (teacher?.availability?.[d]) {
                    const avail = teacher.availability[d][p];
                    if (avail === Availability.PREFER) score += (goal === 'TEACHER_FRIENDLY' ? 55 : 25);
                    if (avail === Availability.AVOID) score -= (goal === 'TEACHER_FRIENDLY' ? 50 : 22);
                }
                if (tIdx !== undefined) {
                    const dayLoad = this.state.teacherDailyLoad[tIdx][d];
                    score -= dayLoad * 14 * teacherMult;

                    const idleGaps = this.computeTeacherIdleGapsOnDay(tIdx, d, p);
                    score -= idleGaps * 12 * teacherMult;
                }
            }
        }

        // 6. Spread occurrences evenly across distinct weekdays (1/day Mon-Fri before repeating a day)
        const existingDayCount = this.computeDaySubjectCount(classObj.id, d, task.subjectId);
        if (existingDayCount > 0) {
            score -= existingDayCount * 450;
        } else {
            score += 55;
        }
        if (
            this.state.classDailySubjects[cIdx][d - 1]?.has(task.subjectId) ||
            this.state.classDailySubjects[cIdx][d + 1]?.has(task.subjectId)
        ) {
            score -= 20;
        }

        // 7. Avoid consecutive identical subjects
        if (p > 0 && this.state.grid[classObj.id][d][p - 1]?.subjectId === task.subjectId) score -= 100;
        if (p < MAX_PERIODS - 1 && this.state.grid[classObj.id][d][p + 1]?.subjectId === task.subjectId) score -= 100;

        // 8. Class compactness
        if (p === 0 || this.state.grid[classObj.id][d][p - 1]) score += 10;

        // 9. Friday relaxation
        if (this.config.style?.fridayRelaxation && d === 4 && p >= 4) {
            score -= 20;
        }

        // 10. Mild controlled randomness to break ties
        score += Math.random() * 6;

        return score;
    }

    private applyTask(task: Task, d: number, p: number, cIdx: number) {
        const cell: TimetableCell = {
            subjectId: task.subjectId,
            teacherId: task.teacherIds && task.teacherIds.length > 0 ? task.teacherIds[0] : '',
            teacherIds: task.teacherIds || [],
            isManual: false,
            isDouble: task.duration === 2,
            classId: task.classId
        };

        this.state.grid[task.classId][d][p] = cell;
        this.state.classDailySubjects[cIdx][d].add(task.subjectId);
        this.state.classDailyLoad[cIdx][d]++;
        if (task.isCore) this.state.classDailyCoreCount[cIdx][d]++;

        task.teacherIds.forEach(tid => {
            if (tid === 'SYSTEM') return;
            const tIdx = this.teacherToIndex.get(tid);
            if (tIdx !== undefined) {
                this.state.teacherSchedule[tIdx][d][p] = task.classId;
                this.state.teacherDailyLoad[tIdx][d]++;
                this.state.teacherWeeklyLoad[tIdx]++;
            }
        });

        if (task.duration === 2) {
            this.state.grid[task.classId][d][p + 1] = cell;
            this.state.classDailyLoad[cIdx][d]++;
            if (task.isCore) this.state.classDailyCoreCount[cIdx][d]++;
            task.teacherIds.forEach(tid => {
                if (tid === 'SYSTEM') return;
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx !== undefined) {
                    this.state.teacherSchedule[tIdx][d][p + 1] = task.classId;
                    this.state.teacherDailyLoad[tIdx][d]++;
                    this.state.teacherWeeklyLoad[tIdx]++;
                }
            });
        }
    }

    private revertTask(task: Task, d: number, p: number, cIdx: number) {
        this.state.grid[task.classId][d][p] = null;
        if (this.computeDaySubjectCount(task.classId, d, task.subjectId) === 0) {
            this.state.classDailySubjects[cIdx][d].delete(task.subjectId);
        }
        this.state.classDailyLoad[cIdx][d]--;
        if (task.isCore) this.state.classDailyCoreCount[cIdx][d]--;

        task.teacherIds.forEach(tid => {
            if (tid === 'SYSTEM') return;
            const tIdx = this.teacherToIndex.get(tid);
            if (tIdx !== undefined) {
                this.state.teacherSchedule[tIdx][d][p] = '';
                this.state.teacherDailyLoad[tIdx][d] = Math.max(0, this.state.teacherDailyLoad[tIdx][d] - 1);
                this.state.teacherWeeklyLoad[tIdx] = Math.max(0, this.state.teacherWeeklyLoad[tIdx] - 1);
            }
        });

        if (task.duration === 2) {
            this.state.grid[task.classId][d][p + 1] = null;
            this.state.classDailyLoad[cIdx][d]--;
            if (task.isCore) this.state.classDailyCoreCount[cIdx][d]--;
            task.teacherIds.forEach(tid => {
                if (tid === 'SYSTEM') return;
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx !== undefined) {
                    this.state.teacherSchedule[tIdx][d][p + 1] = '';
                    this.state.teacherDailyLoad[tIdx][d] = Math.max(0, this.state.teacherDailyLoad[tIdx][d] - 1);
                    this.state.teacherWeeklyLoad[tIdx] = Math.max(0, this.state.teacherWeeklyLoad[tIdx] - 1);
                }
            });
        }
    }

    public getReasoningReport(): ReasoningReport {
        let totalPlaced = 0;
        let morningCoreCount = 0;
        let totalCoreCount = 0;
        let prefMatches = 0;
        let totalPrefEvaluated = 0;
        let unassignedTeacherSlots = 0;

        const isClassLayoutOnly = this.isLayoutOnlyMode();

        for (const cId in this.state.grid) {
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[cId][d][p];
                    if (cell && cell.subjectId !== 'FREE' && cell.subjectId !== 'WORSHIP') {
                        totalPlaced++;
                        const sub = this.subjectMap.get(cell.subjectId);
                        if (sub?.isCore) {
                            totalCoreCount++;
                            if (p < 4) morningCoreCount++;
                        }
                        const tids = this.extractCellTeacherIds(cell);
                        if (!isClassLayoutOnly && tids.length === 0) {
                            unassignedTeacherSlots++;
                        }
                        tids.forEach(tid => {
                            const t = this.teacherMap.get(tid);
                            if (t) {
                                totalPrefEvaluated++;
                                const avail = t.availability?.[d]?.[p];
                                if (avail === undefined || avail === Availability.PREFER || avail === Availability.AVAILABLE) {
                                    prefMatches++;
                                }
                            }
                        });
                    }
                }
            }
        }

        let totalConfiguredRequired = 0;
        let totalMissingLessons = 0;
        let totalExcessLessons = 0;
        let totalUnassignedSlots = 0;
        let totalUnavoidableCurriculumDeficit = 0;
        let totalAvoidableUnplacedSlots = 0;
        let dailyLimitViolations = 0;
        const eligibleTeachingSlots = TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS;
        const classBreakdown: Record<string, ClassAllocationSummary> = {};

        for (const classObj of this.classes) {
            const classSubjects = getEligibleSubjectsForClass(classObj, this.subjects);
            const scheduledCounts = new Map<string, number>();
            const dailyCounts: Record<number, Record<string, number>> = {};
            let classScheduled = 0;

            for (let d = 0; d < DAYS_COUNT; d++) {
                dailyCounts[d] = {};
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[classObj.id]?.[d]?.[p];
                    if (cell && cell.subjectId !== 'FREE' && cell.subjectId !== 'WORSHIP') {
                        classScheduled++;
                        scheduledCounts.set(cell.subjectId, (scheduledCounts.get(cell.subjectId) || 0) + 1);
                        dailyCounts[d][cell.subjectId] = (dailyCounts[d][cell.subjectId] || 0) + 1;
                    }
                }
            }

            let classRequired = 0;
            let classMissing = 0;
            let classExcess = 0;

            for (const sub of classSubjects) {
                const req = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
                classRequired += req;
                const scheduled = scheduledCounts.get(sub.id) || 0;
                if (scheduled < req) {
                    classMissing += req - scheduled;
                } else if (scheduled > req) {
                    classExcess += scheduled - req;
                    this.bottlenecks.add(`Excess Lesson: Class ${classObj.name} scheduled ${scheduled}/${req} periods for ${sub.name}.`);
                }
            }

            const classCapacityDeficit = Math.max(0, classRequired - eligibleTeachingSlots);
            const classAvoidableMissing = Math.max(0, Math.min(classRequired, eligibleTeachingSlots) - classScheduled);

            totalUnavoidableCurriculumDeficit += classCapacityDeficit;
            totalAvoidableUnplacedSlots += classAvoidableMissing;

            if (classCapacityDeficit > 0) {
                this.bottlenecks.add(`Curriculum Capacity Deficit: Class ${classObj.name} has ${classRequired} configured periods exceeding the ${eligibleTeachingSlots} teaching slots (${classCapacityDeficit} excess).`);
            }
            if (classAvoidableMissing > 0) {
                this.bottlenecks.add(`Avoidable Unplaced Lessons: Class ${classObj.name} has ${classAvoidableMissing} teachable periods unplaced.`);
            }

            for (let d = 0; d < DAYS_COUNT; d++) {
                for (const subId in dailyCounts[d]) {
                    const sub = classSubjects.find(s => s.id === subId);
                    const maxDaily = sub ? resolveMaxPerDay(sub) : 2;
                    if (dailyCounts[d][subId] > maxDaily) {
                        dailyLimitViolations++;
                    }
                }
            }

            const unassigned = Math.max(0, eligibleTeachingSlots - classScheduled);
            totalConfiguredRequired += classRequired;
            totalMissingLessons += classMissing;
            totalExcessLessons += classExcess;
            totalUnassignedSlots += unassigned;

            classBreakdown[classObj.id] = {
                eligibleSlots: eligibleTeachingSlots,
                requiredLessons: classRequired,
                additionalLessons: classExcess,
                totalScheduled: classScheduled,
                unfilledSlots: unassigned
            };
        }

        // Teacher clash & balance evaluation
        let teacherClashes = 0;
        let teacherBalanceScore = 100;

        if (!isClassLayoutOnly) {
            const teacherUsage: Record<string, string[]> = {};
            for (const classObj of this.classes) {
                for (let d = 0; d < DAYS_COUNT; d++) {
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        const cell = this.state.grid[classObj.id]?.[d]?.[p];
                        if (!cell || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;
                        const tids = this.extractCellTeacherIds(cell);
                        tids.forEach(tid => {
                            const key = `${tid}-${d}-${p}`;
                            if (!teacherUsage[key]) teacherUsage[key] = [];
                            teacherUsage[key].push(classObj.name);
                        });
                    }
                }
            }
            for (const [key, classesUsing] of Object.entries(teacherUsage)) {
                if (classesUsing.length > 1) {
                    teacherClashes++;
                    const [tid, d, p] = key.split('-');
                    const tObj = this.teacherMap.get(tid);
                    this.bottlenecks.add(`Teacher Clash: ${tObj?.name || tid} scheduled simultaneously with classes (${classesUsing.join(', ')}) on ${DAYS[parseInt(d)]} P${parseInt(p) + 1}.`);
                }
            }

            let activeTeachers = 0;
            let balanceAccum = 0;
            for (let tIdx = 0; tIdx < this.teachers.length; tIdx++) {
                const weekly = this.state.teacherWeeklyLoad[tIdx];
                if (weekly === 0) continue;
                activeTeachers++;
                const counts = this.state.teacherDailyLoad[tIdx];
                const minDay = Math.min(...counts);
                const maxDay = Math.max(...counts);
                const spread = maxDay - minDay;
                let gaps = 0;
                for (let d = 0; d < DAYS_COUNT; d++) {
                    gaps += this.computeTeacherIdleGapsOnDay(tIdx, d);
                }
                const spreadPenalty = Math.max(0, spread - 1) * 7;
                const gapPenalty = gaps * 3;
                balanceAccum += Math.max(0, 100 - spreadPenalty - gapPenalty);
            }
            if (activeTeachers > 0) {
                teacherBalanceScore = Math.round(balanceAccum / activeTeachers);
            }
        }

        const completionRate = totalConfiguredRequired > 0
            ? Math.round((Math.max(0, totalConfiguredRequired - totalMissingLessons) / totalConfiguredRequired) * 100)
            : 100;
        const morningCoreRatio = totalCoreCount > 0 ? Math.round((morningCoreCount / totalCoreCount) * 100) : 100;
        const teacherPrefRate = (!isClassLayoutOnly && totalPrefEvaluated > 0) ? Math.round((prefMatches / totalPrefEvaluated) * 100) : 100;
        const hardConstraintsSatisfied =
            totalAvoidableUnplacedSlots === 0 &&
            totalExcessLessons === 0 &&
            (isClassLayoutOnly || teacherClashes === 0) &&
            dailyLimitViolations === 0;

        const unassignedPenalty = isClassLayoutOnly || totalPlaced === 0
            ? 0
            : Math.min(25, Math.round((unassignedTeacherSlots / totalPlaced) * 30));

        const baseScore = isClassLayoutOnly
            ? Math.round((completionRate * 0.65) + (morningCoreRatio * 0.35))
            : Math.round((completionRate * 0.45) + (morningCoreRatio * 0.2) + (teacherPrefRate * 0.15) + (teacherBalanceScore * 0.2)) - unassignedPenalty;

        const score = hardConstraintsSatisfied
            ? Math.max(0, baseScore)
            : Math.max(0, baseScore - (totalAvoidableUnplacedSlots * 15 + totalExcessLessons * 10 + teacherClashes * 15));

        const recommendations: string[] = [];
        if (isClassLayoutOnly) {
            recommendations.push('Class-Layout-Only Draft: Class timetable generated without faculty assignment. Teacher validation deferred.');
        }
        if (totalUnavoidableCurriculumDeficit > 0) {
            recommendations.push(`${totalUnavoidableCurriculumDeficit} periods exceed the 38-slot teaching capacity across classes. Reduce configured curriculum frequencies to eliminate structural deficit.`);
        }
        if (totalAvoidableUnplacedSlots > 0) {
            recommendations.push(`${totalAvoidableUnplacedSlots} lessons could not be scheduled within available teaching slots.`);
        }
        if (totalExcessLessons > 0) {
            recommendations.push(`${totalExcessLessons} excess lessons detected above configured curriculum frequencies.`);
        }
        if (!isClassLayoutOnly && unassignedTeacherSlots > 0) {
            recommendations.push(`${unassignedTeacherSlots} scheduled lessons have no available qualified teacher due to capacity limits — add or assign qualified teachers to fill remaining faculty slots.`);
        }
        if (morningCoreRatio < 70) {
            recommendations.push('Core subjects are spilling into afternoon periods. Try reducing manual locks in early morning periods.');
        }
        if (!isClassLayoutOnly && teacherPrefRate < 80) {
            recommendations.push("Some teachers were scheduled during 'Avoid' slots due to class timetable demands.");
        }
        if (!isClassLayoutOnly && teacherBalanceScore < 70) {
            recommendations.push('Some teachers have uneven daily loads or mid-day wait gaps; try relaxing strict availability constraints or selecting Teacher-Friendly optimization.');
        }

        return {
            score,
            goal: this.config.goal,
            iterations: this.iterations,
            executionTimeMs: Date.now() - (this.startTime || Date.now()),
            hardConstraintsSatisfied,
            totalSlotsScheduled: totalPlaced,
            totalSlotsRequired: totalConfiguredRequired,
            totalCurriculumRequired: totalConfiguredRequired,
            totalAdditionalAllocated: totalExcessLessons,
            unavoidableCurriculumDeficit: totalUnavoidableCurriculumDeficit,
            avoidableUnplacedSlots: totalAvoidableUnplacedSlots,
            isClassLayoutOnly,
            classBreakdown,
            completionRate,
            teacherPreferenceSatisfactionRate: teacherPrefRate,
            morningCoreRatio,
            teacherBalanceScore,
            unassignedTeacherSlots,
            bottlenecks: Array.from(this.bottlenecks),
            recommendations: recommendations.length > 0 ? recommendations : ['Curriculum frequencies exactly satisfied with balanced teacher & student workloads.'],
            summary: `Required lessons: ${totalConfiguredRequired} | Scheduled: ${totalPlaced} | Unavoidable Deficit: ${totalUnavoidableCurriculumDeficit} | Avoidable Unplaced: ${totalAvoidableUnplacedSlots} | Excess: ${totalExcessLessons} | Unassigned slots: ${totalUnassignedSlots} | Unassigned teachers: ${unassignedTeacherSlots} | Teacher Balance: ${teacherBalanceScore}% | Teacher conflicts: ${teacherClashes}`
        };
    }
}
