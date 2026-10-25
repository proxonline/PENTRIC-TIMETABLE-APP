import { TIMETABLE_CONFIG, DAYS, PERIODS, SSS_SCIENCE_SUBJECTS, SSS_BC_SUBJECTS, JSS_SUBJECTS, ALL_CLASSES, ALL_SUBJECTS } from '../constants';
import { getEligibleSubjectsForClass, resolveMaxPerDay, isTeacherQualifiedForSubject } from '../services/curriculum_eligibility';
import { ConstraintSolver } from '../services/constraint_solver';
import { generateTimetable, validateTimetable } from '../services/generator';
import { Teacher, Class, Subject, Availability, TimetableGrid, TimetableCell } from '../types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
        console.log(`  ✓ PASS: ${testName}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
        failed++;
    }
}

async function runAllTests() {
    console.log('=====================================================');
    console.log('PENTRIC SURGICAL TIMETABLE ENGINE REGRESSION TESTS');
    console.log('Cases A through K Complete Verification Suite');
    console.log('=====================================================\n');

    // -------------------------------------------------------------------------
    // CASE A: Exact 38-Slot Capacity Calculation & Friday Worship Reservation
    // -------------------------------------------------------------------------
    console.log('Case A: Authoritative 38-Slot Capacity & Friday Worship Reservation');
    assert(TIMETABLE_CONFIG.DAYS_COUNT === 5, 'Days count is exactly 5');
    assert(TIMETABLE_CONFIG.PERIODS_PER_DAY === 8, 'Periods per day is exactly 8');
    assert(TIMETABLE_CONFIG.TOTAL_GRID_SLOTS === 40, 'Total physical grid positions is 40');
    assert(TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS === 38, 'Available instructional teaching slots is exactly 38');
    assert(TIMETABLE_CONFIG.WORSHIP_DAY === 4, 'Worship day is Friday (index 4)');
    assert(TIMETABLE_CONFIG.WORSHIP_START_PERIOD === 6, 'Worship begins at Period index 6 (P7)');
    assert(TIMETABLE_CONFIG.WORSHIP_PERIODS_COUNT === 2, 'Worship occupies exactly 2 periods (P7 & P8)');

    // -------------------------------------------------------------------------
    // CASE B: Senior Science Configured Curriculum & Zero Phantom Practical Tasks
    // -------------------------------------------------------------------------
    console.log('\nCase B: Senior Science Curriculum Total & Zero Phantom Labs');
    const ssSciClass: Class = { id: 'SS1A1', name: 'SS1A1', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE' };
    const eligibleSci = getEligibleSubjectsForClass(ssSciClass, SSS_SCIENCE_SUBJECTS);
    assert(eligibleSci.length === 9, 'Senior Science has 9 eligible subjects');
    
    const sciTotal = eligibleSci.reduce((sum, s) => sum + (s.defaultPeriodCount || s.periodsPerWeek || 0), 0);
    assert(sciTotal === 38, `Senior Science configured curriculum total is exactly 38 (calculated ${sciTotal})`);

    // Create qualified teachers for Senior Science
    const sciTeachers: Teacher[] = eligibleSci.map((sub, idx) => ({
        id: `t_sci_${idx}`,
        name: `Teacher ${sub.name}`,
        username: `t_sci_${idx}`,
        password: 'password',
        recoveryCode: 'REC123',
        isCompleted: true,
        subjectsTaught: [sub.id],
        assignedClasses: ['SS1A1'],
        availability: {}
    }));

    const sciSolver = new ConstraintSolver(
        sciTeachers,
        [ssSciClass],
        eligibleSci,
        { goal: 'BALANCED', forceSinglePeriods: true }
    );
    const sciResult = await sciSolver.solve();
    const sciValidation = validateTimetable(sciResult.grid, [ssSciClass], eligibleSci, sciTeachers);

    assert(sciValidation.valid, 'Senior Science generated schedule is 100% valid');
    assert(sciValidation.errors.length === 0, `Zero validation errors for Senior Science (found ${sciValidation.errors.length})`);
    
    // Check that each subject has EXACTLY its configured frequency (no extra phantom practicals)
    let totalScheduledInSci = 0;
    const sciFreqCounts: Record<string, number> = {};
    for (let d = 0; d < 5; d++) {
        for (let p = 0; p < 8; p++) {
            const cell = sciResult.grid['SS1A1']?.[d]?.[p];
            if (cell && cell.subjectId !== 'FREE' && cell.subjectId !== 'WORSHIP') {
                totalScheduledInSci++;
                sciFreqCounts[cell.subjectId] = (sciFreqCounts[cell.subjectId] || 0) + 1;
            }
        }
    }
    assert(totalScheduledInSci === 38, `Exactly 38 teaching slots scheduled for SS1A1 (scheduled: ${totalScheduledInSci})`);
    
    let phantomDetected = false;
    for (const sub of eligibleSci) {
        const req = sub.defaultPeriodCount || sub.periodsPerWeek || 0;
        const actual = sciFreqCounts[sub.id] || 0;
        if (actual !== req) {
            phantomDetected = true;
            console.error(`  Mismatch for ${sub.name}: expected ${req}, got ${actual}`);
        }
    }
    assert(!phantomDetected, 'All 9 Senior Science subjects match their configured frequency exactly (zero phantom labs)');

    // Friday P7 & P8 must be WORSHIP
    const friP7 = sciResult.grid['SS1A1']?.[4]?.[6];
    const friP8 = sciResult.grid['SS1A1']?.[4]?.[7];
    assert(friP7?.subjectId === 'WORSHIP' && friP8?.subjectId === 'WORSHIP', 'Friday P7 and P8 strictly reserved for WORSHIP');

    // -------------------------------------------------------------------------
    // CASE C: Overallocated BC Curriculum Preflight Feasibility
    // -------------------------------------------------------------------------
    console.log('\nCase C: Overallocated BC Curriculum Feasibility Preflight Detection');
    const ss1BcClass: Class = { id: 'SS1BC', name: 'SS1BC', category: 'SSS_BC', level: 'SENIOR', stream: 'BC' };
    
    const overallocatedSubs: Subject[] = [
        ...SSS_BC_SUBJECTS,
        { id: 'extra_bc', name: 'Extra Elective', code: 'EXTR', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 }
    ];
    const bcConfiguredTotal = overallocatedSubs.reduce((sum, s) => sum + (s.defaultPeriodCount || s.periodsPerWeek || 0), 0);
    assert(bcConfiguredTotal === 40, `BC curriculum test set configured to 40 periods (sum = ${bcConfiguredTotal})`);

    const bcGenResult = await generateTimetable(
        [],
        [ss1BcClass],
        overallocatedSubs,
        'BALANCED',
        () => {},
        { goal: 'BALANCED', forceSinglePeriods: true }
    );
    assert(!bcGenResult.success, 'Overallocated class is NOT falsely reported as full success');
    const alertFound = bcGenResult.logs.some(l => l.message.includes('overallocated') || l.message.includes('Curriculum Capacity Alert'));
    assert(alertFound, 'Preflight feasibility alert correctly logged for overallocated BC class');

    // -------------------------------------------------------------------------
    // CASE D: Manual Locks & Morning Core Distribution
    // -------------------------------------------------------------------------
    console.log('\nCase D: Manual Lock Accounting & Morning Core Weekday Fixation');
    const mathSub = SSS_SCIENCE_SUBJECTS.find(s => s.id === 'math_sci')!;
    assert(mathSub.defaultPeriodCount === 5, 'Math defaultPeriodCount is 5');

    const existingGridWithLock: TimetableGrid = {
        'SS1A1': {
            2: {
                0: {
                    subjectId: 'math_sci',
                    teacherId: 't_sci_0',
                    teacherIds: ['t_sci_0'],
                    isManual: true,
                    isDouble: false,
                    classId: 'SS1A1'
                }
            }
        }
    };

    const lockSolver = new ConstraintSolver(
        sciTeachers,
        [ssSciClass],
        eligibleSci,
        { goal: 'BALANCED', forceSinglePeriods: true, preserveManualEdits: true },
        existingGridWithLock
    );
    const lockResult = await lockSolver.solve();

    const wedP1 = lockResult.grid['SS1A1']?.[2]?.[0];
    assert(wedP1?.subjectId === 'math_sci' && wedP1?.isManual === true, 'Manually locked Math on Wednesday P1 is preserved');

    let mathTotalPlaced = 0;
    const mathDays: number[] = [];
    for (let d = 0; d < 5; d++) {
        for (let p = 0; p < 8; p++) {
            const cell = lockResult.grid['SS1A1']?.[d]?.[p];
            if (cell && cell.subjectId === 'math_sci') {
                mathTotalPlaced++;
                mathDays.push(d);
            }
        }
    }
    assert(mathTotalPlaced === 5, `Math scheduled exactly 5 times taking manual lock into account (scheduled: ${mathTotalPlaced})`);
    
    const wedMathCount = mathDays.filter(d => d === 2).length;
    assert(wedMathCount === 1, 'Wednesday has exactly 1 Math occurrence (no duplicate fixation caused by manual lock)');

    // -------------------------------------------------------------------------
    // CASE E: Single Authoritative Daily Limits (resolveMaxPerDay)
    // -------------------------------------------------------------------------
    console.log('\nCase E: Consistent Daily Limits Resolution');
    const mathMax = resolveMaxPerDay({ id: 'm', name: 'M', defaultPeriodCount: 5 } as any);
    const civMax = resolveMaxPerDay({ id: 'c', name: 'C', defaultPeriodCount: 2 } as any);
    const litMax = resolveMaxPerDay({ id: 'l', name: 'L', defaultPeriodCount: 4, maxPerDay: 2 } as any);
    const tdMax = resolveMaxPerDay({ id: 't', name: 'T', defaultPeriodCount: 4, maxPerDay: 1 } as any);

    assert(mathMax === 2, 'Subject with 5 periods defaults to max 2/day');
    assert(civMax === 1, 'Subject with 2 periods defaults to max 1/day');
    assert(litMax === 2, 'Explicit maxPerDay: 2 is strictly respected');
    assert(tdMax === 1, 'Explicit maxPerDay: 1 is strictly respected');

    // -------------------------------------------------------------------------
    // CASE F: Qualification Matching with Canonical IDs & Legacy Names/Codes
    // -------------------------------------------------------------------------
    console.log('\nCase F: Faculty Qualification Matching');
    const subPhys: Subject = { id: 'phy_sci', name: 'Physics', code: 'PHYS', defaultPeriodCount: 5 } as any;

    const teacherCanonical: Teacher = { id: 't1', name: 'T1', subjectsTaught: ['phy_sci'] } as any;
    const teacherLegacyCode: Teacher = { id: 't2', name: 'T2', subjectsTaught: ['PHYS'] } as any;
    const teacherLegacyName: Teacher = { id: 't3', name: 'T3', subjectsTaught: ['Physics'] } as any;
    const teacherUnqualified: Teacher = { id: 't4', name: 'T4', subjectsTaught: ['bio_sci'] } as any;

    assert(isTeacherQualifiedForSubject(teacherCanonical, subPhys), 'Canonical subject ID matches');
    assert(isTeacherQualifiedForSubject(teacherLegacyCode, subPhys), 'Legacy subject code (PHYS) matches');
    assert(isTeacherQualifiedForSubject(teacherLegacyName, subPhys), 'Legacy subject name (Physics) matches');
    assert(!isTeacherQualifiedForSubject(teacherUnqualified, subPhys), 'Unqualified teacher is rejected');

    // -------------------------------------------------------------------------
    // CASE G: Weekly Variety Optimization Respects Teacher Unavailability
    // -------------------------------------------------------------------------
    console.log('\nCase G: Variety Optimization Respects Teacher Unavailability');
    const unavailTeacher: Teacher = {
        id: 't_unavail',
        name: 'Strict Teacher',
        username: 'strict',
        password: 'password',
        recoveryCode: 'REC',
        isCompleted: true,
        subjectsTaught: ['phy_sci'],
        assignedClasses: ['SS1A1'],
        availability: {
            0: { 3: Availability.UNAVAILABLE }
        }
    };

    const solverWithUnavail = new ConstraintSolver(
        [unavailTeacher],
        [ssSciClass],
        [subPhys],
        { goal: 'BALANCED', forceSinglePeriods: true }
    );
    await solverWithUnavail.solve();
    solverWithUnavail.optimizeWeeklyVariety();

    const cellAtMonP4 = (solverWithUnavail as any).state.grid['SS1A1']?.[0]?.[3];
    const isTeacherAtMonP4 = cellAtMonP4?.teacherId === 't_unavail' || cellAtMonP4?.teacherIds?.includes('t_unavail');
    assert(!isTeacherAtMonP4, 'Teacher is NEVER scheduled in an UNAVAILABLE slot during variety optimization');

    // -------------------------------------------------------------------------
    // CASE H: Class-Layout-Only Diagnostic Mode (Single Clean Notice)
    // -------------------------------------------------------------------------
    console.log('\nCase H: Class-Layout-Only Diagnostic Notice');
    const layoutOnlyResult = await generateTimetable(
        [],
        [ssSciClass],
        eligibleSci,
        'BALANCED',
        () => {},
        { goal: 'BALANCED', forceSinglePeriods: true, classLayoutOnly: true }
    );
    const singleNoticeFound = layoutOnlyResult.logs.some(l => l.message.includes('Class-Layout-Only Draft'));
    assert(singleNoticeFound, 'Class-Layout-Only Draft notice logged cleanly');
    const repeatedFacultyErrors = layoutOnlyResult.logs.filter(l => l.type === 'error' && l.message.includes('Faculty Missing'));
    assert(repeatedFacultyErrors.length === 0, 'No repeated faculty missing errors emitted in class-layout-only mode');

    // -------------------------------------------------------------------------
    // CASE I: All 24 Classes Complete 38/38 Slot Placement Without Starvation
    // -------------------------------------------------------------------------
    console.log('\nCase I: Full 24-Class Cohort Layout Capacity (SS2BC & SS3BC Included)');
    const fullSolver = new ConstraintSolver(
        [],
        ALL_CLASSES,
        ALL_SUBJECTS,
        { goal: 'BALANCED', forceSinglePeriods: true, classLayoutOnly: true }
    );
    const fullStartTime = Date.now();
    const fullResult = await fullSolver.solve();
    const fullElapsed = Date.now() - fullStartTime;
    console.log(`  Full 24 classes solved in ${fullElapsed} ms`);

    assert(fullResult.success, 'Full 24-class solve reports success');

    let all24Full = true;
    const unfilledClasses: string[] = [];
    for (const classObj of ALL_CLASSES) {
        let placedSlots = 0;
        for (let d = 0; d < 5; d++) {
            for (let p = 0; p < 8; p++) {
                const cell = fullResult.grid[classObj.id]?.[d]?.[p];
                if (cell && cell.subjectId !== 'FREE' && cell.subjectId !== 'WORSHIP') {
                    placedSlots++;
                }
            }
        }
        if (placedSlots !== 38) {
            all24Full = false;
            unfilledClasses.push(`${classObj.name} (${placedSlots}/38)`);
        }
    }
    assert(all24Full, `All 24 classes achieved 100% capacity (38/38 slots filled)`, unfilledClasses.join(', '));

    // Specifically verify SS2BC and SS3BC
    let ss2bcSlots = 0;
    let ss3bcSlots = 0;
    for (let d = 0; d < 5; d++) {
        for (let p = 0; p < 8; p++) {
            if (fullResult.grid['SS2BC']?.[d]?.[p]?.subjectId !== 'FREE' && fullResult.grid['SS2BC']?.[d]?.[p]?.subjectId !== 'WORSHIP') ss2bcSlots++;
            if (fullResult.grid['SS3BC']?.[d]?.[p]?.subjectId !== 'FREE' && fullResult.grid['SS3BC']?.[d]?.[p]?.subjectId !== 'WORSHIP') ss3bcSlots++;
        }
    }
    assert(ss2bcSlots === 38, `SS2BC has exactly 38/38 slots scheduled (previously starved at 37)`);
    assert(ss3bcSlots === 38, `SS3BC has exactly 38/38 slots scheduled (previously starved at 36)`);

    // -------------------------------------------------------------------------
    // CASE J: Lexicographic Candidate Ranking & Best Candidate Retention
    // -------------------------------------------------------------------------
    console.log('\nCase J: Lexicographic Candidate Ranking & Best Candidate Retention');
    const multiPassResult = await generateTimetable(
        [],
        [ss1BcClass],
        SSS_BC_SUBJECTS,
        'BALANCED',
        () => {},
        { goal: 'BALANCED', forceSinglePeriods: true, classLayoutOnly: true }
    );
    assert(multiPassResult.success, 'Candidate generation succeeded with optimal score retention');
    assert(multiPassResult.reasoningReport?.hardConstraintsSatisfied === true, 'Best candidate retained has zero hard constraint violations');

    // -------------------------------------------------------------------------
    // CASE K: Separation of Unavoidable Capacity Deficits from Avoidable Unplaced Slots
    // -------------------------------------------------------------------------
    console.log('\nCase K: Separation of Unavoidable Capacity Deficits from Avoidable Failures');
    const reportWithExcess = await generateTimetable(
        [],
        [ss1BcClass],
        overallocatedSubs,
        'BALANCED',
        () => {},
        { goal: 'BALANCED', forceSinglePeriods: true, classLayoutOnly: true }
    );
    const deficitFound = reportWithExcess.reasoningReport?.unavoidableCurriculumDeficit === 2;
    assert(deficitFound, `Unavoidable curriculum deficit isolated to exactly 2 periods (40 - 38 = 2)`);
    assert(reportWithExcess.reasoningReport?.avoidableUnplacedSlots === 0, 'Zero avoidable unplaced slots (all 38 physical slots utilized)');

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n=====================================================');
    console.log(`REGRESSION RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=====================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runAllTests().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
