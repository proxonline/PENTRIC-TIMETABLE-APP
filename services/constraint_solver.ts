import { Teacher, Class, Subject, TimetableGrid, TimetableCell, Conflict, GeneratorConfig, Availability, OptimizationGoal, ReasoningReport, ClassAllocationSummary } from '../types';
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
    duration: 1 | 2;
    isFixed: boolean;
    fixedDay?: number;
    fixedPeriod?: number;
    priority: number; // Higher is more important
    teacherLoad: number; // Number of classes assigned to the teacher(s)
    isCore: boolean;
}

interface SolverState {
    grid: TimetableGrid;
    teacherSchedule: string[][][]; // [teacherIndex][day][period] -> classId or empty
    classDailySubjects: Set<string>[][]; // [classIndex][day]
    classDailyLoad: number[][]; // [classIndex][day]
    classDailyCoreCount: number[][]; // [classIndex][day]
}

export class ConstraintSolver {
    private teachers: Teacher[];
    private classes: Class[];
    private subjects: Subject[];
    private config: GeneratorConfig;
    private tasks: Task[] = [];
    private state: SolverState;
    private teacherToIndex: Map<string, number>;
    private classToIndex: Map<string, number>;
    private bestSolution: TimetableGrid | null = null;
    private bestScore: number = -Infinity;
    private iterations = 0;
    private classSolveIterations = 0;
    private maxIterations = 50000;
    private startTime = 0;
    private timeLimit = 8000;

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
        this.onProgress = onProgress;
        this.onSync = onSync;

        this.teacherToIndex = new Map(teachers.map((t, i) => [t.id, i]));
        this.classToIndex = new Map(classes.map((c, i) => [c.id, i]));

