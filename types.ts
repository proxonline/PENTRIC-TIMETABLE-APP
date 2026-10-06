
export enum UserRole {
  TEACHER = 'TEACHER',
  ADMIN = 'ADMIN',
}

export enum Availability {
  AVAILABLE = 'AVAILABLE',
  PREFER = 'PREFER',
  AVOID = 'AVOID',
  UNAVAILABLE = 'UNAVAILABLE',
}

export type AdminTier = 'SUPER_ADMIN' | 'ACADEMIC_ADMIN' | 'DEPT_ADMIN' | 'SUPPORT_ADMIN';

export type OptimizationGoal = 'BALANCED' | 'TEACHER_FRIENDLY' | 'STUDENT_FRIENDLY';

export interface StyleConfig {
  allowMorningDoubles: boolean;
  heavySubjectLimitPerDay: number;
  scienceConsecutiveAllowed: boolean;
  fridayRelaxation: boolean;
}

export interface GeneratorConfig {
  goal: OptimizationGoal;
  forceSinglePeriods: boolean;
  style?: StyleConfig;
  preserveManualEdits?: boolean;
  maxConsecutiveTeacherPeriods?: number;
  respectTeacherPreferences?: boolean;
  prioritizeCoreMorning?: boolean;
}

export interface ReasoningReport {
  score: number; // 0 - 100 overall timetable efficiency
  goal?: OptimizationGoal;
  iterations?: number;
  executionTimeMs?: number;
  hardConstraintsSatisfied: boolean;
  totalSlotsScheduled: number;
  totalSlotsRequired: number;
  completionRate: number; // %
  teacherPreferenceSatisfactionRate: number; // %
  morningCoreRatio: number; // %
  bottlenecks: string[];
  recommendations: string[];
  summary: string;
}

export interface School {
  id: string;
  name: string;
  shortName?: string;
  code?: string;
  motto?: string;
  logo?: string;
  themeColor?: string;
  address?: string;
  isOta?: boolean; // Flag to identify OTA Total Academy
  isDefault?: boolean;
  createdAt?: number;
  adminEmail?: string;
  adminPhone?: string;
  accreditationNumber?: string;
  registeredBy?: string;
  registeredAt?: number;
  updatedAt?: number;
  status?: 'ACTIVE' | 'ARCHIVED';
}

export interface AppSettings {
  // Identity
  schoolName: string;
  currentSession: string;
  currentTerm: '1st Term' | '2nd Term' | '3rd Term';
  term?: string;
  
  // Constraints
  maxSubjectsPerTeacher: number;
  minClassesPerTeacher: number;
  maxClassesPerTeacher: number;

  // Time Config
  enableSaturday: boolean;
  periodsPerDay: number;
  periodDuration: number; // minutes
  breakDurationShort: number; // minutes
  breakDurationLong: number; // minutes
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  action: string;
  user: string;
  snapshot: TimetableGrid;
}

export type AcademicLevel = 'JUNIOR' | 'SENIOR';

export interface Subject {
  id: string;
  name: string;
  code?: string;
  category: 'JUNIOR' | 'SENIOR' | 'JSS' | 'SSS_SCIENCE' | 'SSS_BC' | 'ALL';
  level?: AcademicLevel; // Explicit Junior vs Senior level
  isCore: boolean;
  defaultPeriodCount: number; // Number of times this subject appears per week (frequency)
  maxPerDay?: number; // Times in a day (e.g. 1 per day, 2 for double period)
  periodsPerWeek?: number; // Normalized alias
  preferredTeacherId?: string;
  assignedTeacherIds?: string[];
  color?: string;
}

export interface Class {
  id: string;
  name: string;
  category: 'JUNIOR' | 'SENIOR' | 'JSS' | 'SSS_SCIENCE' | 'SSS_BC';
  level?: AcademicLevel; // Explicit Junior vs Senior level
  gradeLevel?: number;
  assignedTeacherId?: string;
  roomNumber?: string;
}

export interface SlotBudgetInfo {
  level: AcademicLevel;
  totalSlots: number; // e.g. 40
  assignedSlots: number; // sum of periods per week for all subjects in this level
  remainingSlots: number; // totalSlots - assignedSlots
  isOverallocated: boolean;
  isBalanced: boolean;
  subjectsCount: number;
}

