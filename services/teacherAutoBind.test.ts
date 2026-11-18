import test from 'node:test';
import assert from 'node:assert/strict';
import { bindTeacherToTimetableGrid } from './teacherAutoBind';
import { buildTeacherScheduleSummary } from './teacherDashboardUtils';
import { ALL_CLASSES, ALL_SUBJECTS } from '../constants';
import { Availability, Teacher, TimetableGrid } from '../types';

function makeTeacher(overrides: Partial<Teacher> = {}): Teacher {
  return {
    id: 'tch_new_1',
    name: 'Dr. Chidi Okafor',
    username: 'cokafor',
    recoveryCode: 'ABC123',
    subjectsTaught: ['phy_sci'],
    assignedClasses: ['SS1A1', 'SS1A2'],
    availability: {},
    isApproved: true,
    approvalStatus: 'APPROVED',
    isCompleted: true,
    ...overrides,
  };
}

test('bindTeacherToTimetableGrid binds unassigned matching slots on a published grid without double-booking', () => {
  const publishedGrid: TimetableGrid = {
    SS1A1: {
      0: {
        0: { subjectId: 'phy_sci', teacherId: '', teacherIds: [] },
        1: { subjectId: 'math_sci', teacherId: '', teacherIds: [] },
      },
      1: {
        2: { subjectId: 'phy_sci', teacherId: '', teacherIds: [] },
      },
    },
    SS1A2: {
      0: {
        // Same (day 0, period 0) as SS1A1 Physics -> must NOT double-book!
        0: { subjectId: 'phy_sci', teacherId: '', teacherIds: [] },
        // Different slot (day 0, period 3) -> should claim cleanly!
        3: { subjectId: 'phy_sci', teacherId: '', teacherIds: [] },
      },
    },
  };

  const teacher = makeTeacher();
  const res = bindTeacherToTimetableGrid({
    teacher,
    grid: publishedGrid,
    subjects: ALL_SUBJECTS,
    classes: ALL_CLASSES,
  });

  assert.equal(res.updated, true);
  assert.equal(res.boundSlotsCount, 3);
  assert.deepEqual(res.claimedClasses, ['SS1A1', 'SS1A2']);

  // SS1A1 slots claimed
  assert.equal(res.grid.SS1A1[0][0]?.teacherId, 'tch_new_1');
  assert.deepEqual(res.grid.SS1A1[0][0]?.teacherIds, ['tch_new_1']);
  assert.equal(res.grid.SS1A1[1][2]?.teacherId, 'tch_new_1');
  // Unrelated subject left unassigned
  assert.equal(res.grid.SS1A1[0][1]?.teacherId, '');

  // Clash check: SS1A2[0][0] stays unassigned because SS1A1[0][0] already claimed d=0,p=0
  assert.equal(res.grid.SS1A2[0][0]?.teacherId, '');
  // SS1A2[0][3] claimed cleanly
  assert.equal(res.grid.SS1A2[0][3]?.teacherId, 'tch_new_1');

  // Personal dashboard summary immediately populates from the bound published timetable
  const summary = buildTeacherScheduleSummary({
    teacher,
    grid: res.grid,
    configuredSubjects: ALL_SUBJECTS,
    configuredClasses: ALL_CLASSES,
  });
  assert.equal(summary.totalPeriods, 3);
  assert.equal(summary.dailyBreakdown[0], 2);
  assert.equal(summary.dailyBreakdown[1], 1);
});

test('bindTeacherToTimetableGrid respects UNAVAILABLE periods and per-class classSubjects map', () => {
  const publishedGrid: TimetableGrid = {
    JS1A: {
      0: {
        0: { subjectId: 'math_jss', teacherId: '', teacherIds: [] },
        1: { subjectId: 'math_jss', teacherId: '', teacherIds: [] },
      },
    },
    SS1A1: {
      0: {
        2: { subjectId: 'math_sci', teacherId: '', teacherIds: [] },
        3: { subjectId: 'phy_sci', teacherId: '', teacherIds: [] },
      },
    },
  };

  // Teacher teaches Math only in JS1A, and Physics only in SS1A1, and is UNAVAILABLE at Mon P1 (0, 0)
  const teacher = makeTeacher({
    assignedClasses: ['JS1A', 'SS1A1'],
    subjectsTaught: ['math_jss', 'phy_sci'],
    classSubjects: {
      JS1A: ['math_jss'],
      SS1A1: ['phy_sci'],
    },
    availability: {
      0: { 0: Availability.UNAVAILABLE },
    },
  });

  const res = bindTeacherToTimetableGrid({
    teacher,
    grid: publishedGrid,
    subjects: ALL_SUBJECTS,
    classes: ALL_CLASSES,
  });

  assert.equal(res.updated, true);
  assert.equal(res.boundSlotsCount, 2);
  // Unavailable slot skipped
  assert.equal(res.grid.JS1A[0][0]?.teacherId, '');
  // Available matching JS1A Math claimed
  assert.equal(res.grid.JS1A[0][1]?.teacherId, 'tch_new_1');
  // SS1A1 Math NOT claimed because classSubjects['SS1A1'] only has phy_sci
  assert.equal(res.grid.SS1A1[0][2]?.teacherId, '');
  // SS1A1 Physics claimed
  assert.equal(res.grid.SS1A1[0][3]?.teacherId, 'tch_new_1');
});

test('bindTeacherToTimetableGrid protects non-parallel occupied slots while supporting parallel subjects', () => {
  const publishedGrid: TimetableGrid = {
    SS1A1: {
      2: {
        0: { subjectId: 'phy_sci', teacherId: 'other_teacher', teacherIds: ['other_teacher'] },
        1: { subjectId: 'fur_sci', teacherId: 'other_teacher', teacherIds: ['other_teacher'] },
      },
    },
  };

  const teacher = makeTeacher({
    assignedClasses: ['SS1A1'],
    subjectsTaught: ['phy_sci', 'fur_sci'],
  });

  const res = bindTeacherToTimetableGrid({
    teacher,
    grid: publishedGrid,
    subjects: ALL_SUBJECTS,
    classes: ALL_CLASSES,
  });

  assert.equal(res.updated, true);
  assert.equal(res.boundSlotsCount, 1);
  // Non-parallel slot keeps existing teacher exclusively
  assert.equal(res.grid.SS1A1[2][0]?.teacherId, 'other_teacher');
  assert.deepEqual(res.grid.SS1A1[2][0]?.teacherIds, ['other_teacher']);
  // Parallel subject (Further Maths / Agric) cleanly co-assigns the new teacher
  assert.deepEqual(res.grid.SS1A1[2][1]?.teacherIds, ['other_teacher', 'tch_new_1']);
});

test('bindTeacherToTimetableGrid skips unapproved or incomplete teachers', () => {
  const publishedGrid: TimetableGrid = {
    SS1A1: {
      0: {
        0: { subjectId: 'phy_sci', teacherId: '', teacherIds: [] },
      },
    },
  };

  const pendingTeacher = makeTeacher({ isApproved: false, approvalStatus: 'PENDING' });
  const incompleteTeacher = makeTeacher({ isCompleted: false });

  assert.equal(bindTeacherToTimetableGrid({ teacher: pendingTeacher, grid: publishedGrid }).updated, false);
  assert.equal(bindTeacherToTimetableGrid({ teacher: incompleteTeacher, grid: publishedGrid }).updated, false);
});