        // Initialize State
        this.state = {
            grid: {},
            teacherSchedule: Array.from({ length: teachers.length }, () => 
                Array.from({ length: DAYS_COUNT }, () => new Array(MAX_PERIODS).fill(''))
            ),
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
                    // Rule 2: Friday worship — final two periods only (P7 & P8 for 8-period timetable)
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

    private checkTeacherOverbooking() {
        const teacherTotalLoad: Record<string, number> = {};
        this.tasks.forEach(t => {
            t.teacherIds.forEach(tid => {
                if (tid === 'SYSTEM') return;
                teacherTotalLoad[tid] = (teacherTotalLoad[tid] || 0) + t.duration;
            });
        });

        for (const tid in teacherTotalLoad) {
            const load = teacherTotalLoad[tid];
            if (load > 38) {
                const teacher = this.teachers.find(t => t.id === tid);
                const msg = `Teacher ${teacher?.name || tid} is assigned ${load} periods/week (max capacity is 38).`;
                console.warn(msg);
                this.bottlenecks.add(msg);
                if (this.onProgress) {
                    this.onProgress(0, `Warning: ${msg}`);
                }
            }
        }
    }

    private get bottlenecks(): Set<string> {
        return this.bottleneckList;
    }

    private isMandatedFreeSlot(category: string, day: number, period: number): boolean {
        // Rule 2: Friday final two periods are explicitly reserved for worship
        if (day === 4 && period >= MAX_PERIODS - 2) {
            return true;
        }
        return false;
    }

    private isStrictMorningCore(subjectId: string): boolean {
        const id = subjectId.toLowerCase();
        return id.startsWith('math') || id.includes('math') || id.startsWith('eng') || id.includes('eng');
    }

    private prepareTasks(existingGrid?: TimetableGrid) {
        this.totalRequiredSlots = 0;
        this.totalCurriculumRequiredSlots = 0;

        // 1. Process Manual Locks from Existing Grid
        const manualSubjectCounts: Record<string, Record<string, number>> = {}; // classId -> subjectId -> count
        const manualSubjectDays: Record<string, Record<string, Set<number>>> = {}; // classId -> subjectId -> Set<day>

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

        // Track projected period counts to prevent overloading individual teachers
        const teacherPeriodCounts = new Map<string, number>();
        const eligibleTeachingSlotsPerClass = TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS; // 38 slots

        // Helper to select qualified teacher(s) for a class and subject
        const assignTeachersForSubject = (classObj: Class, sub: Subject, countNeeded: number): string[] => {
            let teacherIds: string[] = [];

            // 1. Direct Administrator Assignment or Preferred Teacher
            if (sub.preferredTeacherId && this.teachers.some(t => t.id === sub.preferredTeacherId && isTeacherQualifiedForSubject(t, sub))) {
                teacherIds = [sub.preferredTeacherId];
            } else if (sub.assignedTeacherIds && sub.assignedTeacherIds.length > 0) {
                const validTids = sub.assignedTeacherIds.filter(id => this.teachers.some(t => t.id === id && isTeacherQualifiedForSubject(t, sub)));
                if (validTids.length > 0) {
                    teacherIds = validTids;
                }
            }

            if (teacherIds.length === 0) {
                const classAssigned = this.teachers.filter(t => isTeacherQualifiedForSubject(t, sub) && t.assignedClasses.includes(classObj.id));
                const allQualified = this.teachers.filter(t => isTeacherQualifiedForSubject(t, sub));

                if (PARALLEL_SUBJECTS.includes(sub.id)) {
                    const assignedTeachers = classAssigned.length > 0 ? classAssigned : allQualified;
                    const underloaded = assignedTeachers.filter(t => ((teacherPeriodCounts.get(t.id) || 0) + countNeeded) <= 35);
                    const selected = underloaded.length > 0 ? underloaded : (assignedTeachers.length > 0 ? [assignedTeachers.sort((a, b) => (teacherPeriodCounts.get(a.id) || 0) - (teacherPeriodCounts.get(b.id) || 0))[0]] : []);
                    teacherIds = selected.map(t => t.id);
                } else {
                    let selectedTeacher: Teacher | undefined;

                    // Prefer teacher assigned to class with load <= 28
                    const underloadedClassTeachers = classAssigned.filter(t => ((teacherPeriodCounts.get(t.id) || 0) + countNeeded) <= 28);
                    if (underloadedClassTeachers.length > 0) {
                        underloadedClassTeachers.sort((a, b) => (teacherPeriodCounts.get(a.id) || 0) - (teacherPeriodCounts.get(b.id) || 0));
                        selectedTeacher = underloadedClassTeachers[0];
                    } else {
                        // Secondary: any teacher in school with load <= 28
                        const underloadedSchoolTeachers = allQualified.filter(t => ((teacherPeriodCounts.get(t.id) || 0) + countNeeded) <= 28);
                        if (underloadedSchoolTeachers.length > 0) {
                            underloadedSchoolTeachers.sort((a, b) => (teacherPeriodCounts.get(a.id) || 0) - (teacherPeriodCounts.get(b.id) || 0));
                            selectedTeacher = underloadedSchoolTeachers[0];
                        } else if (classAssigned.length > 0) {
                            classAssigned.sort((a, b) => (teacherPeriodCounts.get(a.id) || 0) - (teacherPeriodCounts.get(b.id) || 0));
                            selectedTeacher = classAssigned[0];
                        } else if (allQualified.length > 0) {
                            allQualified.sort((a, b) => (teacherPeriodCounts.get(a.id) || 0) - (teacherPeriodCounts.get(b.id) || 0));
                            selectedTeacher = allQualified[0];
                        }
                    }

                    if (selectedTeacher) {
                        teacherIds = [selectedTeacher.id];
                    }
                }
            }

            if (teacherIds.length > 0) {
                teacherIds.forEach(tid => {
                    teacherPeriodCounts.set(tid, (teacherPeriodCounts.get(tid) || 0) + countNeeded);
                });
            } else {
                if (this.teachers.length > 0) {
                    this.bottlenecks.add(`Teacher Capacity Shortage: No qualified teacher available to teach ${sub.name} in ${classObj.name}.`);
                } else {
                    this.bottlenecks.add(`Missing Faculty Data: No teachers registered in school to teach ${sub.name} for ${classObj.name}.`);
                }
            }

            return teacherIds;
        };

        // 2. Generate Tasks for each class strictly matching configured curriculum frequencies
        for (const classObj of this.classes) {
            const classSubjects = getEligibleSubjectsForClass(classObj, this.subjects);

            let classCurriculumTotal = 0;
            let classTasksNeeded = 0;
            for (const sub of classSubjects) {
                const manualCount = manualSubjectCounts[classObj.id]?.[sub.id] || 0;
                const requestedCount = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
                classCurriculumTotal += requestedCount;
                this.totalCurriculumRequiredSlots += requestedCount;
                this.totalRequiredSlots += requestedCount;

                const countNeeded = Math.max(0, requestedCount - manualCount);
                if (countNeeded <= 0) continue;

                classTasksNeeded += countNeeded;
                const teacherIds = assignTeachersForSubject(classObj, sub, countNeeded);
                const teacherLoad = teacherIds.reduce((acc, tid) => acc + (teacherPeriodCounts.get(tid) || 0), 0);

                // Distribute remaining daily core occurrences avoiding weekdays that already have a manual lock
                const lockedDays = manualSubjectDays[classObj.id]?.[sub.id] || new Set<number>();
                const availableDays = [0, 1, 2, 3, 4].filter(d => !lockedDays.has(d));

                for (let i = 0; i < countNeeded; i++) {
                    const isDailyCore = requestedCount === 5 && this.isStrictMorningCore(sub.id);
                    const fixedDay = isDailyCore && i < availableDays.length ? availableDays[i] : undefined;
                    this.tasks.push({
                        id: `${classObj.id}-${sub.id}-${i + 1}`,
                        classId: classObj.id,
                        subjectId: sub.id,
                        subjectName: sub.name,
                        teacherIds,
                        duration: 1,
                        isFixed: false,
                        fixedDay,
                        priority: sub.isCore ? 5 : 2,
                        teacherLoad,
                        isCore: sub.isCore
                    });
                }
            }

            // Flag structural capacity overload if configured curriculum exceeds available 38 teaching slots
            if (classCurriculumTotal > eligibleTeachingSlotsPerClass) {
                const excess = classCurriculumTotal - eligibleTeachingSlotsPerClass;
                this.bottlenecks.add(`${classObj.name} has ${classCurriculumTotal} configured curriculum periods, exceeding the ${eligibleTeachingSlotsPerClass} available teaching slots (excess of ${excess} periods).`);
            }
        }


        // Group tasks by class, then INTERLEAVE subjects round-robin with rotated starting subject
        // so tasks of the same subject do not sequentially monopolize period 0 / 1 across all 5 weekdays
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
                const subEntries = Array.from(subMap.entries());
                const res: Task[] = [];
                let round = 0;
                let hasMore = true;
                while (hasMore) {
                    hasMore = false;
                    // Rotate the starting subject in each round to distribute morning and afternoon slots
                    const offset = round % Math.max(1, subEntries.length);
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

        // Update Grid
        this.state.grid[classId][d][p] = cell;
        
        // Update Teacher Schedule
        if (cell.teacherIds) {
            cell.teacherIds.forEach(tid => {
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx !== undefined) {
                    this.state.teacherSchedule[tIdx][d][p] = classId;
                }
            });
        }

        // Update Class Daily Subjects
        this.state.classDailySubjects[cIdx][d].add(cell.subjectId);
        this.state.classDailyLoad[cIdx][d]++;
        const sub = this.subjects.find(s => s.id === cell.subjectId);
        if (sub?.isCore) {
            this.state.classDailyCoreCount[cIdx][d]++;
        }
    }

    public async solve(): Promise<{ success: boolean, grid: TimetableGrid }> {
        this.startTime = Date.now();
        this.lastYieldTime = Date.now();
        this.iterations = 0;
        this.bestScore = -1;
        this.bestSolution = null;

        // Group tasks by class
        const classTaskMap = new Map<string, Task[]>();
        for (const classObj of this.classes) {
            classTaskMap.set(classObj.id, []);
        }
        for (const task of this.tasks) {
            if (classTaskMap.has(task.classId)) {
                classTaskMap.get(task.classId)!.push(task);
            }
        }

        // Solve class-by-class
        for (const classObj of this.classes) {
            let classTasks = classTaskMap.get(classObj.id) || [];
            if (classTasks.length === 0) continue;

            // Cap search tasks to physical teaching capacity (38 slots)
            if (classTasks.length > TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS) {
                classTasks = classTasks.slice(0, TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS);
            }

            this.classSolveIterations = 0;
            const classSuccess = await this.backtrackClass(classObj, classTasks, 0);
            if (!classSuccess) {
                this.fillUnplacedTasksForClass(classObj, classTasks);
            }
        }

        // Clean-up and fallback pass across all tasks
        this.fillUnplacedTasks();
        this.optimizeWeeklyVariety();

        if (this.onSync) {
            this.onSync(JSON.parse(JSON.stringify(this.state.grid)));
        }

        const isComplete = this.isCompleteGrid();
        return { success: isComplete, grid: this.state.grid };
    }

    public optimizeWeeklyVariety() {
        const calculateRepetitionScore = (cId: string): number => {
            let score = 0;
            // 1. Same subject in same period across different days (Section 4.A)
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
                        score += (count - 1) * 100;
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
                            score += 40;
                        }
                    }
                }
            }
            return score;
        };

        for (const classObj of this.classes) {
            const cId = classObj.id;
            const cIdx = this.classToIndex.get(cId);
            if (cIdx === undefined) continue;

            let improved = true;
            let passes = 0;
            const maxPasses = 6;

            while (improved && passes < maxPasses) {
                improved = false;
                passes++;
                let currentScore = calculateRepetitionScore(cId);
                if (currentScore === 0) break;

                for (let d = 0; d < DAYS_COUNT; d++) {
                    for (let p1 = 0; p1 < MAX_PERIODS; p1++) {
                        for (let p2 = p1 + 1; p2 < MAX_PERIODS; p2++) {
                            const cell1 = this.state.grid[cId]?.[d]?.[p1];
                            const cell2 = this.state.grid[cId]?.[d]?.[p2];
                            if (!cell1 || !cell2) continue;
                            if (cell1.subjectId === 'WORSHIP' || cell2.subjectId === 'WORSHIP') continue;
                            if (cell1.isManual || cell2.isManual) continue;
                            if (cell1.subjectId === cell2.subjectId) continue;
                            if (cell1.subjectId === 'FREE' || cell2.subjectId === 'FREE') continue;

                            const sub1 = this.subjects.find(s => s.id === cell1.subjectId);
                            const sub2 = this.subjects.find(s => s.id === cell2.subjectId);

                            // Section 2: Core timing discipline. Keep core in periods 0..3 (P1..P4)
                            if (this.isStrictMorningCore(cell1.subjectId) && p2 >= 4) continue;
                            if (this.isStrictMorningCore(cell2.subjectId) && p1 >= 4) continue;
                            if (sub1?.isCore && p2 >= 4 && !sub2?.isCore) continue;
                            if (sub2?.isCore && p1 >= 4 && !sub1?.isCore) continue;

                            // Section 5: Avoid consecutive identical subjects on day d
                            if (p1 > 0 && p1 - 1 !== p2 && this.state.grid[cId]?.[d]?.[p1 - 1]?.subjectId === cell2.subjectId) continue;
                            if (p1 < MAX_PERIODS - 1 && p1 + 1 !== p2 && this.state.grid[cId]?.[d]?.[p1 + 1]?.subjectId === cell2.subjectId) continue;
                            if (p2 > 0 && p2 - 1 !== p1 && this.state.grid[cId]?.[d]?.[p2 - 1]?.subjectId === cell1.subjectId) continue;
                            if (p2 < MAX_PERIODS - 1 && p2 + 1 !== p1 && this.state.grid[cId]?.[d]?.[p2 + 1]?.subjectId === cell1.subjectId) continue;

                            // Section 5: Teacher clash & availability avoidance across all classes
                            let teacherClash = false;
                            const tids1 = cell1.teacherIds && cell1.teacherIds.length > 0 ? cell1.teacherIds : (cell1.teacherId ? [cell1.teacherId] : []);
                            for (const tid of tids1) {
                                if (tid === 'SYSTEM') continue;
                                const teacherObj = this.teachers.find(t => t.id === tid);
                                if (teacherObj?.availability?.[d]?.[p2] === Availability.UNAVAILABLE) {
                                    teacherClash = true;
                                    break;
                                }
                                const tIdx = this.teacherToIndex.get(tid);
                                if (tIdx !== undefined) {
                                    const occupiedBy = this.state.teacherSchedule[tIdx][d][p2];
                                    if (occupiedBy && occupiedBy !== cId) {
                                        teacherClash = true;
                                        break;
                                    }
                                }
                            }
                            if (teacherClash) continue;

                            const tids2 = cell2.teacherIds && cell2.teacherIds.length > 0 ? cell2.teacherIds : (cell2.teacherId ? [cell2.teacherId] : []);
                            for (const tid of tids2) {
                                if (tid === 'SYSTEM') continue;
                                const teacherObj = this.teachers.find(t => t.id === tid);
                                if (teacherObj?.availability?.[d]?.[p1] === Availability.UNAVAILABLE) {
                                    teacherClash = true;
                                    break;
                                }
                                const tIdx = this.teacherToIndex.get(tid);
                                if (tIdx !== undefined) {
                                    const occupiedBy = this.state.teacherSchedule[tIdx][d][p1];
                                    if (occupiedBy && occupiedBy !== cId) {
                                        teacherClash = true;
                                        break;
                                    }
                                }
                            }
                            if (teacherClash) continue;

                            // Perform tentative swap
                            this.state.grid[cId][d][p1] = cell2;
                            this.state.grid[cId][d][p2] = cell1;

                            const newScore = calculateRepetitionScore(cId);
                            if (newScore < currentScore) {
                                // Keep improving swap! Update teacher schedules
                                tids1.forEach(tid => {
                                    const tIdx = this.teacherToIndex.get(tid);
                                    if (tIdx !== undefined) {
                                        this.state.teacherSchedule[tIdx][d][p1] = '';
                                        this.state.teacherSchedule[tIdx][d][p2] = cId;
                                    }
                                });
                                tids2.forEach(tid => {
                                    const tIdx = this.teacherToIndex.get(tid);
                                    if (tIdx !== undefined) {
                                        this.state.teacherSchedule[tIdx][d][p2] = '';
                                        this.state.teacherSchedule[tIdx][d][p1] = cId;
                                    }
                                });
                                currentScore = newScore;
                                improved = true;
                            } else {
                                // Revert swap
                                this.state.grid[cId][d][p1] = cell1;
                                this.state.grid[cId][d][p2] = cell2;
                            }
                        }
                    }
                }
            }
        }
    }

    private rebuildStateFromGrid() {
        this.state.teacherSchedule = Array.from({ length: this.teachers.length }, () => 
            Array.from({ length: DAYS_COUNT }, () => new Array(MAX_PERIODS).fill(''))
        );
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
                    const sub = this.subjects.find(s => s.id === cell.subjectId);
                    if (sub?.isCore) {
                        this.state.classDailyCoreCount[cIdx][d]++;
                    }

                    const tids = cell.teacherIds && cell.teacherIds.length > 0 
                        ? cell.teacherIds 
                        : (cell.teacherId ? [cell.teacherId] : []);
                    tids.forEach(tid => {
                        if (tid === 'SYSTEM') return;
                        const tIdx = this.teacherToIndex.get(tid);
                        if (tIdx !== undefined) {
                            this.state.teacherSchedule[tIdx][d][p] = classObj.id;
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
        let placed = 0;
        for (const cId in this.state.grid) {
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[cId]?.[d]?.[p];
                    if (cell && cell.subjectId !== 'FREE' && cell.subjectId !== 'WORSHIP') placed++;
                }
            }
        }
        const maxCapacityPossible = this.classes.length * TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS;
        return placed >= Math.min(this.totalRequiredSlots, maxCapacityPossible);
    }

    private fillUnplacedTasksForClass(classObj: Class, classTasks: Task[]) {
        const cIdx = this.classToIndex.get(classObj.id);
        if (cIdx === undefined) return;

        const classSubjects = getEligibleSubjectsForClass(classObj, this.subjects);

        for (const task of classTasks) {
            let countPlaced = 0;
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[classObj.id]?.[d]?.[p];
                    if (cell && cell.subjectId === task.subjectId) {
                        countPlaced++;
                    }
                }
            }

            const sub = classSubjects.find(s => s.id === task.subjectId);
            if (!sub) continue;

            const requiredForSub = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
            if (countPlaced >= requiredForSub) continue;

            // 1. Find valid slots with relaxed daily core/subject limits
            const slots = this.findValidSlots(task, classObj, cIdx, true);
            if (slots.length > 0) {
                this.sortSlots(slots, task, classObj, cIdx);
                this.applyTask(task, slots[0].d, slots[0].p, cIdx);
                continue;
            }

            // 2. Emergency placement respecting maxDaily and avoiding consecutive identical subject
            const maxDaily = resolveMaxPerDay(sub);
            let placedEmergency = false;
            for (let d = 0; d < DAYS_COUNT; d++) {
                let currentSubCountOnDay = 0;
                for (let cp = 0; cp < MAX_PERIODS; cp++) {
                    if (this.state.grid[classObj.id]?.[d]?.[cp]?.subjectId === task.subjectId) {
                        currentSubCountOnDay++;
                    }
                }
                if (currentSubCountOnDay >= maxDaily) continue;

                for (let p = 0; p < MAX_PERIODS; p++) {
                    if (!this.state.grid[classObj.id]?.[d]?.[p] && !this.isMandatedFreeSlot(classObj.category, d, p)) {
                        if (this.isStrictMorningCore(task.subjectId) && p >= 4) continue;
                        if (p > 0 && this.state.grid[classObj.id]?.[d]?.[p - 1]?.subjectId === task.subjectId) continue;
                        if (p < MAX_PERIODS - 1 && this.state.grid[classObj.id]?.[d]?.[p + 1]?.subjectId === task.subjectId) continue;

                        let selectedTeacherIds = task.teacherIds;
                        let hasTeacherClash = false;
                        if (!this.config.classLayoutOnly && this.teachers.length > 0) {
                            for (const tid of task.teacherIds) {
                                if (tid === 'SYSTEM') continue;
                                const tIdx = this.teacherToIndex.get(tid);
                                if (tIdx !== undefined && this.state.teacherSchedule[tIdx][d][p]) {
                                    hasTeacherClash = true;
                                    break;
                                }
                            }
                            if (hasTeacherClash) {
                                const altTeacher = this.teachers.find(t => 
                                    isTeacherQualifiedForSubject(t, sub) && 
                                    this.teacherToIndex.get(t.id) !== undefined && 
                                    !this.state.teacherSchedule[this.teacherToIndex.get(t.id)!][d][p] &&
                                    t.availability?.[d]?.[p] !== Availability.UNAVAILABLE
                                );
                                if (altTeacher) {
                                    selectedTeacherIds = [altTeacher.id];
                                    hasTeacherClash = false;
                                }
                            }
                        }

                        if (!hasTeacherClash) {
                            const placedTask = { ...task, teacherIds: selectedTeacherIds };
                            this.applyTask(placedTask, d, p, cIdx);
                            placedEmergency = true;
                            break;
                        }
                    }
                }
                if (placedEmergency) break;
            }

            // 3. Fallback: if slots remain open and task is still unplaced, relax morning core restrictions
            if (!placedEmergency) {
                for (let d = 0; d < DAYS_COUNT; d++) {
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        if (!this.state.grid[classObj.id]?.[d]?.[p] && !this.isMandatedFreeSlot(classObj.category, d, p)) {
                            let hasTeacherClash = false;
                            if (!this.config.classLayoutOnly && this.teachers.length > 0) {
                                for (const tid of task.teacherIds) {
                                    if (tid === 'SYSTEM') continue;
                                    const tIdx = this.teacherToIndex.get(tid);
                                    if (tIdx !== undefined && this.state.teacherSchedule[tIdx][d][p]) {
                                        hasTeacherClash = true;
                                        break;
                                    }
                                }
                            }
                            if (!hasTeacherClash) {
                                this.applyTask(task, d, p, cIdx);
                                placedEmergency = true;
                                break;
                            }
                        }
                    }
                    if (placedEmergency) break;
                }
            }
        }
    }

    private fillUnplacedTasks() {
        for (const task of this.tasks) {
            const classObj = this.classes.find(c => c.id === task.classId);
            if (!classObj) continue;
            const cIdx = this.classToIndex.get(task.classId);
            if (cIdx === undefined) continue;

            let countPlaced = 0;
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[task.classId]?.[d]?.[p];
                    if (cell && cell.subjectId === task.subjectId) {
                        countPlaced++;
                    }
                }
            }

            const classSubjects = getEligibleSubjectsForClass(classObj, this.subjects);
            const sub = classSubjects.find(s => s.id === task.subjectId);
            if (!sub) continue;

            const requiredForSub = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
            if (countPlaced >= requiredForSub) continue;

            const slots = this.findValidSlots(task, classObj, cIdx, true);
            if (slots.length > 0) {
                this.sortSlots(slots, task, classObj, cIdx);
                this.applyTask(task, slots[0].d, slots[0].p, cIdx);
            } else {
                const maxDaily = resolveMaxPerDay(sub);
                let placedEmergency = false;
                for (let d = 0; d < DAYS_COUNT; d++) {
                    let currentSubCountOnDay = 0;
                    for (let cp = 0; cp < MAX_PERIODS; cp++) {
                        if (this.state.grid[task.classId]?.[d]?.[cp]?.subjectId === task.subjectId) {
                            currentSubCountOnDay++;
                        }
                    }
                    if (currentSubCountOnDay >= maxDaily) continue;

                    for (let p = 0; p < MAX_PERIODS; p++) {
                        if (!this.state.grid[task.classId]?.[d]?.[p] && !this.isMandatedFreeSlot(classObj.category, d, p)) {
                            if (this.isStrictMorningCore(task.subjectId) && p >= 4) continue;
                            if (p > 0 && this.state.grid[task.classId]?.[d]?.[p - 1]?.subjectId === task.subjectId) continue;
                            if (p < MAX_PERIODS - 1 && this.state.grid[task.classId]?.[d]?.[p + 1]?.subjectId === task.subjectId) continue;

                            let selectedTeacherIds = task.teacherIds;
                            let hasTeacherClash = false;
                            if (!this.config.classLayoutOnly && this.teachers.length > 0) {
                                for (const tid of task.teacherIds) {
                                    if (tid === 'SYSTEM') continue;
                                    const tIdx = this.teacherToIndex.get(tid);
                                    if (tIdx !== undefined && this.state.teacherSchedule[tIdx][d][p]) {
                                        hasTeacherClash = true;
                                        break;
                                    }
                                }
                                if (hasTeacherClash) {
                                    const altTeacher = this.teachers.find(t => 
                                        isTeacherQualifiedForSubject(t, sub) && 
                                        this.teacherToIndex.get(t.id) !== undefined && 
                                        !this.state.teacherSchedule[this.teacherToIndex.get(t.id)!][d][p] &&
                                        t.availability?.[d]?.[p] !== Availability.UNAVAILABLE
                                    );
                                    if (altTeacher) {
                                        selectedTeacherIds = [altTeacher.id];
                                        hasTeacherClash = false;
                                    }
                                }
                            }
                            if (!hasTeacherClash) {
                                const placedTask = { ...task, teacherIds: selectedTeacherIds };
                                this.applyTask(placedTask, d, p, cIdx);
                                placedEmergency = true;
                                break;
                            }
                        }
                    }
                    if (placedEmergency) break;
                }

                // Fallback: relax morning core restriction to ensure slots are not left unfilled
                if (!placedEmergency) {
                    for (let d = 0; d < DAYS_COUNT; d++) {
                        for (let p = 0; p < MAX_PERIODS; p++) {
                            if (!this.state.grid[task.classId]?.[d]?.[p] && !this.isMandatedFreeSlot(classObj.category, d, p)) {
                                let hasTeacherClash = false;
                                if (!this.config.classLayoutOnly && this.teachers.length > 0) {
                                    for (const tid of task.teacherIds) {
                                        if (tid === 'SYSTEM') continue;
                                        const tIdx = this.teacherToIndex.get(tid);
                                        if (tIdx !== undefined && this.state.teacherSchedule[tIdx][d][p]) {
                                            hasTeacherClash = true;
                                            break;
                                        }
                                    }
                                }
                                if (!hasTeacherClash) {
                                    this.applyTask(task, d, p, cIdx);
                                    placedEmergency = true;
                                    break;
                                }
                            }
                        }
                        if (placedEmergency) break;
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
        if (this.classSolveIterations > 2000) {
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

        const validSlots = this.findValidSlots(task, classObj, cIdx);
        this.sortSlots(validSlots, task, classObj, cIdx);

        for (const slot of validSlots) {
            this.applyTask(task, slot.d, slot.p, cIdx);

            const ok = await this.backtrackClass(classObj, classTasks, taskIdx + 1);
            if (ok) return true;

            this.revertTask(task, slot.d, slot.p, cIdx);
            if (this.aborted || this.classSolveIterations > 2000) return false;
        }

        return false;
    }

    private findValidSlots(task: Task, classObj: Class, cIdx: number, relaxConstraints = false): { d: number, p: number }[] {
        const slots: { d: number, p: number }[] = [];

        // Calculate dynamic core limit per day based on class curriculum demand
        const classSubjects = getEligibleSubjectsForClass(classObj, this.subjects);

        const totalCorePeriods = classSubjects.filter(s => s.isCore).reduce((acc, s) => acc + (s.defaultPeriodCount || s.periodsPerWeek || 3), 0);
        const dynamicHeavyLimit = Math.max(6, Math.ceil(totalCorePeriods / 5) + 1);
        const heavyLimit = this.config.style?.heavySubjectLimitPerDay
            ? Math.max(this.config.style.heavySubjectLimitPerDay, dynamicHeavyLimit)
            : dynamicHeavyLimit;

        const sub = classSubjects.find(s => s.id === task.subjectId);
        const maxDaily = sub ? resolveMaxPerDay(sub) : 2;


        for (let d = 0; d < DAYS_COUNT; d++) {
            if (task.fixedDay !== undefined && task.fixedDay !== d) {
                continue;
            }

            // Count current occurrences of this subject on day d
            let currentSubCountOnDay = 0;
            for (let p = 0; p < MAX_PERIODS; p++) {
                if (this.state.grid[classObj.id][d][p]?.subjectId === task.subjectId) {
                    currentSubCountOnDay++;
                }
            }
            if (currentSubCountOnDay >= maxDaily) {
                continue;
            }

            if (!relaxConstraints) {
                // Hard Constraint 2: Heavy core subject limit per day
                if (task.isCore && this.state.classDailyCoreCount[cIdx][d] >= heavyLimit) {
                    continue;
                }
            }

            const maxP = task.duration === 2 ? MAX_PERIODS - 1 : MAX_PERIODS;
            for (let p = 0; p < maxP; p++) {
                if (this.canPlace(task, classObj, d, p, relaxConstraints)) {
                    slots.push({ d, p });
                }
            }
        }
        return slots;
    }

    private canPlace(task: Task, classObj: Class, d: number, p: number, allowConsecutive = false): boolean {
        // 1. Mandated Free Slots (e.g. Friday afternoon closing)
        if (this.isMandatedFreeSlot(classObj.category, d, p)) return false;
        if (task.duration === 2 && this.isMandatedFreeSlot(classObj.category, d, p + 1)) return false;

        // 2. Grid Occupancy
        if (this.state.grid[classObj.id][d][p]) return false;
        if (task.duration === 2 && this.state.grid[classObj.id][d][p + 1]) return false;

        // 2b. Core Timing Rule (Section 2: Maths and English strictly in morning periods 0..3 = P1..P4)
        if (this.isStrictMorningCore(task.subjectId)) {
            if (p >= 4) return false;
            if (task.duration === 2 && (p + 1) >= 4) return false;
        } else if (p < 4 && !allowConsecutive) {
            // Reserve exactly 2 morning slots on day d for Math and English
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

        // 3. Avoid consecutive periods of the same subject (single-period rule)
        if (!allowConsecutive) {
            if (p > 0 && this.state.grid[classObj.id][d][p - 1]?.subjectId === task.subjectId) {
                return false;
            }
            if (p < MAX_PERIODS - 1 && this.state.grid[classObj.id][d][p + 1]?.subjectId === task.subjectId) {
                return false;
            }
        }

        // 4. Teacher Schedule & Explicit Availability Constraints
        if (this.config.classLayoutOnly || this.teachers.length === 0) {
            return true;
        }

        const maxConsecutive = this.config.maxConsecutiveTeacherPeriods || 4;

        for (const tid of task.teacherIds) {
            if (tid === 'SYSTEM') continue;
            const teacher = this.teachers.find(t => t.id === tid);
            const tIdx = this.teacherToIndex.get(tid);

            // Hard Check: Teacher already teaching in this slot
            if (tIdx !== undefined && this.state.teacherSchedule[tIdx][d][p]) return false;
            if (task.duration === 2 && tIdx !== undefined && this.state.teacherSchedule[tIdx][d][p + 1]) return false;

            // Hard Check: Explicit Teacher Unavailable Setting
            if (teacher && teacher.availability && teacher.availability[d]) {
                const avail1 = teacher.availability[d][p];
                if (avail1 === Availability.UNAVAILABLE) return false;

                if (task.duration === 2) {
                    const avail2 = teacher.availability[d][p + 1];
                    if (avail2 === Availability.UNAVAILABLE) return false;
                }
            }

            // Hard Check: Max consecutive periods for teacher
            if (tIdx !== undefined) {
                let consecutive = 1;
                // Check back
                let back = p - 1;
                while (back >= 0 && this.state.teacherSchedule[tIdx][d][back]) {
                    consecutive++;
                    back--;
                }
                // Check forward
                let fwd = p + task.duration;
                while (fwd < MAX_PERIODS && this.state.teacherSchedule[tIdx][d][fwd]) {
                    consecutive++;
                    fwd++;
                }

                if (consecutive > maxConsecutive) {
                    return false;
                }
            }
        }

        return true;
    }

    private applyTask(task: Task, d: number, p: number, cIdx: number) {
        const cell: TimetableCell = {
            subjectId: task.subjectId,
            teacherId: (task.teacherIds && task.teacherIds.length > 0) ? task.teacherIds[0] : '',
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
            const tIdx = this.teacherToIndex.get(tid);
            if (tIdx !== undefined) {
                this.state.teacherSchedule[tIdx][d][p] = task.classId;
            }
        });

        if (task.duration === 2) {
            this.state.grid[task.classId][d][p + 1] = cell;
            this.state.classDailyLoad[cIdx][d]++;
            if (task.isCore) this.state.classDailyCoreCount[cIdx][d]++;
            task.teacherIds.forEach(tid => {
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx !== undefined) {
                    this.state.teacherSchedule[tIdx][d][p + 1] = task.classId;
                }
            });
        }
    }

    private revertTask(task: Task, d: number, p: number, cIdx: number) {
        this.state.grid[task.classId][d][p] = null;
        let remainingOnDay = 0;
        for (let cp = 0; cp < MAX_PERIODS; cp++) {
            if (this.state.grid[task.classId][d][cp]?.subjectId === task.subjectId) {
                remainingOnDay++;
            }
        }
        if (remainingOnDay === 0) {
            this.state.classDailySubjects[cIdx][d].delete(task.subjectId);
        }
        this.state.classDailyLoad[cIdx][d]--;
        if (task.isCore) this.state.classDailyCoreCount[cIdx][d]--;

        task.teacherIds.forEach(tid => {
            const tIdx = this.teacherToIndex.get(tid);
            if (tIdx !== undefined) {
                this.state.teacherSchedule[tIdx][d][p] = '';
            }
        });

        if (task.duration === 2) {
            this.state.grid[task.classId][d][p + 1] = null;
            this.state.classDailyLoad[cIdx][d]--;
            if (task.isCore) this.state.classDailyCoreCount[cIdx][d]--;
            task.teacherIds.forEach(tid => {
                const tIdx = this.teacherToIndex.get(tid);
                if (tIdx !== undefined) {
                    this.state.teacherSchedule[tIdx][d][p + 1] = '';
                }
            });
        }
    }

    private sortSlots(slots: { d: number, p: number }[], task: Task, classObj: Class, cIdx: number) {
        const goal = this.config.goal || 'BALANCED';

        slots.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;

            // 1. Daily Load Balance (Prefer days with fewer scheduled subjects)
            const loadA = this.state.classDailyLoad[cIdx][a.d];
            const loadB = this.state.classDailyLoad[cIdx][b.d];
            scoreA -= loadA * 15;
            scoreB -= loadB * 15;

            // 2. Core Subjects Timing Discipline (Section 2 & 5)
            // Core subjects (Math, English, Science cores) must stay in morning periods (0..3 = P1..P4)
            if (task.isCore) {
                const morningWeight = (goal === 'STUDENT_FRIENDLY') ? 70 : (goal === 'BALANCED' ? 60 : 45);
                if (a.p < 4) scoreA += morningWeight;
                else scoreA -= 140;

                if (b.p < 4) scoreB += morningWeight;
                else scoreB -= 140;
            } else {
                // Non-core subjects prefer afternoon or late morning (balancing the day)
                if (a.p >= 3) scoreA += 25;
                if (b.p >= 3) scoreB += 25;
            }

            // 3. Same Subject at the Same Period Across Weekdays Repetition Penalty (Section 4.A)
            // Heavy quality penalty so Math, English, and other subjects move dynamically across the week
            let samePeriodCountA = 0;
            let samePeriodCountB = 0;
            for (let od = 0; od < DAYS_COUNT; od++) {
                if (od !== a.d && this.state.grid[classObj.id][od]?.[a.p]?.subjectId === task.subjectId) {
                    samePeriodCountA++;
                }
                if (od !== b.d && this.state.grid[classObj.id][od]?.[b.p]?.subjectId === task.subjectId) {
                    samePeriodCountB++;
                }
            }
            if (samePeriodCountA > 0) scoreA -= samePeriodCountA * 95;
            if (samePeriodCountB > 0) scoreB -= samePeriodCountB * 95;

            // 4. Period Diversity Bonus (Section 2 & 3)
            // Reward placing a subject at a period position it hasn't used yet in this class
            let periodUsedA = false;
            let periodUsedB = false;
            for (let od = 0; od < DAYS_COUNT; od++) {
                if (od !== a.d && this.state.grid[classObj.id][od]?.[a.p]?.subjectId === task.subjectId) {
                    periodUsedA = true;
                }
                if (od !== b.d && this.state.grid[classObj.id][od]?.[b.p]?.subjectId === task.subjectId) {
                    periodUsedB = true;
                }
            }
            if (!periodUsedA) scoreA += 40;
            if (!periodUsedB) scoreB += 40;

            // 5. Identical 2-Subject Sequence Penalty (Section 4.B)
            // Avoid placing the same pair of subjects (p-1, p) on different weekdays
            if (a.p > 0) {
                const prevA = this.state.grid[classObj.id][a.d]?.[a.p - 1]?.subjectId;
                if (prevA && prevA !== 'FREE' && prevA !== 'WORSHIP') {
                    for (let od = 0; od < DAYS_COUNT; od++) {
                        if (od !== a.d && this.state.grid[classObj.id][od]?.[a.p - 1]?.subjectId === prevA &&
                            this.state.grid[classObj.id][od]?.[a.p]?.subjectId === task.subjectId) {
                            scoreA -= 50;
                        }
                    }
                }
            }
            if (b.p > 0) {
                const prevB = this.state.grid[classObj.id][b.d]?.[b.p - 1]?.subjectId;
                if (prevB && prevB !== 'FREE' && prevB !== 'WORSHIP') {
                    for (let od = 0; od < DAYS_COUNT; od++) {
                        if (od !== b.d && this.state.grid[classObj.id][od]?.[b.p - 1]?.subjectId === prevB &&
                            this.state.grid[classObj.id][od]?.[b.p]?.subjectId === task.subjectId) {
                            scoreB -= 50;
                        }
                    }
                }
            }

            // 6. Teacher Preference Matrix (PREFER vs AVOID)
            task.teacherIds.forEach(tid => {
                const teacher = this.teachers.find(t => t.id === tid);
                if (teacher && teacher.availability && teacher.availability[a.d]) {
                    const availA = teacher.availability[a.d][a.p];
                    if (availA === Availability.PREFER) scoreA += (goal === 'TEACHER_FRIENDLY' ? 50 : 25);
                    if (availA === Availability.AVOID) scoreA -= (goal === 'TEACHER_FRIENDLY' ? 40 : 20);
                }
                if (teacher && teacher.availability && teacher.availability[b.d]) {
                    const availB = teacher.availability[b.d][b.p];
                    if (availB === Availability.PREFER) scoreB += (goal === 'TEACHER_FRIENDLY' ? 50 : 25);
                    if (availB === Availability.AVOID) scoreB -= (goal === 'TEACHER_FRIENDLY' ? 40 : 20);
                }
            });

            // 7. Spread: Distribute occurrences across different days whenever possible
            // Heavily penalize placing the same subject twice on the same day when an empty weekday is available
            if (this.state.classDailySubjects[cIdx][a.d]?.has(task.subjectId)) {
                scoreA -= 110;
            }
            if (this.state.classDailySubjects[cIdx][b.d]?.has(task.subjectId)) {
                scoreB -= 110;
            }

            // Also encourage spacing across the week (avoid adjacent days for low frequency subjects)
            if (this.state.classDailySubjects[cIdx][a.d - 1]?.has(task.subjectId) || 
                this.state.classDailySubjects[cIdx][a.d + 1]?.has(task.subjectId)) {
                scoreA -= 25;
            }
            if (this.state.classDailySubjects[cIdx][b.d - 1]?.has(task.subjectId) || 
                this.state.classDailySubjects[cIdx][b.d + 1]?.has(task.subjectId)) {
                scoreB -= 25;
            }

            // 8. Quality: Avoid consecutive identical subjects
            if (a.p > 0 && this.state.grid[classObj.id][a.d][a.p - 1]?.subjectId === task.subjectId) {
                scoreA -= 100;
            }
            if (a.p < MAX_PERIODS - 1 && this.state.grid[classObj.id][a.d][a.p + 1]?.subjectId === task.subjectId) {
                scoreA -= 100;
            }
            if (b.p > 0 && this.state.grid[classObj.id][b.d][b.p - 1]?.subjectId === task.subjectId) {
                scoreB -= 100;
            }
            if (b.p < MAX_PERIODS - 1 && this.state.grid[classObj.id][b.d][b.p + 1]?.subjectId === task.subjectId) {
                scoreB -= 100;
            }

            // 9. Compactness: Avoid unnecessary isolated gaps between lessons
            if (a.p === 0 || this.state.grid[classObj.id][a.d][a.p - 1]) scoreA += 10;
            if (b.p === 0 || this.state.grid[classObj.id][b.d][b.p - 1]) scoreB += 10;

            // 10. Friday Lightness Rule
            if (this.config.style?.fridayRelaxation) {
                if (a.d === 4 && a.p >= 4) scoreA -= 20;
                if (b.d === 4 && b.p >= 4) scoreB -= 20;
            }

            // 11. Controlled Randomness for Exploration (helps break symmetry)
            scoreA += Math.random() * 8;
            scoreB += Math.random() * 8;

            return scoreB - scoreA;
        });
    }

    public getReasoningReport(): ReasoningReport {
        let totalPlaced = 0;
        let morningCoreCount = 0;
        let totalCoreCount = 0;
        let prefMatches = 0;
        let totalPrefEvaluated = 0;

        for (const cId in this.state.grid) {
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[cId][d][p];
                    if (cell && cell.subjectId !== 'FREE' && cell.subjectId !== 'WORSHIP') {
                        totalPlaced++;
                        const sub = this.subjects.find(s => s.id === cell.subjectId);
                        if (sub?.isCore) {
                            totalCoreCount++;
                            if (p < 4) morningCoreCount++;
                        }
                        if (cell.teacherIds) {
                            cell.teacherIds.forEach(tid => {
                                const t = this.teachers.find(teacher => teacher.id === tid);
                                if (t?.availability?.[d]?.[p]) {
                                    totalPrefEvaluated++;
                                    if (t.availability[d][p] === Availability.PREFER || t.availability[d][p] === Availability.AVAILABLE) {
                                        prefMatches++;
                                    }
                                }
                            });
                        }
                    }
                }
            }
        }

        const isClassLayoutOnly = !!this.config.classLayoutOnly || this.teachers.length === 0;

        let totalConfiguredRequired = 0;
        let totalMissingLessons = 0;
        let totalExcessLessons = 0;
        let totalUnassignedSlots = 0;
        let totalUnavoidableCurriculumDeficit = 0;
        let totalAvoidableUnplacedSlots = 0;
        let dailyLimitViolations = 0;
        const eligibleTeachingSlots = TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS; // 38 slots (excluding Friday Worship P7 & P8)
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
                    classMissing += (req - scheduled);
                } else if (scheduled > req) {
                    classExcess += (scheduled - req);
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

            // Daily limits check
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

        // Teacher clash detection across classes (only evaluated if NOT in classLayoutOnly mode)
        let teacherClashes = 0;
        if (!isClassLayoutOnly) {
            const teacherUsage: Record<string, string[]> = {};
            for (const classObj of this.classes) {
                for (let d = 0; d < DAYS_COUNT; d++) {
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        const cell = this.state.grid[classObj.id]?.[d]?.[p];
                        if (!cell || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;
                        const tids = cell.teacherIds || (cell.teacherId ? [cell.teacherId] : []);
                        tids.forEach(tid => {
                            if (tid === 'SYSTEM') return;
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
                    const tObj = this.teachers.find(t => t.id === tid);
                    this.bottlenecks.add(`Teacher Clash: ${tObj?.name || tid} scheduled simultaneously with classes (${classesUsing.join(', ')}) on ${DAYS[parseInt(d)]} P${parseInt(p) + 1}.`);
                }
            }
        }

        const completionRate = totalConfiguredRequired > 0 
            ? Math.round((Math.max(0, totalConfiguredRequired - totalMissingLessons) / totalConfiguredRequired) * 100) 
            : 100;
        const morningCoreRatio = totalCoreCount > 0 ? Math.round((morningCoreCount / totalCoreCount) * 100) : 100;
        const teacherPrefRate = (!isClassLayoutOnly && totalPrefEvaluated > 0) ? Math.round((prefMatches / totalPrefEvaluated) * 100) : 100;
        const hardConstraintsSatisfied = (totalAvoidableUnplacedSlots === 0) && (totalExcessLessons === 0) && (isClassLayoutOnly || teacherClashes === 0) && (dailyLimitViolations === 0);
        
        const score = hardConstraintsSatisfied 
            ? Math.round((completionRate * 0.5) + (morningCoreRatio * 0.25) + (teacherPrefRate * 0.25))
            : Math.max(0, Math.round((completionRate * 0.5) + (morningCoreRatio * 0.25) + (teacherPrefRate * 0.25)) - (totalAvoidableUnplacedSlots * 15 + totalExcessLessons * 10 + teacherClashes * 15));

        const recommendations: string[] = [];
        if (isClassLayoutOnly) {
            recommendations.push("Class-Layout-Only Draft: Class timetable generated without faculty assignment. Teacher validation deferred.");
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
        if (morningCoreRatio < 70) {
            recommendations.push("Core subjects are spilling into afternoon periods. Try reducing manual locks in early morning periods.");
        }
        if (!isClassLayoutOnly && teacherPrefRate < 80) {
            recommendations.push("Some teachers were scheduled during 'Avoid' slots due to class timetable demands.");
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
            bottlenecks: Array.from(this.bottlenecks),
            recommendations: recommendations.length > 0 ? recommendations : ["Curriculum frequencies exactly satisfied with optimal constraint balance."],
            summary: `Required lessons: ${totalConfiguredRequired} | Scheduled: ${totalPlaced} | Unavoidable Deficit: ${totalUnavoidableCurriculumDeficit} | Avoidable Unplaced: ${totalAvoidableUnplacedSlots} | Excess: ${totalExcessLessons} | Unassigned slots: ${totalUnassignedSlots} | Teacher conflicts: ${teacherClashes}`
        };
    }
}
