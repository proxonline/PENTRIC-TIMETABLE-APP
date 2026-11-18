import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuditDefaults,
  buildConflictFixFallback,
  buildDeterministicSlotAnalysis,
  countScheduledCells,
  normalizeModerationResponse,
  safeParseJsonObject,
} from './aiContracts';

test('countScheduledCells counts populated slots safely', () => {
  const emptyRow = () => Array(8).fill(null);
  const grid: any = {
    jss1a: [
      [{ subjectId: 'math' }, null, { subjectId: 'eng' }, null, null, null, null, null],
      emptyRow(),
      emptyRow(),
      emptyRow(),
      emptyRow(),
    ],
  };
  assert.equal(countScheduledCells(grid), 2);
  assert.equal(countScheduledCells(null), 0);
});

test('safeParseJsonObject strips markdown fences and merges defaults', () => {
  const defaults = buildAuditDefaults([]);
  const parsed = safeParseJsonObject('```json\n{"pedagogicalScore":96,"summary":"Strong layout."}\n```', defaults);
  assert.equal(parsed.pedagogicalScore, 96);
  assert.equal(parsed.fairnessScore, 88);
  assert.equal(parsed.summary, 'Strong layout.');
});

test('safeParseJsonObject falls back cleanly on malformed JSON', () => {
  const defaults = buildAuditDefaults([]);
  const parsed = safeParseJsonObject('not valid json', defaults);
  assert.deepEqual(parsed, defaults);
});

test('normalizeModerationResponse parses safe/flagReason accurately', () => {
  assert.deepEqual(normalizeModerationResponse('{"safe":false,"reason":"Abusive language"}'), {
    isSafe: false,
    flagReason: 'Abusive language',
  });
  assert.deepEqual(normalizeModerationResponse('{"safe":true,"reason":""}'), {
    isSafe: true,
  });
});

test('buildDeterministicSlotAnalysis detects overallocation and emits auto-fix adjustments', () => {
  const subjects: any[] = [
    { id: 's1', name: 'Mathematics', code: 'MTH', isCore: true, defaultPeriodCount: 20, maxPerDay: 2, level: 'JUNIOR' },
    { id: 's2', name: 'Fine Art', code: 'ART', isCore: false, defaultPeriodCount: 22, maxPerDay: 2, level: 'JUNIOR' },
  ];
  const result = buildDeterministicSlotAnalysis('JUNIOR', subjects, [{ id: 'c1', name: 'JSS1A' } as any], [], 38);
  assert.equal(result.slotBudget.assignedSlots, 42);
  assert.equal(result.slotBudget.remainingSlots, -4);
  assert.equal(result.slotBudget.isOverallocated, true);
  assert.equal(result.suggestions[0]?.type, 'SLOT_OVERLOAD');
  assert.ok((result.suggestions[0]?.autoFixPayload?.subjectAdjustments?.length || 0) > 0);
});

test('buildConflictFixFallback describes day and period cleanly', () => {
  const msg = buildConflictFixFallback({
    id: 'cf1',
    type: 'TEACHER_CLASH',
    category: 'INTER_CLASS',
    message: 'Clash',
    day: 2,
    period: 0,
  } as any);
  assert.match(msg, /period 1 on Wednesday/i);
});
