import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  AcademicLevel,
  Class,
  Conflict,
  LogEntry,
  Room,
  Subject,
  Teacher,
  TimetableGrid,
} from '../types';
import {
  buildAuditDefaults,
  buildComfortDefaults,
  buildConflictFixFallback,
  buildDeterministicSlotAnalysis,
  ChatModerationResult,
  ComfortOptimizationResult,
  countScheduledCells,
  DEFAULT_STYLE_CONFIG,
  LearnFromReferenceResult,
  LightningAnalysisResult,
  normalizeModerationResponse,
  safeParseJsonObject,
  TimetableAuditResult,
} from './aiContracts';

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | undefined;

export function getServerGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!cachedClient || cachedKey !== apiKey) {
    cachedKey = apiKey;
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export class GeminiConfigurationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 503) {
    super(message);
    this.name = 'GeminiConfigurationError';
    this.statusCode = statusCode;
  }
}

function extractUpstreamErrorMessage(err: any): { code?: number; message: string } {
  const rawMessage = String(err?.message || err || 'Gemini API request failed');
  const status = Number(err?.status || err?.code || 0) || undefined;
  try {
    const parsed = JSON.parse(rawMessage);
    const inner = parsed?.error || parsed;
    return {
      code: Number(inner?.code) || status,
      message: String(inner?.message || rawMessage),
    };
  } catch {
    return { code: status, message: rawMessage };
  }
}

async function withGeminiRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const { code, message } = extractUpstreamErrorMessage(err);
      const isTransient =
        code === 503 ||
        code === 500 ||
        code === 429 ||
        /UNAVAILABLE|DEADLINE_EXCEEDED|high demand|overloaded|ECONNRESET|ETIMEDOUT/i.test(message);
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = 500 * attempt + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

function formatGeminiUpstreamError(err: any): { statusCode: number; message: string } {
  const { code, message } = extractUpstreamErrorMessage(err);
  if (message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED') || code === 403) {
    return {
      statusCode: 502,
      message: 'Gemini API key was rejected. Verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (message.includes('RESOURCE_EXHAUSTED') || code === 429) {
    return {
      statusCode: 429,
      message: 'Gemini API quota exceeded. Please try again shortly or upgrade your key in Settings > Secrets.',
    };
  }
  if (code === 503 || /UNAVAILABLE|high demand/i.test(message)) {
    return {
      statusCode: 503,
      message,
    };
  }
  return {
    statusCode: 502,
    message,
  };
}

export async function runServerTimetableAudit(params: {
  grid: TimetableGrid;
  teachers: Teacher[];
  classes: Class[];
  subjects: Subject[];
  conflicts: Conflict[];
}): Promise<TimetableAuditResult> {
  const ai = getServerGeminiClient();
  if (!ai) {
    throw new GeminiConfigurationError(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      503
    );
  }

  const { grid, teachers = [], classes = [], conflicts = [] } = params;
  const defaults = buildAuditDefaults(conflicts);
  const totalScheduledCells = countScheduledCells(grid);

  const prompt = `
Perform a comprehensive, high-level reasoning pedagogical quality audit on this academic school timetable:
- Active Classes: ${classes.length}
- Total Teachers: ${teachers.length}
- Total Scheduled Classes: ${totalScheduledCells}
- Active Conflicts: ${conflicts.map((c) => c.message).join(' | ') || 'None'}

Deeply analyze the schedule for:
1. "pedagogicalScore" (0-100): Cognitive subject placement (Math/Science in mornings vs afternoons)
2. "fairnessScore" (0-100): Teacher workload equity, continuous teaching blocks, and break gap distribution
3. "fatigueRisk": "LOW", "MODERATE", or "HIGH"
4. "strengths": Array of 2-4 key positive scheduling patterns
5. "weaknesses": Array of 1-3 scheduling bottlenecks
6. "actionableFixes": Array of 2-3 specific actions the Academic Administrator can perform right now
7. "summary": Concise 2-sentence executive summary
`;

  try {
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              pedagogicalScore: { type: Type.NUMBER },
              fairnessScore: { type: Type.NUMBER },
              fatigueRisk: { type: Type.STRING },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
              actionableFixes: { type: Type.ARRAY, items: { type: Type.STRING } },
              summary: { type: Type.STRING },
            },
          },
        },
      })
    );
    return safeParseJsonObject(response.text, defaults);
  } catch (err: any) {
    const formatted = formatGeminiUpstreamError(err);
    throw new GeminiConfigurationError(formatted.message, formatted.statusCode);
  }
}

