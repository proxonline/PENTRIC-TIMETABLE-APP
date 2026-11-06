import { 
    Teacher, 
    TimetableGrid, 
    Class, 
    Subject, 
    LogEntry, 
    GeneratorConfig, 
    Conflict, 
    ReasoningReport, 
    OptimizationGoal,
    ClassAuditReport,
    ClassCompletionStatus,
    ClassFeasibility,
    FeasibilityReport,
    ClassSubjectAudit
} from '../types';
import { DAYS, TIMETABLE_CONFIG } from '../constants';
import { ConstraintSolver } from './constraint_solver';
import { getEligibleSubjectsForClass, isSubjectEligibleForClass, resolveMaxPerDay, isTeacherQualifiedForSubject } from './curriculum_eligibility';

const MAX_PERIODS = TIMETABLE_CONFIG.PERIODS_PER_DAY;
const DAYS_COUNT = TIMETABLE_CONFIG.DAYS_COUNT;

export const calculateClassFeasibility = (
    classes: Class[],
    subjects: Subject[],
    teachers: Teacher[] = [],
    existingGrid?: TimetableGrid,
    config?: GeneratorConfig
): FeasibilityReport => {
    const capacitySlots = TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS; // 38 slots
    const classReports: Record<string, ClassFeasibility> = {};
    const overallocatedClasses: ClassFeasibility[] = [];
    const impossibleClasses: ClassFeasibility[] = [];
    const facultyBottlenecks: string[] = [];

    for (const classObj of classes) {
        const eligible = getEligibleSubjectsForClass(classObj, subjects);
        let totalRequired = 0;
        let lockedCountTotal = 0;
        const issues: string[] = [];
        const subjectBreakdown = [];

        for (const sub of eligible) {
            const req = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
            totalRequired += req;
            const maxDaily = resolveMaxPerDay(sub);

            // Count locked slots for this subject if existingGrid provided
            let lockedCount = 0;
            if (existingGrid && config?.preserveManualEdits) {
                for (let d = 0; d < DAYS_COUNT; d++) {
                    for (let p = 0; p < MAX_PERIODS; p++) {
                        const cell = existingGrid[classObj.id]?.[d]?.[p];
                        if (cell && cell.isManual && cell.subjectId === sub.id) {
                            lockedCount++;
                        }
                    }
                }
            }
            lockedCountTotal += lockedCount;

            // Feasibility check: Can required lessons fit in 5 days given maxPerDay?
            if (req > maxDaily * 5) {
                issues.push(`Subject ${sub.name} requires ${req} periods/week but daily limit is ${maxDaily} (max ${maxDaily * 5} per 5-day week).`);
            }

            // Qualified faculty count
            const qualifiedTeachers = teachers.filter(t => isTeacherQualifiedForSubject(t, sub));
            if (!config?.classLayoutOnly && teachers.length > 0 && qualifiedTeachers.length === 0) {
                issues.push(`No qualified faculty registered for subject ${sub.name}.`);
                facultyBottlenecks.push(`No faculty for ${sub.name} in ${classObj.name}`);
            }

            subjectBreakdown.push({
                subjectId: sub.id,
                subjectName: sub.name,
                code: sub.code || sub.id,
                required: req,
                maxPerDay: maxDaily,
                lockedCount,
                qualifiedTeachersCount: qualifiedTeachers.length
            });
        }

        let status: 'FEASIBLE' | 'OVERALLOCATED' | 'IMPOSSIBLE' = 'FEASIBLE';
        let excessLessons = 0;
        let freeSlots = 0;

        if (totalRequired > capacitySlots) {
            status = 'OVERALLOCATED';
            excessLessons = totalRequired - capacitySlots;
            issues.push(`Curriculum requires ${totalRequired} periods/week, exceeding the ${capacitySlots} instructional teaching slots by ${excessLessons}.`);
        } else if (issues.some(i => i.includes('daily limit'))) {
            status = 'IMPOSSIBLE';
        } else {
            status = 'FEASIBLE';
            freeSlots = capacitySlots - totalRequired;
        }

        const report: ClassFeasibility = {
            classId: classObj.id,
            className: classObj.name,
            level: classObj.level || classObj.category || 'GENERAL',
            stream: classObj.stream || 'GENERAL',
            status,
            availableSlots: capacitySlots,
            reservedSlots: 2, // Friday P7 & P8
            lockedSlots: lockedCountTotal,
            requiredLessons: totalRequired,
            excessLessons,
            freeSlots,
            issues,
            subjectBreakdown
        };

        classReports[classObj.id] = report;
        if (status === 'OVERALLOCATED') overallocatedClasses.push(report);
        if (status === 'IMPOSSIBLE') impossibleClasses.push(report);
    }

    const allClassesFeasible = overallocatedClasses.length === 0 && impossibleClasses.length === 0;

    return {
        isFeasible: allClassesFeasible,
        allClassesFeasible,
        classes: classReports,
        overallocatedClasses,
        impossibleClasses,
        facultyBottlenecks: Array.from(new Set(facultyBottlenecks)),
        summary: allClassesFeasible
            ? `All ${classes.length} classes are curriculum-feasible (38 instructional slots available per class).`
            : `${overallocatedClasses.length} class(es) have curriculum exceeding weekly teaching capacity; ${impossibleClasses.length} class(es) have impossible constraint configurations.`
    };
};