export interface AIFixSuggestion {
  id: string;
  type: 'SLOT_OVERLOAD' | 'TEACHER_BOTTLENECK' | 'SLOT_DEFICIT' | 'SUBJECT_CLASH' | 'OPTIMIZATION';
  level: AcademicLevel;
  title: string;
  description: string;
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  recommendedAction: string;
  autoFixPayload?: {
    subjectAdjustments?: { subjectId: string; newPeriodCount: number; reason: string }[];
    teacherAssignments?: { subjectId: string; classId?: string; teacherId: string }[];
    classSlotTarget?: number;
  };
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  type?: 'CLASSROOM' | 'LAB' | 'HALL' | 'FIELD';
  category?: string;
  features?: string[];
  description?: string;
}

export interface ExamSession {
  id: string;
  subjectId: string;
  classId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  roomId?: string;
  supervisorTeacherId?: string;
  notes?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  password: string; // Hash or encrypted
  name: string;
  tier: AdminTier;
  department?: 'JSS' | 'SSS_SCIENCE' | 'SSS_BC'; // For Tier 3 restrictions
  lastActive?: number;
  profilePicture?: string;
  mustChangePassword?: boolean;
  darkMode?: boolean;
}

export interface NotificationPreferences {
  newRequests: boolean;
  timetableUpdates: boolean;
  adminMessages: boolean;
  chatMessages: boolean;
  emailNotifications?: boolean;
}

export interface Teacher {
  id: string;
  name: string;
  username: string;
  password?: string;
  recoveryCode: string;
  subjectsTaught: string[];
  assignedClasses: string[];
  availability: Record<number, Record<number, Availability>>;
  isCompleted: boolean;
  preferences?: NotificationPreferences;
  // Profile Fields
  bio?: string;
  contactEmail?: string;
  contactPhone?: string;
  profilePicture?: string; // Base64 string
  lastActive?: number;
  mustChangePassword?: boolean;
  calendarToken?: string;
  darkMode?: boolean;
  // Multi-school & Anti-Imposter Verification Fields
  schoolId?: string;
  emailVerified?: boolean;
  isApproved?: boolean; // false until approved by school admin
  approvalStatus?: 'APPROVED' | 'PENDING' | 'REJECTED';
  rejectionReason?: string;
  registeredAt?: number;
}

export interface TimetableCell {
  subjectId: string;
  teacherId: string; // Primary teacher (or SYSTEM)
  teacherIds?: string[]; // For concurrent subjects (e.g. IRS/CRS)
  note?: string;
  isDouble?: boolean;
  isManual?: boolean; // Track if admin manually placed this
  roomId?: string; // Optional venue ID
  lessonNote?: string;
  lessonLink?: string;
  _realClassId?: string;
  _displayClass?: string;
}

export interface TeacherAbsence {
  id: string;
  teacherId: string;
  teacherName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: number;
  substitutesAssigned?: Record<string, string>; // "day-period-classId" -> substituteTeacherId
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  actorName: string;
  actorRole: 'ADMIN' | 'TEACHER';
  action: string;
  details: string;
}

export type TimetableGrid = Record<string, Record<number, Record<number, TimetableCell | null>>>;

export interface LogEntry {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  isFlagged: boolean;
  groupId?: string; // If group chat
  recipientId?: string; // If DM
  handled?: boolean;
}

export interface SwapRequest {
  id: string;
  teacherId: string;
  teacherName: string;
  type: 'SWAP' | 'OFF_DAY' | 'AUTOMATED_SWAP';
  details: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  timestamp: number;
  // For Automated Swaps
  requestData?: {
      targetClassId: string;
      targetDay: number;
      targetPeriod: number;
      targetSubjectId: string;
      targetTeacherId: string; // The teacher receiving the request
      
      offerClassId: string;
      offerDay: number;
      offerPeriod: number;
      offerSubjectId: string;
  };
}

export interface AppNotification {
  id: string;
  recipientId: string;
  title: string;
  message: string;
  details?: string;
  isRead: boolean;
  timestamp: number;
  type: 'INFO' | 'ALERT' | 'SUCCESS';
  category?: 'SYSTEM' | 'REQUEST' | 'CHAT' | 'TIMETABLE';
}

export interface Conflict {
  id: string;
  type: 'CRITICAL' | 'WARNING' | 'INFO';
  category: 'INTER_CLASH' | 'EXTRA_CLASH' | 'ROOM_CLASH' | 'FATIGUE' | 'UTILIZATION' | 'BALANCE' | 'QUALITY' | 'GAP';
  message: string;
  teacherId?: string;
  classId?: string;
  day?: number;
  period?: number;
  roomId?: string;
}
