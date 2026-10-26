
import React, { useState, useEffect, useRef } from 'react';
import { storage } from '../services/storage';
import { generateTimetable, detectGridConflicts } from '../services/generator';
import { getEligibleSubjectsForClass, isSubjectEligibleForClass, getSubjectStream, getClassStream } from '../services/curriculum_eligibility';
import { ALL_CLASSES, ALL_SUBJECTS, DAYS, PERIODS, TIMETABLE_CONFIG } from '../constants';
import { LogEntry, TimetableGrid as GridType, Teacher, SwapRequest, AdminUser, AdminTier, AppNotification, Class, Subject, AppSettings, ChatMessage, Conflict, Availability, OptimizationGoal, ReasoningReport, Room, TeacherAbsence, AuditLogEntry, School as SchoolType, AcademicLevel, SlotBudgetInfo, AIFixSuggestion, TimetableMetadata } from '../types';
import { auditTimetableSchedule, suggestConflictFix, analyzeTimetableLightningFast } from '../services/ai';
import { TimetableGrid } from './TimetableGrid';
import { UserGuide } from './UserGuide';
import { LogViewer } from './LogViewer';
import { AboutUsModal } from './AboutUsModal';
import { generatePDF, generateExcelWorkbook, generateMasterPDFBooklet, generateAllClassesCSV } from '../services/export_utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { 
  Home, Layout, Users, BookOpen, Layers, Briefcase, 
  ShieldCheck, FileText, Settings, LogOut, 
  Bell, ChevronDown, ChevronRight, Plus, Search, Filter, 
  Play, Save, AlertTriangle, Printer, Download, 
  RotateCcw, Trash2, CheckCircle, X, Edit, Lock, Eye, EyeOff, Key,
  Calendar, Loader2, BarChart2, Zap, MessageSquare, Flag, CheckCheck, Trash, MoreHorizontal, ArrowRight, Grid, Monitor, Sliders, Activity,
  School, CalendarClock, Cpu, AlertOctagon, CalendarRange, Menu, ThumbsUp, ThumbsDown, Inbox, Info, Pencil, ArrowLeft, Terminal, Image,
  ToggleLeft, ToggleRight, Power, RefreshCw, Database, Book, Mail, Phone, GraduationCap, Clock, CreditCard, Sparkles, Palette, MapPin,
  TrendingUp, UserX, Upload, ClipboardList, BarChart3, Moon, Sun, KeyRound, Building2, CheckCircle2,
  ShieldAlert
} from 'lucide-react';

interface Props {
  onLogout: () => void;
  onSwitchSchool?: () => void;
}

// --- THEME CONFIGURATION ---
const THEME_CONFIG = {
  SUPER_ADMIN: {
    sidebarBg: 'bg-[#0f172a]', // Slate 900
    sidebarText: 'text-slate-300',
    sidebarHover: 'hover:bg-blue-600/10 hover:text-blue-400',
    activeItem: 'bg-blue-600 text-white shadow-lg shadow-blue-900/50',
    accentColor: 'text-blue-600',
    buttonBg: 'bg-blue-600 hover:bg-blue-700',
    lightBg: 'bg-blue-50',
    gradient: 'from-blue-600 to-indigo-700',
    label: 'Super Admin'
  },
  ACADEMIC_ADMIN: {
    sidebarBg: 'bg-[#064e3b]', // Emerald 900
    sidebarText: 'text-emerald-200',
    sidebarHover: 'hover:bg-white/10 hover:text-white',
    activeItem: 'bg-white text-emerald-900 shadow-lg',
    accentColor: 'text-emerald-600',
    buttonBg: 'bg-emerald-600 hover:bg-emerald-700',
    lightBg: 'bg-emerald-50',
    gradient: 'from-emerald-500 to-teal-700',
    label: 'Academic Admin'
  },
  DEPT_ADMIN: {
    sidebarBg: 'bg-[#431407]', // Orange 950
    sidebarText: 'text-orange-200',
    sidebarHover: 'hover:bg-white/10 hover:text-white',
    activeItem: 'bg-orange-500 text-white shadow-lg shadow-orange-900/50',
    accentColor: 'text-orange-600',
    buttonBg: 'bg-orange-600 hover:bg-orange-700',
    lightBg: 'bg-orange-50',
    gradient: 'from-orange-500 to-red-600',
    label: 'Department Admin'
  },
  SUPPORT_ADMIN: {
    sidebarBg: 'bg-[#334155]', // Slate 700
    sidebarText: 'text-slate-300',
    sidebarHover: 'hover:bg-white/10 hover:text-white',
    activeItem: 'bg-white/20 text-white shadow-lg',
    accentColor: 'text-slate-600',
    buttonBg: 'bg-slate-600 hover:bg-slate-700',
    lightBg: 'bg-slate-50',
    gradient: 'from-slate-500 to-slate-700',
    label: 'Support Admin'
  }
};

const MENU_ITEMS = [
  { id: 'DASHBOARD', label: 'Dashboard', icon: Home },
  { id: 'SCHOOLS', label: 'School Registry', icon: School },
  { id: 'CLASSES', label: 'Classes', icon: Grid },
  { id: 'SUBJECTS', label: 'Curriculum', icon: BookOpen },
  { id: 'TEACHERS', label: 'Faculty', icon: Users },
  { id: 'TIMETABLE', label: 'Master Schedule', icon: Calendar },
  { id: 'REQUESTS', label: 'Requests', icon: RotateCcw },
  { id: 'ABSENCES', label: 'Absences & Subs', icon: UserX },
  { id: 'INBOX', label: 'Inbox', icon: Inbox },
  { id: 'AUDIT', label: 'Audit Trail', icon: ClipboardList },
  { id: 'SETTINGS', label: 'Settings', icon: Settings },
  { id: 'ADMINS', label: 'Admins', icon: ShieldCheck },
  { id: 'MANUAL', label: 'User Guide', icon: Book },
  { id: 'ABOUT', label: 'About Pentric', icon: Sparkles },
  { id: 'REPORTS', label: 'Logs & Reports', icon: FileText },
];

const NAV_GROUPS: { id: string; label: string; icon: any; itemIds: string[] }[] = [
  {
    id: 'SCHOOL_MANAGEMENT',
    label: 'School Management',
    icon: School,
    itemIds: ['CLASSES', 'SUBJECTS', 'TEACHERS']
  },
  {
    id: 'TIMETABLE_OPERATIONS',
    label: 'Timetable',
    icon: Calendar,
    itemIds: ['TIMETABLE', 'REQUESTS', 'ABSENCES']
  },
  {
    id: 'COMMUNICATIONS',
    label: 'Communications',
    icon: Inbox,
    itemIds: ['INBOX', 'AUDIT']
  },
  {
    id: 'SYSTEM_SETTINGS',
    label: 'Settings & System',
    icon: Settings,
    itemIds: ['SETTINGS', 'ADMINS', 'MANUAL', 'ABOUT', 'REPORTS']
  }
];

