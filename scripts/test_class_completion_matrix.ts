import { ALL_CLASSES, ALL_SUBJECTS, TIMETABLE_CONFIG } from '../constants';
import { getEligibleSubjectsForClass } from '../services/curriculum_eligibility';
import { generateTimetable, validateTimetable, calculateClassFeasibility } from '../services/generator';
import { TimetableGrid } from '../types';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('CLASS-BY-CLASS TIMETABLE COMPLETION REGRESSION SUITE');
  console.log('================================================================\n');

  // Test 1: Pre-generation Feasibility Calculation
  console.log('--- Test 1: Pre-generation Feasibility Preflight ---');
  const feasibility = calculateClassFeasibility(ALL_CLASSES, ALL_SUBJECTS, [], {});
  assert(feasibility.allClassesFeasible, 'All 24 OTA classes must be mathematically feasible');
  assert(feasibility.overallocatedClasses.length === 0, 'Zero classes should have overallocated curriculum (> 38 slots)');
  const reports = Object.values(feasibility.classes);
  assert(reports.length === 24, 'All 24 classes must have feasibility entries');
  for (const cr of reports) {
    assert(cr.requiredLessons === 38, `Class ${cr.classId} must require exactly 38 lessons (found ${cr.requiredLessons})`);
    assert(cr.status === 'FEASIBLE', `Class ${cr.classId} must be feasible (status=${cr.status})`);
  }

  // Test 2: Core Generation & Class Audit Across All 24 Classes
  console.log('\n--- Test 2: 100% Class Completion Across All 24 Cohorts ---');
  const result = await generateTimetable(
    [],
    ALL_CLASSES,
    ALL_SUBJECTS,
    'BALANCED',
    () => {},
    { maxConsecutiveTeacherPeriods: 2, classLayoutOnly: true } as any
  );

  assert(result.success, 'Timetable generation must succeed with 100% completion');
  const val = validateTimetable(result.timetable, ALL_CLASSES, ALL_SUBJECTS, [], true);
  assert(val.valid, 'Generated timetable must be strictly valid');
  assert(val.allClassesComplete, 'All 24 classes must be marked COMPLETE by validator');
  assert(val.errors.length === 0, `Validation must have 0 errors (found ${val.errors.length})`);

  // Inspect each class individually
  console.log('\n--- Test 3: Individual Class Audits (No Missing, No Excess, No Clashes) ---');
  for (const c of ALL_CLASSES) {
    const classGrid = result.timetable[c.id];
    assert(!!classGrid, `Class ${c.id} grid must exist in timetable`);

    const eligible = getEligibleSubjectsForClass(c, ALL_SUBJECTS);
    const subCounts: Record<string, number> = {};
    let scheduledLessons = 0;
    let fridayWorshipCount = 0;
    let emptySlots = 0;

    for (let d = 0; d < 5; d++) {
      for (let p = 0; p < 8; p++) {
        const cell = classGrid?.[d]?.[p];
        // Friday P7 & P8 check
        if (d === 4 && p >= 6) {
          if (cell?.subjectId === 'WORSHIP') fridayWorshipCount++;
          continue;
        }

        if (!cell || !cell.subjectId || cell.subjectId === 'FREE') {
          emptySlots++;
        } else {
          scheduledLessons++;
          subCounts[cell.subjectId] = (subCounts[cell.subjectId] || 0) + 1;
        }
      }
    }

    assert(scheduledLessons === 38, `Class ${c.id}: Scheduled exactly 38 lessons (got ${scheduledLessons})`);
    assert(emptySlots === 0, `Class ${c.id}: 0 empty eligible instructional slots (got ${emptySlots})`);
    assert(fridayWorshipCount === 2, `Class ${c.id}: Friday P7 & P8 strictly reserved for WORSHIP (got ${fridayWorshipCount})`);

    // Verify exact frequency for every configured subject
    for (const sub of eligible) {
      const target = sub.defaultPeriodCount || sub.periodsPerWeek || 3;
      const actual = subCounts[sub.id] || 0;
      assert(actual === target, `Class ${c.id} - ${sub.code || sub.name}: Configured=${target}, Actual=${actual} (no missing, no excess filler)`);
    }
  }

  // Test 4: Science Stream Specific Invariants
  console.log('\n--- Test 4: Senior Science Cohorts Curriculum Invariants ---');
  const sciClasses = ALL_CLASSES.filter(c => c.stream === 'SCIENCE');
  for (const sc of sciClasses) {
    const grid = result.timetable[sc.id];
    let physCount = 0;
    let chemCount = 0;
    let bioCount = 0;
    for (let d = 0; d < 5; d++) {
      for (let p = 0; p < 8; p++) {
        const sid = grid?.[d]?.[p]?.subjectId;
        if (sid === 'phy_sci') physCount++;
        if (sid === 'chem_sci') chemCount++;
        if (sid === 'bio_sci') bioCount++;
      }
    }
    assert(physCount === 5, `Class ${sc.id}: Physics has exactly 5 weekly periods (no phantom filler)`);
    assert(chemCount === 5, `Class ${sc.id}: Chemistry has exactly 5 weekly periods (no phantom filler)`);
    assert(bioCount === 5, `Class ${sc.id}: Biology has exactly 5 weekly periods (no phantom filler)`);
  }

  // Test 5: Business/Commercial Stream Specific Invariants
  console.log('\n--- Test 5: Senior Business/Commercial Cohorts Curriculum Invariants ---');
  const bcClasses = ALL_CLASSES.filter(c => c.stream === 'BC');
  for (const bc of bcClasses) {
    const grid = result.timetable[bc.id];
    let litCount = 0;
    let ecoCount = 0;
    let accCount = 0;
    for (let d = 0; d < 5; d++) {
      for (let p = 0; p < 8; p++) {
        const sid = grid?.[d]?.[p]?.subjectId;
        if (sid === 'lit_bc') litCount++;
        if (sid === 'eco_bc') ecoCount++;
        if (sid === 'acc_bc') accCount++;
      }
    }
    assert(litCount === 4, `Class ${bc.id}: Literature has exactly 4 weekly periods`);
    assert(ecoCount === 4, `Class ${bc.id}: Economics has exactly 4 weekly periods`);
    assert(accCount === 4, `Class ${bc.id}: Accounting has exactly 4 weekly periods`);
  }

  // Test 6: Best Candidate Preservation (Retry Degraded Attempt Rejection)
  console.log('\n--- Test 6: Best Candidate Quality Preservation ---');
  // Construct a degraded timetable missing half of JS1A
  const degradedGrid: TimetableGrid = JSON.parse(JSON.stringify(result.timetable));
  for (let p = 0; p < 8; p++) {
    degradedGrid['JS1A'][0][p] = { subjectId: '', teacherId: '' };
  }
  const degradedVal = validateTimetable(degradedGrid, ALL_CLASSES, ALL_SUBJECTS, [], true);
  assert(!degradedVal.allClassesComplete, 'Degraded timetable must fail allClassesComplete check');
  assert(degradedVal.classAudits['JS1A']?.status === 'INCOMPLETE', 'JS1A must be marked INCOMPLETE');

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner failure:', err);
  process.exit(1);
});