const evaluateAttemptQuality = (
    grid: TimetableGrid,
    classes: Class[],
    subjects: Subject[],
    validation: { 
        valid: boolean; 
        errors: string[]; 
        warnings: string[]; 
        rule1Satisfied: boolean; 
        allClassesComplete?: boolean;
        classAudits?: Record<string, ClassAuditReport>;
        freePeriodStats: Record<string, { eligible: number; scheduled: number; free: number; configured: number }> 
    },
    report?: ReasoningReport
): number => {
    let completedLessons = 0;
    let excessLessons = 0;
    let missingLessons = 0;

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
            } else if (scheduled < req) {
                missingLessons += (req - scheduled);
            }
        }
    }

    // Strict candidate ranking hierarchy:
    // 1. Missing lessons heavily penalized: complete schedules ALWAYS beat incomplete ones.
    // 2. Zero hard constraint violations outranks any solution with violations.
    // 3. Excess lessons penalized heavily (must equal 0).
    // 4. Completed valid lessons without exceeding frequency.
    // 5. Soft variety / preference score.
    const missingPenalty = missingLessons * 200000;
    const hardErrorPenalty = validation.errors.length * 100000;
    const excessPenalty = excessLessons * 50000;
    const completionScore = completedLessons * 500;
    const completeAllBonus = validation.allClassesComplete ? 500000 : 0;
    const reportScoreBonus = report?.score || 0;
    return completionScore + completeAllBonus - missingPenalty - hardErrorPenalty - excessPenalty + reportScoreBonus;
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

    // --- Strict Curriculum Feasibility Preflight ---
    const feasibility = calculateClassFeasibility(classes, subjects, teachers, existingGrid, config);
    if (!feasibility.allClassesFeasible) {
        addLog('warning', `Curriculum Capacity Alert: ${feasibility.overallocatedClasses.length} class(es) have configured weekly periods exceeding available teaching capacity.`);
        feasibility.overallocatedClasses.forEach(c => {
            addLog('info', `Structural Conflict: ${c.className} has ${c.requiredLessons} configured periods (${c.excessLessons} excess). Full schedule requires administrator curriculum reduction.`);
        });
        feasibility.impossibleClasses.forEach(c => {
            addLog('error', `Impossible Configuration: ${c.className} has constraint conflicts: ${c.issues.join('; ')}`);
        });
    } else {
        addLog('info', `Feasibility Confirmed: All ${classes.length} classes have valid curriculum demands within the ${TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS} instructional slots.`);
    }

    const isClassLayoutOnly = !!config.classLayoutOnly || (!teachers || teachers.length === 0);
    if (isClassLayoutOnly) {
        addLog('info', 'Class-Layout-Only Draft: Class timetable generated without faculty assignment. Teacher validation deferred.');
    }

    const MAX_RETRIES = 3;
    let bestQuality = -Infinity;
    let bestGrid: TimetableGrid = {};
    let bestReport: ReasoningReport | undefined;
    let bestValidation: ReturnType<typeof validateTimetable> | undefined;

    const solverConfig: GeneratorConfig = {
        ...config,
        goal,
        classLayoutOnly: isClassLayoutOnly
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
        const validation = validateTimetable(result.grid, classes, subjects, teachers, isClassLayoutOnly, existingGrid);

        const quality = evaluateAttemptQuality(result.grid, classes, subjects, validation, currentReport);
        if (quality > bestQuality || attempt === 0) {
            bestQuality = quality;
            bestGrid = result.grid;
            bestReport = currentReport;
            bestValidation = validation;
        }

        const isSuccess = result.success && validation.valid && validation.rule1Satisfied && validation.allClassesComplete && (currentReport?.hardConstraintsSatisfied ?? true) && feasibility.allClassesFeasible;
        if (isSuccess) {
            bestGrid = result.grid;
            bestReport = currentReport;
            bestValidation = validation;
            if (bestReport) {
                bestReport.classAudits = bestValidation.classAudits;
                bestReport.feasibilityReport = feasibility;
            }
            addLog('success', `High-quality timetable generated on pass ${attempt + 1}! All classes 100% complete. Efficiency Score: ${currentReport?.score || 95}/100.`);
            if (validation.warnings.length > 0) {
                validation.warnings.forEach(warn => addLog('info', warn));
            }
            if (currentReport?.summary) addLog('info', currentReport.summary);
            onProgress(100, { type: 'success', message: 'Timetable generation complete!', timestamp: Date.now() });
            return { success: true, timetable: bestGrid, logs, reasoningReport: bestReport };
        } else {
            addLog('info', `Optimization pass ${attempt + 1} finished with score ${currentReport?.score || 0}/100 (${validation.errors.length} unresolved notices).`);
        }
    }

    addLog('warning', 'Solver completed optimization passes. Delivering best optimized timetable schedule with detailed constraint report.');
    if (!bestValidation) {
        bestValidation = validateTimetable(bestGrid, classes, subjects, teachers, isClassLayoutOnly, existingGrid);
    }

    if (bestReport) {
        bestReport.classAudits = bestValidation.classAudits;
        bestReport.feasibilityReport = feasibility;
    }

    // Deduplicate and group errors
    const seenErrors = new Set<string>();
    const facultyErrors: string[] = [];

    bestValidation.errors.forEach(err => {
        if (err.includes('Missing Faculty Data') || err.includes('Teacher Capacity Shortage')) {
            facultyErrors.push(err);
        } else if (!seenErrors.has(err)) {
            seenErrors.add(err);
            addLog('error', `Unsatisfied Constraint: ${err}`);
        }
    });

    if (!isClassLayoutOnly && facultyErrors.length > 0) {
        const uniqueFac = Array.from(new Set(facultyErrors));
        uniqueFac.forEach(f => addLog('error', f));
    }

    if (bestValidation.warnings.length > 0) {
        const seenWarns = new Set<string>();
        bestValidation.warnings.forEach(warn => {
            if (!seenWarns.has(warn)) {
                seenWarns.add(warn);
                addLog('warning', warn);
            }
        });
    }

    if (bestReport && bestReport.bottlenecks.length > 0) {
        const seenBottlenecks = new Set<string>();
        bestReport.bottlenecks.forEach(b => {
            if (!seenBottlenecks.has(b) && !seenErrors.has(b)) {
                seenBottlenecks.add(b);
                addLog('error', `Bottleneck: ${b}`);
            }
        });
    }

    const overallSuccess = bestValidation.valid && bestValidation.rule1Satisfied && bestValidation.allClassesComplete && (bestReport?.hardConstraintsSatisfied ?? true) && feasibility.allClassesFeasible;
    return { success: overallSuccess, timetable: bestGrid, logs, reasoningReport: bestReport };
};