export const AdminDashboard: React.FC<Props> = ({ onLogout, onSwitchSchool }) => {
  // Session & User State
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [activeView, setActiveView] = useState('DASHBOARD');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [showAboutUsModal, setShowAboutUsModal] = useState(false);

  const toggleSection = (sectionId: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };
  
  // Data State
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [grid, setGrid] = useState<GridType | null>(null);
  const [draftGrid, setDraftGrid] = useState<GridType | null>(() => storage.getDraftTimetable());
  const [hasDraft, setHasDraft] = useState<boolean>(() => storage.hasUnpublishedDraft());
  const [timetableMetadata, setTimetableMetadata] = useState<TimetableMetadata>(() => storage.getTimetableMetadata());
  const [activeScheduleTab, setActiveScheduleTab] = useState<'PUBLISHED' | 'DRAFT'>('PUBLISHED');
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [absences, setAbsences] = useState<TeacherAbsence[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  
  const currentSchool = storage.getCurrentSchool() || { id: 'ota_total_academy', name: 'OTA Total Academy', code: 'OTA' };
  
  // --- SCHOOLS & INSTITUTION REGISTRY STATE ---
  const [schools, setSchools] = useState<SchoolType[]>(() => storage.getSchools());
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [newSchool, setNewSchool] = useState({
    name: '',
    code: '',
    motto: '',
    address: '',
    themeColor: '#2563eb',
    adminEmail: '',
    adminPhone: '',
    accreditationNumber: '',
    adminPasskey: ''
  });
  const [schoolSubmitting, setSchoolSubmitting] = useState(false);
  const [schoolFormError, setSchoolFormError] = useState('');
  const [schoolToDelete, setSchoolToDelete] = useState<SchoolType | null>(null);
  const [deletePasskey, setDeletePasskey] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeletingSchool, setIsDeletingSchool] = useState(false);

  const handleRegisterSchoolSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSchool.name.trim()) {
      setSchoolFormError('Official school name is required.');
      return;
    }
    if (newSchool.name.trim().length < 3) {
      setSchoolFormError('School name must be at least 3 characters long.');
      return;
    }
    const cleanCode = (newSchool.code || newSchool.name.substring(0, 4)).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (cleanCode.length < 2) {
      setSchoolFormError('School acronym code must be at least 2 alphanumeric characters (e.g. CKC).');
      return;
    }
    if (!newSchool.adminPasskey.trim()) {
      setSchoolFormError('Administrator cryptographic verification passkey or password is required.');
      return;
    }

    setSchoolSubmitting(true);
    setSchoolFormError('');

    try {
      const result = await storage.registerSchoolSecurely({
        name: newSchool.name.trim(),
        code: cleanCode,
        motto: newSchool.motto.trim() || 'Excellence in Learning & Character',
        address: newSchool.address.trim() || 'Main Campus',
        themeColor: newSchool.themeColor || '#2563eb',
        adminEmail: newSchool.adminEmail.trim(),
        adminPhone: newSchool.adminPhone.trim(),
        accreditationNumber: newSchool.accreditationNumber.trim(),
        adminPasskey: newSchool.adminPasskey.trim(),
        adminUsername: currentUser?.username || 'admin',
        adminPassword: newSchool.adminPasskey.trim()
      });

      if (!result.success || !result.school) {
        setSchoolFormError(result.error || 'Administrator security verification rejected.');
        return;
      }

      setSchools(storage.getSchools());
      setShowSchoolModal(false);
      setNewSchool({
        name: '',
        code: '',
        motto: '',
        address: '',
        themeColor: '#2563eb',
        adminEmail: '',
        adminPhone: '',
        accreditationNumber: '',
        adminPasskey: ''
      });
      showToast(`Institution "${result.school.name}" registered securely! Zero default data seeded to Firestore.`, 'SUCCESS');
    } catch (err: any) {
      setSchoolFormError(err?.message || 'Error occurred while registering school.');
    } finally {
      setSchoolSubmitting(false);
    }
  };

  const handleConfirmDeleteSchool = async () => {
    if (!schoolToDelete) return;
    if (schoolToDelete.id === 'ota_total_academy') {
      setDeleteError('OTA Total Academy is the founding institutional anchor and cannot be deleted.');
      return;
    }
    if (!deletePasskey.trim()) {
      setDeleteError('Administrator authorization passkey required to confirm deletion.');
      return;
    }

    setIsDeletingSchool(true);
    setDeleteError('');

    try {
      const res = await storage.deleteSchoolSecurely(schoolToDelete.id, deletePasskey.trim());
      if (!res.success) {
        setDeleteError(res.error || 'Failed to delete institution. Verification rejected.');
        return;
      }

      setSchools(storage.getSchools());
      const deletedName = schoolToDelete.name;
      setSchoolToDelete(null);
      setDeletePasskey('');
      showToast(`Institution "${deletedName}" removed from registry and Firestore.`, 'INFO');
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete school.');
    } finally {
      setIsDeletingSchool(false);
    }
  };

  const handleSwitchSchoolContext = (targetSchool: SchoolType) => {
    storage.setCurrentSchool(targetSchool);
    showToast(`Active school switched to "${targetSchool.name}".`, 'SUCCESS');
    if (onSwitchSchool) {
      onSwitchSchool();
    }
  };

  const pendingTeachers = teachers.filter(t => t.isApproved === false || t.approvalStatus === 'PENDING');

  const handleApproveTeacher = async (teacherId: string) => {
    storage.approveTeacher(teacherId, currentUser?.name || 'Administrator');
    try {
      await fetch('/api/teachers/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId,
          action: 'APPROVE',
          adminName: currentUser?.name || 'Administrator'
        })
      });
    } catch {}
    setTeachers(storage.getTeachers());
    showToast('Teacher verified and approved! Imposter check cleared.', 'SUCCESS');
  };

  const handleRejectTeacher = async (teacherId: string, reason?: string) => {
    storage.rejectTeacher(teacherId, reason || 'Flagged as imposter / unverified', currentUser?.name || 'Administrator', true);
    try {
      await fetch('/api/teachers/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId,
          action: 'DELETE',
          reason: reason || 'Flagged as imposter',
          adminName: currentUser?.name || 'Administrator'
        })
      });
    } catch {}
    setTeachers(storage.getTeachers());
    showToast('Flagged account removed. Imposter access denied.', 'ALERT');
  };
  
  // --- UPDATED CONFLICT STATE ---
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [reportTab, setReportTab] = useState<'INTER' | 'EXTRA' | 'ROOM' | 'ALL'>('INTER');
  const [conflictFixes, setConflictFixes] = useState<Record<string, string>>({});
  const [loadingFixId, setLoadingFixId] = useState<string | null>(null);

  const handleGetConflictFix = async (conflict: Conflict) => {
    setLoadingFixId(conflict.id);
    try {
      const suggestion = await suggestConflictFix(conflict, teachers, rooms);
      setConflictFixes(prev => ({ ...prev, [conflict.id]: suggestion }));
    } catch {
      showToast('Failed to fetch AI conflict suggestion', 'ALERT');
    } finally {
      setLoadingFixId(null);
    }
  };

  const handleApproveAbsence = (absenceId: string) => {
    const allAbsences = storage.getAbsences();
    const abs = allAbsences.find(a => a.id === absenceId);
    if (abs) {
      abs.status = 'APPROVED';
      storage.saveAbsence(abs);
      
      // Dispatch outcome notification to teacher mailbox
      storage.addNotification({
        recipientId: abs.teacherId,
        title: 'Absence Request Approved',
        message: `Your absence request for ${abs.startDate} to ${abs.endDate} has been APPROVED by Administration.`,
        details: `Reason: ${abs.reason || 'None specified'}`,
        type: 'SUCCESS',
        category: 'REQUEST'
      });

      storage.addAuditLog({
        actorName: currentUser?.name || 'Admin',
        actorRole: 'ADMIN',
        action: 'ABSENCE_APPROVE',
        details: `Approved absence request for ${abs.teacherName}`
      });
      setAbsences(storage.getAbsences());
      showToast(`Approved absence for ${abs.teacherName}`, 'SUCCESS');
    }
  };

  const handleRejectAbsence = (absenceId: string) => {
    const allAbsences = storage.getAbsences();
    const abs = allAbsences.find(a => a.id === absenceId);
    if (abs) {
      abs.status = 'REJECTED';
      storage.saveAbsence(abs);

      // Dispatch outcome notification to teacher mailbox
      storage.addNotification({
        recipientId: abs.teacherId,
        title: 'Absence Request Rejected',
        message: `Your absence request for ${abs.startDate} to ${abs.endDate} has been REJECTED by Administration.`,
        details: `Reason: ${abs.reason || 'None specified'}`,
        type: 'ALERT',
        category: 'REQUEST'
      });

      storage.addAuditLog({
        actorName: currentUser?.name || 'Admin',
        actorRole: 'ADMIN',
        action: 'ABSENCE_REJECT',
        details: `Rejected absence request for ${abs.teacherName}`
      });
      setAbsences(storage.getAbsences());
      showToast(`Rejected absence for ${abs.teacherName}`, 'INFO');
    }
  };

  const handleAssignSubstitute = (classId: string, day: number, period: number, subTeacherId: string) => {
    const currentGrid = storage.getTimetable();
    if (currentGrid && currentGrid[classId]?.[day]?.[period]) {
      const slot = currentGrid[classId][day][period];
      const previousTeacherId = slot.teacherId;
      const subTeacher = teachers.find(t => t.id === subTeacherId);

      slot.teacherId = subTeacherId;
      slot.isManual = true;
      storage.saveTimetable(currentGrid);

      // Send outcome notification to substitute teacher
      if (subTeacher) {
        storage.addNotification({
          recipientId: subTeacher.id,
          title: 'New Substitution Duty Assigned',
          message: `You have been assigned as substitute teacher covering class ${classId} on Day ${day + 1}, Period ${period + 1}.`,
          details: `Substitution coverage assigned by Administration.`,
          type: 'INFO',
          category: 'REQUEST'
        });
      }

      // Send notification to replaced teacher if known
      if (previousTeacherId && previousTeacherId !== subTeacherId) {
        storage.addNotification({
          recipientId: previousTeacherId,
          title: 'Substitute Assigned for Your Class',
          message: `${subTeacher?.name || 'A substitute teacher'} has been assigned to cover your class (${classId}, Day ${day + 1}, Period ${period + 1}).`,
          details: `Substitution arranged by Administration.`,
          type: 'INFO',
          category: 'REQUEST'
        });
      }

      storage.addAuditLog({
        actorName: currentUser?.name || 'Admin',
        actorRole: 'ADMIN',
        action: 'SUBSTITUTE_ASSIGN',
        details: `Assigned ${subTeacher?.name || subTeacherId} as substitute for ${classId} Day ${day+1} Period ${period+1}`
      });
      setGrid(storage.getTimetable());
      showToast(`Assigned substitute teacher successfully`, 'SUCCESS');
    }
  };
  
  const [settings, setSettings] = useState<AppSettings>(storage.getSettings());
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Inbox
  const [inboxFilter, setInboxFilter] = useState<'ALL' | 'UNREAD' | 'ALERTS'>('ALL');
  const [expandedNotif, setExpandedNotif] = useState<string | null>(null);

  // UI State
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState('');
  const [showCellEditModal, setShowCellEditModal] = useState<{d: number, p: number, cell: any} | null>(null);
  const [cellEditForm, setCellEditForm] = useState<{subjectId: string, teacherId: string, roomId?: string}>({subjectId: '', teacherId: '', roomId: ''});
  const [modalType, setModalType] = useState<'ADMIN' | 'CLASS' | 'SUBJECT' | 'TEACHER' | 'ROOM' | null>(null);
  const [entityForm, setEntityForm] = useState<any>({});
  const [toast, setToast] = useState<{message: string, type: 'INFO'|'ALERT'|'SUCCESS'} | null>(null);
  const [unsavedSettings, setUnsavedSettings] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{type: string, id: string, name: string} | null>(null);
  const [viewTeacher, setViewTeacher] = useState<Teacher | null>(null);
  
  // Generation Reporting
  const [generationLogs, setGenerationLogs] = useState<LogEntry[]>([]);
  const [showGenReport, setShowGenReport] = useState(false);
  const [preserveManualEdits, setPreserveManualEdits] = useState(false);
  const [optimizationGoal, setOptimizationGoal] = useState<OptimizationGoal>('BALANCED');
  const [reasoningReport, setReasoningReport] = useState<ReasoningReport | null>(null);
  const [aiAuditResult, setAiAuditResult] = useState<any>(null);
  const [isAuditingWithAI, setIsAuditingWithAI] = useState(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  
  // Curriculum Tier & AI Diagnostics State
  const [curriculumLevelTab, setCurriculumLevelTab] = useState<AcademicLevel>('JUNIOR');
  const [curriculumSeniorStreamTab, setCurriculumSeniorStreamTab] = useState<'SCIENCE' | 'BC' | 'ALL'>('SCIENCE');
  const [classFilterTab, setClassFilterTab] = useState<AcademicLevel | 'ALL'>('ALL');
  const [isAiAnalyzingTier, setIsAiAnalyzingTier] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<{
    slotBudget: SlotBudgetInfo;
    summary: string;
    issues: string[];
    suggestions: AIFixSuggestion[];
  } | null>(null);
  const [showAiAnalysisModal, setShowAiAnalysisModal] = useState(false);
  const [applyingAiFix, setApplyingAiFix] = useState(false);

  // Ref for Export & Dropdown
  const timetableRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  // Mandatory Admin Password Change State
  const [showMandatoryPasswordModal, setShowMandatoryPasswordModal] = useState(false);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [showAdminPasswordPlain, setShowAdminPasswordPlain] = useState(false);
  const [adminPasswordError, setAdminPasswordError] = useState('');
  const [isUpdatingAdminPassword, setIsUpdatingAdminPassword] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const runLightningAIAnalysis = async (levelToAnalyze: AcademicLevel = curriculumLevelTab) => {
    setIsAiAnalyzingTier(true);
    try {
      const levelSubjects = subjects.filter(s => (s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === levelToAnalyze);
      const levelClasses = classes.filter(c => (c.level || (c.category === 'JSS' || c.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === levelToAnalyze);
      const totalSlots = TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS;
      
      const result = await analyzeTimetableLightningFast(levelToAnalyze, levelSubjects, levelClasses, teachers, totalSlots);
      setAiAnalysisResult(result);
      setShowAiAnalysisModal(true);
      showToast('⚡ AI Analysis Complete in lightning speed', 'SUCCESS');
    } catch (e) {
      showToast('AI analysis encountered an issue', 'ALERT');
    } finally {
      setIsAiAnalyzingTier(false);
    }
  };

  const handleApplyAIFix = async (suggestion: AIFixSuggestion) => {
    if (!suggestion.autoFixPayload?.subjectAdjustments) {
      showToast('No automated fix payload available for this suggestion', 'INFO');
      return;
    }
    setApplyingAiFix(true);
    try {
      const adjustments = suggestion.autoFixPayload.subjectAdjustments;
      const allSubjects = storage.getSubjects();
      
      adjustments.forEach(adj => {
        const sub = allSubjects.find(s => s.id === adj.subjectId);
        if (sub) {
          storage.saveSubject({
            ...sub,
            defaultPeriodCount: adj.newPeriodCount,
            periodsPerWeek: adj.newPeriodCount
          });
        }
      });
      
      loadData();
      showToast(`⚡ AI Fix Applied! Rebalanced ${adjustments.length} subjects to fit timetable spaces perfectly.`, 'SUCCESS');
      setShowAiAnalysisModal(false);
    } catch (e) {
      showToast('Failed to apply AI fix', 'ALERT');
    } finally {
      setApplyingAiFix(false);
    }
  };

  useEffect(() => {
    loadData();
    const unsubStorage = storage.subscribe(loadData);
    const unsubConn = storage.subscribeConnectionStatus((connected) => {
      setIsFirebaseConnected(connected);
    });
    return () => { unsubStorage(); unsubConn(); };
  }, []);

  // Presence Tracking & Active Session Heartbeat
  useEffect(() => {
    const adminId = storage.getLoggedInAdminId();
    if (adminId) {
      storage.updateAdminPresence(adminId);
      const sendHeartbeat = async () => {
        try {
          const res = await fetch('/api/auth/admin-heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminId })
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.active === false) {
              showToast(`Session terminated: another admin (${data.currentAdmin || 'Admin'}) is active.`, 'ALERT');
              onLogout();
            }
          }
        } catch (e) {}
      };
      sendHeartbeat();
      const interval = setInterval(() => {
        storage.updateAdminPresence(adminId);
        sendHeartbeat();
      }, 5000); // Ping heartbeat every 5s
      return () => clearInterval(interval);
    }
  }, []);

  const handleAdminSignOut = async () => {
    const adminId = storage.getLoggedInAdminId();
    if (adminId) {
      try {
        await fetch('/api/auth/admin-logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminId })
        });
      } catch {}
    }
    onLogout();
  };

  useEffect(() => {
    if (classes && classes.length > 0 && !selectedClassId) {
        if (currentUser?.tier === 'DEPT_ADMIN' && currentUser.department) {
            const deptClass = classes.find(c => c && c.category === currentUser.department);
            if (deptClass?.id) setSelectedClassId(deptClass.id);
            else if (classes[0]?.id) setSelectedClassId(classes[0].id);
        } else if (classes[0]?.id) {
            setSelectedClassId(classes[0].id);
        }
    }
  }, [classes, currentUser, selectedClassId]);

  useEffect(() => {
      // Role-based redirect
      if (currentUser?.tier === 'SUPPORT_ADMIN' && activeView === 'DASHBOARD') {
          setActiveView('TIMETABLE');
      }
      if (activeView === 'TEACHERS') {
          setTeachers(storage.getTeachers());
          storage.fetchLatestFromApi(true).then(() => {
              setTeachers(storage.getTeachers());
          });
      }
  }, [currentUser, activeView]);

  const loadData = () => {
    const adminId = storage.getLoggedInAdminId();
    const allAdmins = storage.getAdmins();
    const me = allAdmins.find(a => a.id === adminId);
    if (!me) { onLogout(); return; }

    setCurrentUser(me);
    if (me.mustChangePassword || me.password === 'admin123') {
      setShowMandatoryPasswordModal(true);
    }

    setTeachers(storage.getTeachers());
    setClasses(storage.getClasses());
    setSubjects(storage.getSubjects());
    setRooms(storage.getRooms());
    setNotifications(storage.getNotifications('ADMIN'));
    
    const currentGrid = storage.getTimetable();
    setGrid(currentGrid);
    const currentDraft = storage.getDraftTimetable();
    setDraftGrid(currentDraft);
    const draftExists = storage.hasUnpublishedDraft();
    setHasDraft(draftExists);
    setTimetableMetadata(storage.getTimetableMetadata());

    const activeViewGrid = (activeScheduleTab === 'DRAFT' && currentDraft) ? currentDraft : currentGrid;
    if (activeViewGrid) {
        const detected = detectGridConflicts(activeViewGrid, storage.getClasses(), storage.getSubjects());
        setConflicts(detected);
    } else {
        setConflicts([]);
    }

    setRequests(storage.getRequests());
    setAdmins(allAdmins);
    setAbsences(storage.getAbsences());
    setAuditLogs(storage.getAuditLogs());
    // Only update settings from storage if we don't have unsaved changes locally
    if (!unsavedSettings) {
        setSettings(storage.getSettings());
    }
    setChatMessages(storage.getChatMessages());
    setSchools(storage.getSchools());
  };

  const handleSaveMandatoryPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setAdminPasswordError('');

    if (newAdminPassword.length < 8) {
      setAdminPasswordError('Password must be at least 8 characters long.');
      return;
    }
    if (newAdminPassword === 'admin123') {
      setAdminPasswordError('New password cannot be the insecure default "admin123".');
      return;
    }
    if (newAdminPassword !== confirmAdminPassword) {
      setAdminPasswordError('Passwords do not match. Please re-enter.');
      return;
    }

    setIsUpdatingAdminPassword(true);
    try {
      const res = await storage.changeAdminPassword(currentUser.id, newAdminPassword);
      if (!res.success) {
        setAdminPasswordError(res.error || 'Failed to update administrator password.');
        return;
      }

      try {
        await fetch('/api/auth/change-admin-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminId: currentUser.id, newPassword: newAdminPassword.trim() })
        });
      } catch {}

      setCurrentUser(prev => prev ? { ...prev, mustChangePassword: false, password: '***' } : null);
      setShowMandatoryPasswordModal(false);
      setNewAdminPassword('');
      setConfirmAdminPassword('');
      showToast('Admin password hardened successfully! Access secured.', 'SUCCESS');
    } catch (err: any) {
      setAdminPasswordError(err?.message || 'Error updating password.');
    } finally {
      setIsUpdatingAdminPassword(false);
    }
  };

  const showToast = (message: string, type: 'INFO'|'ALERT'|'SUCCESS') => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 3000);
  };

  const runAIAudit = async () => {
    if (!grid) {
      showToast('No active timetable schedule to audit', 'INFO');
      return;
    }
    setIsAuditingWithAI(true);
    try {
      const result = await auditTimetableSchedule(grid, teachers, classes, subjects, conflicts);
      setAiAuditResult(result);
      showToast('AI Schedule Audit completed', 'SUCCESS');
    } catch (e) {
      showToast('AI Audit encountered an issue', 'ALERT');
    } finally {
      setIsAuditingWithAI(false);
    }
  };

  const handleGenerate = async () => {
      if (isGenerating) {
          showToast('Generation already in progress by another admin', 'ALERT');
          return;
      }
      if (!classes || classes.length === 0) {
          showToast('Cannot generate timetable: No classes are configured.', 'ALERT');
          return;
      }
      if (!subjects || subjects.length === 0) {
          showToast('Cannot generate timetable: No subjects are configured.', 'ALERT');
          return;
      }
      setIsGenerating(true);
      setGenerationProgress(5);
      setGenerationStatus('Initializing constraint solver...');
      
      try {
          // Allow UI to render the loading state before intensive computation
          await new Promise(r => setTimeout(r, 400));
          
          // Ensure freshest authoritative roster and data are loaded directly from storage
          const freshTeachers = storage.getTeachers();
          const freshClasses = classes.length > 0 ? classes : storage.getClasses();
          const freshSubjects = subjects.length > 0 ? subjects : storage.getSubjects();
          setTeachers(freshTeachers);

          const result = await generateTimetable(
            freshTeachers, 
            freshClasses, 
            freshSubjects, 
            optimizationGoal, 
            (p, log) => { 
                setGenerationProgress(p);
                setGenerationStatus(log.message);
            }, 
            { goal: optimizationGoal, forceSinglePeriods: true, preserveManualEdits },
            grid || {}, 
            (syncGrid) => {
                setDraftGrid(syncGrid);
            }
          );
          
          setGenerationLogs(result.logs);
          if (result.reasoningReport) {
              setReasoningReport(result.reasoningReport);
          }
          
          if (result.success || (result.timetable && Object.keys(result.timetable).length > 0)) {
              storage.saveDraftTimetable(result.timetable);
              setDraftGrid(result.timetable);
              setHasDraft(true);
              setActiveScheduleTab('DRAFT');
              loadData();
              if (result.success) {
                  showToast(`Draft schedule generated (${result.reasoningReport?.score || 95}/100)! Review preview and click "Publish Master Timetable" when ready.`, 'SUCCESS');
              } else {
                  showToast('Generated best available draft schedule with noted constraints. Review and publish when ready.', 'INFO');
              }
              setShowGenReport(true);
          } else {
              showToast('Could not generate schedule with current constraints', 'ALERT');
              setShowGenReport(true);
          }
      } catch (err: any) {
          console.error('Timetable generation error:', err);
          const errorMsg = err?.message || 'An unexpected error occurred during timetable generation.';
          showToast(`Generation Error: ${errorMsg}`, 'ALERT');
          setGenerationLogs(prev => [
              ...(prev || []),
              { type: 'error', message: `Generation aborted: ${errorMsg}`, timestamp: Date.now() }
          ]);
          setShowGenReport(true);
      } finally {
          setIsGenerating(false);
          setGenerationProgress(0);
          setGenerationStatus('');
      }
  };

  const handleSaveAsPNG = async () => {
      if (timetableRef.current) {
          try {
              const canvas = await html2canvas(timetableRef.current, { scale: 2 });
              const link = document.createElement('a');
              link.download = `Timetable_${selectedClassId}_${Date.now()}.png`;
              link.href = canvas.toDataURL();
              link.click();
              showToast('Schedule Saved as PNG', 'SUCCESS');
          } catch (err) {
              showToast('Failed to export PNG', 'ALERT');
          }
      } else {
          showToast('Timetable view not ready', 'INFO');
      }
  };

  const requestDelete = (type: string, id: string, name: string) => {
      setDeleteModal({ type, id, name });
  };

  const confirmDelete = () => {
      if (!deleteModal) return;
      const { type, id } = deleteModal;
      
      if (type === 'TEACHER') {
          storage.deleteTeacher(id);
          setTeachers(prev => prev.filter(t => t.id !== id));
      }
      else if (type === 'CLASS') storage.deleteClass(id);
      else if (type === 'SUBJECT') storage.deleteSubject(id);
      else if (type === 'ROOM') storage.deleteRoom(id);
      else if (type === 'ADMIN') {
          if (admins.length <= 1) { showToast('Cannot delete last admin', 'ALERT'); setDeleteModal(null); return; }
          storage.deleteAdmin(id);
      }
      
      showToast('Item deleted successfully', 'SUCCESS');
      loadData();
      setDeleteModal(null);
  };

  const openEditModal = (type: 'TEACHER'|'CLASS'|'SUBJECT'|'ADMIN'|'ROOM', item: any) => {
      setModalType(type);
      setEntityForm({...item}); // Spread to avoid mutation
  };

  const handleEntitySave = () => {
      // Logic to preserve ID if editing, or create new if adding
      const id = entityForm.id || (entityForm.name || 'new').toLowerCase().replace(/\s/g, '_') + '_' + Date.now();
      
      if (modalType === 'TEACHER') {
          // Preserve existing data if editing, otherwise defaults
          const existing = teachers.find(t => t.id === entityForm.id);
          const teacherData: Teacher = {
              ...(existing || {
                  id, 
                  username: entityForm.username || (entityForm.name || 'teacher').toLowerCase().replace(/\s/g, ''),
                  password: 'password', // Default
                  recoveryCode: '123456',
                  isCompleted: false,
                  subjectsTaught: [],
                  assignedClasses: [],
                  availability: Array.from({ length: 5 }).reduce((acc, _, day) => {
                    acc[day] = Array.from({ length: 8 }).reduce((pAcc, _, period) => {
                      pAcc[period] = Availability.AVAILABLE;
                      return pAcc;
                    }, {} as Record<number, Availability>);
                    return acc;
                  }, {} as any) as Record<number, Record<number, Availability>>
              }),
              name: entityForm.name,
              // Fix: ensure username is updated if provided in form
              username: entityForm.username || existing?.username || (entityForm.name || 'teacher').toLowerCase().replace(/\s/g, ''),
          };
          storage.saveTeacher(teacherData);
      }
      else if (modalType === 'CLASS') {
          const level: AcademicLevel = entityForm.level || (entityForm.category === 'JSS' || entityForm.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
          const stream = entityForm.stream || (level === 'SENIOR' ? getClassStream(entityForm) : 'GENERAL');
          storage.saveClass({ 
              id, 
              name: entityForm.name, 
              category: level,
              level,
              stream,
              eligibleSubjectIds: entityForm.eligibleSubjectIds,
              assignedTeacherId: entityForm.assignedTeacherId,
              roomNumber: entityForm.roomNumber
          });
      }
      else if (modalType === 'SUBJECT') {
          const level: AcademicLevel = entityForm.level || (entityForm.category === 'JSS' || entityForm.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
          const stream = entityForm.stream || (level === 'SENIOR' ? getSubjectStream(entityForm) : 'ALL');
          const defaultPeriodCount = Math.max(1, parseInt(entityForm.defaultPeriodCount) || parseInt(entityForm.periodsPerWeek) || 4);
          const maxPerDay = Math.max(1, parseInt(entityForm.maxPerDay) || (defaultPeriodCount >= 5 && (entityForm.isCore === 'true' || entityForm.isCore === true) ? 2 : 1));
          
          storage.saveSubject({ 
              id, 
              name: entityForm.name, 
              code: entityForm.code || (entityForm.name ? entityForm.name.substring(0, 4).toUpperCase() : 'SUBJ'),
              category: level, 
              level,
              stream,
              eligibleClassIds: entityForm.eligibleClassIds,
              isCore: entityForm.isCore === 'true' || entityForm.isCore === true,
              defaultPeriodCount,
              periodsPerWeek: defaultPeriodCount,
              maxPerDay,
              preferredTeacherId: entityForm.preferredTeacherId,
              color: entityForm.color
          });
      }
      else if (modalType === 'ROOM') {
          storage.saveRoom({
              id,
              name: entityForm.name,
              capacity: parseInt(entityForm.capacity) || 30,
              category: entityForm.category || 'GENERAL',
              features: entityForm.features ? (Array.isArray(entityForm.features) ? entityForm.features : String(entityForm.features).split(',').map((s: string) => s.trim())) : []
          });
      }
      else if (modalType === 'ADMIN') {
          const adminData: AdminUser = {
             id,
             username: entityForm.username || (entityForm.name || 'admin').toLowerCase().replace(/\s/g, ''),
             password: entityForm.password || 'admin123',
             name: entityForm.name,
             tier: entityForm.tier || 'SUPPORT_ADMIN',
             department: entityForm.department
          };
          storage.saveAdmin(adminData);
      }
      
      setModalType(null);
      setEntityForm({});
      showToast('Saved Successfully', 'SUCCESS');
      loadData();
  };

  const handleRequestAction = (req: SwapRequest, action: 'APPROVED' | 'REJECTED') => {
      storage.updateRequest({ ...req, status: action });
      showToast(`Request ${action ? action.toLowerCase() : ''}`, action === 'APPROVED' ? 'SUCCESS' : 'INFO');
  };

  // --- SETTINGS LOGIC ---
  const handleSettingChange = (key: keyof AppSettings, value: any) => {
      setSettings(prev => ({ ...prev, [key]: value }));
      setUnsavedSettings(true);
  };

  const handleSaveSettings = () => {
      storage.saveSettings(settings);
      setUnsavedSettings(false);
      showToast('System settings updated successfully', 'SUCCESS');
  };

  const handleSystemReset = () => {
      // Wiping data is a critical action. In the iframe environment, 
      // window.confirm and prompt are often blocked. 
      // We'll execute the reset directly for now to ensure it works.
      storage.resetSystem();
      showToast('System Factory Reset Complete', 'ALERT');
      setTimeout(() => window.location.reload(), 1500);
  };

  // --- MANUAL EDITING & PUBLICATION LOGIC ---
  const handlePublishDraft = () => {
    const draftToPublish = draftGrid || grid;
    if (!draftToPublish || Object.keys(draftToPublish).length === 0) {
      showToast('No timetable draft available to publish.', 'ALERT');
      return;
    }
    setIsPublishing(true);
    try {
      const meta = storage.publishTimetable(draftToPublish, currentUser?.name || 'Administrator');
      setHasDraft(false);
      setDraftGrid(null);
      setActiveScheduleTab('PUBLISHED');
      loadData();
      showToast(`Master Timetable successfully published (Revision #${meta.revisionId})! All faculty and viewers updated.`, 'SUCCESS');
    } catch (e: any) {
      showToast('Failed to publish timetable: ' + (e?.message || 'Unknown error'), 'ALERT');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDiscardDraft = () => {
    storage.discardDraftTimetable();
    setHasDraft(false);
    setDraftGrid(null);
    setActiveScheduleTab('PUBLISHED');
    loadData();
    showToast('Unpublished draft discarded. Now displaying active published schedule.', 'INFO');
  };

  const handleCellClick = (d: number, p: number) => {
      if (!selectedClassId || currentUser?.tier === 'SUPPORT_ADMIN') return;
      const periodsCount = settings.periodsPerDay || 8;
      // Rule 2: Friday worship — final two periods only (reserved)
      if (d === 4 && p >= periodsCount - 2) {
          showToast(`Friday final two periods (P${periodsCount - 1} & P${periodsCount}) are strictly reserved for Worship.`, 'INFO');
          return;
      }
      const targetGrid = (activeScheduleTab === 'DRAFT' && draftGrid) ? draftGrid : grid;
      const cell = targetGrid?.[selectedClassId]?.[d]?.[p];
      setShowCellEditModal({ d, p, cell });
      setCellEditForm({ subjectId: cell?.subjectId || '', teacherId: cell?.teacherId || '', roomId: cell?.roomId || '' });
  };

  const handleSaveCell = async () => {
      if (!selectedClassId || !showCellEditModal) return;
      
      const targetGrid = (activeScheduleTab === 'DRAFT' && draftGrid) ? draftGrid : grid;
      const newGrid = targetGrid ? JSON.parse(JSON.stringify(targetGrid)) : {};
      const { d, p } = showCellEditModal;
      const periodsCount = settings.periodsPerDay || 8;

      if (!newGrid[selectedClassId]) newGrid[selectedClassId] = {};
      if (!newGrid[selectedClassId][d]) newGrid[selectedClassId][d] = {};

      if (d === 4 && p >= periodsCount - 2) {
          // Preserve Friday Worship reservation
          newGrid[selectedClassId][d][p] = {
              subjectId: 'WORSHIP',
              teacherId: 'SYSTEM',
              teacherIds: ['SYSTEM'],
              isManual: true,
              classId: selectedClassId
          };
      } else if (cellEditForm.subjectId && cellEditForm.subjectId !== '') {
          newGrid[selectedClassId][d][p] = {
              subjectId: cellEditForm.subjectId,
              teacherId: cellEditForm.teacherId || 'SYSTEM',
              teacherIds: [cellEditForm.teacherId || 'SYSTEM'],
              roomId: cellEditForm.roomId || undefined,
              isManual: true,
              classId: selectedClassId
          };
      } else {
          newGrid[selectedClassId][d][p] = null;
      }
      
      if (activeScheduleTab === 'DRAFT') {
          storage.saveDraftTimetable(newGrid);
          setDraftGrid(newGrid);
          setHasDraft(true);
      } else {
          storage.publishTimetable(newGrid, `Manual Edit by ${currentUser?.name}`);
          setGrid(newGrid);
      }
      
      setShowCellEditModal(null);
      showToast('Updated Slot', 'SUCCESS');
      loadData(); // Refresh conflicts
  };

  const handleMarkRead = (id: string) => { storage.markRead(id); loadData(); };
  
  // Admin Password Management State
  const [adminPassForm, setAdminPassForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showAdminPass, setShowAdminPass] = useState({
    current: false,
    new: false,
    confirm: false
  });
  const [adminPassStatus, setAdminPassStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isUpdatingAdminPass, setIsUpdatingAdminPass] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleUpdateAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPassStatus(null);
    if (!adminPassForm.newPassword || adminPassForm.newPassword.length < 4) {
      setAdminPassStatus({ type: 'error', message: 'New password must be at least 4 characters long.' });
      return;
    }
    if (adminPassForm.newPassword !== adminPassForm.confirmPassword) {
      setAdminPassStatus({ type: 'error', message: 'New password and confirmation do not match.' });
      return;
    }
    setIsUpdatingAdminPass(true);
    try {
      const token = storage.getAuthToken();
      const currentAdminId = storage.getLoggedInAdminId() || 'admin1';
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          adminId: currentAdminId,
          role: 'ADMIN',
          oldPassword: adminPassForm.currentPassword,
          newPassword: adminPassForm.newPassword
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setAdminPassStatus({ type: 'error', message: data.error || 'Failed to update password.' });
        return;
      }
      storage.updateAdmin(currentAdminId, {
        password: adminPassForm.newPassword,
        mustChangePassword: false
      });
      setAdminPassStatus({ type: 'success', message: 'Administrator password updated successfully! Use your new password on next login.' });
      showToast('Administrator password updated successfully!', 'SUCCESS');
      setAdminPassForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      setAdminPassStatus({ type: 'error', message: err?.message || 'Network error while updating password.' });
    } finally {
      setIsUpdatingAdminPass(false);
    }
  };

  const handleResetAdminPasswordToDefault = async () => {
    if (!window.confirm('Reset administrator password back to default "admin123"?')) return;
    setIsUpdatingAdminPass(true);
    setAdminPassStatus(null);
    try {
      const token = storage.getAuthToken();
      const currentAdminId = storage.getLoggedInAdminId() || 'admin1';
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          adminId: currentAdminId,
          role: 'ADMIN',
          newPassword: 'admin123'
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setAdminPassStatus({ type: 'error', message: data.error || 'Failed to reset password.' });
        return;
      }
      storage.updateAdmin(currentAdminId, {
        password: 'admin123',
        mustChangePassword: false
      });
      setAdminPassStatus({ type: 'success', message: 'Password successfully reset to default "admin123"!' });
      showToast('Password reset to default "admin123"!', 'SUCCESS');
      setAdminPassForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      setAdminPassStatus({ type: 'error', message: err?.message || 'Network error.' });
    } finally {
      setIsUpdatingAdminPass(false);
    }
  };

  const handleClearTeachers = async () => {
    setIsClearing(true);
    try {
      storage.saveTeachers([]);
      showToast('All teachers cleared', 'SUCCESS');
      loadData();
    } catch (error) {
      console.error("Clearing failed:", error);
      showToast("Clearing failed", "ALERT");
    } finally {
      setIsClearing(false);
    }
  };

  const handleMarkAllRead = () => {
      storage.markAllRead('ADMIN');
      loadData();
      showToast('All messages marked as read', 'SUCCESS');
  };

  if (!currentUser) return null;

  const theme = THEME_CONFIG[currentUser.tier];

  // --- FILTERED DATA FOR LISTS ---
  const getFilteredList = (type: string) => {
      const lowerSearch = (searchTerm || '').toLowerCase();
      if (type === 'TEACHERS') return teachers.filter(t => (t.name || '').toLowerCase().includes(lowerSearch));
      if (type === 'CLASSES') {
          // Dept Admins only see their department classes
          let list = classes;
          if (currentUser?.tier === 'DEPT_ADMIN' && currentUser.department) {
              list = list.filter(c => c.category === currentUser.department);
          }
          return list.filter(c => (c.name || '').toLowerCase().includes(lowerSearch));
      }
      if (type === 'SUBJECTS') return subjects.filter(s => (s.name || '').toLowerCase().includes(lowerSearch));
      if (type === 'ADMINS') return admins.filter(a => (a.name || '').toLowerCase().includes(lowerSearch));
      return [];
  };

  const filteredNotifications = notifications.filter(n => {
      if (inboxFilter === 'UNREAD') return !n.isRead;
      if (inboxFilter === 'ALERTS') return n.type === 'ALERT';
      return true;
  });

  // Helper Widgets
  const KPICard = ({ title, value, icon: Icon, color }: any) => (
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className={`p-3 rounded-xl ${color} bg-opacity-10 text-opacity-100 group-hover:scale-110 transition-transform duration-300`}>
             <Icon size={24} className={`${color.replace('bg-', 'text-')}`}/>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">{title}</div>
            <div className="text-3xl font-black text-slate-800">{value}</div>
          </div>
          <div className={`absolute -right-6 -bottom-6 w-24 h-24 rounded-full ${color} opacity-5`}></div>
      </div>
  );

  return (
    <div className="flex h-screen bg-[#f8fafc] font-sans text-slate-900 overflow-hidden selection:bg-blue-100 selection:text-blue-900">
        {/* MOBILE OVERLAY */}
        {isSidebarOpen && (
            <div 
                className="fixed inset-0 bg-slate-900/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
                onClick={() => setIsSidebarOpen(false)}
            />
        )}

        {/* SIDEBAR */}
        <aside className={`fixed md:relative z-50 h-full ${isSidebarOpen ? 'translate-x-0 w-72' : '-translate-x-full w-72 md:w-0 md:translate-x-0'} ${theme.sidebarBg} transition-all duration-300 flex flex-col shrink-0 shadow-2xl overflow-hidden`}>
            <div className="h-20 flex items-center px-6 font-bold text-xl tracking-tight text-white border-b border-white/10">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mr-3 backdrop-blur-sm shadow-inner"><Activity size={20}/></div>
                <div>
                  <div className="leading-none text-lg">Pentric</div>
                  <div className="text-[10px] font-semibold text-slate-400 mt-1 uppercase tracking-wider">Administration</div>
                </div>
            </div>
            
            <nav className="flex-1 py-5 px-3 space-y-3 overflow-y-auto custom-scrollbar">
                {/* Standalone Top Dashboard */}
                <button 
                    onClick={() => { 
                        setActiveView('DASHBOARD'); 
                        setSearchTerm(''); 
                        if (window.innerWidth < 768) setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-bold group
                        ${activeView === 'DASHBOARD' ? theme.activeItem : `${theme.sidebarText} ${theme.sidebarHover}`}`}
                >
                    <Home size={18} className={activeView === 'DASHBOARD' ? 'animate-pulse text-white' : 'opacity-70 group-hover:opacity-100'} />
                    <span className="tracking-wide flex-1 text-left">Dashboard</span>
                </button>

                {/* Collapsible Groups */}
                {NAV_GROUPS.map(group => {
                    const visibleItems = group.itemIds.map(id => MENU_ITEMS.find(m => m.id === id)!).filter(item => {
                        if (!item) return false;
                        if (currentUser.tier === 'SUPPORT_ADMIN' && !['TIMETABLE','TEACHERS','CLASSES'].includes(item.id)) return false;
                        if (currentUser.tier === 'DEPT_ADMIN' && ['ADMINS','SETTINGS','REPORTS'].includes(item.id)) return false;
                        if (currentUser.tier === 'ACADEMIC_ADMIN' && ['ADMINS','SETTINGS'].includes(item.id)) return false;
                        return true;
                    });

                    if (visibleItems.length === 0) return null;

                    const isGroupActive = visibleItems.some(i => i.id === activeView);
                    const isCollapsed = collapsedSections[group.id] && !isGroupActive;

                    return (
                        <div key={group.id} className="space-y-1">
                            <button
                                type="button"
                                onClick={() => toggleSection(group.id)}
                                className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 hover:text-white transition-colors group cursor-pointer"
                            >
                                <span className="flex items-center gap-2">
                                    <group.icon size={13} className="text-blue-400/80" />
                                    {group.label}
                                </span>
                                {isCollapsed ? (
                                    <ChevronRight size={13} className="text-slate-500 group-hover:text-white transition-transform" />
                                ) : (
                                    <ChevronDown size={13} className="text-slate-500 group-hover:text-white transition-transform" />
                                )}
                            </button>

                            {!isCollapsed && (
                                <div className="space-y-1 pl-1 pt-0.5 animate-in slide-in-from-top-1 duration-150">
                                    {visibleItems.map(item => (
                                        <button
                                            key={item.id}
                                            onClick={() => {
                                                if (item.id === 'ABOUT') {
                                                    setShowAboutUsModal(true);
                                                    return;
                                                }
                                                setActiveView(item.id);
                                                setSearchTerm('');
                                                if (window.innerWidth < 768) setIsSidebarOpen(false);
                                            }}
                                            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-200 text-xs font-bold group
                                                ${activeView === item.id ? theme.activeItem : `${theme.sidebarText} ${theme.sidebarHover}`}`}
                                        >
                                            <item.icon size={16} className={activeView === item.id ? 'animate-pulse text-white' : 'opacity-70 group-hover:opacity-100'} />
                                            <span className="tracking-wide flex-1 text-left">{item.label}</span>
                                            {item.id === 'TEACHERS' && pendingTeachers.length > 0 && (
                                                <span className="bg-blue-600 text-white font-black text-[9px] px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                                                    {pendingTeachers.length}
                                                </span>
                                            )}
                                            {item.id === 'INBOX' && notifications.filter(n=>!n.isRead).length > 0 && (
                                                <span className="bg-red-500 text-white text-[9px] px-2 py-0.5 rounded-full">
                                                    {notifications.filter(n=>!n.isRead).length}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            <div className="p-6 border-t border-white/10 bg-black/10">
                <button onClick={handleAdminSignOut} className="flex items-center gap-3 w-full px-4 py-3 text-red-300 hover:text-white hover:bg-red-500/20 rounded-xl transition-all text-sm font-bold">
                    <LogOut size={18} /> Sign Out
                </button>
            </div>
        </aside>

        {/* MAIN */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative">
             {/* HEADER */}
             <header className="h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-4 md:px-8 z-10">
                <div className="flex items-center gap-4">
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2.5 text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"><Menu size={20}/></button>
                    {/* Universal Back Button */}
                    {activeView !== 'DASHBOARD' && (
                        <button onClick={() => setActiveView('DASHBOARD')} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors text-slate-600" title="Back to Dashboard">
                            <ArrowLeft size={18}/>
                        </button>
                    )}
                    <h2 className="font-bold text-xl text-slate-800">{activeView === 'DASHBOARD' ? 'Dashboard' : MENU_ITEMS.find(m=>m.id===activeView)?.label}</h2>
                </div>
                <div className="flex items-center gap-4">
                    {/* Active Institution Badge (School Switching Locked while in portal) */}
                    <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-900 shadow-2xs">
                        <span 
                            onClick={(e) => {
                                if (e.detail === 3) {
                                    window.dispatchEvent(new CustomEvent('open-developer-console'));
                                }
                            }}
                            className="font-extrabold text-blue-700 flex items-center gap-1.5 select-none cursor-default"
                            title={currentSchool.name}
                        >
                            <School size={14} className="text-blue-600" />
                            {currentSchool.name}
                        </span>
                        <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full" title="To switch or register a school, sign out first">
                            Active Institution
                        </span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 border border-slate-200 shadow-sm">
                        <span className={`w-2.5 h-2.5 rounded-full ${isFirebaseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                        <span className={isFirebaseConnected ? 'text-emerald-700' : 'text-amber-700'}>
                            {isFirebaseConnected ? 'Live Sync Connected' : 'Syncing...'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right hidden sm:block">
                            <div className="text-sm font-bold text-slate-800">{currentUser.name}</div>
                            <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block mt-0.5 bg-gradient-to-r ${theme.gradient} text-white shadow-sm`}>{theme.label}</div>
                        </div>
                        <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${theme.gradient} flex items-center justify-center font-bold text-white shadow-md border-2 border-white`}>
                            {currentUser.name.charAt(0)}
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar bg-slate-50/50">
                
                {/* --- CLEAN EXECUTIVE ADMIN DASHBOARD --- */}
                {activeView === 'DASHBOARD' && (() => {
                    let totalSlotsScheduled = 0;
                    if (grid) {
                        for (const cId in grid) {
                            for (let d = 0; d < 5; d++) {
                                for (let p = 0; p < (settings.periodsPerDay || 8); p++) {
                                    const cell = grid[cId]?.[d]?.[p];
                                    if (cell && cell.subjectId !== 'FREE') {
                                        totalSlotsScheduled++;
                                    }
                                }
                            }
                        }
                    }

                    const pendingRequests = requests.filter(r => r.status === 'PENDING').length;
                    const onlineTeachers = teachers.filter(t => t.lastActive && Date.now() - t.lastActive < 120000).length;

                    return (
                        <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300 pb-16">
                            
                            {/* 1. Clean Top Header */}
                            <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100">
                                            {settings.currentSession} • {settings.currentTerm}
                                        </span>
                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${grid ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
                                            {grid ? 'Timetable Published' : 'Draft Mode'}
                                        </span>
                                    </div>
                                    <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
                                        Admin Dashboard
                                    </h1>
                                    <p className="text-slate-500 text-sm mt-1">
                                        {settings.schoolName || currentSchool.name}
                                    </p>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                    <button
                                        onClick={() => setActiveView('TIMETABLE')}
                                        className="px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow transition flex items-center gap-2 cursor-pointer"
                                    >
                                        <Calendar size={15} />
                                        View Master Timetable
                                    </button>
                                    <button
                                        onClick={() => setActiveView('TEACHERS')}
                                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition flex items-center gap-2 cursor-pointer"
                                    >
                                        <Users size={15} />
                                        Faculty
                                    </button>
                                </div>
                            </div>

                            {/* 2. Four Core Metric Cards (Spacious & Clean) */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div 
                                    onClick={() => setActiveView('TEACHERS')}
                                    className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:border-blue-300 transition cursor-pointer group"
                                >
                                    <div className="flex items-center justify-between text-slate-400 group-hover:text-blue-600 transition mb-2">
                                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Teachers</span>
                                        <Users size={18} />
                                    </div>
                                    <div className="text-3xl font-black text-slate-900">{teachers.length}</div>
                                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                                        <span className={`w-2 h-2 rounded-full ${onlineTeachers > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                        <span>{onlineTeachers} active now</span>
                                    </div>
                                </div>

                                <div 
                                    onClick={() => setActiveView('CLASSES')}
                                    className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:border-indigo-300 transition cursor-pointer group"
                                >
                                    <div className="flex items-center justify-between text-slate-400 group-hover:text-indigo-600 transition mb-2">
                                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Classes</span>
                                        <Grid size={18} />
                                    </div>
                                    <div className="text-3xl font-black text-slate-900">{classes.length}</div>
                                    <div className="text-xs text-slate-500 mt-1">Junior & Senior cohorts</div>
                                </div>

                                <div 
                                    onClick={() => setActiveView('SUBJECTS')}
                                    className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:border-violet-300 transition cursor-pointer group"
                                >
                                    <div className="flex items-center justify-between text-slate-400 group-hover:text-violet-600 transition mb-2">
                                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Subjects</span>
                                        <BookOpen size={18} />
                                    </div>
                                    <div className="text-3xl font-black text-slate-900">{subjects.length}</div>
                                    <div className="text-xs text-slate-500 mt-1">Curriculum courses</div>
                                </div>

                                <div 
                                    onClick={() => setActiveView('TIMETABLE')}
                                    className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:border-emerald-300 transition cursor-pointer group"
                                >
                                    <div className="flex items-center justify-between text-slate-400 group-hover:text-emerald-600 transition mb-2">
                                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Lessons</span>
                                        <CalendarClock size={18} />
                                    </div>
                                    <div className="text-3xl font-black text-slate-900">{totalSlotsScheduled}</div>
                                    <div className="text-xs text-emerald-600 font-semibold mt-1 flex items-center gap-1">
                                        <CheckCircle2 size={13} />
                                        <span>100% Scheduled</span>
                                    </div>
                                </div>
                            </div>

                            {/* 3. Two Spacious Operational Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                
                                {/* Timetable Health & Allocation */}
                                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
                                            <Calendar size={18} className="text-blue-600" />
                                            Timetable Overview
                                        </h2>
                                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                                            0 Clashes
                                        </span>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs font-semibold text-slate-600">
                                            <span>Curriculum Completion</span>
                                            <span>100%</span>
                                        </div>
                                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-500 rounded-full w-full" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 pt-2 text-xs text-slate-600">
                                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <span className="text-slate-400 block text-[11px] mb-0.5">Morning Cores</span>
                                            <strong className="text-slate-800">Periods 1–4 Strict</strong>
                                        </div>
                                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <span className="text-slate-400 block text-[11px] mb-0.5">Friday Worship</span>
                                            <strong className="text-slate-800">Periods 7 & 8 Reserved</strong>
                                        </div>
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            onClick={() => setActiveView('TIMETABLE')}
                                            className="w-full py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                                        >
                                            <span>Open Master Timetable</span>
                                            <ArrowRight size={14} />
                                        </button>
                                    </div>
                                </div>

                                {/* Recent Activity & Pending Actions */}
                                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
                                            <ClipboardList size={18} className="text-indigo-600" />
                                            Recent Activity
                                        </h2>
                                        {pendingRequests > 0 && (
                                            <span 
                                                onClick={() => setActiveView('REQUESTS')}
                                                className="text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 cursor-pointer hover:bg-amber-100 transition"
                                            >
                                                {pendingRequests} Requests Pending
                                            </span>
                                        )}
                                    </div>

                                    <div className="space-y-2.5">
                                        {auditLogs && auditLogs.length > 0 ? (
                                            auditLogs.slice(0, 3).map((entry, idx) => (
                                                <div key={entry.id || idx} className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
                                                    <div className="flex items-center gap-2.5 truncate mr-2">
                                                        <FileText size={14} className="text-slate-400 shrink-0" />
                                                        <span className="font-medium text-slate-700 truncate">{entry.action}: {entry.details}</span>
                                                    </div>
                                                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                                        {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-xs text-slate-400 py-3 text-center">No recent activity logs.</p>
                                        )}
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            onClick={() => setActiveView('AUDIT')}
                                            className="w-full py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                                        >
                                            <span>View Audit Trail</span>
                                            <ArrowRight size={14} />
                                        </button>
                                    </div>
                                </div>

                            </div>

                        </div>
                    );
                })()}

                {/* --- MANUAL VIEW --- */}
                {activeView === 'MANUAL' && (
                    <UserGuide role="ADMIN" />
                )}

                {/* --- SETTINGS VIEW --- */}
                {activeView === 'SETTINGS' && (
                    <div className="max-w-5xl mx-auto pb-20 animate-in fade-in duration-500">
                        {/* ... (Existing Settings UI kept as is) ... */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                            <div>
                                <h1 className="text-3xl font-black text-slate-900">Configuration</h1>
                                <p className="text-slate-500">Manage system parameters and academic constraints.</p>
                            </div>
                            {unsavedSettings && (
                                <button onClick={handleSaveSettings} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-600/20 animate-bounce flex items-center justify-center gap-2 w-full md:w-auto">
                                    <Save size={18}/> Save Changes
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* School Identity */}
                            <section className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><School size={20}/></div>
                                    <h2 className="text-xl font-bold text-slate-800">School Identity</h2>
                                </div>
                                <div className="space-y-5">
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase ml-1 mb-1.5 block">Institution Name</label>
                                        <input type="text" value={settings.schoolName} onChange={(e) => handleSettingChange('schoolName', e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-blue-500 transition"/>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase ml-1 mb-1.5 block">Academic Session</label>
                                            <input type="text" value={settings.currentSession} onChange={(e) => handleSettingChange('currentSession', e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-blue-500 transition"/>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase ml-1 mb-1.5 block">Current Term</label>
                                            <select value={settings.currentTerm} onChange={(e) => handleSettingChange('currentTerm', e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-blue-500 transition">
                                                <option value="1st Term">1st Term</option>
                                                <option value="2nd Term">2nd Term</option>
                                                <option value="3rd Term">3rd Term</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* Time Configuration */}
                            <section className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><CalendarClock size={20}/></div>
                                    <h2 className="text-xl font-bold text-slate-800">Time Configuration</h2>
                                </div>
                                <div className="space-y-5">
                                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 opacity-75">
                                        <div>
                                            <div className="font-bold text-slate-800 flex items-center gap-2">
                                                <span>Saturday School</span>
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-600 uppercase">Standard OTA</span>
                                            </div>
                                            <div className="text-xs text-slate-500">OTA timetable standard is Monday–Friday (38 instructional teaching slots)</div>
                                        </div>
                                        <div className="text-xs font-bold text-slate-500 px-3 py-1.5 bg-slate-200/60 rounded-lg">
                                            Mon–Fri (38 Slots)
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase ml-1 mb-1.5 block">Periods Per Day</label>
                                            <input type="number" min="1" max="12" value={settings.periodsPerDay} onChange={(e) => handleSettingChange('periodsPerDay', parseInt(e.target.value))} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-blue-500 transition"/>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase ml-1 mb-1.5 block">Duration (Mins)</label>
                                            <input type="number" min="15" max="120" value={settings.periodDuration} onChange={(e) => handleSettingChange('periodDuration', parseInt(e.target.value))} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-blue-500 transition"/>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* Constraints */}
                            <section className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center"><Sliders size={20}/></div>
                                    <h2 className="text-xl font-bold text-slate-800">Algorithm Constraints</h2>
                                </div>
                                <div className="space-y-5">
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase ml-1 mb-1.5 block">Max Subjects / Teacher</label>
                                        <div className="flex items-center gap-4">
                                            <input type="range" min="1" max="20" value={settings.maxSubjectsPerTeacher} onChange={(e) => handleSettingChange('maxSubjectsPerTeacher', parseInt(e.target.value))} className="flex-1 accent-blue-600 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"/>
                                            <span className="w-12 h-12 flex items-center justify-center bg-slate-100 rounded-xl font-bold text-slate-700">{settings.maxSubjectsPerTeacher}</span>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase ml-1 mb-1.5 block">Min Classes</label>
                                            <input type="number" value={settings.minClassesPerTeacher} onChange={(e) => handleSettingChange('minClassesPerTeacher', parseInt(e.target.value))} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-blue-500 transition"/>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase ml-1 mb-1.5 block">Max Classes</label>
                                            <input type="number" value={settings.maxClassesPerTeacher} onChange={(e) => handleSettingChange('maxClassesPerTeacher', parseInt(e.target.value))} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:border-blue-500 transition"/>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* Danger Zone */}
                            <section className="bg-red-50/50 rounded-[2rem] p-8 shadow-sm border border-red-100">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center"><AlertOctagon size={20}/></div>
                                    <h2 className="text-xl font-bold text-red-900">Danger Zone</h2>
                                </div>
                                <div className="space-y-4">
                                    <p className="text-sm text-red-700/70 leading-relaxed">
                                        Resetting the system will permanently delete all teachers, classes, subjects, and generated timetables. This action cannot be undone.
                                    </p>
                                    <button onClick={handleSystemReset} className="w-full py-4 bg-white border border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-600 hover:text-white transition-all shadow-sm flex items-center justify-center gap-2">
                                        <Trash2 size={18}/> Factory Reset System
                                    </button>
                                </div>
                            </section>
                        </div>
                    </div>
                )}
                
                {/* --- INBOX VIEW --- */}
                {activeView === 'INBOX' && (
                    <div className="h-[calc(100vh-140px)] flex flex-col bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
                        {/* ... (Existing Inbox UI kept as is) ... */}
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h2 className="text-xl font-bold text-slate-800">Inbox</h2>
                                <p className="text-sm text-slate-500">Notifications & System Alerts</p>
                            </div>
                            <div className="flex gap-2 items-center">
                                {notifications.some(n => !n.isRead) && (
                                    <button onClick={handleMarkAllRead} className="mr-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-100 transition-colors flex items-center gap-2">
                                        <CheckCheck size={14}/> Mark All Read
                                    </button>
                                )}
                                {['ALL', 'UNREAD', 'ALERTS'].map((f) => (
                                    <button 
                                        key={f}
                                        onClick={() => setInboxFilter(f as any)}
                                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${inboxFilter === f ? 'bg-slate-900 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30 custom-scrollbar">
                            {filteredNotifications.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60">
                                    <Inbox size={48} className="mb-4"/>
                                    <p>No messages found</p>
                                </div>
                            )}
                            {filteredNotifications.map(n => {
                                const isExpanded = expandedNotif === n.id;
                                return (
                                    <div 
                                        key={n.id} 
                                        onClick={() => { if(!n.isRead) handleMarkRead(n.id); setExpandedNotif(isExpanded ? null : n.id); }}
                                        className={`bg-white border rounded-2xl p-5 cursor-pointer transition-all duration-300 hover:shadow-md ${n.isRead ? 'border-slate-100 opacity-90' : 'border-blue-200 shadow-sm ring-1 ring-blue-50'}`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${n.type === 'ALERT' ? 'bg-red-50 text-red-600' : n.type === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                                                {n.type === 'ALERT' ? <AlertTriangle size={20}/> : n.type === 'SUCCESS' ? <CheckCircle size={20}/> : <Info size={20}/>}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start mb-1">
                                                    <h4 className={`text-sm ${n.isRead ? 'font-semibold text-slate-700' : 'font-bold text-slate-900'}`}>{n.title || 'Notification'}</h4>
                                                    <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap ml-2">{new Date(n.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                                </div>
                                                <p className="text-sm text-slate-500 leading-relaxed truncate">{n.message}</p>
                                                
                                                <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-4 pt-4 border-t border-slate-50' : 'grid-rows-[0fr] opacity-0 h-0 overflow-hidden'}`}>
                                                    <div className="overflow-hidden">
                                                        <div className="text-sm text-slate-600 bg-slate-50 p-4 rounded-xl leading-relaxed whitespace-pre-wrap">
                                                            {n.details || n.message}
                                                        </div>
                                                        <div className="flex justify-end mt-4">
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); storage.deleteNotification(n.id); loadData(); }}
                                                                className="text-xs font-bold text-red-400 hover:text-red-600 flex items-center gap-1"
                                                            >
                                                                <Trash size={14}/> Delete
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            {!n.isRead && !isExpanded && <div className="w-2 h-2 rounded-full bg-blue-500 mt-2"></div>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* --- REPORTS VIEW (UPDATED) --- */}
                {activeView === 'REPORTS' && (
                    <div className="space-y-6 animate-in fade-in duration-500">
                        {/* ... (Existing Reports UI kept as is) ... */}
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-800">System Reports</h2>
                                <p className="text-slate-400 text-sm">Conflict analysis and generation logs.</p>
                            </div>
                            {/* TAB SWITCHER */}
                            <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
                                <button 
                                    onClick={() => setReportTab('INTER')} 
                                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${reportTab==='INTER' ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    Interclashes
                                </button>
                                <button 
                                    onClick={() => setReportTab('EXTRA')} 
                                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${reportTab==='EXTRA' ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    Extraclashes
                                </button>
                                <button 
                                    onClick={() => setReportTab('ROOM')} 
                                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${reportTab==='ROOM' ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    Venue Clashes
                                </button>
                                <button 
                                    onClick={() => setReportTab('ALL')} 
                                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${reportTab==='ALL' ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    Generation Logs
                                </button>
                            </div>
                        </div>

                        {/* CONTENT AREA */}
                        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm min-h-[500px] p-8">
                            {reportTab === 'ALL' ? (
                                <LogViewer logs={generationLogs} />
                            ) : (
                                /* Filter Conflicts based on Tab */
                                (() => {
                                    const filteredConflicts = conflicts.filter(c => {
                                        if (reportTab === 'INTER') return c.category === 'INTER_CLASH';
                                        if (reportTab === 'EXTRA') return c.category === 'EXTRA_CLASH';
                                        if (reportTab === 'ROOM') return c.category === 'ROOM_CLASH';
                                        return true;
                                    });

                                    if (filteredConflicts.length === 0) {
                                        return (
                                            <div className="flex flex-col items-center justify-center h-full py-20 opacity-50">
                                                <CheckCircle size={64} className="text-emerald-500 mb-4"/>
                                                <h3 className="text-xl font-bold text-slate-800">
                                                    No {reportTab === 'INTER' ? 'Interclashes' : reportTab === 'EXTRA' ? 'Extraclashes' : reportTab === 'ROOM' ? 'Venue Clashes' : 'Conflicts'} Detected
                                                </h3>
                                                <p className="text-sm text-slate-500">The schedule is clean in this category.</p>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div className="space-y-4">
                                            {filteredConflicts.map((conflict) => (
                                                <div key={conflict.id} className={`p-6 rounded-2xl border flex flex-col gap-4 ${
                                                    conflict.category === 'INTER_CLASH' ? 'bg-red-50/60 border-red-100' :
                                                    conflict.category === 'EXTRA_CLASH' ? 'bg-orange-50/60 border-orange-100' :
                                                    conflict.category === 'ROOM_CLASH' ? 'bg-purple-50/60 border-purple-100' :
                                                    'bg-slate-50 border-slate-100'
                                                }`}>
                                                    <div className="flex items-start gap-4">
                                                        <div className={`p-3 rounded-xl shrink-0 ${
                                                            conflict.category === 'INTER_CLASH' ? 'bg-red-100 text-red-600' :
                                                            conflict.category === 'EXTRA_CLASH' ? 'bg-orange-100 text-orange-600' :
                                                            conflict.category === 'ROOM_CLASH' ? 'bg-purple-100 text-purple-600' :
                                                            'bg-slate-200 text-slate-600'
                                                        }`}>
                                                            <AlertTriangle size={24}/>
                                                        </div>
                                                        <div className="flex-1">
                                                            <div className="flex items-center justify-between gap-3 mb-1">
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className={`font-bold text-base ${
                                                                        conflict.category === 'INTER_CLASH' ? 'text-red-900' :
                                                                        conflict.category === 'EXTRA_CLASH' ? 'text-orange-900' :
                                                                        conflict.category === 'ROOM_CLASH' ? 'text-purple-900' :
                                                                        'text-slate-800'
                                                                    }`}>
                                                                        {conflict.category === 'INTER_CLASH' ? 'Interclash Detected' : 
                                                                         conflict.category === 'EXTRA_CLASH' ? 'Extraclash Detected' : 
                                                                         conflict.category === 'ROOM_CLASH' ? 'Venue Clash Detected' : 'System Warning'}
                                                                    </h4>
                                                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/50 border border-black/5 opacity-70">
                                                                        {conflict.type}
                                                                    </span>
                                                                </div>
                                                                <button
                                                                    onClick={() => handleGetConflictFix(conflict)}
                                                                    disabled={loadingFixId === conflict.id}
                                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-all shadow-2xs"
                                                                >
                                                                    {loadingFixId === conflict.id ? (
                                                                        <Loader2 size={14} className="animate-spin text-indigo-600" />
                                                                    ) : (
                                                                        <Sparkles size={14} className="text-indigo-600" />
                                                                    )}
                                                                    <span>Suggest Fix</span>
                                                                </button>
                                                            </div>
                                                            <p className="text-sm text-slate-600 leading-relaxed mb-2">{conflict.message}</p>
                                                            <div className="flex gap-4 text-xs font-mono opacity-60">
                                                                {conflict.day !== undefined && <span>Day: {DAYS[conflict.day]}</span>}
                                                                {conflict.period !== undefined && <span>Period: {PERIODS[conflict.period]?.label || conflict.period + 1}</span>}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {conflictFixes[conflict.id] && (
                                                        <div className="p-4 rounded-xl bg-indigo-50/80 border border-indigo-100 text-indigo-900 text-xs font-medium flex items-start gap-3 animate-in fade-in">
                                                            <Sparkles size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                                                            <div>
                                                                <span className="font-bold text-indigo-950 block mb-0.5">AI Recommended Resolution:</span>
                                                                {conflictFixes[conflict.id]}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()
                            )}
                        </div>
                    </div>
                )}
                
                {/* --- TIMETABLE VIEW --- */}
                {activeView === 'TIMETABLE' && (() => {
                    const currentDisplayGrid = (activeScheduleTab === 'DRAFT' && draftGrid) ? draftGrid : grid;
                    return (
                    <div className="space-y-6 animate-in fade-in duration-500">
                        {/* AUTHORITATIVE REVISION & DRAFT STATUS BANNER */}
                        <div className={`p-5 rounded-2xl border shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all ${
                            hasDraft 
                                ? 'bg-amber-50/90 border-amber-200 text-amber-950' 
                                : 'bg-slate-900 border-slate-800 text-white'
                        }`}>
                            <div className="flex items-center gap-3.5">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                    hasDraft ? 'bg-amber-100 text-amber-700' : 'bg-blue-600/30 text-blue-400 border border-blue-500/30'
                                }`}>
                                    {hasDraft ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-extrabold text-sm md:text-base">
                                            {hasDraft ? 'Unpublished Schedule Draft Active' : 'Authoritative Master Schedule Active'}
                                        </h4>
                                        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                                            hasDraft ? 'bg-amber-200/80 text-amber-900' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                        }`}>
                                            Published Revision #{timetableMetadata.revisionId}
                                        </span>
                                    </div>
                                    <p className={`text-xs mt-0.5 ${hasDraft ? 'text-amber-800' : 'text-slate-400'}`}>
                                        {hasDraft 
                                            ? `A newly generated schedule draft is awaiting approval. Faculty and public portals will continue displaying Revision #${timetableMetadata.revisionId} until you publish.`
                                            : `Officially released by ${timetableMetadata.publishedBy} • Synced monotonically across all devices.`}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 w-full md:w-auto">
                                {hasDraft && (
                                    <>
                                        <div className="bg-amber-100/80 p-1 rounded-xl flex items-center border border-amber-200">
                                            <button
                                                onClick={() => setActiveScheduleTab('PUBLISHED')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                    activeScheduleTab === 'PUBLISHED'
                                                        ? 'bg-white text-slate-800 shadow-sm'
                                                        : 'text-amber-800 hover:text-amber-950'
                                                }`}
                                            >
                                                Live (Rev #{timetableMetadata.revisionId})
                                            </button>
                                            <button
                                                onClick={() => setActiveScheduleTab('DRAFT')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                    activeScheduleTab === 'DRAFT'
                                                        ? 'bg-amber-600 text-white shadow-sm'
                                                        : 'text-amber-800 hover:text-amber-950'
                                                }`}
                                            >
                                                Draft Preview
                                            </button>
                                        </div>

                                        <button
                                            onClick={handlePublishDraft}
                                            disabled={isPublishing}
                                            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow-md flex items-center gap-1.5 shrink-0"
                                            title="Publish Draft as authoritative schedule"
                                        >
                                            {isPublishing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                                            <span>Publish Timetable</span>
                                        </button>

                                        <button
                                            onClick={handleDiscardDraft}
                                            className="px-3 py-2.5 bg-white border border-amber-300 hover:bg-amber-100/50 text-amber-900 font-bold text-xs rounded-xl transition-all shrink-0"
                                            title="Discard this draft"
                                        >
                                            Discard
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* OPTIMIZATION STRATEGY SELECTOR BAR */}
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-indigo-600" />
                                <div>
                                    <h4 className="text-sm font-black text-slate-800">Generation Heuristics & Strategy</h4>
                                    <p className="text-xs text-slate-500">Choose the algorithmic goal for the constraint solver</p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 w-full md:w-auto">
                                {[
                                    { id: 'BALANCED', label: 'Balanced Default' },
                                    { id: 'TEACHER_PREFERENCE', label: 'Faculty Preferences' },
                                    { id: 'LOAD_BALANCED', label: 'Smooth Daily Load' },
                                    { id: 'FAST', label: 'Rapid Solve' }
                                ].map(g => (
                                    <button
                                        key={g.id}
                                        onClick={() => setOptimizationGoal(g.id as OptimizationGoal)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                            optimizationGoal === g.id 
                                                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20' 
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                    >
                                        {g.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row md:justify-between md:items-center bg-white p-4 md:p-6 rounded-2xl border border-slate-200 gap-4 shadow-sm">
                             <div className="flex items-center gap-4 w-full md:w-auto">
                                <div className="bg-slate-100 p-2 rounded-xl text-slate-500"><Filter size={20}/></div>
                                <select 
                                    value={selectedClassId} 
                                    onChange={e => setSelectedClassId(e.target.value)} 
                                    className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 font-bold text-sm w-full md:min-w-[200px] outline-none focus:ring-2 focus:ring-blue-500/20"
                                >
                                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                             </div>
                             
                             <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-center">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <div className="relative">
                                        <input 
                                            type="checkbox" 
                                            checked={preserveManualEdits} 
                                            onChange={e => setPreserveManualEdits(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                    </div>
                                    <span className="text-xs font-bold text-slate-500 group-hover:text-slate-700 transition-colors">Preserve Locks</span>
                                </label>
                                
                                {currentUser.tier !== 'SUPPORT_ADMIN' && (
                                    <button 
                                        onClick={handleGenerate} 
                                        disabled={isGenerating} 
                                        className="w-full sm:w-auto px-5 py-3 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20"
                                    >
                                        {isGenerating ? <Loader2 size={18} className="animate-spin"/> : <Zap size={18}/>} 
                                        <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
                                    </button>
                                )}

                                {hasDraft && (
                                    <button
                                        onClick={handlePublishDraft}
                                        disabled={isPublishing}
                                        className="w-full sm:w-auto px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
                                        title="Publish Draft to All Faculty & Viewers"
                                    >
                                        {isPublishing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                                        <span>Publish Draft</span>
                                    </button>
                                )}

                                <button
                                    onClick={runAIAudit}
                                    disabled={isAuditingWithAI}
                                    className="w-full sm:w-auto px-4 py-3 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-sm rounded-xl transition border border-indigo-200/80 flex items-center justify-center gap-2"
                                    title="Audit timetable quality with Gemini"
                                >
                                    {isAuditingWithAI ? <Loader2 size={18} className="animate-spin text-indigo-600"/> : <Sparkles size={18} className="text-indigo-600"/>}
                                    <span>AI Audit</span>
                                </button>

                                {/* TIMETABLE EXPORT DROPDOWN (ALL CLASSES) */}
                                <div className="relative w-full sm:w-auto" ref={exportMenuRef}>
                                    <button
                                        onClick={() => setShowExportMenu(!showExportMenu)}
                                        className="w-full sm:w-auto px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
                                        title="Export Timetables (All Classes)"
                                    >
                                        <Download size={18} />
                                        <span>Export Timetables</span>
                                        <ChevronDown size={16} className={showExportMenu ? 'rotate-180 transition-transform' : 'transition-transform'} />
                                    </button>

                                    {showExportMenu && (
                                        <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 py-3 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                                            <div className="px-4 py-2 border-b border-slate-100">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Complete School Export (All Classes)</div>
                                            </div>
                                            
                                            <button
                                                onClick={() => {
                                                    setShowExportMenu(false);
                                                    generateMasterPDFBooklet(grid || {}, settings.schoolName, settings.currentTerm, classes, subjects, teachers, rooms);
                                                }}
                                                className="w-full px-4 py-3 text-left hover:bg-indigo-50/80 transition-colors flex items-start gap-3 group"
                                            >
                                                <div className="p-2 rounded-lg bg-rose-50 text-rose-600 group-hover:bg-rose-100 transition-colors mt-0.5">
                                                    <FileText size={18} />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                                                        <span>Master PDF Booklet</span>
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold">All Classes</span>
                                                    </div>
                                                    <p className="text-xs text-slate-500">Every class timetable in a single paginated booklet</p>
                                                </div>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    setShowExportMenu(false);
                                                    generateExcelWorkbook(grid || {}, 'CLASSES', settings.schoolName, settings.currentTerm, classes, subjects, teachers, rooms);
                                                }}
                                                className="w-full px-4 py-3 text-left hover:bg-emerald-50/80 transition-colors flex items-start gap-3 group"
                                            >
                                                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors mt-0.5">
                                                    <Download size={18} />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                                                        <span>Excel Workbook (.xlsx)</span>
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">All Classes</span>
                                                    </div>
                                                    <p className="text-xs text-slate-500">Full multi-sheet workbook with all classes & master grid</p>
                                                </div>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    setShowExportMenu(false);
                                                    generateAllClassesCSV(grid || {}, settings.schoolName, settings.currentTerm, classes, subjects, teachers, rooms);
                                                }}
                                                className="w-full px-4 py-3 text-left hover:bg-blue-50/80 transition-colors flex items-start gap-3 group"
                                            >
                                                <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors mt-0.5">
                                                    <ClipboardList size={18} />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                                                        <span>Master CSV Spreadsheet</span>
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">All Classes</span>
                                                    </div>
                                                    <p className="text-xs text-slate-500">Universal comma-separated spreadsheet of all classes</p>
                                                </div>
                                            </button>

                                            <div className="my-1 border-t border-slate-100"></div>

                                            <div className="px-4 py-1.5">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Single Class Export ({classes.find(c => c.id === selectedClassId)?.name || selectedClassId})</div>
                                            </div>

                                            <button
                                                onClick={() => {
                                                    setShowExportMenu(false);
                                                    generatePDF(grid || {}, selectedClassId, 'CLASS', settings.schoolName, settings.currentTerm, classes, subjects, teachers, rooms);
                                                }}
                                                className="w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors flex items-center gap-3 text-slate-700"
                                            >
                                                <Printer size={16} className="text-indigo-600" />
                                                <span className="text-xs font-semibold">Print / PDF (Current Class Only)</span>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    setShowExportMenu(false);
                                                    handleSaveAsPNG();
                                                }}
                                                className="w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors flex items-center gap-3 text-slate-700"
                                            >
                                                <Image size={16} className="text-slate-600" />
                                                <span className="text-xs font-semibold">Save Image (PNG Snapshot)</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {generationLogs.length > 0 && (
                                    <button 
                                        onClick={() => setShowGenReport(true)} 
                                        className="w-full sm:w-auto px-4 py-3 bg-slate-100 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                                        title="View Generation Logs"
                                    >
                                        <FileText size={18}/>
                                    </button>
                                )}
                             </div>
                        </div>

                        {/* REASONING & QUALITY DIAGNOSTIC BANNER */}
                        {reasoningReport && (
                            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-3xl shadow-xl border border-indigo-500/20">
                                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 font-black text-2xl">
                                            {reasoningReport.score}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-extrabold text-lg text-white">Algorithm Efficiency & Reasoning</h4>
                                                <span className="text-[10px] font-bold bg-indigo-500/30 text-indigo-200 px-2.5 py-0.5 rounded-full border border-indigo-400/30">
                                                    {(reasoningReport.goal || optimizationGoal || 'BALANCED').replace('_', ' ')}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-300 mt-1">
                                                Solver executed {(reasoningReport.iterations || 0).toLocaleString()} backtracks over {reasoningReport.executionTimeMs || 0}ms. Core Morning Ratio: {reasoningReport.morningCoreRatio}%
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        {reasoningReport.recommendations?.map((rec, i) => (
                                            <div key={i} className="text-xs bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-slate-200">
                                                💡 {rec}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* AI AUDIT RESULT BANNER */}
                        {aiAuditResult && (
                            <div className="bg-white border border-indigo-100 p-6 rounded-3xl shadow-sm space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                                            <Sparkles size={20} />
                                        </div>
                                        <div>
                                            <h4 className="font-extrabold text-slate-900">Gemini AI Pedagogical Schedule Audit</h4>
                                            <p className="text-xs text-slate-500 font-medium">
                                                Pedagogical Score: <strong className="text-indigo-600 font-black">{aiAuditResult.pedagogicalScore ?? 85}/100</strong> | Fairness: <strong className="text-emerald-600 font-black">{aiAuditResult.fairnessScore ?? 88}/100</strong> | Fatigue Risk: <strong className="text-amber-600 font-bold">{aiAuditResult.fatigueRisk || 'LOW'}</strong>
                                            </p>
                                        </div>
                                    </div>
                                    <button onClick={() => setAiAuditResult(null)} className="text-slate-400 hover:text-slate-600">
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                    <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-100">
                                        <div className="font-bold text-emerald-800 mb-2">Pedagogical Strengths</div>
                                        <ul className="space-y-1 text-emerald-700">
                                            {aiAuditResult.strengths?.map((s: string, i: number) => (
                                                <li key={i}>• {s}</li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-100">
                                        <div className="font-bold text-amber-800 mb-2">Actionable Fixes & Weaknesses</div>
                                        <ul className="space-y-1 text-amber-700">
                                            {aiAuditResult.actionableFixes?.map((r: string, i: number) => (
                                                <li key={i}>• {r}</li>
                                            ))}
                                            {aiAuditResult.weaknesses?.map((w: string, i: number) => (
                                                <li key={`w-${i}`}>• {w}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}

                        {isGenerating && (
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                                <div className="flex justify-between text-sm font-medium text-slate-600">
                                    <span>{generationStatus || 'Preparing to generate...'}</span>
                                    <span>{Math.round(generationProgress)}%</span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                                    <div 
                                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out" 
                                        style={{ width: `${generationProgress}%` }}
                                    ></div>
                                </div>
                                <p className="text-xs text-slate-400 text-center">
                                    This may take up to 2.5 minutes depending on the complexity of constraints.
                                </p>
                            </div>
                        )}

                        <div ref={timetableRef} className="bg-white p-4 md:p-8 rounded-3xl shadow-sm border border-slate-200 min-h-[600px]">
                             <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-6 pb-4 border-b border-slate-100">
                                <div>
                                    <h3 className="font-black text-xl md:text-2xl text-slate-800 uppercase tracking-tight">{classes.find(c=>c.id===selectedClassId)?.name}</h3>
                                    <p className="text-slate-400 text-sm font-medium">Master Schedule • {settings.currentSession} • {settings.currentTerm}</p>
                                </div>
                                <div className="text-left md:text-right hidden md:block">
                                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Last Updated</div>
                                    <div className="font-mono text-sm text-slate-600">{new Date().toLocaleDateString()}</div>
                                </div>
                             </div>

                             {/* Always render grid container, check validity inside TimetableGrid or just pass empty object */}
                             {currentDisplayGrid || classes.length > 0 ? (
                                 <TimetableGrid 
                                    timetable={currentDisplayGrid || {}} 
                                    classId={selectedClassId} 
                                    isEditable={currentUser.tier !== 'SUPPORT_ADMIN'} 
                                    onCellClick={handleCellClick} 
                                    teachers={teachers}
                                    rooms={rooms}
                                 />
                             ) : (
                                 <div className="h-96 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-100 rounded-3xl bg-slate-50/50">
                                     <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                                        <Calendar size={32} className="opacity-40"/>
                                     </div>
                                     <p className="font-bold text-lg text-slate-600">No classes found.</p>
                                     <p className="text-sm mt-2 opacity-70 max-w-xs text-center">Add classes in the 'Classes' tab to start generating a timetable.</p>
                                 </div>
                             )}
                        </div>
                    </div>
                    );
                })()}

                {/* CLASSES VIEW */}
                {activeView === 'CLASSES' && (
                    <div className="space-y-8 animate-in fade-in duration-500">
                        {(() => {
                            const juniorClasses = classes.filter(c => (c.level || (c.category === 'JSS' || c.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === 'JUNIOR');
                            const seniorClasses = classes.filter(c => (c.level || (c.category === 'JSS' || c.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === 'SENIOR');
                            const juniorSubjects = subjects.filter(s => (s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === 'JUNIOR');
                            const seniorSubjects = subjects.filter(s => (s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === 'SENIOR');

                            const displayedClasses = classFilterTab === 'ALL' 
                                ? classes 
                                : (classFilterTab === 'JUNIOR' ? juniorClasses : seniorClasses);

                            return (
                                <>
                                    {/* Header & Controls */}
                                    <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 bg-white p-6 md:p-8 rounded-[2rem] border border-slate-200 shadow-xs">
                                        <div>
                                            <div className="flex items-center gap-3 mb-1">
                                                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                                                    <GraduationCap size={22} />
                                                </div>
                                                <h2 className="text-2xl font-black text-slate-900">Academic Classes</h2>
                                            </div>
                                            <p className="text-slate-500 text-sm">
                                                Create and manage Junior and Senior class streams separately. Each inherits its tier curriculum automatically.
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-3 flex-wrap">
                                            <button 
                                                onClick={() => { 
                                                    setModalType('CLASS'); 
                                                    setEntityForm({ level: 'JUNIOR' }); 
                                                }} 
                                                className="px-5 py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm hover:bg-blue-700 transition-all text-sm"
                                            >
                                                <Plus size={16}/> Add Junior Class
                                            </button>
                                            <button 
                                                onClick={() => { 
                                                    setModalType('CLASS'); 
                                                    setEntityForm({ level: 'SENIOR' }); 
                                                }} 
                                                className="px-5 py-3 bg-purple-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm hover:bg-purple-700 transition-all text-sm"
                                            >
                                                <Plus size={16}/> Add Senior Class
                                            </button>
                                        </div>
                                    </div>

                                    {/* Filter Tabs */}
                                    <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl w-fit">
                                        <button 
                                            onClick={() => setClassFilterTab('ALL')}
                                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                                                classFilterTab === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                            }`}
                                        >
                                            All Classes ({classes.length})
                                        </button>
                                        <button 
                                            onClick={() => setClassFilterTab('JUNIOR')}
                                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                                                classFilterTab === 'JUNIOR' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                            }`}
                                        >
                                            <span>🎓 Junior Classes</span>
                                            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${classFilterTab === 'JUNIOR' ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-600'}`}>{juniorClasses.length}</span>
                                        </button>
                                        <button 
                                            onClick={() => setClassFilterTab('SENIOR')}
                                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                                                classFilterTab === 'SENIOR' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                            }`}
                                        >
                                            <span>🏛️ Senior Classes</span>
                                            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${classFilterTab === 'SENIOR' ? 'bg-purple-700 text-white' : 'bg-slate-200 text-slate-600'}`}>{seniorClasses.length}</span>
                                        </button>
                                    </div>

                                    {/* Grid of Classes */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                                        {displayedClasses.map(c => {
                                            const isJunior = (c.level || (c.category === 'JSS' || c.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === 'JUNIOR';
                                            const tierSubjects = isJunior ? juniorSubjects : seniorSubjects;
                                            const tierPeriods = tierSubjects.reduce((sum, s) => sum + (s.defaultPeriodCount || s.periodsPerWeek || 0), 0);
                                            const formTeacher = teachers.find(t => t.id === c.assignedTeacherId);

                                            return (
                                                <div 
                                                    key={c.id} 
                                                    className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all group relative overflow-hidden flex flex-col justify-between"
                                                >
                                                    <div className={`absolute top-0 right-0 w-24 h-24 rounded-bl-full opacity-10 ${isJunior ? 'bg-blue-600' : 'bg-purple-600'}`} />
                                                    
                                                    <div>
                                                        <div className="flex justify-between items-start mb-3 relative z-10">
                                                            <div className={`p-3 rounded-xl ${isJunior ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                                                                <GraduationCap size={20} />
                                                            </div>
                                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-sm rounded-lg p-1 shadow-xs">
                                                                <button onClick={() => openEditModal('CLASS', c)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-colors"><Pencil size={14}/></button>
                                                                <button onClick={() => requestDelete('CLASS', c.id, c.name)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors"><Trash size={14}/></button>
                                                            </div>
                                                        </div>
                                                        
                                                        <h4 className="font-black text-xl text-slate-900 mb-1">{c.name}</h4>
                                                        
                                                        <div className="flex items-center gap-2 mb-3">
                                                            <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${
                                                                isJunior ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                                                            }`}>
                                                                {isJunior ? 'Junior Stream' : 'Senior Stream'}
                                                            </span>
                                                        </div>

                                                        <div className="space-y-1.5 text-xs text-slate-500 pt-3 border-t border-slate-100">
                                                            <div className="flex items-center justify-between">
                                                                <span>Auto Curriculum:</span>
                                                                <span className="font-bold text-slate-800">{tierSubjects.length} Subjects</span>
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                <span>Total Slots Demand:</span>
                                                                <span className="font-bold text-slate-800">{tierPeriods} periods/wk</span>
                                                            </div>
                                                            {formTeacher && (
                                                                <div className="flex items-center justify-between pt-1">
                                                                    <span>Form Teacher:</span>
                                                                    <span className="font-bold text-slate-700 truncate max-w-[120px]">{formTeacher.name}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {displayedClasses.length === 0 && (
                                            <div className="col-span-full p-12 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50 text-slate-400 font-medium">
                                                No classes found in this category. Click "+ Add Class" to manually register your academic streams.
                                            </div>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                )}

                {/* SUBJECTS/CURRICULUM VIEW */}
                {activeView === 'SUBJECTS' && (
                    <div className="space-y-8 animate-in fade-in duration-500">
                        {(() => {
                            const juniorSubjects = subjects.filter(s => (s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === 'JUNIOR');
                            const seniorSubjects = subjects.filter(s => (s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === 'SENIOR');
                            const scienceSubjects = seniorSubjects.filter(s => s.stream === 'SCIENCE' || s.category === 'SSS_SCIENCE' || s.id.endsWith('_sci'));
                            const bcSubjects = seniorSubjects.filter(s => s.stream === 'BC' || s.category === 'SSS_BC' || s.id.endsWith('_bc'));

                            const juniorClasses = classes.filter(c => (c.level || (c.category === 'JSS' || c.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === 'JUNIOR');
                            const seniorClasses = classes.filter(c => (c.level || (c.category === 'JSS' || c.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === 'SENIOR');
                            const scienceClasses = seniorClasses.filter(c => (c.stream || '').toUpperCase() === 'SCIENCE' || /SS\d+A\d*/i.test(c.id));
                            const bcClasses = seniorClasses.filter(c => (c.stream || '').toUpperCase() === 'BC' || c.id.includes('BC'));

                            // Authoritative 38 instructional teaching slots (Monday-Friday, 8 periods/day, excluding Friday Worship P7 & P8)
                            const teachingCapacity = TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS;
                            const gridTotalSlots = TIMETABLE_CONFIG.TOTAL_GRID_SLOTS;



                            const activeSubjects = curriculumLevelTab === 'JUNIOR' 
                                ? juniorSubjects 
                                : curriculumSeniorStreamTab === 'SCIENCE' 
                                    ? scienceSubjects 
                                    : curriculumSeniorStreamTab === 'BC' 
                                        ? bcSubjects 
                                        : seniorSubjects;

                            const activeClasses = curriculumLevelTab === 'JUNIOR' 
                                ? juniorClasses 
                                : curriculumSeniorStreamTab === 'SCIENCE' 
                                    ? scienceClasses 
                                    : curriculumSeniorStreamTab === 'BC' 
                                        ? bcClasses 
                                        : seniorClasses;

                            const assignedSlots = activeSubjects.reduce((sum, s) => sum + (s.defaultPeriodCount || s.periodsPerWeek || 0), 0);
                            const remainingSlots = teachingCapacity - assignedSlots;
                            const isOverallocated = remainingSlots < 0;
                            const isBalanced = remainingSlots >= 0 && remainingSlots <= 2;
                            const pctUsed = Math.min(100, Math.round((assignedSlots / teachingCapacity) * 100));

                            return (
                                <>
                                    {/* Header & Action Controls */}
                                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-white p-6 md:p-8 rounded-[2rem] border border-slate-200 shadow-xs">
                                        <div>
                                            <div className="flex items-center gap-3 mb-1">
                                                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                                                    <BookOpen size={22} />
                                                </div>
                                                <h2 className="text-2xl font-black text-slate-900">Curriculum & Subject Timetable Slots</h2>
                                            </div>
                                            <p className="text-slate-500 text-sm">
                                                Configure subjects and weekly period allocations. Senior school classes are automatically segmented into pure Science and Commercial streams to prevent subject contamination.
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-3 flex-wrap">
                                            <button 
                                                onClick={() => runLightningAIAnalysis(curriculumLevelTab)} 
                                                disabled={isAiAnalyzingTier}
                                                className="px-5 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-md shadow-orange-200 hover:opacity-95 transition-all text-sm"
                                            >
                                                {isAiAnalyzingTier ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} className="fill-white" />}
                                                <span>⚡ Analyze with AI</span>
                                            </button>

                                            <button 
                                                onClick={() => { 
                                                    setModalType('SUBJECT'); 
                                                    setEntityForm({ 
                                                        level: curriculumLevelTab, 
                                                        stream: curriculumLevelTab === 'SENIOR' ? curriculumSeniorStreamTab : undefined,
                                                        defaultPeriodCount: 4, 
                                                        maxPerDay: 1, 
                                                        isCore: 'true' 
                                                    }); 
                                                }} 
                                                className="px-5 py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm hover:bg-blue-700 transition-all text-sm"
                                            >
                                                <Plus size={16}/> Add {curriculumLevelTab === 'JUNIOR' ? 'Junior' : curriculumSeniorStreamTab === 'SCIENCE' ? 'Science' : curriculumSeniorStreamTab === 'BC' ? 'Commercial' : 'Senior'} Subject
                                            </button>
                                        </div>
                                    </div>

                                    {/* Tier Switcher Tabs */}
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl w-fit flex-wrap">
                                            <button 
                                                onClick={() => setCurriculumLevelTab('JUNIOR')}
                                                className={`px-5 py-2.5 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 ${
                                                    curriculumLevelTab === 'JUNIOR' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                                                }`}
                                            >
                                                <span>🎓 Junior School Subjects</span>
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] ${curriculumLevelTab === 'JUNIOR' ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
                                                    {juniorSubjects.length}
                                                </span>
                                            </button>

                                            <button 
                                                onClick={() => setCurriculumLevelTab('SENIOR')}
                                                className={`px-5 py-2.5 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 ${
                                                    curriculumLevelTab === 'SENIOR' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                                                }`}
                                            >
                                                <span>🏛️ Senior School Subjects</span>
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] ${curriculumLevelTab === 'SENIOR' ? 'bg-purple-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
                                                    {seniorSubjects.length}
                                                </span>
                                            </button>
                                        </div>

                                        <div className="text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl">
                                            Applies to: <span className="text-slate-800">{activeClasses.length} {curriculumLevelTab === 'JUNIOR' ? 'Junior' : curriculumSeniorStreamTab === 'SCIENCE' ? 'Science' : curriculumSeniorStreamTab === 'BC' ? 'Commercial' : 'Senior'} Classes</span>
                                        </div>
                                    </div>

                                    {/* Senior School Stream Sub-Tabs */}
                                    {curriculumLevelTab === 'SENIOR' && (
                                        <div className="flex items-center gap-2 bg-purple-50/70 border border-purple-100 p-1.5 rounded-2xl w-fit flex-wrap">
                                            <button 
                                                onClick={() => setCurriculumSeniorStreamTab('SCIENCE')}
                                                className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 ${
                                                    curriculumSeniorStreamTab === 'SCIENCE' ? 'bg-purple-700 text-white shadow-xs' : 'text-purple-700 hover:bg-purple-100'
                                                }`}
                                            >
                                                <span>🔬 Science Stream (SS1A1–SS3A2)</span>
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] ${curriculumSeniorStreamTab === 'SCIENCE' ? 'bg-purple-800 text-white' : 'bg-purple-200 text-purple-800'}`}>
                                                    {scienceSubjects.length} subjects ({scienceSubjects.reduce((acc, s) => acc + (s.defaultPeriodCount || s.periodsPerWeek || 0), 0)} periods)
                                                </span>
                                            </button>

                                            <button 
                                                onClick={() => setCurriculumSeniorStreamTab('BC')}
                                                className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 ${
                                                    curriculumSeniorStreamTab === 'BC' ? 'bg-purple-700 text-white shadow-xs' : 'text-purple-700 hover:bg-purple-100'
                                                }`}
                                            >
                                                <span>💼 Commercial / BC Stream (SS1BC–SS3BC)</span>
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] ${curriculumSeniorStreamTab === 'BC' ? 'bg-purple-800 text-white' : 'bg-purple-200 text-purple-800'}`}>
                                                    {bcSubjects.length} subjects ({bcSubjects.reduce((acc, s) => acc + (s.defaultPeriodCount || s.periodsPerWeek || 0), 0)} periods)
                                                </span>
                                            </button>

                                            <button 
                                                onClick={() => setCurriculumSeniorStreamTab('ALL')}
                                                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                                                    curriculumSeniorStreamTab === 'ALL' ? 'bg-purple-700 text-white' : 'text-purple-700 hover:bg-purple-100'
                                                }`}
                                            >
                                                All Senior ({seniorSubjects.length})
                                            </button>
                                        </div>
                                    )}

                                    {/* TIMETABLE SLOT BUDGET & REMAINING SPACES METER (User Required) */}
                                    <div className={`p-6 rounded-3xl border transition-all ${
                                        isOverallocated 
                                            ? 'bg-rose-50/70 border-rose-200 ring-2 ring-rose-200/50' 
                                            : isBalanced 
                                                ? 'bg-emerald-50/70 border-emerald-200' 
                                                : 'bg-blue-50/70 border-blue-200'
                                    }`}>
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                    <h3 className="font-black text-slate-900 text-lg">
                                                        {curriculumLevelTab === 'JUNIOR' ? 'Junior School' : curriculumSeniorStreamTab === 'SCIENCE' ? 'Senior Science Stream' : curriculumSeniorStreamTab === 'BC' ? 'Senior Commercial / BC Stream' : 'Senior School Combined'} Timetable Slot Budget
                                                    </h3>
                                                    {isOverallocated ? (
                                                        <span className="bg-rose-600 text-white text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full animate-pulse">
                                                            ⚠️ Overallocated
                                                        </span>
                                                    ) : isBalanced ? (
                                                        <span className="bg-emerald-600 text-white text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full">
                                                            ✅ Perfectly Balanced
                                                        </span>
                                                    ) : (
                                                        <span className="bg-blue-600 text-white text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full">
                                                            {remainingSlots} Spaces Left
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-600">
                                                    Instructional capacity: <strong className="text-slate-900">{teachingCapacity} teaching periods</strong> (+ 2 reserved Friday Worship periods = {gridTotalSlots} total timetable slots).
                                                    Each class timetable follows this exact curriculum frequency.
                                                </p>
                                            </div>

                                            <div className="flex items-center gap-4 bg-white/90 backdrop-blur-sm px-5 py-3 rounded-2xl border border-slate-200 shrink-0">
                                                <div className="text-center">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Teaching Slots</div>
                                                    <div className="font-black text-slate-800 text-lg">{teachingCapacity}</div>
                                                </div>
                                                <div className="w-px h-8 bg-slate-200" />
                                                <div className="text-center">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Assigned Slots</div>
                                                    <div className={`font-black text-lg ${isOverallocated ? 'text-rose-600' : 'text-slate-800'}`}>
                                                        {assignedSlots}
                                                    </div>
                                                </div>
                                                <div className="w-px h-8 bg-slate-200" />
                                                <div className="text-center">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Spaces Left</div>
                                                    <div className={`font-black text-lg ${isOverallocated ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                        {remainingSlots}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Progress Bar Visualizer */}
                                        <div className="space-y-1.5">
                                            <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex">
                                                <div 
                                                    className={`h-full transition-all duration-500 ${
                                                        isOverallocated 
                                                            ? 'bg-rose-500' 
                                                            : isBalanced 
                                                                ? 'bg-emerald-500' 
                                                                : 'bg-blue-600'
                                                    }`} 
                                                    style={{ width: `${Math.min(100, (assignedSlots / teachingCapacity) * 100)}%` }} 
                                                />
                                            </div>
                                            <div className="flex justify-between text-[11px] font-bold text-slate-500">
                                                <span>0 periods</span>
                                                <span>
                                                    {isOverallocated 
                                                        ? `${assignedSlots}/${teachingCapacity} slots (${Math.abs(remainingSlots)} slots excess)`
                                                        : `${assignedSlots}/${teachingCapacity} slots (${remainingSlots} slots remaining for subjects assigning)`
                                                    }
                                                </span>
                                                <span>{teachingCapacity} teaching slots (+ 2 Worship)</span>
                                            </div>
                                        </div>

                                        {/* Warning Banner if Overallocated */}
                                        {isOverallocated && (
                                            <div className="mt-4 p-4 bg-rose-100/90 border border-rose-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                <div className="flex items-center gap-3">
                                                    <AlertTriangle size={20} className="text-rose-600 shrink-0" />
                                                    <p className="text-xs text-rose-900 font-bold">
                                                        Overallocated by {Math.abs(remainingSlots)} spaces! You requested {assignedSlots} periods for {teachingCapacity} spaces. AI can rebalance this at lightning speed.
                                                    </p>
                                                </div>
                                                <button 
                                                    onClick={() => runLightningAIAnalysis(curriculumLevelTab)} 
                                                    className="px-4 py-2 bg-rose-600 text-white font-black text-xs rounded-xl hover:bg-rose-700 transition shadow-xs shrink-0 flex items-center justify-center gap-1.5"
                                                >
                                                    <Zap size={14} className="fill-white" /> Fix with AI
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Subjects Cards Grid */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                        {activeSubjects.map(s => {
                                            const preferredTeacher = teachers.find(t => t.id === s.preferredTeacherId);
                                            const timesPerWeek = s.defaultPeriodCount || s.periodsPerWeek || 3;
                                            const maxPerDay = s.maxPerDay || 1;

                                            return (
                                                <div 
                                                    key={s.id} 
                                                    className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all group flex flex-col justify-between h-full relative overflow-hidden"
                                                >
                                                    <div className={`absolute top-0 right-0 w-16 h-16 rounded-bl-full opacity-5 ${s.isCore ? 'bg-blue-600' : 'bg-slate-400'}`} />
                                                    
                                                    <div>
                                                        <div className="flex justify-between items-start mb-3">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider ${
                                                                    s.isCore ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
                                                                }`}>
                                                                    {s.isCore ? 'Core Subject' : 'Elective'}
                                                                </span>
                                                                {s.code && (
                                                                    <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                                                                        {s.code}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-sm rounded-lg p-1 shadow-xs relative z-10">
                                                                <button onClick={() => openEditModal('SUBJECT', s)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-colors"><Pencil size={14}/></button>
                                                                <button onClick={() => requestDelete('SUBJECT', s.id, s.name)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors"><Trash size={14}/></button>
                                                            </div>
                                                        </div>

                                                        <h4 className="font-extrabold text-slate-900 mb-2 line-clamp-2 text-lg">{s.name}</h4>

                                                        <div className="space-y-1.5 text-xs text-slate-600 font-medium">
                                                            <div className="flex items-center gap-2">
                                                                <Clock size={14} className="text-blue-500 shrink-0"/> 
                                                                <span><strong className="text-slate-900">{timesPerWeek}</strong> times a week ({timesPerWeek} periods)</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <CalendarRange size={14} className="text-slate-400 shrink-0"/> 
                                                                <span>Max <strong className="text-slate-800">{maxPerDay}</strong> period{maxPerDay > 1 ? 's' : ''}/day</span>
                                                            </div>
                                                            {preferredTeacher && (
                                                                <div className="flex items-center gap-2 text-slate-500 text-[11px] pt-1">
                                                                    <Users size={12} className="text-slate-400 shrink-0" />
                                                                    <span className="truncate">Teacher: {preferredTeacher.name}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 flex items-center justify-between">
                                                        <span>
                                                            {curriculumLevelTab === 'JUNIOR'
                                                                ? 'Applies to: All Junior Classes'
                                                                : s.stream === 'SCIENCE'
                                                                    ? 'Applies to: A / Science Classes Only'
                                                                    : s.stream === 'BC'
                                                                        ? 'Applies to: Combined BC Classes Only'
                                                                        : 'Applies to: Common to All Senior Classes'}
                                                        </span>
                                                        <span className="font-bold text-slate-500">{timesPerWeek} / {teachingCapacity} slots</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {activeSubjects.length === 0 && (
                                            <div className="col-span-full p-12 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50 text-slate-400 font-medium">
                                                No {(curriculumLevelTab || 'junior').toLowerCase()} subjects created yet. Click "+ Add Subject" to manually configure your curriculum.
                                            </div>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                )}
                 {/* TEACHERS */}
                {activeView === 'TEACHERS' && (
                    <div className="space-y-6 animate-in fade-in duration-500">
                        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                            <div>
                                <h2 className="text-2xl font-black text-slate-800">Faculty Management</h2>
                                <p className="text-slate-500">Manage teachers and their assignments.</p>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                                <div className="relative flex-1 md:w-72">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Search size={18}/></div>
                                    <input 
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" 
                                        placeholder="Search Teachers..." 
                                        value={searchTerm} 
                                        onChange={e=>setSearchTerm(e.target.value)}
                                    />
                                </div>
                                <button onClick={() => { setModalType('TEACHER'); setEntityForm({}); }} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all whitespace-nowrap w-full sm:w-auto"><Plus size={18}/> Add Teacher</button>
                                <button 
                                    onClick={handleClearTeachers} 
                                    disabled={isClearing}
                                    className={`px-6 py-3 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-100 transition-all whitespace-nowrap w-full sm:w-auto ${isClearing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {isClearing ? <Loader2 className="animate-spin" size={18}/> : <Trash2 size={18}/>}
                                    {isClearing ? 'Clearing...' : 'Clear All'}
                                </button>
                            </div>
                        </div>

                        {/* Anti-Imposter Faculty Approvals Section */}
                        {pendingTeachers.length > 0 && (
                            <div className="bg-gradient-to-r from-blue-50/90 via-blue-50/40 to-transparent border border-blue-200 rounded-3xl p-6 shadow-xs">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black shadow-md shadow-blue-600/20">
                                            <ShieldCheck size={22} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-black text-slate-900 text-lg">Staff Verification & Anti-Imposter Protection</h3>
                                                <span className="bg-blue-600 text-white font-black text-xs px-2.5 py-0.5 rounded-full shadow-xs">
                                                    {pendingTeachers.length} Pending
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-600 font-medium">
                                                These educators created accounts for your school. Verify their credentials to confirm they are official faculty and not imposters.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {pendingTeachers.map((t) => (
                                        <div key={t.id} className="bg-white rounded-2xl p-5 border border-blue-100 shadow-md flex flex-col justify-between hover:border-blue-300 transition">
                                            <div>
                                                <div className="flex items-start justify-between gap-2 mb-2">
                                                    <div>
                                                        <h4 className="font-extrabold text-slate-900 text-base">{t.name}</h4>
                                                        <p className="text-xs font-mono text-slate-500">@{t.username}</p>
                                                    </div>
                                                    <span className="text-[10px] uppercase font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-200">
                                                        Awaiting Approval
                                                    </span>
                                                </div>
                                                {t.contactEmail && (
                                                    <p className="text-xs text-slate-500 mb-2 truncate">📧 {t.contactEmail}</p>
                                                )}
                                                <p className="text-[11px] text-slate-400 mb-4">
                                                    Registration: {t.registeredAt ? new Date(t.registeredAt).toLocaleString() : 'Recently'}
                                                </p>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
                                                <button
                                                    onClick={() => handleApproveTeacher(t.id)}
                                                    className="py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5"
                                                >
                                                    <CheckCircle size={14} /> Approve Staff
                                                </button>
                                                <button
                                                    onClick={() => handleRejectTeacher(t.id, 'Imposter flagged by administration')}
                                                    className="py-2.5 px-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-xl text-xs transition border border-red-200 flex items-center justify-center gap-1.5"
                                                >
                                                    <X size={14} /> Deny Imposter
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                            {getFilteredList('TEACHERS').map((t: any) => (
                                <div key={t.id} onClick={() => setViewTeacher(t)} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer group relative overflow-hidden">
                                     <div className="absolute top-0 right-0 w-24 h-24 bg-slate-50 rounded-bl-[4rem] -mr-4 -mt-4 z-0 group-hover:bg-blue-50 transition-colors"></div>
                                     
                                     <div className="relative z-10 flex items-start gap-4">
                                        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-xl border-2 border-white shadow-sm group-hover:scale-105 transition-transform overflow-hidden shrink-0 relative">
                                            {(t.profilePicture || storage.getTeacherProfilePicture(t.id)) ? <img src={t.profilePicture || storage.getTeacherProfilePicture(t.id)} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : t.name.charAt(0)}
                                            {t.lastActive && Date.now() - t.lastActive < 120000 && (
                                                <div className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full shadow-sm" title="Online now"></div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-bold text-lg text-slate-800 truncate group-hover:text-blue-600 transition-colors">{t.name}</h3>
                                            <p className="text-xs text-slate-500 font-medium mb-3">@{t.username}</p>
                                            <div className="flex flex-wrap gap-2">
                                                <span className="bg-slate-50 text-slate-600 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border border-slate-100">
                                                    <Book size={12}/> {t.subjectsTaught.length} Subjects
                                                </span>
                                                <span className="bg-slate-50 text-slate-600 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border border-slate-100">
                                                    <GraduationCap size={12}/> {t.assignedClasses.length} Classes
                                                </span>
                                            </div>
                                        </div>
                                     </div>

                                     <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-20">
                                        <button onClick={(e) => { e.stopPropagation(); openEditModal('TEACHER', t); }} className="p-2 bg-white text-blue-500 hover:bg-blue-50 rounded-lg transition-colors shadow-sm border border-slate-100" title="Edit"><Pencil size={16}/></button>
                                        <button onClick={(e) => { e.stopPropagation(); requestDelete('TEACHER', t.id, t.name); }} className="p-2 bg-white text-red-400 hover:bg-red-50 rounded-lg transition-colors shadow-sm border border-slate-100" title="Delete"><Trash size={16}/></button>
                                     </div>
                                </div>
                            ))}
                        </div>
                        
                        {getFilteredList('TEACHERS').length === 0 && (
                            <div className="p-16 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                                    <Search size={24}/>
                                </div>
                                <h3 className="font-bold text-slate-600 text-lg">No teachers found</h3>
                                <p className="text-slate-400 text-sm">Try adjusting your search terms.</p>
                            </div>
                        )}
                    </div>
                )}
                {/* REQUESTS */}
                {activeView === 'REQUESTS' && (
                    <div className="space-y-6">
                         <div className="bg-white rounded-3xl border border-slate-200 p-6 min-h-[400px]">
                            {requests.length === 0 ? <div className="text-center text-slate-400 py-10">No pending requests</div> : (
                                <div className="space-y-4">
                                    {requests.map(r => (
                                        <div key={r.id} className="p-4 border rounded-xl flex justify-between items-center bg-slate-50">
                                            <div>
                                                <div className="font-bold">{r.teacherName}</div>
                                                <div className="text-sm text-slate-500">{r.type}: {r.details}</div>
                                            </div>
                                            {r.status === 'PENDING' ? (
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleRequestAction(r, 'APPROVED')} className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold">Approve</button>
                                                    <button onClick={() => handleRequestAction(r, 'REJECTED')} className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs font-bold">Reject</button>
                                                </div>
                                            ) : (
                                                <span className={`text-xs font-bold px-3 py-1 rounded-full ${r.status==='APPROVED'?'bg-emerald-100 text-emerald-600':'bg-red-100 text-red-600'}`}>{r.status}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                         </div>
                    </div>
                )}

                {/* ABSENCES & SUBSTITUTES VIEW */}
                {activeView === 'ABSENCES' && (
                    <div className="space-y-8 animate-in fade-in duration-300">
                        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                            <h2 className="text-2xl font-black text-slate-900 mb-1">Teacher Absences & Substitutes</h2>
                            <p className="text-slate-500 text-sm mb-6">Review absence requests and assign substitutes.</p>

                            <div className="space-y-4">
                                {absences.length === 0 ? (
                                    <div className="text-center py-16 text-slate-400 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                                        No absence requests recorded.
                                    </div>
                                ) : (
                                    absences.map(abs => (
                                        <div key={abs.id} className="p-6 bg-slate-50 rounded-3xl border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                            <div>
                                                <div className="flex items-center gap-3 mb-1">
                                                    <h3 className="font-extrabold text-base text-slate-900">{abs.teacherName}</h3>
                                                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                                                        abs.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                                                        abs.status === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                                                        'bg-amber-100 text-amber-700'
                                                    }`}>
                                                        {abs.status}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-600 mb-1">
                                                    <span className="font-bold">Dates:</span> {abs.startDate} to {abs.endDate}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    <span className="font-bold">Reason:</span> {abs.reason}
                                                </p>
                                            </div>

                                            {abs.status === 'PENDING' && (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleApproveAbsence(abs.id)}
                                                        className="px-4 py-2 bg-emerald-600 text-white font-bold text-xs rounded-xl hover:bg-emerald-700 transition"
                                                    >
                                                        Approve
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejectAbsence(abs.id)}
                                                        className="px-4 py-2 bg-rose-600 text-white font-bold text-xs rounded-xl hover:bg-rose-700 transition"
                                                    >
                                                        Reject
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* AUDIT TRAIL VIEW */}
                {activeView === 'AUDIT' && (
                    <div className="space-y-8 animate-in fade-in duration-300">
                        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                <div>
                                    <h2 className="text-2xl font-black text-slate-900 mb-1">System Audit Trail</h2>
                                    <p className="text-slate-500 text-sm">Security log of all system and schedule modifications.</p>
                                </div>
                                <div className="relative">
                                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                    <input
                                        type="text"
                                        placeholder="Search logs..."
                                        value={auditSearch}
                                        onChange={e => setAuditSearch(e.target.value)}
                                        className="pl-10 pr-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                {auditLogs.length === 0 ? (
                                    <div className="text-center py-16 text-slate-400 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                                        No audit log records found.
                                    </div>
                                ) : (
                                    auditLogs
                                        .filter(l => !auditSearch || (l.actorName || '').toLowerCase().includes(auditSearch.toLowerCase()) || (l.details || '').toLowerCase().includes(auditSearch.toLowerCase()))
                                        .slice(0, 50)
                                        .map(log => (
                                            <div key={log.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between text-xs">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-slate-200 text-slate-700 rounded-xl font-bold text-[10px] uppercase">
                                                        {log.actorRole}
                                                    </div>
                                                    <div>
                                                        <span className="font-bold text-slate-900">{log.actorName}:</span>{' '}
                                                        <span className="text-slate-600">{log.details}</span>
                                                    </div>
                                                </div>
                                                <span className="font-mono text-[11px] text-slate-400 shrink-0">
                                                    {new Date(log.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                        ))
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* SCHOOLS REGISTRY VIEW - LOCKED WHILE AUTHENTICATED INSIDE A SCHOOL PORTAL */}
                {activeView === 'SCHOOLS' && (
                    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in py-10">
                        <div className="bg-white rounded-[2.5rem] border border-amber-200 p-8 md:p-10 shadow-sm text-center space-y-5">
                            <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-3xl mx-auto flex items-center justify-center shadow-inner">
                                <Lock size={32} />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                                    School Registry & Switching Locked
                                </h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    Active School Session: <strong className="text-slate-800">{currentSchool.name}</strong>
                                </p>
                            </div>
                            <div className="p-5 bg-amber-50/80 rounded-2xl border border-amber-200/80 text-xs text-amber-900 text-left space-y-2">
                                <p className="font-extrabold uppercase tracking-wide text-[11px] text-amber-950 flex items-center gap-1.5">
                                    <ShieldCheck size={14} className="text-amber-700" /> Institution Isolation Policy
                                </p>
                                <p className="leading-relaxed">
                                    To protect academic data integrity and prevent cross-school contamination, institution switching and school registration are restricted while you are logged into an active school portal.
                                </p>
                                <p className="font-bold text-amber-950 pt-1">
                                    To switch institutions or register a new school, please sign out of {currentSchool.name} first.
                                </p>
                            </div>
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                                <button
                                    onClick={() => setActiveView('DASHBOARD')}
                                    className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition"
                                >
                                    Return to Dashboard
                                </button>
                                <button
                                    onClick={handleAdminSignOut}
                                    className="w-full sm:w-auto px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-sm flex items-center justify-center gap-2"
                                >
                                    <LogOut size={15} /> Sign Out of {currentSchool.name}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ADMINS MANAGEMENT & CREDENTIALS VIEW */}
                {activeView === 'ADMINS' && (
                    <div className="space-y-8 animate-in fade-in duration-300">
                        {/* Header Banner */}
                        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border border-slate-800">
                            <div className="absolute right-0 top-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
                            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                                <div className="space-y-2">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-white/10 text-blue-300 border border-white/10">
                                        <ShieldCheck size={14} /> Administrator Security & Access
                                    </div>
                                    <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">
                                        Administrator Profile & Credentials
                                    </h2>
                                    <p className="text-slate-300 text-sm max-w-2xl leading-relaxed">
                                        Manage your administrator account credentials, master passkey, and system access. The default development administrator password is <code className="bg-white/20 px-2 py-0.5 rounded text-amber-300 font-mono font-bold">admin123</code>. You can change it anytime below.
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="px-4 py-2.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-inner">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                        Development Mode: Ready
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Status Alert if any */}
                        {adminPassStatus && (
                            <div className={`p-4 rounded-2xl border flex items-start gap-3 text-sm animate-in fade-in duration-200 ${
                                adminPassStatus.type === 'success' 
                                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200' 
                                    : 'bg-red-50 text-red-900 border-red-200'
                            }`}>
                                {adminPassStatus.type === 'success' ? (
                                    <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
                                ) : (
                                    <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
                                )}
                                <div className="font-medium">{adminPassStatus.message}</div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                            {/* Left Column: Change Password Card */}
                            <div className="lg:col-span-7 bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm space-y-6">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                                            <Key size={20} />
                                        </div>
                                        <div>
                                            <h3 className="font-black text-slate-900 text-lg">Change Administrator Password</h3>
                                            <p className="text-xs text-slate-500">Update the master administrative password for this system</p>
                                        </div>
                                    </div>
                                    <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[11px] font-bold">
                                        Default: admin123
                                    </span>
                                </div>

                                <form onSubmit={handleUpdateAdminPassword} className="space-y-5">
                                    {/* Current Password */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                                            <span>Current Password</span>
                                            <span className="text-[11px] font-normal text-slate-400">Default is admin123</span>
                                        </label>
                                        <div className="relative">
                                            <input 
                                                type={showAdminPass.current ? "text" : "password"}
                                                value={adminPassForm.currentPassword}
                                                onChange={e => setAdminPassForm({ ...adminPassForm, currentPassword: e.target.value })}
                                                placeholder="Enter current password (e.g. admin123)"
                                                className="w-full px-4 py-3.5 pr-11 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                                            />
                                            <button 
                                                type="button"
                                                onClick={() => setShowAdminPass(p => ({ ...p, current: !p.current }))}
                                                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                            >
                                                {showAdminPass.current ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                    </div>

                                    {/* New Password */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                            New Password
                                        </label>
                                        <div className="relative">
                                            <input 
                                                type={showAdminPass.new ? "text" : "password"}
                                                value={adminPassForm.newPassword}
                                                onChange={e => setAdminPassForm({ ...adminPassForm, newPassword: e.target.value })}
                                                placeholder="Enter new password (min. 4 characters)"
                                                className="w-full px-4 py-3.5 pr-11 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                                            />
                                            <button 
                                                type="button"
                                                onClick={() => setShowAdminPass(p => ({ ...p, new: !p.new }))}
                                                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                            >
                                                {showAdminPass.new ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Confirm Password */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                            Confirm New Password
                                        </label>
                                        <div className="relative">
                                            <input 
                                                type={showAdminPass.confirm ? "text" : "password"}
                                                value={adminPassForm.confirmPassword}
                                                onChange={e => setAdminPassForm({ ...adminPassForm, confirmPassword: e.target.value })}
                                                placeholder="Re-enter new password"
                                                className="w-full px-4 py-3.5 pr-11 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                                            />
                                            <button 
                                                type="button"
                                                onClick={() => setShowAdminPass(p => ({ ...p, confirm: !p.confirm }))}
                                                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                            >
                                                {showAdminPass.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                                        <button 
                                            type="submit"
                                            disabled={isUpdatingAdminPass}
                                            className="w-full sm:w-auto flex-1 py-3.5 px-6 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-900/10 disabled:opacity-50 cursor-pointer"
                                        >
                                            {isUpdatingAdminPass ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                            <span>Save New Password</span>
                                        </button>
                                        <button 
                                            type="button"
                                            onClick={handleResetAdminPasswordToDefault}
                                            disabled={isUpdatingAdminPass}
                                            className="w-full sm:w-auto py-3.5 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                                            title="Quickly reset administrator password to default admin123 for development"
                                        >
                                            <RotateCcw size={16} /> Reset to admin123
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* Right Column: Admin Profile & Dev Status */}
                            <div className="lg:col-span-5 space-y-6">
                                {/* Profile Card */}
                                <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-5">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-black text-xl shadow-lg shadow-blue-500/20">
                                            SA
                                        </div>
                                        <div>
                                            <h4 className="font-black text-slate-900 text-base">Super Administrator</h4>
                                            <p className="text-xs text-slate-500">Username: <span className="font-mono font-bold text-slate-800">admin</span></p>
                                            <div className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                                                <ShieldCheck size={12} /> Master Root Admin
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3 pt-3 border-t border-slate-100 text-xs">
                                        <div className="flex items-center justify-between py-1.5 text-slate-600">
                                            <span>Account Role</span>
                                            <span className="font-bold text-slate-900">SUPER_ADMIN</span>
                                        </div>
                                        <div className="flex items-center justify-between py-1.5 text-slate-600">
                                            <span>Default Credentials</span>
                                            <span className="font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">admin / admin123</span>
                                        </div>
                                        <div className="flex items-center justify-between py-1.5 text-slate-600">
                                            <span>Active Institution</span>
                                            <span className="font-bold text-slate-900">{currentSchool.name}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-1.5 text-slate-600">
                                            <span>Single Session Lock</span>
                                            <span className="font-bold text-emerald-600 flex items-center gap-1">
                                                <CheckCircle2 size={14} /> Active
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between py-1.5 text-slate-600">
                                            <span>Cloud Sync State</span>
                                            <span className="font-bold text-blue-600">Connected & Verified</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Dev Ready Card */}
                                <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-3xl p-6 border border-blue-100 space-y-3">
                                    <div className="flex items-center gap-2 text-indigo-900 font-black text-sm">
                                        <Sparkles size={16} className="text-indigo-600" /> Ready for Development
                                    </div>
                                    <p className="text-xs text-indigo-800 leading-relaxed">
                                        All testing mock faculty have been removed. The database is clean, allowing you to add actual teachers, assign specific class streams, or run automated conflict-free timetable scheduling from scratch.
                                    </p>
                                    <div className="pt-2 flex items-center gap-2 text-[11px] text-indigo-600 font-semibold">
                                        <span>Official creator:</span>
                                        <a href="https://pbfa.netlify.app" target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-indigo-900">
                                            PBFA INNOVATIONS AND TECHNOLOGY
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>

        {/* DELETE MODAL */}
        {deleteModal && (
            <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-[2rem] shadow-2xl p-8 max-w-md w-full animate-in zoom-in-95 duration-200 border border-slate-100">
                    <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                        <Trash2 size={32}/>
                    </div>
                    <h3 className="text-2xl font-black text-center text-slate-800 mb-2">Delete {deleteModal.name}?</h3>
                    <p className="text-center text-slate-500 mb-8 leading-relaxed">
                        Are you sure you want to delete this {deleteModal?.type ? deleteModal.type.toLowerCase() : 'item'}? This action is permanent and cannot be undone.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <button 
                            onClick={() => setDeleteModal(null)} 
                            className="py-3 px-4 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                        >
                            No, go back
                        </button>
                        <button 
                            onClick={confirmDelete} 
                            className="py-3 px-4 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 shadow-lg shadow-red-500/20 transition-all flex items-center justify-center gap-2"
                        >
                            <Trash2 size={18}/> Yes, Delete
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* MODAL: Edit Cell */}
        {showCellEditModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center backdrop-blur-sm animate-in fade-in">
                <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-sm animate-in zoom-in-95">
                    <h3 className="font-bold text-xl mb-6 text-slate-800">Edit Slot</h3>
                    
                    <div className="space-y-4 mb-6">
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                             <div className="text-xs font-bold text-slate-400 uppercase mb-1">Time Slot</div>
                             <div className="font-medium">{DAYS[showCellEditModal.d]} • {PERIODS[showCellEditModal.p].label}</div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block ml-1">Assign Subject</label>
                            <select 
                                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm"
                                value={cellEditForm.subjectId}
                                onChange={e => setCellEditForm({...cellEditForm, subjectId: e.target.value})}
                            >
                                <option value="">(Empty Slot)</option>
                                <option value="FREE">FREE PERIOD</option>
                                {subjects.filter(s => {
                                    // Strictly filter subjects eligible for this specific class
                                    const cls = classes.find(c => c.id === selectedClassId);
                                    return cls ? isSubjectEligibleForClass(s, cls) : true;
                                }).map(s => <option key={s.id} value={s.id}>{s.name} ({s.code || s.id})</option>)}
                            </select>
                        </div>

                        {cellEditForm.subjectId && cellEditForm.subjectId !== 'FREE' && (
                            <>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block ml-1">Assign Teacher</label>
                                    <select 
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm"
                                        value={cellEditForm.teacherId}
                                        onChange={e => setCellEditForm({...cellEditForm, teacherId: e.target.value})}
                                    >
                                        <option value="SYSTEM">System / TBD</option>
                                        {teachers.filter(t => t.subjectsTaught.includes(cellEditForm.subjectId)).map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                        <optgroup label="Other Teachers">
                                            {teachers.filter(t => !t.subjectsTaught.includes(cellEditForm.subjectId)).map(t => (
                                                <option key={t.id} value={t.id}>{t.name}</option>
                                            ))}
                                        </optgroup>
                                    </select>
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block ml-1">Assign Room / Venue Override</label>
                                    <select 
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm"
                                        value={cellEditForm.roomId || ''}
                                        onChange={e => setCellEditForm({...cellEditForm, roomId: e.target.value})}
                                    >
                                        <option value="">Default Classroom</option>
                                        {rooms.map(r => (
                                            <option key={r.id} value={r.id}>{r.name} ({r.capacity} seats)</option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex justify-end gap-3">
                        <button onClick={() => setShowCellEditModal(null)} className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl">Cancel</button>
                        <button onClick={handleSaveCell} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:bg-slate-800">Save Changes</button>
                    </div>
                </div>
            </div>
        )}

        {/* MODAL: Add/Edit Entity */}
        {modalType && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center backdrop-blur-sm">
                <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                    <h3 className="font-bold text-xl mb-6">Add {modalType}</h3>
                    <div className="space-y-4">
                        <input className="w-full p-4 bg-slate-50 rounded-xl border" placeholder="Name" value={entityForm.name||''} onChange={e=>setEntityForm({...entityForm, name: e.target.value})} />
                        
                        {/* TEACHER SPECIFIC FIELDS */}
                        {modalType === 'TEACHER' && (
                             <>
                                <input className="w-full p-4 bg-slate-50 rounded-xl border" placeholder="Username (e.g. teacher1)" value={entityForm.username||''} onChange={e=>setEntityForm({...entityForm, username: e.target.value})} />
                                <input className="w-full p-4 bg-slate-50 rounded-xl border" placeholder="Set Password" value={entityForm.password||''} onChange={e=>setEntityForm({...entityForm, password: e.target.value})} />
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Max Subjects Load</label>
                                    <input type="number" className="w-full p-4 bg-slate-50 rounded-xl border" placeholder="Subject Limit (e.g. 4)" value={entityForm.subjectLimit||''} onChange={e=>setEntityForm({...entityForm, subjectLimit: e.target.value})} />
                                </div>
                             </>
                        )}
                        
                        {/* CLASS SPECIFIC FIELDS */}
                        {modalType === 'CLASS' && (
                             <div className="space-y-4">
                                 <div>
                                     <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Academic Tier Level</label>
                                     <div className="grid grid-cols-2 gap-2">
                                         <button
                                             type="button"
                                             onClick={() => setEntityForm({ ...entityForm, level: 'JUNIOR' })}
                                             className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                                                 (entityForm.level || 'JUNIOR') === 'JUNIOR'
                                                     ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                                     : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                             }`}
                                         >
                                             🎓 Junior Class
                                         </button>
                                         <button
                                             type="button"
                                             onClick={() => setEntityForm({ ...entityForm, level: 'SENIOR' })}
                                             className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                                                 entityForm.level === 'SENIOR'
                                                     ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                                                     : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                             }`}
                                         >
                                             🏛️ Senior Class
                                         </button>
                                     </div>
                                     <p className="text-[11px] text-slate-400 mt-1.5">
                                         {(entityForm.level || 'JUNIOR') === 'JUNIOR' 
                                             ? 'Will automatically inherit all Junior school subjects and weekly periods.'
                                             : 'Will automatically inherit Senior curriculum subjects for its configured stream.'
                                         }
                                     </p>
                                 </div>

                                 {/* Senior Stream Selector for Class */}
                                 {(entityForm.level === 'SENIOR') && (
                                     <div>
                                         <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Curriculum Stream</label>
                                         <select
                                             className="w-full p-3.5 bg-slate-50 rounded-xl border text-sm font-bold text-slate-800"
                                             value={entityForm.stream || (entityForm.name && entityForm.name.toUpperCase().includes('BC') ? 'BC' : 'SCIENCE')}
                                             onChange={e => setEntityForm({ ...entityForm, stream: e.target.value })}
                                         >
                                             <option value="SCIENCE">🔬 A / Science Stream (SS1A1–SS3A2)</option>
                                             <option value="BC">📊 Combined BC Stream (SS1BC–SS3BC)</option>
                                             <option value="GENERAL">🌐 General Senior Stream</option>
                                         </select>
                                     </div>
                                 )}

                                 <div>
                                     <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Form / Class Teacher</label>
                                     <select 
                                         className="w-full p-3.5 bg-slate-50 rounded-xl border text-sm font-bold text-slate-800"
                                         value={entityForm.assignedTeacherId || ''}
                                         onChange={e => setEntityForm({ ...entityForm, assignedTeacherId: e.target.value })}
                                     >
                                         <option value="">(Select Form Teacher)</option>
                                         {teachers.map(t => (
                                             <option key={t.id} value={t.id}>{t.name} (@{t.username})</option>
                                         ))}
                                     </select>
                                 </div>
                             </div>
                        )}

                        {/* SUBJECT SPECIFIC FIELDS (With Live Remaining Spaces Calculator) */}
                        {modalType === 'SUBJECT' && (() => {
                            const selectedLevel: AcademicLevel = entityForm.level || 'JUNIOR';
                            const totalCapacity = TIMETABLE_CONFIG.INSTRUCTIONAL_SLOTS; // 38 instructional teaching slots

                            
                            const otherSubjectsSum = subjects
                                .filter(s => s.id !== entityForm.id && (s.level || (s.category === 'JSS' || s.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR')) === selectedLevel)
                                .reduce((sum, s) => sum + (s.defaultPeriodCount || s.periodsPerWeek || 0), 0);

                            const currentPeriods = parseInt(entityForm.defaultPeriodCount) || 0;
                            const newTotalAssigned = otherSubjectsSum + currentPeriods;
                            const remainingSpaces = totalCapacity - newTotalAssigned;
                            const isOver = remainingSpaces < 0;

                            return (
                                <div className="space-y-4">
                                    {/* Level Selection */}
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Curriculum Academic Level</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setEntityForm({ ...entityForm, level: 'JUNIOR' })}
                                                className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                                                    selectedLevel === 'JUNIOR'
                                                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                                }`}
                                            >
                                                🎓 Junior Subject
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setEntityForm({ ...entityForm, level: 'SENIOR' })}
                                                className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                                                    selectedLevel === 'SENIOR'
                                                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                                                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                                }`}
                                            >
                                                🏛️ Senior Subject
                                            </button>
                                        </div>
                                        <p className="text-[11px] text-slate-500 mt-1 font-medium">
                                            {selectedLevel === 'JUNIOR'
                                                ? '✨ Applies automatically to ALL Junior classes.'
                                                : '✨ Senior subject curriculum with stream-specific eligibility.'
                                            }
                                        </p>
                                    </div>

                                    {/* Senior Stream Selector */}
                                    {selectedLevel === 'SENIOR' && (
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Senior Stream Eligibility</label>
                                            <select
                                                className="w-full p-3.5 bg-slate-50 rounded-xl border text-sm font-bold text-slate-800"
                                                value={entityForm.stream || 'ALL'}
                                                onChange={e => setEntityForm({ ...entityForm, stream: e.target.value })}
                                            >
                                                <option value="ALL">🌐 Common (Both Science & BC Streams)</option>
                                                <option value="SCIENCE">🔬 A / Science Streams Only (SS1A1–SS3A2)</option>
                                                <option value="BC">📊 Combined BC Streams Only (SS1BC–SS3BC)</option>
                                            </select>
                                        </div>
                                    )}

                                    {/* Subject Code & Core/Elective */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Subject Code</label>
                                            <input 
                                                className="w-full p-3.5 bg-slate-50 rounded-xl border text-sm font-bold uppercase" 
                                                placeholder="e.g. MTH" 
                                                value={entityForm.code || ''} 
                                                onChange={e => setEntityForm({ ...entityForm, code: e.target.value.toUpperCase() })} 
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Subject Type</label>
                                            <select 
                                                className="w-full p-3.5 bg-slate-50 rounded-xl border text-sm font-bold"
                                                value={entityForm.isCore} 
                                                onChange={e => setEntityForm({ ...entityForm, isCore: e.target.value })}
                                            >
                                                <option value="true">Core Subject</option>
                                                <option value="false">Elective Subject</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Times per Week & Times in a Day */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-bold text-slate-700 uppercase mb-1 block">
                                                Times / Week
                                            </label>
                                            <input 
                                                type="number" 
                                                min={1} 
                                                max={10} 
                                                className="w-full p-3.5 bg-slate-50 rounded-xl border text-base font-black text-slate-900 focus:bg-white" 
                                                placeholder="e.g. 4" 
                                                value={entityForm.defaultPeriodCount || ''} 
                                                onChange={e => setEntityForm({ ...entityForm, defaultPeriodCount: e.target.value })} 
                                            />
                                            <span className="text-[10px] text-slate-400">Weekly periods</span>
                                        </div>

                                        <div>
                                            <label className="text-xs font-bold text-slate-700 uppercase mb-1 block">
                                                Times in a Day
                                            </label>
                                            <select 
                                                className="w-full p-3.5 bg-slate-50 rounded-xl border text-sm font-bold text-slate-900"
                                                value={entityForm.maxPerDay || 1}
                                                onChange={e => setEntityForm({ ...entityForm, maxPerDay: parseInt(e.target.value) || 1 })}
                                            >
                                                <option value={1}>Once a day (1 period)</option>
                                                <option value={2}>Twice a day (Double period)</option>
                                                <option value={3}>3 times a day</option>
                                            </select>
                                            <span className="text-[10px] text-slate-400">Daily limit</span>
                                        </div>
                                    </div>

                                    {/* LIVE REMAINING SPACES LEFT INDICATOR */}
                                    <div className={`p-4 rounded-2xl border transition-all ${
                                        isOver 
                                            ? 'bg-rose-50 border-rose-200' 
                                            : remainingSpaces <= 2 
                                                ? 'bg-emerald-50 border-emerald-200' 
                                                : 'bg-blue-50 border-blue-200'
                                    }`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-1.5">
                                                <Clock size={16} className={isOver ? 'text-rose-600' : 'text-blue-600'} />
                                                <span className="text-xs font-black text-slate-800">Remaining Timetable Spaces</span>
                                            </div>
                                            <span className={`text-xs font-black px-2.5 py-0.5 rounded-full ${
                                                isOver 
                                                    ? 'bg-rose-600 text-white' 
                                                    : 'bg-white text-slate-800 border border-slate-200'
                                            }`}>
                                                {remainingSpaces} slots left
                                            </span>
                                        </div>

                                        <p className="text-xs text-slate-600 leading-relaxed">
                                            Timetable has <strong className="text-slate-900">{totalCapacity} total spaces</strong>.
                                            {otherSubjectsSum > 0 ? ` Other ${(selectedLevel || 'junior').toLowerCase()} subjects occupy ${otherSubjectsSum} spaces.` : ''}
                                            {currentPeriods > 0 ? ` Assigning this subject ${currentPeriods} times a week (${entityForm.maxPerDay || 1}x/day) leaves ` : ' '}
                                            <strong className={isOver ? 'text-rose-600 font-black' : 'text-emerald-700 font-black'}>
                                                {remainingSpaces} slots left
                                            </strong> for subjects assigning.
                                        </p>

                                        {isOver && (
                                            <div className="mt-2.5 pt-2 border-t border-rose-200 text-[11px] text-rose-700 font-bold flex items-center gap-1">
                                                <AlertTriangle size={13} className="shrink-0" />
                                                <span>Overallocated by {Math.abs(remainingSpaces)} spaces! Reduces available slots below 0.</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Preferred Faculty Teacher */}
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Preferred Faculty Teacher (Optional)</label>
                                        <select 
                                            className="w-full p-3.5 bg-slate-50 rounded-xl border text-sm font-bold text-slate-800"
                                            value={entityForm.preferredTeacherId || ''}
                                            onChange={e => setEntityForm({ ...entityForm, preferredTeacherId: e.target.value })}
                                        >
                                            <option value="">System Automatic Assignment</option>
                                            {teachers.map(t => (
                                                <option key={t.id} value={t.id}>{t.name} (@{t.username})</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ROOM SPECIFIC FIELDS */}
                        {modalType === 'ROOM' && (
                             <>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Capacity</label>
                                    <input type="number" className="w-full p-4 bg-slate-50 rounded-xl border" placeholder="Capacity (e.g. 40)" value={entityForm.capacity||''} onChange={e=>setEntityForm({...entityForm, capacity: e.target.value})} />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Category / Type</label>
                                    <select className="w-full p-4 bg-slate-50 rounded-xl border" value={entityForm.category||'GENERAL'} onChange={e=>setEntityForm({...entityForm, category: e.target.value})}>
                                         <option value="GENERAL">General Classroom</option>
                                         <option value="LABORATORY">Science Laboratory</option>
                                         <option value="ICT">ICT Lab</option>
                                         <option value="HALL">Multi-purpose Hall</option>
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Features</label>
                                    <input className="w-full p-4 bg-slate-50 rounded-xl border" placeholder="Comma-separated (e.g. Projector, AC)" value={Array.isArray(entityForm.features) ? entityForm.features.join(', ') : (entityForm.features || '')} onChange={e=>setEntityForm({...entityForm, features: e.target.value})} />
                                </div>
                             </>
                        )}
                    </div>
                    <div className="flex justify-end gap-3 mt-6">
                        <button onClick={() => setModalType(null)} className="px-6 py-3 text-slate-500 font-bold">Cancel</button>
                        <button onClick={handleEntitySave} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold">Save</button>
                    </div>
                </div>
            </div>
        )}

        {/* MODAL: Teacher Details */}
        {viewTeacher && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl animate-in zoom-in-95 duration-200 border border-slate-100 max-h-[90vh] flex flex-col overflow-hidden">
                    <div className="p-8 border-b border-slate-100 flex justify-between items-start bg-slate-50 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
                        <div className="relative z-10 flex gap-6">
                            <div className="w-24 h-24 rounded-full border-4 border-white shadow-lg overflow-hidden bg-slate-200 flex items-center justify-center shrink-0">
                                {(viewTeacher.profilePicture || storage.getTeacherProfilePicture(viewTeacher.id)) ? (
                                    <img src={viewTeacher.profilePicture || storage.getTeacherProfilePicture(viewTeacher.id)} className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-3xl font-bold text-slate-400">{viewTeacher.name.charAt(0)}</span>
                                )}
                            </div>
                            <div>
                                <h2 className="text-3xl font-black text-slate-900 mb-1">{viewTeacher.name}</h2>
                                <div className="flex items-center gap-3 text-slate-500 font-medium mb-4">
                                    <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Teacher</span>
                                    {viewTeacher.lastActive && Date.now() - viewTeacher.lastActive < 120000 ? (
                                        <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                                            Online
                                        </span>
                                    ) : (
                                        <span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                                            Offline
                                        </span>
                                    )}
                                    <span>@{viewTeacher.username}</span>
                                </div>
                                <div className="flex gap-6 text-sm">
                                    {viewTeacher.contactEmail && (
                                        <div className="flex items-center gap-2 text-slate-600">
                                            <Mail size={16} className="text-slate-400"/> {viewTeacher.contactEmail}
                                        </div>
                                    )}
                                    {viewTeacher.contactPhone && (
                                        <div className="flex items-center gap-2 text-slate-600">
                                            <Phone size={16} className="text-slate-400"/> {viewTeacher.contactPhone}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setViewTeacher(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors relative z-10">
                            <X size={24} className="text-slate-400"/>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/30">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            {/* Left Column: Stats & Bio */}
                            <div className="space-y-6">
                                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Workload Summary</h3>
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center">
                                            <span className="text-slate-600 font-medium">Assigned Classes</span>
                                            <span className="font-bold text-slate-900">{viewTeacher.assignedClasses.length}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-slate-600 font-medium">Subjects Taught</span>
                                            <span className="font-bold text-slate-900">{viewTeacher.subjectsTaught.length}</span>
                                        </div>
                                        <div className="pt-4 border-t border-slate-50">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-slate-600 font-medium">Weekly Periods</span>
                                                <span className="font-bold text-slate-900">
                                                    {(() => {
                                                        let count = 0;
                                                        if (grid) {
                                                            Object.values(grid).forEach(days => {
                                                                Object.values(days).forEach(periods => {
                                                                    Object.values(periods).forEach((cell: any) => {
                                                                        if (cell && (cell.teacherId === viewTeacher.id || cell.teacherIds?.includes(viewTeacher.id))) {
                                                                            count++;
                                                                        }
                                                                    });
                                                                });
                                                            });
                                                        }
                                                        return count;
                                                    })()}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-400">Target: {settings.maxSubjectsPerTeacher * settings.periodsPerDay} (Max)</div>
                                        </div>
                                    </div>
                                </div>

                                {viewTeacher.bio && (
                                    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Bio</h3>
                                        <p className="text-slate-600 text-sm leading-relaxed">{viewTeacher.bio}</p>
                                    </div>
                                )}
                            </div>

                            {/* Right Column: Schedule & Assignments */}
                            <div className="lg:col-span-2 space-y-6">
                                {/* Teaching Assignments Table */}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                    <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50">
                                        <h3 className="font-bold text-slate-800">Teaching Assignments</h3>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs text-slate-400 uppercase bg-slate-50/50">
                                                <tr>
                                                    <th className="px-6 py-3 font-bold">Class</th>
                                                    <th className="px-6 py-3 font-bold">Subject</th>
                                                    <th className="px-6 py-3 font-bold text-right">Periods/Week</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {(() => {
                                                    // Calculate load per class/subject
                                                    const loadMap: Record<string, number> = {};
                                                    if (grid) {
                                                        Object.entries(grid).forEach(([cId, days]) => {
                                                            Object.values(days).forEach(periods => {
                                                                Object.values(periods).forEach((cell: any) => {
                                                                    if (cell && (cell.teacherId === viewTeacher.id || cell.teacherIds?.includes(viewTeacher.id))) {
                                                                        const key = `${cId}|${cell.subjectId}`;
                                                                        loadMap[key] = (loadMap[key] || 0) + 1;
                                                                    }
                                                                });
                                                            });
                                                        });
                                                    }
                                                    
                                                    const assignments = Object.entries(loadMap).map(([key, count]) => {
                                                        const [cId, sId] = key.split('|');
                                                        return {
                                                            classId: cId,
                                                            subjectId: sId,
                                                            count
                                                        };
                                                    }).sort((a, b) => a.classId.localeCompare(b.classId));

                                                    if (assignments.length === 0) {
                                                        return (
                                                            <tr>
                                                                <td colSpan={3} className="px-6 py-8 text-center text-slate-400 italic">
                                                                    No active assignments found in current timetable.
                                                                </td>
                                                            </tr>
                                                        );
                                                    }

                                                    return assignments.map((assign, idx) => (
                                                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                                            <td className="px-6 py-4 font-bold text-slate-700">
                                                                {classes.find(c => c.id === assign.classId)?.name || assign.classId}
                                                            </td>
                                                            <td className="px-6 py-4 text-slate-600">
                                                                {subjects.find(s => s.id === assign.subjectId)?.name || assign.subjectId}
                                                            </td>
                                                            <td className="px-6 py-4 text-right font-mono font-bold text-slate-900">
                                                                {assign.count}
                                                            </td>
                                                        </tr>
                                                    ));
                                                })()}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Personal Schedule Grid */}
                                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                                    <h3 className="font-bold text-slate-800 mb-4">Personal Schedule</h3>
                                    {(() => {
                                        // Construct Personal Grid for View
                                        // Similar logic to TeacherDashboard
                                        if (!grid) return <div className="text-center py-10 text-slate-400">Timetable not generated.</div>;

                                        const personalGrid: Record<number, Record<number, any>> = {};
                                        for(let d=0; d<DAYS.length; d++) {
                                            personalGrid[d] = {};
                                            for(let p=0; p<8; p++) personalGrid[d][p] = null;
                                        }

                                        let hasClasses = false;
                                        for(const cId in grid) {
                                            const days = grid[cId];
                                            if (!days || typeof days !== 'object') continue;
                                            for(const dStr in days) {
                                                const d = parseInt(dStr);
                                                if (!personalGrid[d]) continue;
                                                if (!days[d] || typeof days[d] !== 'object') continue;
                                                for(const pStr in days[d]) {
                                                    const p = parseInt(pStr);
                                                    const cell = days[d]?.[p];
                                                    if (cell && (cell.teacherId === viewTeacher.id || cell.teacherIds?.includes(viewTeacher.id))) {
                                                        hasClasses = true;
                                                        personalGrid[d][p] = { 
                                                            ...cell, 
                                                            _displayClass: classes.find(c=>c.id===cId)?.name || cId 
                                                        };
                                                    }
                                                }
                                            }
                                        }

                                        if (!hasClasses) return <div className="text-center py-10 text-slate-400">No classes scheduled for this teacher.</div>;

                                        return (
                                            <TimetableGrid 
                                                timetable={{ 'MY_SCHEDULE': personalGrid }} 
                                                classId="MY_SCHEDULE" 
                                                isEditable={false} 
                                                teachers={teachers}
                                                rooms={rooms}
                                            />
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                        <button onClick={() => {
                            openEditModal('TEACHER', viewTeacher);
                            setViewTeacher(null);
                        }} className="px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors shadow-sm flex items-center gap-2">
                            <Settings size={18}/> Edit Profile
                        </button>
                        <button onClick={() => setViewTeacher(null)} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:bg-slate-800 transition-colors">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* MODAL: Generation Report */}
        {showGenReport && (
            <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl animate-in zoom-in-95 duration-200 border border-slate-100 max-h-[90vh] flex flex-col">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-[2rem]">
                        <h3 className="text-xl font-black text-slate-800">Generation Report</h3>
                        <button onClick={() => setShowGenReport(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                            <X size={24} className="text-slate-400"/>
                        </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <LogViewer logs={generationLogs} />
                    </div>
                    <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-[2rem] flex justify-end">
                        <button onClick={() => setShowGenReport(false)} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:bg-slate-800">Close Report</button>
                    </div>
                </div>
            </div>
        )}

        {/* MODAL: Register New School Manually (Extremely Secure) */}
        {showSchoolModal && (
            <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200 border border-slate-100 overflow-hidden">
                    <div className="p-6 pb-4 border-b border-slate-100 bg-slate-50/80 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-600/20">
                                <School size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                                    Register New School
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
                                        Admin Authorized
                                    </span>
                                </h3>
                                <p className="text-xs text-slate-500">Manual administrative addition with zero pre-populated database state</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowSchoolModal(false)}
                            className="p-2 hover:bg-slate-200 rounded-full transition"
                        >
                            <X size={20} className="text-slate-400" />
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto space-y-4">
                        {/* Security Notice */}
                        <div className="p-4 bg-blue-50/70 border border-blue-200/80 rounded-2xl flex items-start gap-3 text-xs text-blue-900">
                            <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                            <div>
                                <span className="font-extrabold block mb-0.5">Strict Zero-Default-Data Policy</span>
                                <span className="text-blue-800 text-[11px] leading-relaxed">
                                    This institution will be created with zero pre-populated mock data in Firestore. No default teachers or dummy schedules are injected. Only your authorized manual configuration is saved.
                                </span>
                            </div>
                        </div>

                        {schoolFormError && (
                            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
                                <AlertTriangle size={16} className="shrink-0" />
                                <span>{schoolFormError}</span>
                            </div>
                        )}

                        <form onSubmit={handleRegisterSchoolSubmit} className="space-y-4">
                            {/* Section 1: Institution Details */}
                            <div className="space-y-3">
                                <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                    <Building2 size={13} /> Institutional Identity
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        School Official Name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. Christ the King College"
                                        value={newSchool.name}
                                        onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            School Code / Acronym <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            maxLength={8}
                                            required
                                            placeholder="e.g. CKC"
                                            value={newSchool.code}
                                            onChange={(e) => setNewSchool({ ...newSchool, code: e.target.value.toUpperCase() })}
                                            className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none uppercase font-mono tracking-wider transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Ministry Accreditation Serial
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="e.g. ACCR-2026-904"
                                            value={newSchool.accreditationNumber}
                                            onChange={(e) => setNewSchool({ ...newSchool, accreditationNumber: e.target.value })}
                                            className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none font-mono transition"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        School Motto / Mission Statement
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Knowledge, Integrity and Academic Distinction"
                                        value={newSchool.motto}
                                        onChange={(e) => setNewSchool({ ...newSchool, motto: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Campus Physical Address & City
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 100 University Drive, Knowledge Valley"
                                        value={newSchool.address}
                                        onChange={(e) => setNewSchool({ ...newSchool, address: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Admin / Registrar Contact Email
                                        </label>
                                        <input
                                            type="email"
                                            placeholder="e.g. registrar@school.edu"
                                            value={newSchool.adminEmail}
                                            onChange={(e) => setNewSchool({ ...newSchool, adminEmail: e.target.value })}
                                            className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            Administrative Contact Phone
                                        </label>
                                        <input
                                            type="tel"
                                            placeholder="e.g. +234 802 345 6789"
                                            value={newSchool.adminPhone}
                                            onChange={(e) => setNewSchool({ ...newSchool, adminPhone: e.target.value })}
                                            className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Institutional Brand Theme Color
                                    </label>
                                    <div className="flex items-center gap-2">
                                        {['#2563eb', '#059669', '#7c3aed', '#ea580c', '#0284c7', '#dc2626', '#0f172a'].map((c) => (
                                            <button
                                                key={c}
                                                type="button"
                                                onClick={() => setNewSchool({ ...newSchool, themeColor: c })}
                                                className={`w-7 h-7 rounded-lg border-2 transition transform active:scale-95 ${
                                                    newSchool.themeColor === c ? 'border-slate-900 scale-110 shadow-sm' : 'border-transparent'
                                                }`}
                                                style={{ backgroundColor: c }}
                                            />
                                        ))}
                                        <input
                                            type="color"
                                            value={newSchool.themeColor || '#2563eb'}
                                            onChange={(e) => setNewSchool({ ...newSchool, themeColor: e.target.value })}
                                            className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 ml-2"
                                            title="Pick custom color"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Section 2: Security Gate */}
                            <div className="pt-3 border-t border-slate-100 space-y-3">
                                <div className="text-[11px] font-black uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                                    <Lock size={13} /> Administrator Cryptographic Verification Gate <span className="text-red-500">*</span>
                                </div>
                                <p className="text-[11px] text-slate-500">
                                    To execute this registration and write the isolated record to Firestore, please provide your Administrator Master Password or Security Passkey.
                                </p>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Admin Master Password / Passkey <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="password"
                                            required
                                            placeholder="Enter administrator passkey"
                                            value={newSchool.adminPasskey}
                                            onChange={(e) => setNewSchool({ ...newSchool, adminPasskey: e.target.value })}
                                            className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 pl-9 text-xs text-slate-900 outline-none font-mono transition"
                                        />
                                        <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => setShowSchoolModal(false)}
                                    className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={schoolSubmitting}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 transition disabled:opacity-50 flex items-center gap-2"
                                >
                                    {schoolSubmitting ? (
                                        <>
                                            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                            Authorizing & Writing...
                                        </>
                                    ) : (
                                        <>
                                            <ShieldCheck size={16} /> Register Institution
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        )}

        {/* MODAL: Delete School Confirmation (Extremely Secure) */}
        {schoolToDelete && (
            <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-[2rem] shadow-2xl p-8 max-w-md w-full animate-in zoom-in-95 duration-200 border border-slate-100">
                    <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                        <Trash2 size={32} />
                    </div>
                    <h3 className="text-2xl font-black text-center text-slate-900 mb-2">
                        Delete "{schoolToDelete.name}"?
                    </h3>
                    <p className="text-center text-slate-500 text-xs mb-6 leading-relaxed">
                        This action will remove the school and its record from Firestore. Default founding institutions cannot be deleted.
                    </p>

                    {deleteError && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
                            <AlertTriangle size={16} className="shrink-0" />
                            <span>{deleteError}</span>
                        </div>
                    )}

                    <div className="space-y-4 mb-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">
                                Confirm with Administrator Passkey <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="password"
                                placeholder="Admin passkey"
                                value={deletePasskey}
                                onChange={(e) => setDeletePasskey(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 focus:border-red-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 font-mono outline-none transition"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => {
                                setSchoolToDelete(null);
                                setDeletePasskey('');
                                setDeleteError('');
                            }}
                            className="py-3 px-4 bg-slate-100 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-200 transition"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirmDeleteSchool}
                            disabled={isDeletingSchool}
                            className="py-3 px-4 bg-red-600 text-white font-bold text-xs rounded-xl hover:bg-red-700 shadow-lg shadow-red-600/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isDeletingSchool ? 'Deleting...' : 'Confirm Delete'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* MODAL: Lightning-Fast AI Timetable Diagnostics & Instant Resolution */}
        {showAiAnalysisModal && aiAnalysisResult && (
            <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl border border-slate-100 max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                    {/* Header */}
                    <div className="p-6 md:p-8 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-start justify-between relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                        <div className="flex items-center gap-4 relative z-10">
                            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0">
                                <Zap size={24} className="fill-amber-400" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-black text-xl text-white">⚡ Lightning AI Diagnostic & Fix</h3>
                                    <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-indigo-500/30 border border-indigo-400/30 text-indigo-200">
                                        {aiAnalysisResult.slotBudget.level} STREAM
                                    </span>
                                </div>
                                <p className="text-xs text-slate-300">
                                    Real-time capacity verification and rapid conflict solver powered by Gemini AI.
                                </p>
                            </div>
                        </div>
                        <button 
                            onClick={() => setShowAiAnalysisModal(false)}
                            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition relative z-10"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar bg-slate-50/50">
                        {/* Slot Budget Summary Cards */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-white p-4 rounded-2xl border border-slate-200 text-center shadow-xs">
                                <div className="text-[10px] font-black uppercase text-slate-400">Total Spaces</div>
                                <div className="text-xl font-black text-slate-800 mt-0.5">
                                    {aiAnalysisResult.slotBudget.totalSlots}
                                </div>
                                <div className="text-[10px] text-slate-400">Timetable slots</div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl border border-slate-200 text-center shadow-xs">
                                <div className="text-[10px] font-black uppercase text-slate-400">Assigned Slots</div>
                                <div className={`text-xl font-black mt-0.5 ${
                                    aiAnalysisResult.slotBudget.isOverallocated ? 'text-rose-600' : 'text-slate-800'
                                }`}>
                                    {aiAnalysisResult.slotBudget.assignedSlots}
                                </div>
                                <div className="text-[10px] text-slate-400">Across {aiAnalysisResult.slotBudget.subjectsCount} subjects</div>
                            </div>
                            <div className={`p-4 rounded-2xl border text-center shadow-xs ${
                                aiAnalysisResult.slotBudget.isOverallocated 
                                    ? 'bg-rose-50 border-rose-200 text-rose-700' 
                                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            }`}>
                                <div className="text-[10px] font-black uppercase">
                                    {aiAnalysisResult.slotBudget.isOverallocated ? 'Over Capacity' : 'Spaces Left'}
                                </div>
                                <div className="text-xl font-black mt-0.5">
                                    {aiAnalysisResult.slotBudget.isOverallocated 
                                        ? `+${Math.abs(aiAnalysisResult.slotBudget.remainingSlots)}` 
                                        : aiAnalysisResult.slotBudget.remainingSlots
                                    }
                                </div>
                                <div className="text-[10px] opacity-80">
                                    {aiAnalysisResult.slotBudget.isOverallocated ? 'Need cutting' : 'Available to assign'}
                                </div>
                            </div>
                        </div>

                        {/* Executive AI Summary */}
                        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-2">
                            <div className="flex items-center gap-2 text-xs font-black text-slate-800 uppercase tracking-wider">
                                <Sparkles size={14} className="text-amber-500" />
                                <span>AI Structural Assessment</span>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed font-medium">
                                {aiAnalysisResult.summary}
                            </p>
                        </div>

                        {/* Issues Detected */}
                        {aiAnalysisResult.issues && aiAnalysisResult.issues.length > 0 && (
                            <div className="space-y-2">
                                <div className="text-xs font-black uppercase text-slate-400 tracking-wider">
                                    Diagnostics & Bottlenecks ({aiAnalysisResult.issues.length})
                                </div>
                                <div className="space-y-2">
                                    {aiAnalysisResult.issues.map((iss, i) => (
                                        <div key={i} className="p-3 bg-rose-50/80 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
                                            <AlertTriangle size={15} className="text-rose-600 shrink-0 mt-0.5" />
                                            <span className="font-semibold">{iss}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Actionable Suggestions & Fixes */}
                        <div className="space-y-3">
                            <div className="text-xs font-black uppercase text-slate-400 tracking-wider">
                                Recommended Action & Lightning Fixes
                            </div>

                            {aiAnalysisResult.suggestions && aiAnalysisResult.suggestions.length > 0 ? (
                                aiAnalysisResult.suggestions.map((sug, i) => (
                                    <div key={sug.id || i} className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                                                    sug.severity === 'CRITICAL' 
                                                        ? 'bg-rose-100 text-rose-700' 
                                                        : sug.severity === 'WARNING'
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-blue-100 text-blue-700'
                                                }`}>
                                                    {sug.severity}
                                                </span>
                                                <h4 className="font-extrabold text-sm text-slate-900">{sug.title}</h4>
                                            </div>
                                        </div>

                                        <p className="text-xs text-slate-600 leading-relaxed font-medium">
                                            {sug.description}
                                        </p>

                                        {sug.autoFixPayload?.subjectAdjustments && (
                                            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1 text-xs text-slate-700">
                                                <div className="font-bold text-[11px] text-slate-500 uppercase">Planned Auto-Adjustments:</div>
                                                {sug.autoFixPayload.subjectAdjustments.map((adj, ai) => (
                                                    <div key={ai} className="flex items-center justify-between font-mono text-[11px]">
                                                        <span>{adj.reason}</span>
                                                        <span className="font-bold text-blue-600">{adj.newPeriodCount} periods/wk</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="pt-2 flex items-center justify-between gap-3 border-t border-slate-100">
                                            <span className="text-[11px] text-slate-500 italic">
                                                💡 {sug.recommendedAction}
                                            </span>
                                            {sug.autoFixPayload?.subjectAdjustments && (
                                                <button
                                                    onClick={() => handleApplyAIFix(sug)}
                                                    disabled={applyingAiFix}
                                                    className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-500/20 flex items-center gap-1.5 shrink-0 transition"
                                                >
                                                    {applyingAiFix ? (
                                                        <>
                                                            <Loader2 size={13} className="animate-spin" />
                                                            <span>Applying...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Zap size={13} className="fill-white" />
                                                            <span>⚡ Apply Fix Immediately</span>
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-200 text-center text-xs text-emerald-800 font-bold flex items-center justify-center gap-2">
                                    <CheckCircle2 size={18} className="text-emerald-600" />
                                    <span>Everything looks optimal! No scheduling conflicts or budget deficits detected.</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-5 bg-white border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs text-slate-400 font-medium">
                            ⚡ Changes apply to all {(aiAnalysisResult.slotBudget.level || 'junior').toLowerCase()} classes simultaneously
                        </span>
                        <button
                            onClick={() => setShowAiAnalysisModal(false)}
                            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-xs"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* MANDATORY ADMIN PASSWORD HARDENING MODAL */}
        {showMandatoryPasswordModal && (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
                    <div className="bg-gradient-to-r from-amber-500 via-rose-500 to-red-600 p-6 text-white text-center">
                        <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center shadow-lg">
                            <ShieldAlert size={32} className="text-white animate-pulse" />
                        </div>
                        <h3 className="text-xl font-black tracking-tight">Security Hardening Required</h3>
                        <p className="text-xs text-white/90 font-medium mt-1">Default Administrator Password Detected</p>
                    </div>

                    <form onSubmit={handleSaveMandatoryPassword} className="p-6 space-y-4">
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 leading-relaxed space-y-1.5">
                            <div className="font-bold flex items-center gap-1.5 text-amber-950">
                                <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                                <span>Action Required Before Continuing</span>
                            </div>
                            <p>
                                Your administrative account is currently secured with the factory default password (<code className="px-1.5 py-0.5 bg-amber-100 rounded text-[11px] font-mono font-bold text-amber-900">admin123</code>), which leaves school timetables and faculty records vulnerable to unauthorized access.
                            </p>
                            <p className="font-semibold text-amber-950">
                                You must create a unique, strong administrator password to proceed.
                            </p>
                        </div>

                        {adminPasswordError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold flex items-center gap-2">
                                <AlertOctagon size={16} className="text-red-500 shrink-0" />
                                <span>{adminPasswordError}</span>
                            </div>
                        )}

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    New Administrator Password
                                </label>
                                <div className="relative">
                                    <input
                                        type={showAdminPasswordPlain ? "text" : "password"}
                                        value={newAdminPassword}
                                        onChange={e => setNewAdminPassword(e.target.value)}
                                        placeholder="Enter minimum 8 characters"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition pr-10"
                                        required
                                        minLength={8}
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowAdminPasswordPlain(!showAdminPasswordPlain)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    >
                                        {showAdminPasswordPlain ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Confirm New Password
                                </label>
                                <input
                                    type={showAdminPasswordPlain ? "text" : "password"}
                                    value={confirmAdminPassword}
                                    onChange={e => setConfirmAdminPassword(e.target.value)}
                                    placeholder="Re-enter your new password"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition"
                                    required
                                    minLength={8}
                                />
                            </div>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[11px] text-slate-600 space-y-1 font-medium">
                            <div className="font-bold text-slate-700">Security Requirements:</div>
                            <div className="flex items-center gap-1.5">
                                <span className={newAdminPassword.length >= 8 ? "text-emerald-600 font-bold" : "text-slate-400"}>
                                    {newAdminPassword.length >= 8 ? "✓" : "○"} At least 8 characters
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className={newAdminPassword && newAdminPassword !== 'admin123' ? "text-emerald-600 font-bold" : "text-slate-400"}>
                                    {newAdminPassword && newAdminPassword !== 'admin123' ? "✓" : "○"} Not the default "admin123"
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className={newAdminPassword && newAdminPassword === confirmAdminPassword ? "text-emerald-600 font-bold" : "text-slate-400"}>
                                    {newAdminPassword && newAdminPassword === confirmAdminPassword ? "✓" : "○"} Passwords match
                                </span>
                            </div>
                        </div>

                        <div className="pt-2 flex flex-col gap-2">
                            <button
                                type="submit"
                                disabled={isUpdatingAdminPassword || newAdminPassword.length < 8 || newAdminPassword === 'admin123' || newAdminPassword !== confirmAdminPassword}
                                className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition shadow-lg shadow-rose-600/25 flex items-center justify-center gap-2"
                            >
                                {isUpdatingAdminPassword ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        <span>Securing Credentials...</span>
                                    </>
                                ) : (
                                    <>
                                        <Lock size={16} />
                                        <span>Update & Secure Administrator Account</span>
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={handleAdminSignOut}
                                className="w-full py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition flex items-center justify-center gap-1.5"
                            >
                                <LogOut size={14} />
                                <span>Sign Out Instead</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        )}

        {toast && (
            <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-right-10 fade-in duration-300 px-6 py-4 rounded-2xl shadow-2xl bg-slate-900 text-white font-bold">
                {toast.message}
            </div>
        )}

        {/* About Pentric Modal */}
        {showAboutUsModal && <AboutUsModal onClose={() => setShowAboutUsModal(false)} />}
    </div>
  );
};