export async function runServerComfortOptimization(params: {
  grid: TimetableGrid;
  teachers: Teacher[];
  classes: Class[];
  subjects: Subject[];
}): Promise<ComfortOptimizationResult> {
  const ai = getServerGeminiClient();
  if (!ai) {
    throw new GeminiConfigurationError(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      503
    );
  }

  const { teachers = [], classes = [] } = params;
  const defaults = buildComfortDefaults();

  const prompt = `
You are an expert Educational Timetable Optimization System powered by deep reasoning.
Examine the current school schedule structure across ${classes.length} classes and ${teachers.length} teachers.

Evaluate:
1. Student cognitive fatigue (heavy subjects in morning vs late afternoon).
2. Teacher comfort (avoiding more than 3 consecutive teaching periods without break).
3. Subject spacing (avoiding subject repetition on the same day).
`;

  try {
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              comfortScore: { type: Type.NUMBER },
              cognitiveEfficiency: { type: Type.NUMBER },
              insights: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggestedAdjustments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    classId: { type: Type.STRING },
                    day: { type: Type.INTEGER },
                    periodA: { type: Type.INTEGER },
                    periodB: { type: Type.INTEGER },
                    reason: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      })
    );
    return safeParseJsonObject(response.text, defaults);
  } catch (err: any) {
    const formatted = formatGeminiUpstreamError(err);
    throw new GeminiConfigurationError(formatted.message, formatted.statusCode);
  }
}

export async function runServerErrorAnalysis(params: {
  logs: LogEntry[];
}): Promise<string> {
  const errorLogs = (params.logs || []).filter((l) => l.type === 'error' || l.type === 'warning');
  if (errorLogs.length === 0) return 'No critical errors or warnings detected.';

  const ai = getServerGeminiClient();
  if (!ai) {
    throw new GeminiConfigurationError(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      503
    );
  }

  const prompt = `
Analyze these timetable generation errors and logs for a school system.
ERRORS/WARNINGS: ${errorLogs.map((l) => l.message).join(' | ')}

Provide a concise summary of the main scheduling bottlenecks and 3 actionable fixes for the Academic Administrator.
Format the output as clean markdown.
`;

  try {
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      })
    );
    return response.text || 'No detailed analysis generated.';
  } catch (err: any) {
    const formatted = formatGeminiUpstreamError(err);
    throw new GeminiConfigurationError(formatted.message, formatted.statusCode);
  }
}

export async function runServerLearnReference(params: {
  input: string | { data: string; mimeType: string };
}): Promise<LearnFromReferenceResult> {
  const defaultResult: LearnFromReferenceResult = {
    config: DEFAULT_STYLE_CONFIG,
    summary: 'Analysis complete with default institution rules.',
  };

  if (!params.input) return defaultResult;

  const ai = getServerGeminiClient();
  if (!ai) {
    throw new GeminiConfigurationError(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      503
    );
  }

  const promptText = `
Analyze this school timetable dataset/reference to extract scheduling style preferences.

Extract:
1. "allowMorningDoubles": Are double periods common in the morning? (boolean)
2. "heavySubjectLimitPerDay": Max number of heavy subjects (Math/Eng/Science) per day? (number)
3. "scienceConsecutiveAllowed": Do lab/science subjects appear back-to-back? (boolean)
4. "fridayRelaxation": Is Friday lighter or ending early? (boolean)

Return JSON object with "config" and "summary".
`;

  const contents =
    typeof params.input === 'string'
      ? { parts: [{ text: promptText }, { text: `DATA:\n${params.input.substring(0, 5000)}` }] }
      : {
          parts: [
            { text: promptText },
            { inlineData: { mimeType: params.input.mimeType, data: params.input.data } },
          ],
        };

  try {
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              config: {
                type: Type.OBJECT,
                properties: {
                  allowMorningDoubles: { type: Type.BOOLEAN },
                  heavySubjectLimitPerDay: { type: Type.NUMBER },
                  scienceConsecutiveAllowed: { type: Type.BOOLEAN },
                  fridayRelaxation: { type: Type.BOOLEAN },
                },
              },
              summary: { type: Type.STRING },
            },
          },
        },
      })
    );
    const parsed = safeParseJsonObject<any>(response.text, {});
    return {
      config: { ...DEFAULT_STYLE_CONFIG, ...(parsed.config || {}) },
      summary: parsed.summary || 'Pattern analysis complete.',
    };
  } catch (err: any) {
    const formatted = formatGeminiUpstreamError(err);
    throw new GeminiConfigurationError(formatted.message, formatted.statusCode);
  }
}

export async function runServerChatModeration(params: {
  content: string;
}): Promise<ChatModerationResult> {
  const ai = getServerGeminiClient();
  if (!ai) {
    throw new GeminiConfigurationError(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      503
    );
  }

  const prompt = `
Review this school communication message for safety and professional standards.
Message: "${String(params.content || '').slice(0, 2000)}"
`;

  try {
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              safe: { type: Type.BOOLEAN },
              reason: { type: Type.STRING },
            },
          },
        },
      })
    );
    return normalizeModerationResponse(response.text);
  } catch (err: any) {
    const formatted = formatGeminiUpstreamError(err);
    throw new GeminiConfigurationError(formatted.message, formatted.statusCode);
  }
}

