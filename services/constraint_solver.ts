import { Teacher, Class, Subject, TimetableGrid, TimetableCell, Conflict, GeneratorConfig, Availability, OptimizationGoal, ReasoningReport } from '../types';
import { PARALLEL_SUBJECTS, DAYS } from '../constants';

const MAX_PERIODS = 8;
const DAYS_COUNT = 5;

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
    private maxIterations = 50000;
    private startTime = 0;
    private timeLimit = 8000;

    private onProgress?: (progress: number, message: string) => void;
    private onSync?: (grid: TimetableGrid) => void;
    private lastYieldTime = 0;

    private aborted = false;
    private totalRequiredSlots = 0;
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

        // Initialize Grid Structure
        classes.forEach(c => {
            this.state.grid[c.id] = {};
            for (let d = 0; d < DAYS_COUNT; d++) {
                this.state.grid[c.id][d] = {};
                for (let p = 0; p < MAX_PERIODS; p++) {
                    this.state.grid[c.id][d][p] = null;
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
        // Friday (Index 4) Logic
        if (day === 4) {
            if (category === 'JSS') return period >= 5; // JSS closes after P5 (P6, P7, P8 free)
            if (category.startsWith('SSS')) return period >= 6; // SSS closes after P6 (P7, P8 free)
        }
        return false;
    }

    private prepareTasks(existingGrid?: TimetableGrid) {
        // 1. Process Manual Locks from Existing Grid
        const manualSubjectCounts: Record<string, Record<string, number>> = {}; // classId -> subjectId -> count

        if (existingGrid && this.config.preserveManualEdits) {
            for (const cId in existingGrid) {
                if (!this.state.grid[cId]) continue;
                if (!manualSubjectCounts[cId]) manualSubjectCounts[cId] = {};

                for (let d = 0; d < DAYS_COUNT; d++) {
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        const cell = existingGrid[cId]?.[d]?.[p];
                        if (cell && cell.isManual) {
                            this.applyManualLock(cId, d, p, cell);
                            manualSubjectCounts[cId][cell.subjectId] = (manualSubjectCounts[cId][cell.subjectId] || 0) + 1;
                        }
                    }
                }
            }
        }

        // Track projected period counts to prevent overloading individual teachers
        const teacherPeriodCounts = new Map<string, number>();

        // 2. Generate Tasks for each class
        for (const classObj of this.classes) {
            const classLevel = classObj.level || (classObj.category === 'JSS' || classObj.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
            
            // Match subjects for this class's academic level (Junior vs Senior)
            const classSubjects = this.subjects.filter(s => {
                const sLevel = s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
                return sLevel === classLevel || s.category === classObj.category || s.category === 'ALL';
            });

            // Calculate available slots
            let availableSlots = 0;
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    if (!this.state.grid[classObj.id][d][p]) {
                        availableSlots++;
                    }
                }
            }

            const subjectCounts = new Map<string, number>();
            let totalRequested = 0;
            
            for (const sub of classSubjects) {
                const manualCount = manualSubjectCounts[classObj.id]?.[sub.id] || 0;
                const requestedCount = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
                let count = Math.max(0, requestedCount - manualCount);
                subjectCounts.set(sub.id, count);
                totalRequested += count;
            }

            if (totalRequested > availableSlots) {
                this.bottlenecks.add(`${classObj.name} has ${totalRequested} periods assigned, exceeding the ${availableSlots} available slots.`);
            }

            // Generate Tasks exactly as configured by Administrator
            for (const sub of classSubjects) {
                let count = subjectCounts.get(sub.id)!;
                if (count <= 0) continue;

                let teacherIds: string[] = [];
                
                // 1. Direct Administrator Assignment or Preferred Teacher
                if (sub.preferredTeacherId && this.teachers.some(t => t.id === sub.preferredTeacherId)) {
                    teacherIds = [sub.preferredTeacherId];
                    teacherPeriodCounts.set(sub.preferredTeacherId, (teacherPeriodCounts.get(sub.preferredTeacherId) || 0) + count);
                } else if (sub.assignedTeacherIds && sub.assignedTeacherIds.length > 0) {
                    const validTids = sub.assignedTeacherIds.filter(id => this.teachers.some(t => t.id === id));
                    if (validTids.length > 0) {
                        teacherIds = validTids;
                        validTids.forEach(tid => {
                            teacherPeriodCounts.set(tid, (teacherPeriodCounts.get(tid) || 0) + count);
                        });
                    }
                }

                if (teacherIds.length === 0) {
                    if (PARALLEL_SUBJECTS.includes(sub.id)) {
                        const classAssigned = this.teachers.filter(t => t.subjectsTaught.includes(sub.id) && t.assignedClasses.includes(classObj.id));
                        const assignedTeachers = classAssigned.length > 0 ? classAssigned : this.teachers.filter(t => t.subjectsTaught.includes(sub.id));
                        teacherIds = assignedTeachers.length > 0 ? assignedTeachers.map(t => t.id) : ['SYSTEM'];
                        teacherIds.forEach(tid => {
                            if (tid !== 'SYSTEM') {
                                teacherPeriodCounts.set(tid, (teacherPeriodCounts.get(tid) || 0) + count);
                            }
                        });
                    } else {
                        const classAssigned = this.teachers.filter(t => t.subjectsTaught.includes(sub.id) && t.assignedClasses.includes(classObj.id));
                        const allQualified = this.teachers.filter(t => t.subjectsTaught.includes(sub.id));

                        let selectedTeacher: Teacher | undefined;

                        // Prefer teacher assigned to class with load <= 28
                        const underloadedClassTeachers = classAssigned.filter(t => ((teacherPeriodCounts.get(t.id) || 0) + count) <= 28);
                        if (underloadedClassTeachers.length > 0) {
                            underloadedClassTeachers.sort((a, b) => (teacherPeriodCounts.get(a.id) || 0) - (teacherPeriodCounts.get(b.id) || 0));
                            selectedTeacher = underloadedClassTeachers[0];
                        } else {
                            // Secondary: any teacher in school with load <= 28
                            const underloadedSchoolTeachers = allQualified.filter(t => ((teacherPeriodCounts.get(t.id) || 0) + count) <= 28);
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
                            teacherPeriodCounts.set(selectedTeacher.id, (teacherPeriodCounts.get(selectedTeacher.id) || 0) + count);
                        } else {
                            teacherIds = ['SYSTEM'];
                            this.bottlenecks.add(`No teacher assigned for ${sub.name} in ${classObj.name}. Using system placeholder.`);
                        }
                    }
                }

                const teacherLoad = teacherIds.reduce((acc, tid) => acc + (teacherPeriodCounts.get(tid) || 0), 0);
                const maxPerDay = sub.maxPerDay || (count >= 5 ? 2 : 1);

                // Double Periods allowed only if maxPerDay >= 2 and configured
                if (!this.config.forceSinglePeriods && maxPerDay >= 2 && sub.isCore && count >= 4) {
                    this.tasks.push({
                        id: `${classObj.id}-${sub.id}-DOUBLE`,
                        classId: classObj.id,
                        subjectId: sub.id,
                        subjectName: sub.name,
                        teacherIds,
                        duration: 2,
                        isFixed: false,
                        priority: 10,
                        teacherLoad,
                        isCore: sub.isCore
                    });
                    count -= 2;
                    this.totalRequiredSlots += 2;
                }

                // Single Periods
                while (count > 0) {
                    this.tasks.push({
                        id: `${classObj.id}-${sub.id}-${count}`,
                        classId: classObj.id,
                        subjectId: sub.id,
                        subjectName: sub.name,
                        teacherIds,
                        duration: 1,
                        isFixed: false,
                        priority: sub.isCore ? 5 : 1,
                        teacherLoad,
                        isCore: sub.isCore
                    });
                    count--;
                    this.totalRequiredSlots += 1;
                }
            }
        }

        // Group tasks by classId so depth-first search completes each class locally
        this.tasks.sort((a, b) => {
            if (a.classId !== b.classId) {
                return a.classId.localeCompare(b.classId);
            }
            if (a.duration !== b.duration) return b.duration - a.duration;
            if (a.isCore !== b.isCore) return a.isCore ? -1 : 1;
            if (a.teacherLoad !== b.teacherLoad) return b.teacherLoad - a.teacherLoad;
            return b.priority - a.priority;
        });
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
        
        const success = await this.backtrack(0);
        if (success) {
            return { success: true, grid: this.state.grid };
        }

        // If backtracking yielded a partial solution, restore best state and fill unplaced tasks
        if (this.bestSolution) {
            this.state.grid = JSON.parse(JSON.stringify(this.bestSolution));
        }

        this.fillUnplacedTasks();

        const isComplete = this.isCompleteGrid();
        return { success: isComplete, grid: this.state.grid };
    }

    private isCompleteGrid(): boolean {
        let placed = 0;
        for (const cId in this.state.grid) {
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    if (this.state.grid[cId][d][p]) placed++;
                }
            }
        }
        return placed >= this.totalRequiredSlots;
    }

    private fillUnplacedTasks() {
        for (const task of this.tasks) {
            const classObj = this.classes.find(c => c.id === task.classId);
            if (!classObj) continue;
            const cIdx = this.classToIndex.get(task.classId);
            if (cIdx === undefined) continue;

            // Check how many instances of this task's subject are placed for this class
            let countPlaced = 0;
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = this.state.grid[task.classId][d][p];
                    if (cell && cell.subjectId === task.subjectId) {
                        countPlaced++;
                    }
                }
            }

            // Check if task needs placement
            const classLevel = classObj.level || (classObj.category === 'JSS' || classObj.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
            const classSubjects = this.subjects.filter(s => {
                const sLevel = s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
                return sLevel === classLevel || s.category === classObj.category || s.category === 'ALL';
            });
            const sub = classSubjects.find(s => s.id === task.subjectId);
            if (!sub) continue;

            const totalRequiredForSub = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
            if (countPlaced >= totalRequiredForSub) continue;

            // Find valid slots with relaxed daily core/subject limits
            const slots = this.findValidSlots(task, classObj, cIdx, true);
            if (slots.length > 0) {
                this.sortSlots(slots, task, classObj, cIdx);
                this.applyTask(task, slots[0].d, slots[0].p, cIdx);
            } else {
                // Emergency placement into any open slot for this class
                for (let d = 0; d < DAYS_COUNT; d++) {
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        if (!this.state.grid[task.classId][d][p]) {
                            this.applyTask(task, d, p, cIdx);
                            break;
                        }
                    }
                }
            }
        }
    }

    private async backtrack(taskIndex: number): Promise<boolean> {
        this.iterations++;
        const now = Date.now();

        if (now - this.lastYieldTime > 50) {
            this.lastYieldTime = now;
            if (this.onProgress) {
                const pct = Math.min(0.99, taskIndex / Math.max(1, this.tasks.length));
                this.onProgress(pct, `Optimizing timetable... Placed ${taskIndex}/${this.tasks.length} tasks (${this.iterations} iterations)`);
            }
            if (this.onSync) {
                const gridCopy = JSON.parse(JSON.stringify(this.state.grid));
                this.onSync(gridCopy);
            }
            await new Promise(r => setTimeout(r, 0));
        }

        if (this.aborted) return false;

        if (this.iterations > this.maxIterations) {
            this.aborted = true;
            return false;
        }
        if (now - this.startTime > this.timeLimit) {
            this.aborted = true;
            this.bottlenecks.add('Time limit reached (60 seconds).');
            return false;
        }

        if (taskIndex > this.bestScore) {
            this.bestScore = taskIndex;
            this.bestSolution = JSON.parse(JSON.stringify(this.state.grid));
        }

        // Base Case
        if (taskIndex >= this.tasks.length) {
            return true;
        }

        const task = this.tasks[taskIndex];
        const classObj = this.classes.find(c => c.id === task.classId)!;
        const cIdx = this.classToIndex.get(task.classId)!;

        // Find valid slots
        const validSlots = this.findValidSlots(task, classObj, cIdx);

        // Sort slots by heuristic and optimization goal
        this.sortSlots(validSlots, task, classObj, cIdx);

        for (const slot of validSlots) {
            this.applyTask(task, slot.d, slot.p, cIdx);

            if (await this.backtrack(taskIndex + 1)) {
                return true;
            }

            this.revertTask(task, slot.d, slot.p, cIdx);
            
            if (this.aborted) return false;
        }

        return false;
    }

    private findValidSlots(task: Task, classObj: Class, cIdx: number, relaxConstraints = false): { d: number, p: number }[] {
        const slots: { d: number, p: number }[] = [];

        // Calculate dynamic core limit per day based on class curriculum demand
        const classLevel = classObj.level || (classObj.category === 'JSS' || classObj.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
        const classSubjects = this.subjects.filter(s => {
            const sLevel = s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
            return sLevel === classLevel || s.category === classObj.category || s.category === 'ALL';
        });

        const totalCorePeriods = classSubjects.filter(s => s.isCore).reduce((acc, s) => acc + (s.defaultPeriodCount || s.periodsPerWeek || 3), 0);
        const dynamicHeavyLimit = Math.max(6, Math.ceil(totalCorePeriods / 5) + 1);
        const heavyLimit = this.config.style?.heavySubjectLimitPerDay
            ? Math.max(this.config.style.heavySubjectLimitPerDay, dynamicHeavyLimit)
            : dynamicHeavyLimit;

        const sub = classSubjects.find(s => s.id === task.subjectId);
        const maxDaily = sub?.maxPerDay || (sub && (sub.defaultPeriodCount || sub.periodsPerWeek || 3) > 5 ? 2 : 1);

        for (let d = 0; d < DAYS_COUNT; d++) {
            if (!relaxConstraints) {
                // Hard Constraint 1: Subject max count per day
                let currentSubCountOnDay = 0;
                for (let p = 0; p < MAX_PERIODS; p++) {
                    if (this.state.grid[classObj.id][d][p]?.subjectId === task.subjectId) {
                        currentSubCountOnDay++;
                    }
                }
                if (currentSubCountOnDay >= maxDaily) {
                    continue;
                }

                // Hard Constraint 2: Heavy core subject limit per day
                if (task.isCore && this.state.classDailyCoreCount[cIdx][d] >= heavyLimit) {
                    continue;
                }
            }

            const maxP = task.duration === 2 ? MAX_PERIODS - 1 : MAX_PERIODS;
            for (let p = 0; p < maxP; p++) {
                if (this.canPlace(task, classObj, d, p)) {
                    slots.push({ d, p });
                }
            }
        }
        return slots;
    }

    private canPlace(task: Task, classObj: Class, d: number, p: number): boolean {
        // 1. Mandated Free Slots (e.g. Friday afternoon closing)
        if (this.isMandatedFreeSlot(classObj.category, d, p)) return false;
        if (task.duration === 2 && this.isMandatedFreeSlot(classObj.category, d, p + 1)) return false;

        // 2. Grid Occupancy
        if (this.state.grid[classObj.id][d][p]) return false;
        if (task.duration === 2 && this.state.grid[classObj.id][d][p + 1]) return false;

        // 3. Teacher Schedule & Explicit Availability Constraints
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
            teacherId: (task.teacherIds && task.teacherIds.length > 0) ? task.teacherIds[0] : 'SYSTEM',
            teacherIds: task.teacherIds || ['SYSTEM'],
            isManual: false,
            isDouble: task.duration === 2
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
        this.state.classDailySubjects[cIdx][d].delete(task.subjectId);
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

            // 2. Core Subjects Prefer Morning (Periods 0..3)
            if (task.isCore) {
                const morningWeight = (goal === 'STUDENT_FRIENDLY') ? 40 : (goal === 'BALANCED' ? 25 : 15);
                if (a.p < 4) scoreA += morningWeight;
                if (b.p < 4) scoreB += morningWeight;
            }

            // 3. Teacher Preference Matrix (PREFER vs AVOID)
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

            // 4. Spread: Avoid placing same subject on adjacent days if possible
            if (this.state.classDailySubjects[cIdx][a.d - 1]?.has(task.subjectId) || 
                this.state.classDailySubjects[cIdx][a.d + 1]?.has(task.subjectId)) {
                scoreA -= 10;
            }
            if (this.state.classDailySubjects[cIdx][b.d - 1]?.has(task.subjectId) || 
                this.state.classDailySubjects[cIdx][b.d + 1]?.has(task.subjectId)) {
                scoreB -= 10;
            }

            // 5. Friday Lightness Rule
            if (this.config.style?.fridayRelaxation) {
                if (a.d === 4 && a.p >= 4) scoreA -= 20;
                if (b.d === 4 && b.p >= 4) scoreB -= 20;
            }

            // 6. Slight Randomness for Path Exploration
            scoreA += Math.random() * 4;
            scoreB += Math.random() * 4;

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
                    if (cell) {
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

        const completionRate = Math.round((totalPlaced / Math.max(1, this.totalRequiredSlots)) * 100);
        const morningCoreRatio = totalCoreCount > 0 ? Math.round((morningCoreCount / totalCoreCount) * 100) : 100;
        const teacherPrefRate = totalPrefEvaluated > 0 ? Math.round((prefMatches / totalPrefEvaluated) * 100) : 100;
        const score = Math.round((completionRate * 0.5) + (morningCoreRatio * 0.25) + (teacherPrefRate * 0.25));

        const recommendations: string[] = [];
        if (completionRate < 100) {
            recommendations.push("Consider increasing teacher capacity or converting some double periods into single periods.");
        }
        if (morningCoreRatio < 70) {
            recommendations.push("Core subjects are spilling into afternoon periods. Try reducing manual locks in early morning periods.");
        }
        if (teacherPrefRate < 80) {
            recommendations.push("Some teachers were scheduled during 'Avoid' slots due to tight class demands.");
        }

        return {
            score,
            goal: this.config.goal,
            iterations: this.iterations,
            executionTimeMs: Date.now() - (this.startTime || Date.now()),
            hardConstraintsSatisfied: completionRate === 100,
            totalSlotsScheduled: totalPlaced,
            totalSlotsRequired: this.totalRequiredSlots,
            completionRate,
            teacherPreferenceSatisfactionRate: teacherPrefRate,
            morningCoreRatio,
            bottlenecks: Array.from(this.bottlenecks),
            recommendations: recommendations.length > 0 ? recommendations : ["Timetable constraints are optimally balanced."],
            summary: `Scheduled ${totalPlaced}/${this.totalRequiredSlots} required class slots across ${this.classes.length} classes. ${morningCoreRatio}% of core subjects scheduled in prime morning hours.`
        };
    }
}
