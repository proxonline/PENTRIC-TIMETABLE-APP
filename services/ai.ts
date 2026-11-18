import {
  AcademicLevel,
  AIFixSuggestion,
  Class,
  Conflict,
  LogEntry,
  Room,
  SlotBudgetInfo,
  StyleConfig,
  Subject,
  Teacher,
  TimetableGrid,
} from '../types';
import {
  buildDeterministicSlotAnalysis,
  ChatModerationResult,
  ComfortOptimizationResult,
  LearnFromReferenceResult,
  TimetableAuditResult,
} from './aiContracts';

async function postAIJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `AI request failed (${res.status})`);
  }
  return data as T;
}

export const auditTimetableSchedule = async (
  grid: TimetableGrid,
  teachers: Teacher[],
  classes: Class[],
  subjects: Subject[],
  conflicts: Conflict[]
): Promise<TimetableAuditResult> => {
  const data = await postAIJson<TimetableAuditResult & { success?: boolean }>('/api/ai/audit-schedule', {
    grid,
    teachers,
    classes,
    subjects,
    conflicts,
  });
  return {
    pedagogicalScore: data.pedagogicalScore,
    fairnessScore: data.fairnessScore,
    fatigueRisk: data.fatigueRisk,
    strengths: data.strengths || [],
    weaknesses: data.weaknesses || [],
    actionableFixes: data.actionableFixes || [],
    summary: data.summary,
  };
};

export const optimizeTimetableComfortWithAI = async (
  grid: TimetableGrid,
  teachers: Teacher[],
  classes: Class[],
  subjects: Subject[]
): Promise<ComfortOptimizationResult> => {
  const data = await postAIJson<ComfortOptimizationResult & { success?: boolean }>('/api/ai/optimize-comfort', {
    grid,
    teachers,
    classes,
    subjects,
  });
  return {
    comfortScore: data.comfortScore,
    cognitiveEfficiency: data.cognitiveEfficiency,
    insights: data.insights || [],
    suggestedAdjustments: data.suggestedAdjustments || [],
  };
};

export const analyzeGenerationErrors = async (
  logs: LogEntry[],
  teachers: Teacher[],
  classes: Class[],
  subjects: Subject[]
): Promise<string> => {
  const errorLogs = logs.filter((l) => l.type === 'error' || l.type === 'warning');
  if (errorLogs.length === 0) return 'No critical errors or warnings detected.';

  const data = await postAIJson<{ success?: boolean; analysis: string }>('/api/ai/analyze-errors', {
    logs: errorLogs,
    teachers,
    classes,
    subjects,
  });
  return data.analysis || 'No detailed analysis generated.';
};

export const learnFromTimetableReference = async (
  input: string | { data: string; mimeType: string }
): Promise<{ config: StyleConfig; summary: string }> => {
  const data = await postAIJson<LearnFromReferenceResult & { success?: boolean }>('/api/ai/learn-reference', {
    input,
  });
  return {
    config: data.config,
    summary: data.summary,
  };
};

export const monitorChatContent = async (
  content: string
): Promise<ChatModerationResult> => {
  try {
    const data = await postAIJson<ChatModerationResult & { success?: boolean }>('/api/ai/moderate-chat', {
      content,
    });
    return {
      isSafe: data.isSafe ?? true,
      ...(data.flagReason ? { flagReason: data.flagReason } : {}),
    };
  } catch {
    return { isSafe: true };
  }
};

export const suggestConflictFix = async (
  conflict: Conflict,
  teachers: Teacher[],
  rooms: Room[]
): Promise<string> => {
  const data = await postAIJson<{ success?: boolean; suggestion: string }>('/api/ai/suggest-conflict-fix', {
    conflict,
    teachers,
    rooms,
  });
  return data.suggestion;
};

export const analyzeTimetableLightningFast = async (
  level: AcademicLevel,
  subjects: Subject[],
  classes: Class[],
  teachers: Teacher[],
  totalSlots: number = 40
): Promise<{
  slotBudget: SlotBudgetInfo;
  summary: string;
  issues: string[];
  suggestions: AIFixSuggestion[];
}> => {
  try {
    const data = await postAIJson<{
      success?: boolean;
      slotBudget: SlotBudgetInfo;
      summary: string;
      issues?: string[];
      suggestions?: AIFixSuggestion[];
    }>('/api/ai/analyze-timetable', {
      level,
      subjects,
      classes,
      teachers,
      totalSlots,
    });
    if (data && data.success) {
      return {
        slotBudget: data.slotBudget,
        summary: data.summary,
        issues: data.issues || [],
        suggestions: data.suggestions || [],
      };
    }
  } catch {
    // Fallback to deterministic rule analysis when offline
  }

  return buildDeterministicSlotAnalysis(level, subjects, classes, teachers, totalSlots);
};