export async function runServerConflictFix(params: {
  conflict: Conflict;
  teachers: Teacher[];
  rooms: Room[];
}): Promise<string> {
  const ai = getServerGeminiClient();
  if (!ai) {
    throw new GeminiConfigurationError(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
      503
    );
  }

  const { conflict, teachers = [], rooms = [] } = params;
  const fallback = buildConflictFixFallback(conflict);
  const teacherName = conflict.teacherId
    ? teachers.find((t) => t.id === conflict.teacherId)?.name || conflict.teacherId
    : 'Unassigned';
  const roomName = conflict.roomId
    ? rooms.find((r) => r.id === conflict.roomId)?.name || conflict.roomId
    : 'Unassigned';

  const prompt = `
You are an expert school timetable administrator assistant.
A schedule conflict was detected:
- Category: ${conflict.category || 'GENERAL'}
- Type: ${conflict.type || 'CONFLICT'}
- Message: ${conflict.message || 'Overlap detected'}
- Class: ${conflict.classId || 'N/A'}
- Teacher: ${teacherName}
- Room: ${roomName}
- Day: ${conflict.day !== undefined ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][conflict.day] : 'N/A'}
- Period: ${conflict.period !== undefined ? conflict.period + 1 : 'N/A'}

Provide a concise, highly specific 2-sentence recommended action for the administrator to clear this conflict.
`;

  try {
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      })
    );
    return response.text ? response.text.trim() : fallback;
  } catch (err: any) {
    const formatted = formatGeminiUpstreamError(err);
    throw new GeminiConfigurationError(formatted.message, formatted.statusCode);
  }
}

export async function runServerLightningAnalysis(params: {
  level: AcademicLevel;
  subjects: Subject[];
  classes: Class[];
  teachers: Teacher[];
  totalSlots: number;
}): Promise<LightningAnalysisResult> {
  const { level = 'JUNIOR', subjects = [], classes = [], teachers = [], totalSlots = 40 } = params;
  const deterministic = buildDeterministicSlotAnalysis(level, subjects, classes, teachers, totalSlots);

  const ai = getServerGeminiClient();
  if (!ai) {
    return deterministic;
  }

  const prompt = `
You are the AI Chief Academic Timetable Optimization Engine.
Analyze this curriculum and scheduling configuration for the "${level}" academic tier:
- Timetable Total Slots per class: ${totalSlots}
- Total Allocated Periods from Subjects: ${deterministic.slotBudget.assignedSlots}
- Remaining Free/Unassigned Slots: ${deterministic.slotBudget.remainingSlots}
- Status: ${deterministic.slotBudget.isOverallocated ? 'OVERALLOCATED (Problem)' : deterministic.slotBudget.isBalanced ? 'PERFECTLY BALANCED' : 'UNDERALLOCATED'}
- Subjects Configured (${subjects.length}):
${subjects.map((s) => `  * ${s.name} (${s.code || 'CODE'}): ${s.defaultPeriodCount || 3} periods/wk, max ${s.maxPerDay || 1}/day, Core: ${s.isCore}`).join('\n')}
- Number of ${level} Classes: ${classes.length}
- Faculty Available: ${teachers.length}

Provide a concise, ultra-fast diagnostic and recommendations.
`;

  try {
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              issues: { type: Type.ARRAY, items: { type: Type.STRING } },
              aiSuggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    type: { type: Type.STRING },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    severity: { type: Type.STRING },
                    recommendedAction: { type: Type.STRING },
                    autoFixPayload: {
                      type: Type.OBJECT,
                      properties: {
                        subjectAdjustments: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              subjectId: { type: Type.STRING },
                              newPeriodCount: { type: Type.INTEGER },
                              reason: { type: Type.STRING },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
    );

    if (response.text) {
      const parsed = safeParseJsonObject<any>(response.text, {});
      return {
        slotBudget: deterministic.slotBudget,
        summary: parsed.summary || deterministic.summary,
        issues:
          Array.isArray(parsed.issues) && parsed.issues.length > 0
            ? parsed.issues
            : deterministic.issues,
        suggestions:
          Array.isArray(parsed.aiSuggestions) && parsed.aiSuggestions.length > 0
            ? parsed.aiSuggestions
            : deterministic.suggestions,
      };
    }
  } catch (aiErr: any) {
    console.warn('[AI Analyzer] Gemini call fallback to rule engine:', aiErr?.message || aiErr);
  }

  return deterministic;
}
