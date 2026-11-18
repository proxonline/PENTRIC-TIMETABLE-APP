import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTeacherScheduleSummary,
  formatSwapRequestSummary,
  getTimeOfDayGreeting,
  resolveTaughtSubjectsSummary,
} from './teacherDashboardUtils';
import { Availability, Teacher, TimetableGrid } from '../types';

function makeTeacher(overrides: Partial<Teacher> = {}): Teacher {
  return {
    id: 'tch_1',
    name: 'Ngozi Adeyemi',
    username: 'nadeyemi',
    recoveryCode: '000000',
    subjectsTaught: [],
    assignedClasses: [],
    availability: { 0: { 0: Availability.AVAILABLE } },
    isCompleted: true,
    ...overrides,
  };
}

test('resolveTaughtSubjectsSummary resolves IDs, codes, names, custom strings, and timetable slots without duplicates', () => {
  const teacher = makeTeacher({
    subjectsTaught: ['math_jss', 'PHYS', 'Robotics Club'],
    assignedClasses: ['JS1A', 'JS1B', 'SS1A1'],
  });

  const grid: TimetableGrid = {
    JS1A: {
      0: {
        0: { subjectId: 'math_jss', teacherId: 'tch_1' },
        1: { subjectId: 'math_jss', teacherId: 'tch_1' },
      },
    },
    SS1A1: {
      1: {
        2: { subjectId: 'phy_sci', teacherId: 'tch_1' },
      },
    },
    SS2A1: {
      2: {
        3: { subjectId: 'chem_sci', teacherId: 'other_t', teacherIds: ['other_t', 'tch_1'] },
      },
    },
  };

  const resolved = resolveTaughtSubjectsSummary({ teacher, grid });
  const byId = new Map(resolved.map(item => [item.id, item]));

  assert.equal(resolved.length, 4);

  const math = byId.get('math_jss');
  assert.ok(math);
  assert.equal(math.name, 'Mathematics');
  assert.equal(math.code, 'MATH');
  assert.equal(math.weeklyPeriods, 2);
  assert.deepEqual(math.classes.map(c => c.name), ['JS1A']);
  assert.equal(math.isFromProfile, true);
  assert.equal(math.isFromTimetable, true);

  const phy = byId.get('phy_sci');
  assert.ok(phy);
  assert.equal(phy.name, 'Physics');
  assert.equal(phy.weeklyPeriods, 1);
  assert.deepEqual(phy.classes.map(c => c.name), ['SS1A1']);

  const chem = byId.get('chem_sci');
  assert.ok(chem);
  assert.equal(chem.name, 'Chemistry');
  assert.equal(chem.weeklyPeriods, 1);
  assert.deepEqual(chem.classes.map(c => c.name), ['SS2A1']);
  assert.equal(chem.isFromProfile, false);
  assert.equal(chem.isFromTimetable, true);

  const custom = byId.get('Robotics Club');
  assert.ok(custom);
  assert.equal(custom.name, 'Robotics Club');
  assert.equal(custom.weeklyPeriods, 0);
  assert.deepEqual(custom.classes.map(c => c.name), ['JS1A', 'JS1B', 'SS1A1']);
});

test('resolveTaughtSubjectsSummary narrows unscheduled profile subjects to eligible assigned classes', () => {
  const teacher = makeTeacher({
    subjectsTaught: ['math_jss', 'chem_sci'],
    assignedClasses: ['JS1A', 'SS1A1', 'SS1BC'],
  });

  const resolved = resolveTaughtSubjectsSummary({ teacher, grid: null });
  const math = resolved.find(s => s.id === 'math_jss');
  const chem = resolved.find(s => s.id === 'chem_sci');

  assert.ok(math);
  assert.deepEqual(math.classes.map(c => c.name), ['JS1A']);

  assert.ok(chem);
  assert.deepEqual(chem.classes.map(c => c.name), ['SS1A1']);
});

