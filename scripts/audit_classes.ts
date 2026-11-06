import { ALL_CLASSES, ALL_SUBJECTS, TIMETABLE_CONFIG } from '../constants';
import { getEligibleSubjectsForClass, resolveMaxPerDay } from '../services/curriculum_eligibility';
import { generateTimetable, validateTimetable } from '../services/generator';
import fs from 'fs';

async function audit() {
  console.log('=====================================================');
  console.log('AUDIT OF ALL CLASSES IN PENTRIC');
  console.log('=====================================================\n');

  // 1. Inspect configured classes and curriculum
  let storedStore: any = null;
  if (fs.existsSync('data/ota_store.json')) {
    try {
      storedStore = JSON.parse(fs.readFileSync('data/ota_store.json', 'utf8'));
    } catch {}
  }

  const classes = storedStore?.keys?.ota_classes || ALL_CLASSES;
  const subjects = storedStore?.keys?.ota_subjects_v2 || ALL_SUBJECTS;
  const teachers = storedStore?.keys?.ota_teachers_v3 || [];
  const currentGrid = storedStore?.keys?.ota_timetable_v2 || {};

  console.log(`Total Classes: ${classes.length}`);
  console.log(`Total Subjects: ${subjects.length}`);
  console.log(`Total Teachers: ${teachers.length}`);
  console.log(`Current Timetable classes present: ${Object.keys(currentGrid).length}\n`);

  console.log('--- CURRICULUM CONFIGURATION PER CLASS ---');
  const classCurriculumSummary: Record<string, { required: number; subjectsCount: number; subjects: string[] }> = {};

  for (const c of classes) {
    const eligible = getEligibleSubjectsForClass(c, subjects);
    const sum = eligible.reduce((acc: number, s: any) => acc + (s.defaultPeriodCount || s.periodsPerWeek || 3), 0);
    classCurriculumSummary[c.id] = {
      required: sum,
      subjectsCount: eligible.length,
      subjects: eligible.map((s: any) => `${s.code || s.id}: ${s.defaultPeriodCount || s.periodsPerWeek || 3}`)
    };
    console.log(`Class: ${c.id.padEnd(8)} | Level: ${(c.level || c.category).padEnd(12)} | Stream: ${(c.stream || 'GEN').padEnd(8)} | Required Lessons: ${String(sum).padStart(2)} / 38 slots | Subjects: ${eligible.length}`);
  }

  console.log('\n--- AUDIT OF CURRENT STORED TIMETABLE ---');
  for (const c of classes) {
    const eligible = getEligibleSubjectsForClass(c, subjects);
    const reqSum = classCurriculumSummary[c.id].required;
    const classGrid = currentGrid[c.id] || {};

    let scheduled = 0;
    let worship = 0;
    let empty = 0;
    const subCounts: Record<string, number> = {};

    for (let d = 0; d < 5; d++) {
      for (let p = 0; p < 8; p++) {
        const cell = classGrid?.[d]?.[p];
        if (d === 4 && p >= 6) {
          if (cell?.subjectId === 'WORSHIP') worship++;
          continue;
        }
        if (!cell || !cell.subjectId || cell.subjectId === 'FREE') {
          empty++;
        } else {
          scheduled++;
          subCounts[cell.subjectId] = (subCounts[cell.subjectId] || 0) + 1;
        }
      }
    }

    const missing = Math.max(0, reqSum - scheduled);
    const missingSubs: string[] = [];
    const excessSubs: string[] = [];

    for (const s of eligible) {
      const target = s.defaultPeriodCount || s.periodsPerWeek || 3;
      const actual = subCounts[s.id] || 0;
      if (actual < target) {
        missingSubs.push(`${s.code || s.id} (${actual}/${target})`);
      } else if (actual > target) {
        excessSubs.push(`${s.code || s.id} (${actual}/${target})`);
      }
    }

    console.log(`Class ${c.id.padEnd(8)}: Required=${reqSum}, Scheduled=${scheduled}, Empty=${empty}, Missing=${missing}, MissingSubs=[${missingSubs.join(', ')}], ExcessSubs=[${excessSubs.join(', ')}]`);
  }

  console.log('\n--- RUNNING FRESH GENERATION AUDIT ---');
  const genResult = await generateTimetable(
    teachers,
    classes,
    subjects,
    'BALANCED',
    () => {},
    { maxConsecutiveTeacherPeriods: 2, classLayoutOnly: true } as any
  );

  console.log(`Generation Success: ${genResult.success}`);
  const val = validateTimetable(genResult.timetable, classes, subjects, teachers, true);
  console.log(`Validation Valid: ${val.valid}, Rule1Satisfied: ${val.rule1Satisfied}`);
  console.log(`Errors count: ${val.errors.length}`);
  if (val.errors.length > 0) {
    console.log('Errors sample:', val.errors.slice(0, 10));
  }

  console.log('\n--- CLASS-BY-CLASS POST-GENERATION COMPLETION REPORT ---');
  let allComplete = true;
  for (const c of classes) {
    const eligible = getEligibleSubjectsForClass(c, subjects);
    const reqSum = classCurriculumSummary[c.id].required;
    const classGrid = genResult.timetable[c.id] || {};

    let scheduled = 0;
    let empty = 0;
    const subCounts: Record<string, number> = {};

    for (let d = 0; d < 5; d++) {
      for (let p = 0; p < 8; p++) {
        const cell = classGrid?.[d]?.[p];
        if (d === 4 && p >= 6) continue; // Friday worship
        if (!cell || !cell.subjectId || cell.subjectId === 'FREE' || cell.subjectId === 'WORSHIP') {
          empty++;
        } else {
          scheduled++;
          subCounts[cell.subjectId] = (subCounts[cell.subjectId] || 0) + 1;
        }
      }
    }

    const missingLessons = Math.max(0, Math.min(reqSum, 38) - scheduled);
    const missingSubjects: string[] = [];
    const excessSubjects: string[] = [];

    for (const s of eligible) {
      const target = s.defaultPeriodCount || s.periodsPerWeek || 3;
      const actual = subCounts[s.id] || 0;
      if (actual < target) {
        missingSubjects.push(`${s.name} (got ${actual}, needs ${target})`);
      } else if (actual > target) {
        excessSubjects.push(`${s.name} (got ${actual}, needs ${target})`);
      }
    }

    let status = 'COMPLETE';
    if (reqSum > 38) {
      status = 'OVERALLOCATED_CURRICULUM';
      allComplete = false;
    } else if (scheduled < reqSum) {
      status = 'INCOMPLETE';
      allComplete = false;
    }

    console.log(`\nClass: ${c.name} (${c.id})`);
    console.log(`  Status: ${status}`);
    console.log(`  Required Lessons: ${reqSum}`);
    console.log(`  Scheduled Lessons: ${scheduled} / 38 eligible slots`);
    console.log(`  Empty Slots: ${empty}`);
    console.log(`  Missing Lessons: ${missingLessons}`);
    if (missingSubjects.length > 0) {
      console.log(`  Missing Subjects: ${missingSubjects.join(', ')}`);
    }
    if (excessSubjects.length > 0) {
      console.log(`  Excess Subjects: ${excessSubjects.join(', ')}`);
    }
  }

  console.log(`\nOVERALL COMPLETION AUDIT RESULT: ${allComplete ? 'ALL CLASSES COMPLETE' : 'INCOMPLETE CLASSES DETECTED'}`);
}

audit().catch(console.error);