export const validateTimetable = (
    grid: TimetableGrid, 
    classes: Class[], 
    subjects: Subject[],
    teachers?: Teacher[],
    classLayoutOnly: boolean = false,
    existingGrid?: TimetableGrid
): { 
    valid: boolean; 
    errors: string[]; 
    warnings: string[];
    rule1Satisfied: boolean; 
    allClassesComplete: boolean;
    classAudits: Record<string, ClassAuditReport>;
    freePeriodStats: Record<string, { eligible: number; scheduled: number; free: number; configured: number }>;
    unavoidableCurriculumDeficit: number;
    avoidableUnplacedSlots: number;
} => {
    const isLayoutOnly = classLayoutOnly || !teachers || teachers.length === 0;
    const errors: string[] = [];
    const warnings: string[] = [];
    let rule1Satisfied = true;
    let unavoidableCurriculumDeficitTotal = 0;
    let avoidableUnplacedSlotsTotal = 0;
    const freePeriodStats: Record<string, { eligible: number; scheduled: number; free: number; configured: number }> = {};
    const classAudits: Record<string, ClassAuditReport> = {};
    const eligibleTeachingSlots = TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS; // 38 slots (excluding Friday Worship P7 & P8)

    if (isLayoutOnly) {
        warnings.push('Class-Layout-Only Draft: Class timetable generated without faculty assignment. Teacher validation deferred.');
    }

    // Teacher slot usage for clash detection across classes
    const teacherSlotUsage: Record<string, string[]> = {};
    const classTeacherClashes: Record<string, string[]> = {};
    for (const c of classes) {
        classTeacherClashes[c.id] = [];
    }

    // Pre-scan grid to map teacher slot assignments across classes
    if (!isLayoutOnly) {
        for (const classObj of classes) {
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const cell = grid?.[classObj.id]?.[d]?.[p];
                    if (!cell || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') continue;
                    const tids = cell.teacherIds || (cell.teacherId && cell.teacherId !== 'SYSTEM' ? [cell.teacherId] : []);
                    tids.forEach(tid => {
                        if (tid === 'SYSTEM') return;
                        const key = `${tid}-${d}-${p}`;
                        if (!teacherSlotUsage[key]) teacherSlotUsage[key] = [];
                        teacherSlotUsage[key].push(classObj.name);
                    });
                }
            }
        }
        for (const [key, classNames] of Object.entries(teacherSlotUsage)) {
            if (classNames.length > 1) {
                const [tid, d, p] = key.split('-');
                const teacherObj = teachers?.find(t => t.id === tid);
                const teacherName = teacherObj?.name || tid;
                const msg = `Teacher Clash: Teacher ${teacherName} is scheduled to teach multiple classes simultaneously (${classNames.join(', ')}) on ${DAYS[parseInt(d)]} P${parseInt(p) + 1}.`;
                errors.push(msg);
                for (const classObj of classes) {
                    if (classNames.includes(classObj.name)) {
                        classTeacherClashes[classObj.id].push(msg);
                    }
                }
            }
        }
    }

    for (const classObj of classes) {
        const classSubjects = getEligibleSubjectsForClass(classObj, subjects);
        const eligibleSubIds = new Set(classSubjects.map(s => s.id));

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
        const classClashes: string[] = [];
        const reservedViolations: string[] = [];
        const lockedViolations: string[] = [];
        const dailyLimitViolations: string[] = [];

        for (let d = 0; d < DAYS_COUNT; d++) {
            dailyCounts[d] = {};
            for (let p = 0; p < MAX_PERIODS; p++) {
                const cell = grid?.[classObj.id]?.[d]?.[p];
                if (!cell) continue;

                // Rule 2: Friday worship reservation check
                if (d === 4 && p >= MAX_PERIODS - 2) {
                    if (cell.subjectId !== 'WORSHIP') {
                        const msg = `Rule 2 Violation: Class ${classObj.name} has ordinary subject ${cell.subjectId} during reserved Friday Worship (P${p + 1}).`;
                        errors.push(msg);
                        reservedViolations.push(msg);
                    }
                    continue;
                }

                if (cell.subjectId === 'WORSHIP') {
                    const msg = `Rule 2 Violation: Class ${classObj.name} has Worship on ${DAYS[d]} P${p + 1} outside reserved Friday final two periods.`;
                    errors.push(msg);
                    reservedViolations.push(msg);
                    continue;
                }

                if (cell.subjectId === 'FREE') continue;

                scheduledTotal++;
                scheduledSubCounts[cell.subjectId] = (scheduledSubCounts[cell.subjectId] || 0) + 1;

                // Rule 3: No cross-class timetable contamination
                if (cell.classId && cell.classId !== classObj.id) {
                    const msg = `Rule 3 Violation: Class ${classObj.name} contains foreign timetable assignment belonging to class ${cell.classId} on ${DAYS[d]} P${p + 1}.`;
                    errors.push(msg);
                    classClashes.push(msg);
                }

                // Rule 4: Strict curriculum eligibility
                if (!eligibleSubIds.has(cell.subjectId)) {
                    const msg = `Rule 4 Violation: Ineligible subject ${cell.subjectId} scheduled for ${classObj.name} on ${DAYS[d]} P${p + 1}.`;
                    errors.push(msg);
                    classClashes.push(msg);
                }

                dailyCounts[d][cell.subjectId] = (dailyCounts[d][cell.subjectId] || 0) + 1;
            }
        }

        // Rule 2: Verify Friday final two periods are preserved as WORSHIP
        const friP7 = grid?.[classObj.id]?.[4]?.[MAX_PERIODS - 2];
        const friP8 = grid?.[classObj.id]?.[4]?.[MAX_PERIODS - 1];
        if (!friP7 || friP7.subjectId !== 'WORSHIP' || !friP8 || friP8.subjectId !== 'WORSHIP') {
            const msg = `Rule 2 Violation: Class ${classObj.name} must reserve final two Friday periods (P7 & P8) for Worship.`;
            errors.push(msg);
            reservedViolations.push(msg);
        }

        // Manual locks preservation check
        if (existingGrid) {
            for (let d = 0; d < DAYS_COUNT; d++) {
                for (let p = 0; p < MAX_PERIODS; p++) {
                    const lockedCell = existingGrid[classObj.id]?.[d]?.[p];
                    if (lockedCell && lockedCell.isManual && lockedCell.subjectId !== 'FREE' && lockedCell.subjectId !== 'WORSHIP') {
                        const currentCell = grid?.[classObj.id]?.[d]?.[p];
                        if (!currentCell || currentCell.subjectId !== lockedCell.subjectId) {
                            const msg = `Manual Lock Violation: Locked ${lockedCell.subjectId} in ${classObj.name} on ${DAYS[d]} P${p + 1} was modified.`;
                            errors.push(msg);
                            lockedViolations.push(msg);
                        }
                    }
                }
            }
        }

        // Rule 5: Daily limits
        for (let d = 0; d < DAYS_COUNT; d++) {
            for (const subId in dailyCounts[d]) {
                const sub = classSubjects.find(s => s.id === subId);
                const maxDaily = sub ? resolveMaxPerDay(sub) : 2;
                const count = dailyCounts[d][subId];
                if (count > maxDaily) {
                    const msg = `Rule 5 Violation: Subject ${sub?.name || subId} scheduled ${count} times on ${DAYS[d]} for ${classObj.name} (exceeds max ${maxDaily}/day).`;
                    errors.push(msg);
                    dailyLimitViolations.push(msg);
                }
            }
        }

        const classCapacityDeficit = Math.max(0, configuredWeeklyTotal - eligibleTeachingSlots);
        const classAvoidableUnplaced = Math.max(0, Math.min(configuredWeeklyTotal, eligibleTeachingSlots) - scheduledTotal);
        unavoidableCurriculumDeficitTotal += classCapacityDeficit;
        avoidableUnplacedSlotsTotal += classAvoidableUnplaced;

        // Subject audit arrays
        const subjectAudits: ClassSubjectAudit[] = [];
        const missingSubjects: ClassSubjectAudit[] = [];
        const excessSubjects: ClassSubjectAudit[] = [];
        const skippedSubjects: ClassSubjectAudit[] = [];
        let missingLessonsTotal = 0;

        for (const sub of classSubjects) {
            const req = requiredPerSubject[sub.id];
            const scheduled = scheduledSubCounts[sub.id] || 0;
            const missing = Math.max(0, req - scheduled);
            const excess = Math.max(0, scheduled - req);
            missingLessonsTotal += missing;

            const auditItem: ClassSubjectAudit = {
                id: sub.id,
                name: sub.name,
                code: sub.code || sub.id,
                required: req,
                scheduled,
                missing,
                excess
            };
            subjectAudits.push(auditItem);

            if (scheduled < req) {
                missingSubjects.push(auditItem);
                if (scheduled === 0 && req > 0) {
                    skippedSubjects.push(auditItem);
                }
                if (configuredWeeklyTotal > eligibleTeachingSlots && scheduledTotal >= eligibleTeachingSlots) {
                    warnings.push(`Curriculum Capacity Deficit: Class ${classObj.name} has ${configuredWeeklyTotal} configured periods for 38 slots; ${sub.name} received ${scheduled}/${req} periods.`);
                } else {
                    rule1Satisfied = false;
                    errors.push(`Missing Lesson Error: Class ${classObj.name} scheduled ${scheduled} of ${req} configured weekly periods for ${sub.name} (missing ${missing} periods).`);
                }
            } else if (scheduled > req) {
                excessSubjects.push(auditItem);
                rule1Satisfied = false;
                errors.push(`Excess Lesson Error: Class ${classObj.name} scheduled ${scheduled} weekly periods for ${sub.name}, exceeding the configured frequency of ${req} (excess ${excess} periods).`);
            }
        }

        const freeTeachingPeriods = eligibleTeachingSlots - scheduledTotal;
        freePeriodStats[classObj.id] = { 
            eligible: eligibleTeachingSlots, 
            scheduled: scheduledTotal, 
            free: freeTeachingPeriods,
            configured: configuredWeeklyTotal
        };

        if (freeTeachingPeriods > 0 && configuredWeeklyTotal <= eligibleTeachingSlots) {
            warnings.push(`Unassigned Periods: Class ${classObj.name} has ${freeTeachingPeriods} unassigned teaching periods. ${scheduledTotal}/${configuredWeeklyTotal} configured curriculum lessons allocated.`);
        }

        // Determine explicit class status
        let status: ClassCompletionStatus = 'COMPLETE';
        if (configuredWeeklyTotal > eligibleTeachingSlots) {
            status = 'IMPOSSIBLE_CONFIGURATION';
        } else if (scheduledTotal === 0 && configuredWeeklyTotal > 0) {
            status = 'GENERATION_FAILED';
        } else if (
            scheduledTotal < configuredWeeklyTotal || 
            missingLessonsTotal > 0 || 
            missingSubjects.length > 0 || 
            classClashes.length > 0 || 
            (classTeacherClashes[classObj.id] && classTeacherClashes[classObj.id].length > 0) || 
            reservedViolations.length > 0 || 
            lockedViolations.length > 0
        ) {
            status = 'INCOMPLETE';
        } else {
            status = 'COMPLETE';
        }

        const details = status === 'COMPLETE'
            ? `All ${scheduledTotal}/${configuredWeeklyTotal} required lessons satisfied with 0 clashes and 0 missing lessons.`
            : status === 'IMPOSSIBLE_CONFIGURATION'
            ? `Configured curriculum (${configuredWeeklyTotal} periods) exceeds the 38 eligible teaching slots by ${configuredWeeklyTotal - eligibleTeachingSlots}.`
            : status === 'GENERATION_FAILED'
            ? `Timetable grid has 0 scheduled lessons.`
            : `Missing ${missingLessonsTotal} lesson(s) across [${missingSubjects.map(s => s.code).join(', ')}].`;

        classAudits[classObj.id] = {
            classId: classObj.id,
            className: classObj.name,
            level: classObj.level || classObj.category || 'GENERAL',
            stream: classObj.stream || 'GENERAL',
            status,
            requiredLessons: configuredWeeklyTotal,
            scheduledLessons: scheduledTotal,
            missingLessons: missingLessonsTotal,
            emptySlots: freeTeachingPeriods,
            subjectAudits,
            missingSubjects,
            excessSubjects,
            skippedSubjects,
            teacherClashes: classTeacherClashes[classObj.id] || [],
            classClashes,
            lockedViolations,
            reservedViolations,
            dailyLimitViolations,
            details
        };
    }

    const allClassesComplete = classes.every(c => classAudits[c.id]?.status === 'COMPLETE');

    return { 
        valid: errors.length === 0, 
        errors, 
        warnings, 
        rule1Satisfied, 
        allClassesComplete,
        classAudits,
        freePeriodStats,
        unavoidableCurriculumDeficit: unavoidableCurriculumDeficitTotal,
        avoidableUnplacedSlots: avoidableUnplacedSlotsTotal
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

