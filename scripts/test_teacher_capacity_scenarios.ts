import { ALL_CLASSES, ALL_SUBJECTS, TIMETABLE_CONFIG } from '../constants';
import { getEligibleSubjectsForClass } from '../services/curriculum_eligibility';
import { generateTimetable, validateTimetable } from '../services/generator';
import { Teacher } from '../types';
import fs from 'fs';

async function testScenarios() {
  console.log('=====================================================');
  console.log('INVESTIGATING CAUSES OF INCOMPLETE TIMETABLES');
  console.log('=====================================================\n');

  // Let's see what teachers existed before or currently in the app
  const teachersInStore: Teacher[] = [];
  
  // Scenario 1: No teachers (Class Layout Only)
  console.log('--- SCENARIO 1: Class Layout Only (Zero Faculty) ---');
  const res1 = await generateTimetable(
    [],
    ALL_CLASSES,
    ALL_SUBJECTS,
    'BALANCED',
    () => {},
    { classLayoutOnly: true } as any
  );
  const val1 = validateTimetable(res1.timetable, ALL_CLASSES, ALL_SUBJECTS, [], true);
  console.log(`Success: ${res1.success}, Valid: ${val1.valid}, Rule1Satisfied: ${val1.rule1Satisfied}`);
  let missingTotal1 = 0;
  for (const c of ALL_CLASSES) {
    const stats = val1.freePeriodStats[c.id];
    const missing = Math.max(0, stats.configured - stats.scheduled);
    missingTotal1 += missing;
    if (missing > 0) console.log(`  ${c.id}: ${stats.scheduled}/${stats.configured} (missing ${missing})`);
  }
  console.log(`Total missing lessons across all 24 classes: ${missingTotal1}\n`);

  // Scenario 2: 1 English teacher and 1 Math teacher assigned to all classes
  console.log('--- SCENARIO 2: Bottleneck Faculty (1 Math & 1 English teacher) ---');
  const bottleneckTeachers: any[] = [
    {
      id: 'teach_math_1',
      name: 'Dr. Euler',
      username: 'euler',
      subjectsTaught: ['math_jss', 'math_sci', 'math_bc'],
      assignedClasses: ALL_CLASSES.map(c => c.id),
      availability: {},
      isApproved: true,
      approvalStatus: 'APPROVED',
      isCompleted: true
    },
    {
      id: 'teach_eng_1',
      name: 'Ms. Shakespeare',
      username: 'shakespeare',
      subjectsTaught: ['eng_jss', 'eng_sci', 'eng_bc'],
      assignedClasses: ALL_CLASSES.map(c => c.id),
      availability: {},
      isApproved: true,
      approvalStatus: 'APPROVED',
      isCompleted: true
    }
  ];

  const res2 = await generateTimetable(
    bottleneckTeachers,
    ALL_CLASSES,
    ALL_SUBJECTS,
    'BALANCED',
    () => {},
    { classLayoutOnly: false } as any
  );
  const val2 = validateTimetable(res2.timetable, ALL_CLASSES, ALL_SUBJECTS, bottleneckTeachers, false);
  console.log(`Success: ${res2.success}, Valid: ${val2.valid}, Rule1Satisfied: ${val2.rule1Satisfied}`);
  console.log(`Errors count: ${val2.errors.length}`);
  let missingTotal2 = 0;
  const incompleteClasses2: string[] = [];
  for (const c of ALL_CLASSES) {
    const stats = val2.freePeriodStats[c.id];
    const missing = Math.max(0, stats.configured - stats.scheduled);
    missingTotal2 += missing;
    if (missing > 0) {
      incompleteClasses2.push(`${c.id} (got ${stats.scheduled}/${stats.configured}, missing ${missing})`);
    }
  }
  console.log(`Total missing lessons: ${missingTotal2}`);
  console.log(`Incomplete classes (${incompleteClasses2.length}):`, incompleteClasses2);

  // Scenario 3: How does the generator handle partial faculty vs unassigned subjects?
  // When Dr. Euler can only teach 38 periods, what happened to the other 82 periods of Math?
  // Did the generator leave them EMPTY, or assign them without a teacher, or drop them?
  console.log('\n--- SCENARIO 2 ANALYSIS OF MATH SLOTS ---');
  let mathScheduledCount = 0;
  let mathWithTeacher = 0;
  let mathWithoutTeacher = 0;
  for (const c of ALL_CLASSES) {
    const grid = res2.timetable[c.id];
    for (let d = 0; d < 5; d++) {
      for (let p = 0; p < 8; p++) {
        const cell = grid?.[d]?.[p];
        if (cell && (cell.subjectId.startsWith('math_'))) {
          mathScheduledCount++;
          if (cell.teacherId && cell.teacherId !== 'SYSTEM') {
            mathWithTeacher++;
          } else {
            mathWithoutTeacher++;
          }
        }
      }
    }
  }
  console.log(`Total Math slots scheduled: ${mathScheduledCount} / 120 required`);
  console.log(`Math slots with teacher: ${mathWithTeacher}`);
  console.log(`Math slots without teacher (empty or unassigned): ${mathWithoutTeacher}`);
}

testScenarios().catch(console.error);