test('buildTeacherScheduleSummary extracts weekly stats, daily cadence, fatigue warning, and weekday agenda', () => {
  const teacher = makeTeacher({
    assignedClasses: ['JS1A'],
  });

  const grid: TimetableGrid = {
    JS1A: {
      1: {
        0: { subjectId: 'math_jss', teacherId: 'tch_1', roomId: 'room_1', lessonNote: 'Fractions intro' },
        1: { subjectId: 'math_jss', teacherId: 'tch_1' },
        2: { subjectId: 'math_jss', teacherId: 'tch_1' },
        3: { subjectId: 'math_jss', teacherId: 'tch_1' },
        4: { subjectId: 'math_jss', teacherId: 'tch_1' },
        5: { subjectId: 'math_jss', teacherId: 'tch_1' },
      },
    },
  };

  // Tuesday local time -> day index 1
  const tuesday = new Date(2026, 10, 17, 9, 0, 0);
  const summary = buildTeacherScheduleSummary({
    teacher,
    grid,
    rooms: [{ id: 'room_1', name: 'Block A Room 3', capacity: 40 }],
    currentDate: tuesday,
  });

  assert.equal(summary.totalPeriods, 6);
  assert.equal(summary.freePeriods, 32);
  assert.deepEqual(summary.dailyBreakdown, [0, 6, 0, 0, 0]);
  assert.equal(summary.maxConsecutivePeriods, 6);
  assert.equal(summary.fatigueWarning, true);
  assert.equal(summary.isWeekendPreview, false);
  assert.equal(summary.todayDayName, 'Tuesday');
  assert.equal(summary.todayAgenda.length, 6);
  assert.equal(summary.todayAgenda[0].subjectName, 'Mathematics');
  assert.equal(summary.todayAgenda[0].roomName, 'Block A Room 3');
  assert.equal(summary.todayAgenda[0].hasLessonNote, true);
});

test('buildTeacherScheduleSummary switches to Monday preview on weekends', () => {
  const teacher = makeTeacher();
  const grid: TimetableGrid = {
    JS1A: {
      0: {
        0: { subjectId: 'eng_jss', teacherId: 'tch_1' },
      },
    },
  };

  const sunday = new Date(2026, 10, 15, 10, 0, 0);
  const summary = buildTeacherScheduleSummary({ teacher, grid, currentDate: sunday });
  assert.equal(summary.isWeekendPreview, true);
  assert.equal(summary.todayDayName, 'Monday');
  assert.equal(summary.todayAgenda.length, 1);
  assert.equal(summary.todayAgenda[0].subjectName, 'English');
});

test('getTimeOfDayGreeting returns morning, afternoon, and evening appropriately', () => {
  assert.equal(getTimeOfDayGreeting(new Date(2026, 0, 1, 8, 30)), 'Good Morning');
  assert.equal(getTimeOfDayGreeting(new Date(2026, 0, 1, 14, 0)), 'Good Afternoon');
  assert.equal(getTimeOfDayGreeting(new Date(2026, 0, 1, 19, 15)), 'Good Evening');
});

test('formatSwapRequestSummary humanizes automated swap payloads with subject, class, and teacher names', () => {
  const summary = formatSwapRequestSummary(
    {
      id: 'req_1',
      teacherId: 'tch_1',
      teacherName: 'Ngozi Adeyemi',
      type: 'AUTOMATED_SWAP',
      details: 'Proposed swap',
      status: 'PENDING',
      timestamp: Date.now(),
      requestData: {
        offerClassId: 'JS1A',
        offerDay: 0,
        offerPeriod: 1,
        offerSubjectId: 'math_jss',
        targetClassId: 'JS1A',
        targetDay: 2,
        targetPeriod: 3,
        targetSubjectId: 'eng_jss',
        targetTeacherId: 'tch_2',
      },
    },
    [],
    [],
    [makeTeacher({ id: 'tch_2', name: 'Chinedu Eze' })]
  );

  assert.equal(
    summary,
    'Swap Mathematics (JS1A, Mon P2) for English (JS1A, Wed P4) with Chinedu Eze'
  );
});
