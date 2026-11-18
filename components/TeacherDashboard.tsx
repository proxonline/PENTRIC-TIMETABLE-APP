import React, { useState, useEffect, useRef, useMemo } from 'react';
import { storage } from '../services/storage';
import { monitorChatContent } from '../services/ai';
import { checkProfanity } from '../services/moderation';
import { ALL_SUBJECTS, ALL_CLASSES, DAYS, PERIODS } from '../constants';
import { getEligibleSubjectsForClass } from '../services/curriculum_eligibility';
import {
  buildTeacherScheduleSummary,
  formatSwapRequestSummary,
  formatTeacherDateLabel,
  getTimeOfDayGreeting,
  resolveClassDisplayName,
  resolveSubjectDisplayName,
  resolveTaughtSubjectsSummary,
  resolveTeacherDisplayName,
} from '../services/teacherDashboardUtils';
import {
  resolveTeacherTheme,
  TEACHER_THEME_LIST,
  TEACHER_THEMES,
} from '../services/teacherThemes';
import {
  Teacher,
  TeacherThemeId,
  Room,
  Subject,
  Class,
  SwapRequest,
  AppNotification,
  ChatMessage,
  TimetableGrid,
  TeacherAbsence,
} from '../types';
import { TimetableGrid as TimetableGridView } from './TimetableGrid';
import { UserGuide } from './UserGuide';
import { AboutUsModal } from './AboutUsModal';
import {
  Check,
  LogOut,
  Save,
  LayoutGrid,
  BookOpen,
  Clock,
  Send,
  Bell,
  Calendar,
  X,
  Info,
  MessageCircle,
  User,
  AlertTriangle,
  GraduationCap,
  ChevronRight,
  Camera,
  Mail,
  Phone,
  CheckCircle,
  RotateCcw,
  Filter,
  Trash,
  Menu,
  Inbox,
  ArrowLeft,
  Search,
  Book,
  Copy,
  CalendarX,
  Pencil,
  FileText,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Users,
  Palette,
} from 'lucide-react';

interface Props {
  onLogout: () => void;
  onSwitchSchool?: () => void;
}

const Toast = ({
  message,
  type,
  onClose,
  isDark = false,
}: {
  message: string;
  type: 'INFO' | 'ALERT' | 'SUCCESS';
  onClose: () => void;
  isDark?: boolean;
}) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const styles = isDark
    ? {
        INFO: 'bg-[#150E29]/92 backdrop-blur-xl border-purple-400/35 ring-1 ring-purple-500/30 text-slate-100 shadow-[0_14px_34px_-10px_rgba(124,58,237,0.45)]',
        ALERT: 'bg-rose-950/92 backdrop-blur-xl border-rose-400/40 ring-1 ring-rose-500/30 text-rose-100 shadow-[0_14px_34px_-10px_rgba(225,29,72,0.35)]',
        SUCCESS: 'bg-[#121D2B]/92 backdrop-blur-xl border-emerald-400/40 ring-1 ring-emerald-500/30 text-emerald-100 shadow-[0_14px_34px_-10px_rgba(16,185,129,0.3)]',
      }
    : {
        INFO: 'bg-white/85 backdrop-blur-xl border-white ring-1 ring-blue-200/70 text-slate-900 shadow-[0_14px_34px_-10px_rgba(37,99,235,0.22)]',
        ALERT: 'bg-rose-50/90 backdrop-blur-xl border-rose-200 ring-1 ring-rose-200/60 text-rose-900 shadow-[0_14px_34px_-10px_rgba(225,29,72,0.18)]',
        SUCCESS: 'bg-gradient-to-r from-white/90 via-sky-50/90 to-emerald-50/90 backdrop-blur-xl border-white ring-1 ring-emerald-200/70 text-emerald-950 shadow-[0_14px_34px_-10px_rgba(16,185,129,0.2)]',
      };

  return (
    <div
      className={`fixed bottom-5 right-5 left-4 sm:left-auto z-[100] ${styles[type]} border px-4 py-3.5 rounded-xl flex items-center gap-3 sm:max-w-md animate-in slide-in-from-bottom-4 duration-200`}
      role="status"
    >
      {type === 'SUCCESS' && <CheckCircle size={18} className={isDark ? 'text-emerald-400 shrink-0' : 'text-emerald-600 shrink-0'} />}
      {type === 'ALERT' && <AlertTriangle size={18} className={isDark ? 'text-rose-400 shrink-0' : 'text-rose-600 shrink-0'} />}
      {type === 'INFO' && <Info size={18} className={isDark ? 'text-violet-400 shrink-0' : 'text-blue-600 shrink-0'} />}
      <span className="font-medium text-xs sm:text-sm leading-snug">{message}</span>
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        className={`p-1 rounded-md shrink-0 ${isDark ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}
      >
        <X size={15} />
      </button>
    </div>
  );
};

export const TeacherDashboard: React.FC<Props> = ({ onLogout }) => {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [allTeachers, setAllTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [configuredSubjects, setConfiguredSubjects] = useState<Subject[]>(() => storage.getSubjects());
  const [configuredClasses, setConfiguredClasses] = useState<Class[]>(() => storage.getClasses());
  const [absences, setAbsences] = useState<TeacherAbsence[]>([]);
  const [step, setStep] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const currentSchool = storage.getCurrentSchool() || {
    id: 'ota_total_academy',
    name: 'OTA Total Academy',
    code: 'OTA',
    motto: 'Strictly for the Serious Minded Academics',
  };

  // Onboarding & Portfolio Editor state
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [tempSelectedClasses, setTempSelectedClasses] = useState<string[]>([]);
  const [tempClassSubjects, setTempClassSubjects] = useState<Record<string, string[]>>({});
  const [currentOnboardingClassIndex, setCurrentOnboardingClassIndex] = useState(0);
  const [onboardingSearch, setOnboardingSearch] = useState('');
  const [classCategoryFilter, setClassCategoryFilter] = useState<'ALL' | 'JS' | 'SS'>('ALL');
  const [showPortfolioModal, setShowPortfolioModal] = useState(false);

  // Sync assigned classes when onboarding starts
  useEffect(() => {
    if (teacher && !teacher.isCompleted) {
      if (teacher.assignedClasses && teacher.assignedClasses.length > 0 && tempSelectedClasses.length === 0) {
        setTempSelectedClasses(teacher.assignedClasses);
      }
      if (teacher.subjectsTaught && teacher.subjectsTaught.length > 0 && Object.keys(tempClassSubjects).length === 0) {
        const initialMap: Record<string, string[]> = {};
        (teacher.assignedClasses || []).forEach(cId => {
          initialMap[cId] = [...teacher.subjectsTaught];
        });
        setTempClassSubjects(initialMap);
      }
    }
  }, [teacher]);

  // Core data state
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [moderationError, setModerationError] = useState('');
  const [grid, setGrid] = useState<TimetableGrid | null>(null);
  const [viewClassId, setViewClassId] = useState<string>(() => configuredClasses[0]?.id || ALL_CLASSES?.[0]?.id || 'JS1A');
  const [swapModalData, setSwapModalData] = useState<any>(null);
  const [myOfferSlot, setMyOfferSlot] = useState<string>('');

  // Personal Schedule Modals
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [copiedCalendar, setCopiedCalendar] = useState(false);
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [absenceForm, setAbsenceForm] = useState({ startDate: '', endDate: '', reason: '' });
  const [lessonModal, setLessonModal] = useState<{
    day: number;
    period: number;
    classId: string;
    subjectName?: string;
    className?: string;
    note: string;
    link: string;
  } | null>(null);

  // Inbox State
  const [inboxFilter, setInboxFilter] = useState<'ALL' | 'UNREAD' | 'ALERTS'>('ALL');
  const [expandedNotif, setExpandedNotif] = useState<string | null>(null);

  // Profile Form State
  const [profileData, setProfileData] = useState({
    bio: '',
    contactEmail: '',
    contactPhone: '',
    profilePicture: '',
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const [msg, setMsg] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'INFO' | 'ALERT' | 'SUCCESS' } | null>(null);
  const [showAboutModal, setShowAboutModal] = useState(false);

  // Theme Switcher (persisted to Cloud Firestore via teacher.uiTheme)
  const [activeThemeId, setActiveThemeId] = useState<TeacherThemeId>('white_blue');
  const [showThemePopover, setShowThemePopover] = useState(false);
  const pendingThemeSwitchAtRef = useRef<number>(0);
  const themePopoverRef = useRef<HTMLDivElement>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  const theme = useMemo(() => resolveTeacherTheme(activeThemeId), [activeThemeId]);

  const loadData = () => {
    const teachers = storage.getTeachers();
    setAllTeachers(teachers);
    setRooms(storage.getRooms());
    setConfiguredSubjects(storage.getSubjects());
    const classesList = storage.getClasses();
    setConfiguredClasses(classesList);

    const t = teachers.find(x => x.id === storage.getLoggedInTeacherId());
    if (t) {
      setTeacher(t);
      if (t.uiTheme && Date.now() - pendingThemeSwitchAtRef.current > 2500) {
        setActiveThemeId(t.uiTheme);
      }
      const allNotes = storage.getNotifications(t.id);
      setNotifications(allNotes);
      setUnreadCount(allNotes.filter(n => !n.isRead).length);
      const allRequests = storage.getRequests();
      setRequests(
        allRequests.filter(
          r => r.teacherId === t.id || (r.type === 'AUTOMATED_SWAP' && r.requestData?.targetTeacherId === t.id)
        )
      );
      setAbsences(storage.getAbsences().filter(a => a.teacherId === t.id));
      setGrid(storage.getTimetable());
      setChatMessages(storage.getChatMessages());
    }
  };

  useEffect(() => {
    loadData();
    const initialGrid = storage.getTimetable();
    let prevGridStr: string | null = initialGrid ? JSON.stringify(initialGrid) : null;

    const unsubscribe = storage.subscribe(() => {
      loadData();
      const newGrid = storage.getTimetable();
      if (newGrid) {
        const newGridStr = JSON.stringify(newGrid);
        if (prevGridStr !== null && newGridStr !== prevGridStr) {
          setToast({
            message: 'Master timetable was updated by Administration. Your schedule is up to date.',
            type: 'SUCCESS',
          });
        }
        prevGridStr = newGridStr;
      }
    });

    const unsubConn = storage.subscribeConnectionStatus(connected => {
      setIsFirebaseConnected(connected);
    });
    return () => {
      unsubscribe();
      unsubConn();
    };
  }, []);

  useEffect(() => {
    const teacherId = storage.getLoggedInTeacherId();
    if (teacherId) {
      storage.updateTeacherPresence(teacherId);
      const interval = setInterval(() => {
        storage.updateTeacherPresence(teacherId);
      }, 30000);
      return () => clearInterval(interval);
    }
  }, []);

  useEffect(() => {
    if (step === 2) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, step]);

  useEffect(() => {
    if (teacher && !isEditingProfile) {
      setProfileData({
        bio: teacher.bio || '',
        contactEmail: teacher.contactEmail || '',
        contactPhone: teacher.contactPhone || '',
        profilePicture: teacher.profilePicture || '',
      });
    }
  }, [teacher, isEditingProfile]);

  const scheduleSummary = useMemo(() => {
    if (!teacher) {
      return {
        totalPeriods: 0,
        freePeriods: 38,
        dailyBreakdown: [0, 0, 0, 0, 0],
        maxConsecutivePeriods: 0,
        fatigueWarning: false,
        activeClasses: [],
        personalGrid: null,
        todayDayIndex: 0,
        todayDayName: 'Monday',
        isWeekendPreview: false,
        todayAgenda: [],
      };
    }
    return buildTeacherScheduleSummary({
      teacher,
      grid,
      configuredSubjects,
      configuredClasses,
      rooms,
    });
  }, [teacher, grid, configuredSubjects, configuredClasses, rooms]);

  const resolvedSubjects = useMemo(() => {
    if (!teacher) return [];
    return resolveTaughtSubjectsSummary({
      teacher,
      configuredSubjects,
      configuredClasses,
      grid,
    });
  }, [teacher, configuredSubjects, configuredClasses, grid]);

  useEffect(() => {
    if (!showThemePopover) return;
    const handleOutside = (e: MouseEvent) => {
      if (themePopoverRef.current && !themePopoverRef.current.contains(e.target as Node)) {
        setShowThemePopover(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowThemePopover(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showThemePopover]);

  const showToast = (message: string, type: 'INFO' | 'ALERT' | 'SUCCESS') => setToast({ message, type });

  const handleSelectTheme = (nextThemeId: TeacherThemeId) => {
    pendingThemeSwitchAtRef.current = Date.now();
    setActiveThemeId(nextThemeId);
    setShowThemePopover(false);
    if (teacher) {
      const updatedTeacher: Teacher = {
        ...teacher,
        uiTheme: nextThemeId,
      };
      setTeacher(updatedTeacher);
      storage.saveTeacher(updatedTeacher);
    }
    showToast(`Theme saved: ${TEACHER_THEMES[nextThemeId].name}`, 'SUCCESS');
  };

  const handleMarkRead = (id: string) => {
    storage.markRead(id);
    loadData();
  };

  const handleMarkAllRead = () => {
    notifications.filter(n => !n.isRead).forEach(n => storage.markRead(n.id));
    loadData();
    showToast('All notifications marked as read.', 'INFO');
  };

  const handleChatSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!teacher || !chatInput.trim()) return;

    const content = chatInput.trim();
    setModerationError('');

    const moderation = checkProfanity(content);
    if (!moderation.isClean) {
      setModerationError('Message blocked: Profanity and inappropriate language are prohibited in the faculty staff room.');
      showToast('Message blocked by automated moderation.', 'ALERT');
      return;
    }

    setChatInput('');
    const msgId = crypto.randomUUID();
    storage.addChatMessage({
      id: msgId,
      senderId: teacher.id,
      senderName: teacher.name,
      content,
      timestamp: Date.now(),
      isFlagged: false,
      handled: true,
    });
    loadData();

    monitorChatContent(content)
      .then(check => {
        if (!check.isSafe) storage.flagMessage(msgId, check.flagReason || 'Inappropriate language');
      })
      .catch(() => {});
  };

  const handleCellClickForNote = (d: number, p: number) => {
    const myGrid = scheduleSummary.personalGrid?.['MY_SCHEDULE'];
    if (!myGrid) return;
    const cell = myGrid[d]?.[p];
    if (!cell || cell.subjectId === 'FREE') return;
    const cId = cell._realClassId || '';
    setLessonModal({
      day: d,
      period: p,
      classId: cId,
      subjectName: resolveSubjectDisplayName(cell.subjectId, configuredSubjects),
      className: cell._displayClass || resolveClassDisplayName(cId, configuredClasses),
      note: cell.lessonNote || '',
      link: cell.lessonLink || '',
    });
  };

  const handleSaveLessonNote = async () => {
    if (!lessonModal || !teacher) return;
    await storage.saveLessonNote(lessonModal.classId, lessonModal.day, lessonModal.period, lessonModal.note, lessonModal.link);
    storage.addAuditLog({
      actorName: teacher.name,
      actorRole: 'TEACHER',
      action: 'LESSON_NOTE_UPDATE',
      details: `Updated lesson note for Period ${lessonModal.period + 1}`,
    });
    loadData();
    showToast('Lesson note saved.', 'SUCCESS');
    setLessonModal(null);
  };

  const handleRequestAbsence = () => {
    if (!teacher || !absenceForm.startDate || !absenceForm.endDate || !absenceForm.reason.trim()) {
      showToast('Please complete all absence fields.', 'ALERT');
      return;
    }
    if (absenceForm.endDate < absenceForm.startDate) {
      showToast('End date cannot be earlier than start date.', 'ALERT');
      return;
    }
    const newAbsence: TeacherAbsence = {
      id: 'abs_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      teacherId: teacher.id,
      teacherName: teacher.name,
      startDate: absenceForm.startDate,
      endDate: absenceForm.endDate,
      reason: absenceForm.reason.trim(),
      status: 'PENDING',
      createdAt: Date.now(),
    };
    storage.saveAbsence(newAbsence);
    storage.addAuditLog({
      actorName: teacher.name,
      actorRole: 'TEACHER',
      action: 'ABSENCE_REQUEST',
      details: `Requested absence: ${absenceForm.startDate} to ${absenceForm.endDate}`,
    });
    loadData();
    showToast('Absence request submitted to Administration.', 'SUCCESS');
    setShowAbsenceModal(false);
    setAbsenceForm({ startDate: '', endDate: '', reason: '' });
  };

  const toggleClassSelection = (classId: string) =>
    setTempSelectedClasses(prev => (prev.includes(classId) ? prev.filter(id => id !== classId) : [...prev, classId]));

  const toggleSubjectForClass = (classId: string, subjectId: string) =>
    setTempClassSubjects(prev => {
      const cur = prev[classId] || [];
      const nw = cur.includes(subjectId) ? cur.filter(id => id !== subjectId) : [...cur, subjectId];
      return { ...prev, [classId]: nw };
    });

  const finishOnboarding = () => {
    if (!teacher) return;
    const allSubjects = new Set<string>();
    tempSelectedClasses.forEach(cid => {
      tempClassSubjects[cid]?.forEach(s => allSubjects.add(s));
    });

    const filteredClassSubjects: Record<string, string[]> = {};
    tempSelectedClasses.forEach(cid => {
      if (Array.isArray(tempClassSubjects[cid]) && tempClassSubjects[cid].length > 0) {
        filteredClassSubjects[cid] = [...tempClassSubjects[cid]];
      }
    });

    const updatedTeacher: Teacher = {
      ...teacher,
      assignedClasses: tempSelectedClasses,
      subjectsTaught: Array.from(allSubjects),
      classSubjects: filteredClassSubjects,
      isCompleted: true,
    };

    storage.saveTeacher(updatedTeacher);
    setTeacher(updatedTeacher);
    setStep(0);
    showToast('Teaching portfolio saved. Any matching timetable slots are bound automatically.', 'SUCCESS');
  };

  const openPortfolioEditor = () => {
    if (!teacher) return;
    const currentClasses = [...(teacher.assignedClasses || [])];
    const initialMap: Record<string, string[]> = {};
    const catalogClasses = configuredClasses.length > 0 ? configuredClasses : ALL_CLASSES;
    const currentSubjectIds = (teacher.subjectsTaught || []).map(token => {
      const lower = token.toLowerCase();
      const match =
        configuredSubjects.find(s => s.id === token || s.id.toLowerCase() === lower || (s.code || '').toLowerCase() === lower || s.name.toLowerCase() === lower) ||
        ALL_SUBJECTS.find(s => s.id === token || s.id.toLowerCase() === lower || (s.code || '').toLowerCase() === lower || s.name.toLowerCase() === lower);
      return match ? match.id : token;
    });

    currentClasses.forEach(cId => {
      if (teacher.classSubjects?.[cId] && teacher.classSubjects[cId].length > 0) {
        initialMap[cId] = [...teacher.classSubjects[cId]];
        return;
      }
      const clsObj = catalogClasses.find(c => c.id === cId);
      if (clsObj) {
        const eligibleIds = new Set(getEligibleSubjectsForClass(clsObj, configuredSubjects).map(s => s.id));
        const matched = currentSubjectIds.filter(sid => eligibleIds.has(sid));
        initialMap[cId] = matched.length > 0 ? matched : [...currentSubjectIds];
      } else {
        initialMap[cId] = [...currentSubjectIds];
      }
    });

    setTempSelectedClasses(currentClasses);
    setTempClassSubjects(initialMap);
    setCurrentOnboardingClassIndex(0);
    setOnboardingSearch('');
    setClassCategoryFilter('ALL');
    setOnboardingStep(1);
    setShowPortfolioModal(true);
  };

  const savePortfolioChanges = () => {
    if (!teacher) return;
    const allSubjects = new Set<string>();
    tempSelectedClasses.forEach(cid => {
      tempClassSubjects[cid]?.forEach(s => allSubjects.add(s));
    });

    const filteredClassSubjects: Record<string, string[]> = {};
    tempSelectedClasses.forEach(cid => {
      if (Array.isArray(tempClassSubjects[cid]) && tempClassSubjects[cid].length > 0) {
        filteredClassSubjects[cid] = [...tempClassSubjects[cid]];
      }
    });

    const updatedTeacher: Teacher = {
      ...teacher,
      assignedClasses: tempSelectedClasses,
      subjectsTaught: Array.from(allSubjects),
      classSubjects: filteredClassSubjects,
      isCompleted: true,
    };

    storage.saveTeacher(updatedTeacher);
    setTeacher(updatedTeacher);
    setShowPortfolioModal(false);
    showToast('Teaching classes & subjects updated.', 'SUCCESS');
  };

  const handleRequestSubmit = () => {
    if (!teacher || !msg.trim()) return;
    storage.addRequest({
      id: crypto.randomUUID(),
      teacherId: teacher.id,
      teacherName: teacher.name,
      type: 'SWAP',
      details: msg.trim(),
      status: 'PENDING',
      timestamp: Date.now(),
    });
    setMsg('');
    showToast('Request submitted to Administration.', 'SUCCESS');
    loadData();
  };

  const sendAutomatedSwapRequest = () => {
    if (!swapModalData || !myOfferSlot || !teacher) return;
    const [offerClassId, offerD, offerP, offerSubId] = myOfferSlot.split('|');
    storage.addRequest({
      id: crypto.randomUUID(),
      teacherId: teacher.id,
      teacherName: teacher.name,
      type: 'AUTOMATED_SWAP',
      status: 'PENDING',
      timestamp: Date.now(),
      details: `Proposed swap`,
      requestData: {
        targetClassId: swapModalData.coords.classId,
        targetDay: swapModalData.coords.d,
        targetPeriod: swapModalData.coords.p,
        targetSubjectId: swapModalData.targetCell.subjectId,
        targetTeacherId: swapModalData.targetCell.teacherId,
        offerClassId,
        offerDay: parseInt(offerD, 10),
        offerPeriod: parseInt(offerP, 10),
        offerSubjectId: offerSubId,
      },
    });
    setSwapModalData(null);
    setMyOfferSlot('');
    loadData();
    showToast('Swap proposal submitted.', 'SUCCESS');
  };

  const getMySlots = () => {
    if (!grid || !teacher) return [];
    const slots: { label: string; value: string }[] = [];
    for (const cId in grid) {
      if (!grid[cId] || typeof grid[cId] !== 'object') continue;
      for (let d = 0; d < 5; d++) {
        if (!grid[cId][d] || typeof grid[cId][d] !== 'object') continue;
        for (let p = 0; p < 8; p++) {
          const cell = grid[cId]?.[d]?.[p];
          if (cell && (cell.teacherId === teacher.id || cell.teacherIds?.includes(teacher.id))) {
            const subName = resolveSubjectDisplayName(cell.subjectId, configuredSubjects);
            const className = resolveClassDisplayName(cId, configuredClasses);
            slots.push({
              label: `${DAYS[d]} ${PERIODS[p].label} · ${subName} (${className})`,
              value: `${cId}|${d}|${p}|${cell.subjectId}`,
            });
          }
        }
      }
    }
    return slots;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast('Image too large (max 8MB).', 'ALERT');
      return;
    }
    const reader = new FileReader();
    reader.onload = event => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = 256;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
            const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            setProfileData(prev => ({ ...prev, profilePicture: optimizedDataUrl }));
            if (teacher) {
              const updatedTeacher: Teacher = {
                ...teacher,
                bio: profileData.bio || teacher.bio,
                contactEmail: profileData.contactEmail || teacher.contactEmail,
                contactPhone: profileData.contactPhone || teacher.contactPhone,
                profilePicture: optimizedDataUrl,
              };
              storage.saveTeacher(updatedTeacher);
              setTeacher(updatedTeacher);
              showToast('Profile picture updated.', 'SUCCESS');
            }
          }
        } catch {
          const rawData = event.target?.result as string;
          setProfileData(prev => ({ ...prev, profilePicture: rawData }));
          if (teacher) {
            const updatedTeacher: Teacher = {
              ...teacher,
              bio: profileData.bio || teacher.bio,
              contactEmail: profileData.contactEmail || teacher.contactEmail,
              contactPhone: profileData.contactPhone || teacher.contactPhone,
              profilePicture: rawData,
            };
            storage.saveTeacher(updatedTeacher);
            setTeacher(updatedTeacher);
            showToast('Profile picture updated.', 'SUCCESS');
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = () => {
    if (!teacher) return;
    const updated = { ...teacher, ...profileData };
    storage.saveTeacher(updated);
    setTeacher(updated);
    setIsEditingProfile(false);
    showToast('Profile updated successfully.', 'SUCCESS');
  };

  const filteredNotifications = notifications.filter(n => {
    if (inboxFilter === 'UNREAD') return !n.isRead;
    if (inboxFilter === 'ALERTS') return n.type === 'ALERT';
    return true;
  });

  if (!teacher) return null;

  const catalogClasses = configuredClasses.length > 0 ? configuredClasses : ALL_CLASSES;
  const catalogSubjects = configuredSubjects.length > 0 ? configuredSubjects : ALL_SUBJECTS;

  const renderClassAndSubjectPicker = (mode: 'ONBOARDING' | 'PORTFOLIO_EDIT') => {
    const activeStep = mode === 'PORTFOLIO_EDIT' && onboardingStep === 0 ? 1 : onboardingStep;
    const currentClassId = tempSelectedClasses?.[currentOnboardingClassIndex];
    const currentClass = catalogClasses.find(c => c && c.id === currentClassId);
    const search = (onboardingSearch || '').toLowerCase();

    const isJunior = (c: Class) => c.level === 'JUNIOR' || c.id.startsWith('JS');
    const isSenior = (c: Class) => c.level === 'SENIOR' || c.id.startsWith('SS');

    const filteredClasses = catalogClasses.filter(c => {
      const matchesSearch =
        (c.name || '').toLowerCase().includes(search) || (c.category || '').toLowerCase().includes(search);
      if (!matchesSearch) return false;
      if (classCategoryFilter === 'JS') return isJunior(c);
      if (classCategoryFilter === 'SS') return isSenior(c);
      return true;
    });

    const eligibleSubjects = currentClass ? getEligibleSubjectsForClass(currentClass, catalogSubjects) : [];
    const filteredSubjects = eligibleSubjects.filter(
      s => (s.name || '').toLowerCase().includes(search) || (s.code || '').toLowerCase().includes(search)
    );

    const handleSelectAllJunior = () => {
      const juniorIds = catalogClasses.filter(isJunior).map(c => c.id);
      setTempSelectedClasses(prev => Array.from(new Set([...prev, ...juniorIds])));
    };

    const handleSelectAllSenior = () => {
      const seniorIds = catalogClasses.filter(isSenior).map(c => c.id);
      setTempSelectedClasses(prev => Array.from(new Set([...prev, ...seniorIds])));
    };

    const handleClearAllClasses = () => {
      setTempSelectedClasses([]);
    };

    const handleSelectAllSubjectsForCurrentClass = () => {
      if (!currentClass) return;
      const eligibleIds = eligibleSubjects
        .filter(
          s =>
            !allTeachers.some(
              t => t.id !== teacher.id && t.assignedClasses.includes(currentClass.id) && t.subjectsTaught.includes(s.id)
            )
        )
        .map(s => s.id);
      setTempClassSubjects(prev => ({
        ...prev,
        [currentClass.id]: eligibleIds,
      }));
    };

    const handleClearSubjectsForCurrentClass = () => {
      if (!currentClass) return;
      setTempClassSubjects(prev => ({
        ...prev,
        [currentClass.id]: [],
      }));
    };

    return (
      <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${theme.isDark ? 'bg-transparent text-slate-100' : 'bg-gradient-to-br from-white/85 via-sky-50/60 to-blue-50/70 backdrop-blur-xl'}`}>
        {activeStep === 0 && mode === 'ONBOARDING' && (
          <div className="flex-1 flex flex-col justify-between p-5 sm:p-8 overflow-y-auto custom-scrollbar">
            <div className="max-w-lg mx-auto w-full my-auto text-center py-4">
              <div className={`w-14 h-14 ${theme.accentBadge} rounded-xl mx-auto flex items-center justify-center mb-5`}>
                <GraduationCap size={28} />
              </div>
              <div className={`text-xs font-semibold tracking-wide mb-2 ${theme.textAccent}`}>{currentSchool.name}</div>
              <h2 className={`text-2xl sm:text-3xl font-extrabold mb-2 tracking-tight ${theme.textPrimary}`}>
                Welcome, {teacher.name.split(' ')[0]}
              </h2>
              <p className={`text-sm leading-relaxed mb-6 max-w-md mx-auto ${theme.textSecondary}`}>
                Set up your classes and subjects in two simple steps so your daily lessons and timetable appear cleanly on your Home screen.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left mb-6">
                <div className={`p-4 ${theme.glassCard}`}>
                  <div className={`w-7 h-7 rounded-lg ${theme.accentBadge} flex items-center justify-center text-xs font-bold mb-2 font-mono-num`}>
                    1
                  </div>
                  <div className={`font-bold text-sm mb-0.5 ${theme.textPrimary}`}>Pick Your Classes</div>
                  <div className={`text-xs leading-normal ${theme.textMuted}`}>Select the class arms you teach this term.</div>
                </div>
                <div className={`p-4 ${theme.glassCard}`}>
                  <div className={`w-7 h-7 rounded-lg ${theme.softInset} ${theme.textAccent} flex items-center justify-center text-xs font-bold mb-2 font-mono-num`}>
                    2
                  </div>
                  <div className={`font-bold text-sm mb-0.5 ${theme.textPrimary}`}>Pick Your Subjects</div>
                  <div className={`text-xs leading-normal ${theme.textMuted}`}>Choose the subjects you teach in each class.</div>
                </div>
              </div>
            </div>

            <div className={`pt-4 border-t ${theme.isDark ? 'border-white/10' : 'border-blue-100/80'} flex items-center justify-between gap-3 shrink-0`}>
              <button
                onClick={onLogout}
                className={`px-4 py-2.5 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
              >
                Sign Out
              </button>
              <button
                onClick={() => setOnboardingStep(1)}
                className={`px-5 py-2.5 rounded-lg font-bold text-sm transition flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.primaryBtn}`}
              >
                <span>Get Started</span>
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        )}

        {activeStep === 1 && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={`p-4 sm:p-6 pb-3 ${theme.cardHeader} backdrop-blur-md shrink-0`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <h2 className={`text-lg sm:text-xl font-bold leading-tight ${theme.textPrimary}`}>Select Classes You Teach</h2>
                  <p className={`text-xs mt-0.5 ${theme.textMuted}`}>Choose every class arm assigned to you this term.</p>
                </div>
                <div className={`text-xs font-bold font-mono-num shrink-0 ${theme.textAccent}`}>
                  {tempSelectedClasses.length} selected
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <div className="relative flex-1">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${theme.textAccent}`} size={15} />
                  <input
                    type="text"
                    placeholder="Search classes (JS1, SS2, A, B...)"
                    value={onboardingSearch}
                    onChange={e => setOnboardingSearch(e.target.value)}
                    className={`w-full pl-9 pr-3 py-2 rounded-lg text-xs font-semibold outline-none ${theme.input}`}
                  />
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  <button
                    onClick={() => setClassCategoryFilter('ALL')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 border transition ${
                      classCategoryFilter === 'ALL' ? theme.primaryBtn : theme.secondaryBtn
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setClassCategoryFilter('JS')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 border transition ${
                      classCategoryFilter === 'JS' ? theme.primaryBtn : theme.secondaryBtn
                    }`}
                  >
                    Junior (JS)
                  </button>
                  <button
                    onClick={() => setClassCategoryFilter('SS')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 border transition ${
                      classCategoryFilter === 'SS' ? theme.primaryBtn : theme.secondaryBtn
                    }`}
                  >
                    Senior (SS)
                  </button>
                </div>
              </div>

              <div className={`flex flex-wrap items-center gap-2 mt-2.5 pt-2.5 border-t ${theme.isDark ? 'border-white/10' : 'border-blue-100/70'} text-xs`}>
                <span className={`font-medium ${theme.textMuted}`}>Quick select:</span>
                <button
                  onClick={handleSelectAllJunior}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition ${theme.secondaryBtn}`}
                >
                  + All Junior
                </button>
                <button
                  onClick={handleSelectAllSenior}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition ${theme.secondaryBtn}`}
                >
                  + All Senior
                </button>
                {tempSelectedClasses.length > 0 && (
                  <button
                    onClick={handleClearAllClasses}
                    className={`px-2.5 py-1 rounded-lg border font-semibold transition ${
                      theme.isDark
                        ? 'bg-rose-500/20 border-rose-400/35 text-rose-200 hover:bg-rose-500/30'
                        : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                    }`}
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0 custom-scrollbar">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {filteredClasses.map(c => {
                  const isSelected = tempSelectedClasses.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleClassSelection(c.id)}
                      className={`min-h-[44px] p-2.5 rounded-lg border text-xs sm:text-sm font-bold transition flex items-center justify-center gap-1.5 select-none ${
                        isSelected ? theme.primaryBtn : theme.subjectUnselectedCard
                      }`}
                    >
                      {isSelected && <Check size={14} className="stroke-[3]" />}
                      <span>{c.name}</span>
                    </button>
                  );
                })}
              </div>
              {filteredClasses.length === 0 && (
                <div className={`py-12 text-center text-xs ${theme.textMuted}`}>No classes match your filter.</div>
              )}
            </div>

            <div className={`p-3 sm:p-4 backdrop-blur-md border-t ${theme.isDark ? 'bg-black/25 border-white/10' : 'bg-white/75 border-blue-100/80'} flex items-center justify-between gap-3 shrink-0`}>
              {mode === 'ONBOARDING' ? (
                <button
                  onClick={() => setOnboardingStep(0)}
                  className={`px-4 py-2.5 rounded-lg font-semibold text-xs sm:text-sm transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                >
                  <ArrowLeft size={16} />
                  <span>Intro</span>
                </button>
              ) : (
                <button
                  onClick={() => setShowPortfolioModal(false)}
                  className={`px-4 py-2.5 rounded-lg font-semibold text-xs sm:text-sm transition whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                >
                  Cancel
                </button>
              )}
              <button
                onClick={() => {
                  setOnboardingStep(2);
                  setCurrentOnboardingClassIndex(0);
                  setOnboardingSearch('');
                }}
                disabled={tempSelectedClasses.length === 0}
                className={`px-5 py-2.5 sm:px-6 rounded-lg font-bold text-xs sm:text-sm transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.primaryBtn}`}
              >
                <span>Assign Subjects ({tempSelectedClasses.length})</span>
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        )}

        {activeStep === 2 && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={`p-4 sm:p-6 pb-3 ${theme.cardHeader} backdrop-blur-md shrink-0`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <div className={`text-[11px] font-bold uppercase tracking-wider mb-0.5 font-mono-num ${theme.textAccent}`}>
                    Class {currentOnboardingClassIndex + 1} of {tempSelectedClasses.length}
                  </div>
                  <h2 className={`text-lg sm:text-xl font-bold leading-tight ${theme.textPrimary}`}>
                    {currentClass?.name || 'Class'}
                  </h2>
                  <p className={`text-xs mt-0.5 ${theme.textMuted}`}>Select the subjects you teach in {currentClass?.name}.</p>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-xs font-bold font-mono-num ${theme.textAccent}`}>
                    {tempClassSubjects[currentClass?.id || '']?.length || 0} picked
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-2 custom-scrollbar">
                {tempSelectedClasses.map((cId, idx) => {
                  const c = catalogClasses.find(cls => cls.id === cId);
                  const isCurrent = idx === currentOnboardingClassIndex;
                  const count = tempClassSubjects[cId]?.length || 0;
                  return (
                    <button
                      key={cId}
                      onClick={() => {
                        setCurrentOnboardingClassIndex(idx);
                        setOnboardingSearch('');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition flex items-center gap-1.5 border ${
                        isCurrent
                          ? theme.primaryBtn
                          : count > 0
                            ? theme.isDark
                              ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/35'
                              : 'bg-emerald-50/90 text-emerald-800 border-emerald-200'
                            : theme.secondaryBtn
                      }`}
                    >
                      <span>{c?.name || cId}</span>
                      <span className="font-mono-num opacity-80">({count})</span>
                    </button>
                  );
                })}
              </div>

              <div className={`flex flex-col sm:flex-row gap-2 mt-2 pt-2 border-t ${theme.isDark ? 'border-white/10' : 'border-blue-100/70'}`}>
                <div className="relative flex-1">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${theme.textAccent}`} size={15} />
                  <input
                    type="text"
                    placeholder={`Search subjects for ${currentClass?.name}...`}
                    value={onboardingSearch}
                    onChange={e => setOnboardingSearch(e.target.value)}
                    className={`w-full pl-9 pr-3 py-2 rounded-lg text-xs font-semibold outline-none ${theme.input}`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAllSubjectsForCurrentClass}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition ${theme.secondaryBtn}`}
                  >
                    Select All Eligible
                  </button>
                  <button
                    onClick={handleClearSubjectsForCurrentClass}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition ${theme.secondaryBtn}`}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0 custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {filteredSubjects.map(s => {
                  if (!currentClass) return null;
                  const takenBy = allTeachers.find(
                    t =>
                      t.id !== teacher.id &&
                      t.assignedClasses.includes(currentClass.id) &&
                      t.subjectsTaught.includes(s.id)
                  );
                  const isTaken = !!takenBy;
                  const isSelected = tempClassSubjects[currentClass.id]?.includes(s.id);

                  return (
                    <button
                      key={s.id}
                      onClick={() => !isTaken && toggleSubjectForClass(currentClass.id, s.id)}
                      disabled={isTaken}
                      className={`p-3 rounded-lg border text-left transition flex items-start gap-3 select-none ${
                        isTaken
                          ? theme.isDark
                            ? 'bg-white/5 border-white/10 opacity-50 cursor-not-allowed text-slate-400'
                            : 'bg-white/40 border-slate-200 opacity-60 cursor-not-allowed'
                          : isSelected
                            ? theme.subjectSelectedCard
                            : theme.subjectUnselectedCard
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                          isSelected
                            ? theme.accentBadge + ' border-transparent'
                            : theme.isDark
                              ? 'bg-white/5 border-white/25'
                              : 'bg-white border-blue-200'
                        }`}
                      >
                        {isSelected && <Check size={13} className="stroke-[3]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`font-bold text-xs sm:text-sm leading-tight truncate ${theme.textPrimary}`}>{s.name}</div>
                        <div className={`flex items-center gap-1.5 mt-1 text-[11px] font-mono-num ${theme.textMuted}`}>
                          <span>{s.code || s.id}</span>
                          {s.category && <span>· {s.category}</span>}
                        </div>
                        {isTaken && (
                          <div className={`mt-1 text-[11px] font-semibold ${theme.isDark ? 'text-rose-300' : 'text-rose-600'}`}>
                            Assigned to {takenBy?.name ? takenBy.name.split(' ')[0] : 'Staff'}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {filteredSubjects.length === 0 && (
                <div className={`py-12 text-center text-xs ${theme.textMuted}`}>No subjects found matching your search.</div>
              )}
            </div>

            <div className={`p-3 sm:p-4 backdrop-blur-md border-t ${theme.isDark ? 'bg-black/25 border-white/10' : 'bg-white/75 border-blue-100/80'} flex items-center justify-between gap-3 shrink-0`}>
              {currentOnboardingClassIndex > 0 ? (
                <button
                  onClick={() => {
                    setCurrentOnboardingClassIndex(prev => prev - 1);
                    setOnboardingSearch('');
                  }}
                  className={`px-4 py-2.5 rounded-lg font-semibold text-xs sm:text-sm transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                >
                  <ArrowLeft size={16} />
                  <span>Previous Class</span>
                </button>
              ) : (
                <button
                  onClick={() => setOnboardingStep(1)}
                  className={`px-4 py-2.5 rounded-lg font-semibold text-xs sm:text-sm transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                >
                  <ArrowLeft size={16} />
                  <span>Back to Classes</span>
                </button>
              )}

              {currentOnboardingClassIndex < tempSelectedClasses.length - 1 ? (
                <button
                  onClick={() => {
                    setCurrentOnboardingClassIndex(prev => prev + 1);
                    setOnboardingSearch('');
                  }}
                  className={`px-5 py-2.5 rounded-lg font-bold text-xs sm:text-sm transition flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.primaryBtn}`}
                >
                  <span>
                    Next: {catalogClasses.find(c => c.id === tempSelectedClasses[currentOnboardingClassIndex + 1])?.name || 'Class'}
                  </span>
                  <ChevronRight size={17} />
                </button>
              ) : (
                <button
                  onClick={mode === 'ONBOARDING' ? finishOnboarding : savePortfolioChanges}
                  className={`px-5 py-2.5 rounded-lg font-bold text-xs sm:text-sm transition flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.primaryBtn}`}
                >
                  <CheckCircle size={17} />
                  <span>{mode === 'ONBOARDING' ? 'Save & Open Home' : 'Save Changes'}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!teacher.isCompleted) {
    return (
      <div className={`fixed inset-0 z-50 ${theme.appShell} backdrop-blur-xl flex items-center justify-center p-0 sm:p-4 md:p-6 overflow-hidden font-teacher-ui`}>
        <div className={`w-full h-[100dvh] sm:h-auto sm:max-h-[92dvh] sm:max-w-4xl ${theme.onboardingContainer} sm:rounded-xl overflow-hidden flex flex-col md:flex-row`}>
          <aside className={`hidden md:flex md:w-64 ${theme.onboardingSidebar} p-6 flex-col justify-between shrink-0`}>
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-9 h-9 ${theme.brandBadge} rounded-lg flex items-center justify-center`}>
                  <GraduationCap size={19} />
                </div>
                <div>
                  <h1 className={`font-bold text-sm tracking-tight ${theme.textPrimary}`}>Faculty Setup</h1>
                  <p className={`text-[11px] ${theme.textMuted}`}>{currentSchool.name}</p>
                </div>
              </div>

              <div className="space-y-2">
                {[
                  { id: 0, label: 'Welcome' },
                  { id: 1, label: 'Your Classes', count: tempSelectedClasses.length },
                  { id: 2, label: 'Your Subjects' },
                ].map(item => (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                      onboardingStep === item.id
                        ? theme.softInset + ` ${theme.textPrimary} font-bold shadow-sm`
                        : onboardingStep > item.id
                          ? theme.isDark
                            ? 'bg-emerald-500/20 border-emerald-400/35 text-emerald-200 font-medium'
                            : 'bg-emerald-50/80 border-emerald-200 text-emerald-800 font-medium'
                          : `border-transparent ${theme.textMuted}`
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold font-mono-num ${
                          onboardingStep > item.id
                            ? 'bg-emerald-600 text-white'
                            : onboardingStep === item.id
                              ? theme.accentBadge
                              : theme.softInset
                        }`}
                      >
                        {onboardingStep > item.id ? <Check size={12} /> : item.id + 1}
                      </span>
                      <span>{item.label}</span>
                    </div>
                    {item.count !== undefined && item.count > 0 && (
                      <span className={`font-mono-num text-[11px] ${theme.textAccent}`}>{item.count}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className={`pt-4 ${theme.sidebarDivider} flex items-center gap-3`}>
              <div className={`w-8 h-8 rounded-lg ${theme.brandBadge} flex items-center justify-center font-bold text-xs`}>
                {teacher.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-xs font-bold truncate ${theme.textPrimary}`}>{teacher.name}</div>
                <div className={`text-[11px] truncate ${theme.textMuted}`}>@{teacher.username}</div>
              </div>
            </div>
          </aside>

          <div className={`md:hidden ${theme.header} px-4 py-3 shrink-0 flex flex-col gap-2`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 ${theme.brandBadge} rounded-lg flex items-center justify-center`}>
                  <GraduationCap size={14} />
                </div>
                <span className={`font-bold text-sm ${theme.textPrimary}`}>Teacher Setup</span>
              </div>
              <span className={`text-xs font-semibold font-mono-num ${theme.textMuted}`}>
                Step {onboardingStep + 1} of 3
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 h-1 w-full">
              {[0, 1, 2].map(idx => (
                <div key={idx} className={`rounded-sm ${onboardingStep >= idx ? 'bg-violet-500' : theme.isDark ? 'bg-white/15' : 'bg-blue-100'}`} />
              ))}
            </div>
          </div>

          {renderClassAndSubjectPicker('ONBOARDING')}
        </div>
      </div>
    );
  }

  const pageMeta: Record<number, { title: string; subtitle: string }> = {
    0: { title: 'Home', subtitle: 'Your subjects, today’s classes, and weekly planner' },
    6: { title: 'Messages', subtitle: 'School updates, alerts, and swap notices' },
    1: { title: 'My Timetable', subtitle: 'Your weekly classes, lesson notes, and calendar feed' },
    2: { title: 'Staff Room', subtitle: 'Chat and coordinate with fellow teachers' },
    3: { title: 'Swaps & Requests', subtitle: 'Request class swaps or schedule help' },
    5: { title: 'School Timetable', subtitle: 'Browse timetables across all school classes' },
    7: { title: 'Help Guide', subtitle: 'Quick instructions for teachers' },
    4: { title: 'My Profile', subtitle: 'Bio, contact details, themes & subjects' },
  };

  const statusApprovedCls = theme.isDark
    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/35'
    : 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  const statusPendingCls = theme.isDark
    ? 'bg-amber-500/20 text-amber-200 border border-amber-400/35'
    : 'bg-amber-50 text-amber-700 border border-amber-200';
  const statusRejectedCls = theme.isDark
    ? 'bg-rose-500/20 text-rose-200 border border-rose-400/35'
    : 'bg-rose-50 text-rose-700 border border-rose-200';

  const activeMeta = pageMeta[step] || pageMeta[0];
  const pendingRequestsCount = requests.filter(r => r.status === 'PENDING').length;
  const greeting = getTimeOfDayGreeting();
  const dateLabel = formatTeacherDateLabel();
  const maxDailyLoad = Math.max(1, ...scheduleSummary.dailyBreakdown);
  const inlineSubjectsPreview =
    resolvedSubjects.length > 0
      ? resolvedSubjects
          .slice(0, 3)
          .map(s => s.name)
          .join(', ') + (resolvedSubjects.length > 3 ? ` +${resolvedSubjects.length - 3} more` : '')
      : 'None assigned yet';
  const inlineClassesPreview =
    scheduleSummary.activeClasses.length > 0
      ? scheduleSummary.activeClasses
          .slice(0, 4)
          .map(c => c.name)
          .join(' · ') +
        (scheduleSummary.activeClasses.length > 4 ? ` +${scheduleSummary.activeClasses.length - 4}` : '')
      : 'No classes selected';

  const SidebarBtn = ({
    id,
    label,
    icon: Icon,
    badge,
  }: {
    id: number;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    badge?: number;
  }) => {
    const isActive = step === id;
    return (
      <button
        onClick={() => {
          setStep(id);
          setIsMobileMenuOpen(false);
        }}
        className={`w-full min-h-[42px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${
          isActive ? theme.navActive : theme.navInactive
        }`}
      >
        <Icon size={17} className={`shrink-0 ${isActive ? 'text-white' : theme.navIconInactive}`} />
        <span className="flex-1 text-left truncate">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span
            className={`px-1.5 py-0.5 rounded-md text-[11px] font-bold font-mono-num ${
              isActive ? theme.navBadgeActive : theme.navBadgeInactive
            }`}
          >
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className={`relative flex h-screen ${theme.appShell} font-teacher-ui overflow-hidden transition-colors duration-300`}>
      {/* Ambient Gradient Light Blooms for Genuine Frosted Glass Refraction */}
      <div className="pointer-events-none select-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
        <div className={`absolute -top-32 -left-24 w-[34rem] h-[34rem] rounded-full ${theme.orb1} blur-3xl opacity-90 transition-colors duration-500`} />
        <div className={`absolute -top-20 right-[-6rem] w-[38rem] h-[38rem] rounded-full ${theme.orb2} blur-3xl opacity-85 transition-colors duration-500`} />
        <div className={`absolute top-[38%] left-[32%] w-[30rem] h-[30rem] rounded-full ${theme.orb3} blur-3xl opacity-80 transition-colors duration-500`} />
        <div className={`absolute -bottom-32 right-[12%] w-[36rem] h-[36rem] rounded-full ${theme.orb4} blur-3xl opacity-85 transition-colors duration-500`} />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} isDark={theme.isDark} />}

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* FROSTED GLASS TEACHER SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 w-64 ${theme.sidebar} transform transition-transform duration-200 z-50 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } md:relative md:translate-x-0 flex flex-col shrink-0`}
      >
        <div className={`p-5 ${theme.sidebarHeader} flex items-center justify-between gap-2`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 ${theme.brandBadge} rounded-lg flex items-center justify-center shrink-0`}>
              <GraduationCap size={19} />
            </div>
            <div className="min-w-0">
              <div className={`font-bold text-sm tracking-tight truncate ${theme.textPrimary}`}>Faculty Workspace</div>
              <div className={`text-[11px] font-medium truncate ${theme.brandSubtext}`}>{currentSchool.name}</div>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="Close menu"
            className={`md:hidden p-2 rounded-lg ${theme.iconBtn}`}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
          <SidebarBtn id={0} label="Home" icon={LayoutGrid} />
          <SidebarBtn id={1} label="My Timetable" icon={Calendar} />
          <SidebarBtn id={6} label="Messages" icon={Inbox} badge={unreadCount} />
          <SidebarBtn id={2} label="Staff Room" icon={MessageCircle} />
          <SidebarBtn id={3} label="Swaps & Requests" icon={RotateCcw} badge={pendingRequestsCount} />
          <SidebarBtn id={5} label="School Timetable" icon={BookOpen} />
          <SidebarBtn id={4} label="My Profile" icon={User} />
          <SidebarBtn id={7} label="Help Guide" icon={Book} />

          <div className={`pt-3 mt-3 ${theme.sidebarDivider}`}>
            <button
              onClick={() => {
                setShowAboutModal(true);
                setIsMobileMenuOpen(false);
              }}
              className={`w-full min-h-[42px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap shrink-0 ${theme.navInactive}`}
            >
              <Info size={17} className={`shrink-0 ${theme.navIconInactive}`} />
              <span>About Pentric</span>
            </button>
          </div>
        </nav>

        <div className={`p-3.5 ${theme.sidebarFooter} space-y-2.5`}>
          <button
            onClick={() => {
              setStep(4);
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition text-left ${theme.profileMiniCard}`}
          >
            {teacher.profilePicture ? (
              <img src={teacher.profilePicture} alt={teacher.name} className="w-9 h-9 rounded-lg object-cover shrink-0 border border-white/20" />
            ) : (
              <div className={`w-9 h-9 rounded-lg ${theme.profileMiniAvatar} flex items-center justify-center font-bold text-sm shrink-0`}>
                {teacher.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className={`font-bold text-xs truncate ${theme.textPrimary}`}>{teacher.name}</div>
              <div className={`text-[11px] truncate font-mono-num ${theme.profileMiniMeta}`}>
                {resolvedSubjects.length} {resolvedSubjects.length === 1 ? 'subject' : 'subjects'} ·{' '}
                {scheduleSummary.activeClasses.length} classes
              </div>
            </div>
          </button>
          <button
            onClick={onLogout}
            className={`flex items-center justify-center gap-2 w-full min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 ${theme.logoutBtn}`}
          >
            <LogOut size={15} className="shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT VIEWPORT */}
      <div className="relative z-10 flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        <header className={`h-16 ${theme.header} px-3 sm:px-6 lg:px-8 flex justify-between items-center gap-3 shrink-0 z-30`}>
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className={`md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition shrink-0 ${theme.iconBtn}`}
            >
              <Menu size={20} />
            </button>
            {step !== 0 && (
              <button
                onClick={() => setStep(0)}
                aria-label="Back to Home"
                className={`min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg transition shrink-0 ${theme.iconBtn}`}
                title="Back to Home"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div className="min-w-0">
              <div className={`hidden sm:flex items-center gap-1.5 text-[11px] font-medium ${theme.headerBreadcrumb}`}>
                <span>Teacher Portal</span>
                <span>/</span>
                <span className={`font-semibold ${theme.textPrimary}`}>{activeMeta.title}</span>
              </div>
              <h2 className={`text-base sm:text-lg font-bold truncate leading-tight ${theme.textPrimary}`}>
                {activeMeta.title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <div className={`hidden xl:flex items-center gap-2 text-xs pr-1 ${theme.textSecondary}`}>
              <span className={`font-semibold ${theme.textPrimary}`}>{currentSchool.name}</span>
              <span className={theme.textMuted}>·</span>
              <span
                className={
                  isFirebaseConnected
                    ? theme.isDark
                      ? 'text-emerald-300 font-semibold'
                      : 'text-emerald-700 font-semibold'
                    : theme.isDark
                      ? 'text-amber-300 font-semibold'
                      : 'text-amber-700 font-semibold'
                }
              >
                {isFirebaseConnected ? 'Live Sync Connected' : 'Syncing'}
              </span>
            </div>

            {/* Theme Picker Popover Trigger */}
            <div className="relative" ref={themePopoverRef}>
              <button
                type="button"
                onClick={() => setShowThemePopover(prev => !prev)}
                aria-label="Choose color theme"
                aria-expanded={showThemePopover}
                className={`inline-flex items-center gap-2 px-3 min-h-[38px] rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
              >
                <span className={`w-3.5 h-3.5 rounded-md bg-gradient-to-br ${theme.swatchGradient} border border-white/40 shrink-0`} />
                <Palette size={14} className="sm:hidden shrink-0" />
                <span className="hidden sm:inline">{theme.name}</span>
              </button>

              {showThemePopover && (
                <div
                  className={`absolute right-0 mt-2 w-72 ${theme.modalPanel} p-3 z-[80] animate-in fade-in slide-in-from-top-2 duration-150`}
                >
                  <div className="flex items-center justify-between px-1 pb-2.5 mb-2 border-b border-current/10">
                    <div>
                      <div className={`text-xs font-bold ${theme.textPrimary}`}>Workspace Themes</div>
                      <div className={`text-[11px] ${theme.textMuted}`}>Saved automatically to your account</div>
                    </div>
                    <Palette size={14} className={theme.textAccent} />
                  </div>
                  <div className="space-y-1.5 max-h-[65vh] overflow-y-auto custom-scrollbar pr-0.5">
                    {TEACHER_THEME_LIST.map(tOpt => {
                      const isCurrent = theme.id === tOpt.id;
                      return (
                        <button
                          key={tOpt.id}
                          type="button"
                          onClick={() => handleSelectTheme(tOpt.id)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition ${
                            isCurrent
                              ? theme.primaryBtn
                              : theme.isDark
                                ? 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-100'
                                : 'bg-white/70 hover:bg-white border-slate-200/80 text-slate-800'
                          }`}
                        >
                          <div
                            className={`w-8 h-8 rounded-lg bg-gradient-to-br ${tOpt.swatchGradient} border border-white/40 shrink-0 shadow-sm`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className={`text-xs font-bold truncate ${isCurrent ? 'text-white' : theme.textPrimary}`}>
                              {tOpt.name}
                            </div>
                            <div className={`text-[11px] truncate ${isCurrent ? 'text-white/80' : theme.textMuted}`}>
                              {tOpt.tagline}
                            </div>
                          </div>
                          {isCurrent && <Check size={14} className="shrink-0 text-white" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {step !== 1 && (
              <button
                onClick={() => setStep(1)}
                className={`hidden sm:inline-flex items-center gap-1.5 px-3.5 min-h-[38px] rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
              >
                <Calendar size={14} className={theme.textAccent} />
                <span>My Timetable</span>
              </button>
            )}

            <button
              onClick={() => setStep(6)}
              aria-label="Open messages and notifications"
              className={`relative min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center transition shrink-0 ${theme.iconBtn}`}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-gradient-to-r from-rose-600 to-rose-500 text-white text-[10px] font-bold font-mono-num rounded-md flex items-center justify-center shadow-sm">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 sm:p-6 lg:p-8 custom-scrollbar">
          {/* --- HOME TAB --- */}
          {step === 0 && (
            <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
              {/* Luminous Frosted Glass Hero Card */}
              <section className={`relative overflow-hidden ${theme.heroCard} p-5 sm:p-7`}>
                <div
                  className={`pointer-events-none absolute -top-16 -right-12 w-72 h-72 rounded-full ${theme.heroGlow} blur-2xl`}
                  aria-hidden="true"
                />
                <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                  <div className="flex items-start gap-4 max-w-2xl">
                    <div className={`hidden sm:flex w-12 h-12 rounded-lg ${theme.accentBadge} items-center justify-center shrink-0 mt-0.5`}>
                      <BookOpen size={22} />
                    </div>
                    <div className="space-y-1.5">
                      <div className={`text-xs font-semibold ${theme.textAccent}`}>
                        {dateLabel} · {currentSchool.name}
                      </div>
                      <h1 className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${theme.textPrimary}`}>
                        {greeting}, {teacher.name.split(' ')[0]}
                      </h1>
                      <p className={`text-sm leading-relaxed ${theme.textSecondary}`}>
                        {resolvedSubjects.length > 0 ? (
                          <>
                            You teach <span className={`font-bold ${theme.textPrimary}`}>{inlineSubjectsPreview}</span> to{' '}
                            <span className={`font-bold font-mono-num ${theme.textPrimary}`}>
                              {scheduleSummary.activeClasses.length}
                            </span>{' '}
                            {scheduleSummary.activeClasses.length === 1 ? 'class' : 'classes'}, with{' '}
                            <span className={`font-bold font-mono-num ${theme.textPrimary}`}>{scheduleSummary.todayAgenda.length}</span>{' '}
                            {scheduleSummary.todayAgenda.length === 1 ? 'lesson' : 'lessons'} scheduled for{' '}
                            {scheduleSummary.todayDayName}.
                          </>
                        ) : (
                          <>Pick the subjects and classes you teach so your personal timetable and daily lessons appear here.</>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      onClick={() => setStep(1)}
                      className={`min-h-[42px] px-4 py-2.5 rounded-lg font-bold text-xs sm:text-sm transition flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.primaryBtn}`}
                    >
                      <Calendar size={16} />
                      <span>Open My Timetable</span>
                    </button>
                    <button
                      onClick={openPortfolioEditor}
                      className={`min-h-[42px] px-4 py-2.5 rounded-lg font-semibold text-xs sm:text-sm transition flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                    >
                      <Pencil size={15} className={theme.textAccent} />
                      <span>Edit My Subjects</span>
                    </button>
                    <button
                      onClick={() => setStep(2)}
                      className={`min-h-[42px] px-4 py-2.5 rounded-lg font-semibold text-xs sm:text-sm transition flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                    >
                      <MessageCircle size={15} className={theme.textAccent} />
                      <span>Staff Room</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* 4-Card Frosted Glass Educator Summary Strip */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className={`${theme.glassCard} p-4 sm:p-5`}>
                  <div className={`flex items-center justify-between text-xs font-semibold ${theme.textAccent} mb-2`}>
                    <span>Subjects You Teach</span>
                    <div className={`w-7 h-7 rounded-lg ${theme.accentBadge} flex items-center justify-center`}>
                      <BookOpen size={14} />
                    </div>
                  </div>
                  <div className={`text-2xl sm:text-3xl font-extrabold font-mono-num ${theme.textPrimary}`}>
                    {resolvedSubjects.length}
                  </div>
                  <div className={`text-xs mt-1.5 line-clamp-2 leading-snug font-medium ${theme.textSecondary}`} title={inlineSubjectsPreview}>
                    {inlineSubjectsPreview}
                  </div>
                </div>

                <div className={`${theme.glassCard} p-4 sm:p-5`}>
                  <div className={`flex items-center justify-between text-xs font-semibold ${theme.textAccent} mb-2`}>
                    <span>Classes You Teach</span>
                    <div className={`w-7 h-7 rounded-lg ${theme.accentBadge} flex items-center justify-center`}>
                      <Users size={14} />
                    </div>
                  </div>
                  <div className={`text-2xl sm:text-3xl font-extrabold font-mono-num ${theme.textPrimary}`}>
                    {scheduleSummary.activeClasses.length}
                  </div>
                  <div className={`text-xs mt-1.5 line-clamp-2 leading-snug font-medium ${theme.textSecondary}`} title={inlineClassesPreview}>
                    {inlineClassesPreview}
                  </div>
                </div>

                <div className={`${theme.glassCard} p-4 sm:p-5`}>
                  <div className={`flex items-center justify-between text-xs font-semibold ${theme.textAccent} mb-2`}>
                    <span>Periods This Week</span>
                    <div className={`w-7 h-7 rounded-lg ${theme.accentBadge} flex items-center justify-center`}>
                      <Clock size={14} />
                    </div>
                  </div>
                  <div className={`text-2xl sm:text-3xl font-extrabold font-mono-num ${theme.textPrimary}`}>
                    {scheduleSummary.totalPeriods}
                    <span className={`text-xs font-semibold ml-1.5 font-teacher-ui ${theme.textMuted}`}>lessons/wk</span>
                  </div>
                  <div className={`text-xs mt-1.5 font-mono-num leading-snug ${theme.textSecondary}`}>
                    {scheduleSummary.freePeriods} free periods
                  </div>
                </div>

                <button
                  onClick={() => setStep(6)}
                  className={`${theme.glassCard} ${theme.glassCardHover} p-4 sm:p-5 text-left transition`}
                >
                  <div className={`flex items-center justify-between text-xs font-semibold ${theme.textAccent} mb-2`}>
                    <span>Messages & Requests</span>
                    <div className={`w-7 h-7 rounded-lg ${theme.accentBadge} flex items-center justify-center`}>
                      <Inbox size={14} />
                    </div>
                  </div>
                  <div className={`text-2xl sm:text-3xl font-extrabold font-mono-num ${theme.textPrimary}`}>
                    {unreadCount}
                    <span className={`text-xs font-semibold ml-1.5 font-teacher-ui ${theme.textMuted}`}>unread</span>
                  </div>
                  <div className={`text-xs mt-1.5 truncate font-mono-num ${theme.textSecondary}`}>
                    {pendingRequestsCount} open swap request{pendingRequestsCount === 1 ? '' : 's'}
                  </div>
                </button>
              </section>

              {/* Main Workspace Grid: Subjects You Teach + Today's Classes */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* LEFT COLUMN: SUBJECTS YOU TEACH */}
                <section
                  aria-label="Subjects You Teach"
                  className={`lg:col-span-7 ${theme.glassCard} overflow-hidden`}
                >
                  <div className={`px-5 py-4 ${theme.cardHeader} flex flex-wrap items-center justify-between gap-3`}>
                    <div>
                      <h2 className={`text-base sm:text-lg font-bold ${theme.textPrimary}`}>Subjects You Teach</h2>
                      <p className={`text-xs mt-0.5 ${theme.textMuted}`}>
                        Every subject assigned to you, the classes you take, and your weekly lesson count
                      </p>
                    </div>
                    <button
                      onClick={openPortfolioEditor}
                      className={`min-h-[38px] px-3.5 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                    >
                      <Pencil size={14} className={theme.textAccent} />
                      <span>Edit Subjects</span>
                    </button>
                  </div>

                  {resolvedSubjects.length === 0 ? (
                    <div className="p-8 sm:p-10 text-center">
                      <div className={`w-12 h-12 rounded-lg ${theme.accentBadge} flex items-center justify-center mx-auto mb-3`}>
                        <BookOpen size={22} />
                      </div>
                      <h3 className={`text-sm font-bold mb-1 ${theme.textPrimary}`}>No subjects added yet</h3>
                      <p className={`text-xs max-w-sm mx-auto mb-5 leading-relaxed ${theme.textMuted}`}>
                        Choose the classes and subjects you handle this term so they show clearly on your Home screen.
                      </p>
                      <button
                        onClick={openPortfolioEditor}
                        className={`min-h-[40px] px-5 py-2.5 rounded-lg text-xs font-bold transition inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.primaryBtn}`}
                      >
                        <BookOpen size={15} />
                        <span>Add Your Subjects</span>
                      </button>
                    </div>
                  ) : (
                    <div className={theme.divider}>
                      {resolvedSubjects.map(sub => (
                        <div
                          key={sub.id}
                          className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                            theme.isDark ? 'hover:bg-white/[0.04]' : 'hover:bg-white/60'
                          }`}
                        >
                          <div className="flex items-start gap-3.5 min-w-0">
                            <div className={`w-11 h-11 rounded-lg ${theme.accentBadge} font-mono-num text-xs font-bold flex items-center justify-center shrink-0`}>
                              {sub.code.slice(0, 4)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className={`font-bold text-sm truncate ${theme.textPrimary}`}>{sub.name}</h3>
                                <span className={`text-[11px] font-medium ${theme.textAccent}`}>
                                  {sub.levelLabel} · {sub.isCore ? 'Core' : 'Elective'}
                                </span>
                              </div>
                              <div className={`mt-1 text-xs flex flex-wrap items-center gap-x-1.5 gap-y-1 ${theme.textSecondary}`}>
                                <span className={`font-medium ${theme.textMuted}`}>Classes:</span>
                                {sub.classes.length > 0 ? (
                                  <span className={`font-semibold ${theme.textPrimary}`}>
                                    {sub.classes.map(c => c.name).join(' · ')}
                                  </span>
                                ) : (
                                  <span className={theme.textMuted}>Scheduled across school</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 flex sm:flex-col items-center sm:items-end justify-between gap-2 pl-14 sm:pl-0">
                            <div className="sm:text-right">
                              {sub.weeklyPeriods > 0 ? (
                                <div className={`text-sm font-bold font-mono-num ${theme.textPrimary}`}>
                                  {sub.weeklyPeriods} {sub.weeklyPeriods === 1 ? 'lesson' : 'lessons'}/wk
                                </div>
                              ) : (
                                <div className={`text-xs font-semibold ${theme.textMuted}`}>
                                  {grid ? '0 slots in timetable' : 'Awaiting timetable'}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => setStep(1)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${theme.secondaryBtn}`}
                            >
                              View Timetable
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* RIGHT COLUMN: TODAY'S CLASSES & YOUR WEEK AHEAD */}
                <div className="lg:col-span-5 space-y-6">
                  <section className={`${theme.glassCard} overflow-hidden`}>
                    <div className={`px-5 py-4 ${theme.cardHeader} flex items-center justify-between gap-2`}>
                      <div>
                        <h2 className={`text-base font-bold ${theme.textPrimary}`}>
                          {scheduleSummary.isWeekendPreview
                            ? `${scheduleSummary.todayDayName} Preview`
                            : `${scheduleSummary.todayDayName}’s Classes`}
                        </h2>
                        <p className={`text-xs mt-0.5 ${theme.textMuted}`}>
                          {scheduleSummary.todayAgenda.length > 0
                            ? 'Keep quick lesson notes ready for each period'
                            : 'Your lessons for the day will show here'}
                        </p>
                      </div>
                      <button
                        onClick={() => setStep(1)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition ${theme.secondaryBtn}`}
                      >
                        Full Timetable
                      </button>
                    </div>

                    {scheduleSummary.todayAgenda.length === 0 ? (
                      <div className="p-6 text-center space-y-3">
                        <p className={`text-xs font-medium ${theme.textMuted}`}>
                          {grid
                            ? `No lessons scheduled for ${scheduleSummary.todayDayName}.`
                            : 'Your timetable has not been published by Administration yet.'}
                        </p>
                        <button
                          onClick={() => setStep(5)}
                          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition ${theme.secondaryBtn}`}
                        >
                          Browse School Timetable
                        </button>
                      </div>
                    ) : (
                      <div className={theme.divider}>
                        {scheduleSummary.todayAgenda.map(item => (
                          <div
                            key={`${item.dayIndex}-${item.periodIndex}-${item.classId}`}
                            className={`px-5 py-3.5 flex items-center justify-between gap-3 transition ${
                              theme.isDark ? 'hover:bg-white/[0.04]' : 'hover:bg-white/60'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-14 py-1 px-1.5 rounded-lg ${theme.softInset} text-center shrink-0`}>
                                <div className={`text-xs font-bold font-mono-num ${theme.textAccent}`}>{item.periodLabel}</div>
                                <div className={`text-[10px] font-mono-num ${theme.textMuted}`}>
                                  {item.timeRange.split('–')[0]?.trim()}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className={`text-sm font-bold truncate ${theme.textPrimary}`}>{item.subjectName}</div>
                                <div className={`text-xs truncate ${theme.textSecondary}`}>
                                  {item.className}
                                  {item.roomName ? ` · ${item.roomName}` : ''}
                                </div>
                              </div>
                            </div>

                            <button
                              onClick={() =>
                                setLessonModal({
                                  day: item.dayIndex,
                                  period: item.periodIndex,
                                  classId: item.classId,
                                  subjectName: item.subjectName,
                                  className: item.className,
                                  note: item.lessonNote || '',
                                  link: item.lessonLink || '',
                                })
                              }
                              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                                item.hasLessonNote ? theme.primaryBtn : theme.secondaryBtn
                              }`}
                            >
                              <FileText size={13} />
                              <span>{item.hasLessonNote ? 'Edit Note' : '+ Add Note'}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className={`${theme.glassCard} p-5`}>
                    <div className="flex items-center justify-between gap-2 mb-4">
                      <div>
                        <h2 className={`text-sm font-bold ${theme.textPrimary}`}>Your Week Ahead</h2>
                        <p className={`text-xs ${theme.textMuted}`}>Lessons distributed across Monday – Friday</p>
                      </div>
                      <span
                        className={`text-xs font-semibold ${
                          scheduleSummary.fatigueWarning
                            ? theme.isDark
                              ? 'text-amber-300'
                              : 'text-amber-700'
                            : theme.isDark
                              ? 'text-emerald-300'
                              : 'text-emerald-700'
                        }`}
                      >
                        {scheduleSummary.fatigueWarning ? 'Busy stretch (5+ in a row)' : 'Comfortable pace'}
                      </span>
                    </div>

                    <div className="grid grid-cols-5 gap-2.5">
                      {DAYS.map((day, idx) => {
                        const count = scheduleSummary.dailyBreakdown[idx] || 0;
                        const pct = Math.round((count / maxDailyLoad) * 100);
                        return (
                          <div key={day} className={`${theme.softInset} rounded-lg p-2.5 text-center shadow-xs`}>
                            <div className={`text-[11px] font-semibold uppercase ${theme.textAccent}`}>{day.slice(0, 3)}</div>
                            <div className="h-12 flex items-end justify-center my-2">
                              <div className={`w-3 ${theme.barTrack} rounded-sm h-full flex items-end overflow-hidden`}>
                                <div
                                  className={`w-full ${theme.barFill} rounded-sm transition-all`}
                                  style={{ height: `${Math.max(count > 0 ? 18 : 0, pct)}%` }}
                                />
                              </div>
                            </div>
                            <div className={`text-xs font-bold font-mono-num ${theme.textPrimary}`}>{count} p</div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}

          {/* --- MY TIMETABLE TAB --- */}
          {step === 1 && (
            <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className={`${theme.glassCard} p-5`}>
                  <span className={`text-xs font-semibold block mb-1 ${theme.textAccent}`}>Lessons This Week</span>
                  <div className={`text-2xl font-extrabold font-mono-num ${theme.textPrimary}`}>
                    {scheduleSummary.totalPeriods}{' '}
                    <span className={`text-xs font-medium font-teacher-ui ${theme.textMuted}`}>lessons / wk</span>
                  </div>
                  <span className={`text-xs mt-1 block font-mono-num ${theme.textSecondary}`}>
                    {scheduleSummary.freePeriods} free periods
                  </span>
                </div>

                <div className={`${theme.glassCard} p-5 md:col-span-2`}>
                  <span className={`text-xs font-semibold block mb-2.5 ${theme.textAccent}`}>Lessons Per Day</span>
                  <div className="grid grid-cols-5 gap-2 text-center">
                    {DAYS.map((day, idx) => (
                      <div key={day} className={`${theme.softInset} p-2 rounded-lg`}>
                        <span className={`text-[10px] font-bold block uppercase ${theme.textAccent}`}>{day.substring(0, 3)}</span>
                        <span className={`text-sm font-bold font-mono-num ${theme.textPrimary}`}>
                          {scheduleSummary.dailyBreakdown[idx] || 0} p
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`${theme.glassCard} p-5 flex flex-col justify-between`}>
                  <span className={`text-xs font-semibold block mb-1 ${theme.textAccent}`}>Weekly Pace</span>
                  {scheduleSummary.fatigueWarning ? (
                    <div className={`p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 ${statusPendingCls}`}>
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>5+ classes in a row detected</span>
                    </div>
                  ) : (
                    <div className={`p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 ${statusApprovedCls}`}>
                      <CheckCircle size={16} className="shrink-0" />
                      <span>Comfortable spacing</span>
                    </div>
                  )}
                </div>
              </div>

              <div className={`${theme.glassCard} p-4 sm:p-6`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                    <h3 className={`text-lg sm:text-xl font-bold ${theme.textPrimary}`}>My Weekly Timetable</h3>
                    <p className={`text-xs mt-0.5 ${theme.textMuted}`}>
                      Tap any class slot to add lesson notes or learning links for that period.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      onClick={() => setShowCalendarModal(true)}
                      className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-2 font-semibold text-xs rounded-lg transition whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                    >
                      <Calendar size={15} className={theme.textAccent} />
                      <span>Calendar Feed</span>
                    </button>
                    <button
                      onClick={() => setShowAbsenceModal(true)}
                      className={`min-h-[40px] flex items-center gap-1.5 px-3.5 py-2 font-semibold text-xs rounded-lg border transition whitespace-nowrap shrink-0 ${statusRejectedCls}`}
                    >
                      <CalendarX size={15} />
                      <span>Request Time Off</span>
                    </button>
                  </div>
                </div>

                {scheduleSummary.personalGrid ? (
                  <TimetableGridView
                    timetable={scheduleSummary.personalGrid}
                    classId="MY_SCHEDULE"
                    isEditable={false}
                    teachers={allTeachers}
                    rooms={rooms}
                    subjects={configuredSubjects}
                    onCellClick={handleCellClickForNote}
                    themeVariant={theme.timetableVariant}
                  />
                ) : (
                  <div className={`text-center py-16 text-sm border border-dashed rounded-xl ${theme.softInset} ${theme.textMuted}`}>
                    Your timetable has not been published by Administration yet.
                  </div>
                )}
              </div>

              {absences.length > 0 && (
                <div className={`${theme.glassCard} p-5`}>
                  <h3 className={`text-sm font-bold mb-3 ${theme.textPrimary}`}>My Absence Requests</h3>
                  <div className={theme.divider}>
                    {absences.map(a => (
                      <div key={a.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <span className={`font-bold font-mono-num ${theme.textPrimary}`}>
                            {a.startDate} → {a.endDate}
                          </span>
                          <span className={`ml-2 ${theme.textSecondary}`}>{a.reason}</span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                            a.status === 'APPROVED'
                              ? statusApprovedCls
                              : a.status === 'REJECTED'
                                ? statusRejectedCls
                                : statusPendingCls
                          }`}
                        >
                          {a.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* --- SCHOOL TIMETABLE VIEW --- */}
          {step === 5 && (
            <div className="max-w-7xl mx-auto space-y-5 animate-in fade-in duration-300">
              <div className={`${theme.glassCard} p-4 sm:p-6`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h3 className={`text-lg sm:text-xl font-bold ${theme.textPrimary}`}>
                      Class Timetable: {resolveClassDisplayName(viewClassId, catalogClasses)}
                    </h3>
                    <p className={`text-xs mt-0.5 ${theme.textMuted}`}>
                      Tap a colleague’s lesson slot to propose a friendly period swap.
                    </p>
                  </div>
                  <div className={`flex items-center gap-2.5 ${theme.softInset} px-3.5 py-2 rounded-lg shadow-xs w-fit`}>
                    <Filter size={16} className={`${theme.textAccent} shrink-0`} />
                    <label htmlFor="master-class-select" className={`text-xs font-semibold ${theme.textSecondary}`}>
                      Class:
                    </label>
                    <select
                      id="master-class-select"
                      value={viewClassId}
                      onChange={e => setViewClassId(e.target.value)}
                      className={`bg-transparent text-sm font-bold outline-none cursor-pointer ${theme.textPrimary}`}
                    >
                      {catalogClasses.map(c => (
                        <option key={c.id} value={c.id} className={theme.selectOption}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {grid ? (
                  <TimetableGridView
                    timetable={grid}
                    classId={viewClassId}
                    isEditable={true}
                    teachers={allTeachers}
                    rooms={rooms}
                    subjects={configuredSubjects}
                    themeVariant={theme.timetableVariant}
                    onCellClick={(d, p) => {
                      const cell = grid?.[viewClassId]?.[d]?.[p];
                      if (
                        cell &&
                        cell.teacherId !== teacher.id &&
                        !cell.teacherIds?.includes(teacher.id) &&
                        cell.teacherId !== 'SYSTEM' &&
                        cell.subjectId !== 'FREE' &&
                        cell.subjectId !== 'WORSHIP'
                      ) {
                        setSwapModalData({ coords: { classId: viewClassId, d, p }, targetCell: cell });
                      }
                    }}
                  />
                ) : (
                  <div className={`text-center py-16 text-sm border border-dashed rounded-xl ${theme.softInset} ${theme.textMuted}`}>
                    School timetable has not been published yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* --- MESSAGES (INBOX) TAB --- */}
          {step === 6 && (
            <div className={`max-w-5xl mx-auto h-[calc(100vh-140px)] min-h-[460px] flex flex-col ${theme.glassCard} overflow-hidden animate-in fade-in`}>
              <div className={`p-4 sm:p-5 ${theme.cardHeader} flex flex-wrap justify-between items-center gap-3`}>
                <div>
                  <h2 className={`text-lg font-bold ${theme.textPrimary}`}>Messages</h2>
                  <p className={`text-xs ${theme.textMuted}`}>Timetable notices, swap updates, and school announcements</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                    >
                      Mark all read
                    </button>
                  )}
                  {(['ALL', 'UNREAD', 'ALERTS'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setInboxFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 border ${
                        inboxFilter === f ? theme.primaryBtn : theme.secondaryBtn
                      }`}
                    >
                      {f === 'ALL' ? 'All' : f === 'UNREAD' ? 'Unread' : 'Alerts'}
                    </button>
                  ))}
                </div>
              </div>

              <div className={`flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 ${theme.chatRoomBg} custom-scrollbar`}>
                {filteredNotifications.length === 0 && (
                  <div className={`flex flex-col items-center justify-center h-full py-12 ${theme.textMuted}`}>
                    <Inbox size={40} className={`mb-3 opacity-60 ${theme.textAccent}`} />
                    <p className={`text-sm font-medium ${theme.textSecondary}`}>No messages in this view</p>
                  </div>
                )}
                {filteredNotifications.map(n => {
                  const isExpanded = expandedNotif === n.id;
                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (!n.isRead) handleMarkRead(n.id);
                        setExpandedNotif(isExpanded ? null : n.id);
                      }}
                      className={`backdrop-blur-md border rounded-xl p-4 cursor-pointer transition ${
                        n.isRead ? theme.readMessageCard : theme.unreadMessageCard
                      }`}
                    >
                      <div className="flex items-start gap-3.5">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            n.type === 'ALERT'
                              ? statusRejectedCls
                              : n.type === 'SUCCESS'
                                ? statusApprovedCls
                                : theme.accentBadge
                          }`}
                        >
                          {n.type === 'ALERT' ? (
                            <AlertTriangle size={18} />
                          ) : n.type === 'SUCCESS' ? (
                            <CheckCircle size={18} />
                          ) : (
                            <Info size={18} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-2 mb-0.5">
                            <h4 className={`text-sm truncate ${n.isRead ? `font-semibold ${theme.textSecondary}` : `font-bold ${theme.textPrimary}`}`}>
                              {n.title || 'Notice'}
                            </h4>
                            <span className={`text-[11px] font-medium whitespace-nowrap font-mono-num ${theme.textMuted}`}>
                              {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className={`text-xs sm:text-sm leading-relaxed truncate ${theme.textSecondary}`}>{n.message}</p>

                          {isExpanded && (
                            <div className={`mt-3 pt-3 border-t ${theme.isDark ? 'border-white/10' : 'border-blue-100/80'} space-y-3`}>
                              <div className={`text-xs sm:text-sm p-3.5 rounded-lg leading-relaxed whitespace-pre-wrap ${theme.softInset} ${theme.textPrimary}`}>
                                {n.details || n.message}
                              </div>
                              <div className="flex justify-end">
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    storage.deleteNotification(n.id);
                                    loadData();
                                  }}
                                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 ${statusRejectedCls}`}
                                >
                                  <Trash size={13} />
                                  <span>Delete</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        {!n.isRead && !isExpanded && <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${theme.isDark ? 'bg-violet-400' : 'bg-blue-600'}`} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* --- STAFF ROOM CHAT TAB --- */}
          {step === 2 && (
            <div className={`max-w-5xl mx-auto h-[calc(100vh-140px)] min-h-[460px] flex flex-col ${theme.glassCard} overflow-hidden animate-in fade-in`}>
              <div className={`p-4 sm:p-5 ${theme.cardHeader} flex flex-col sm:flex-row sm:items-center justify-between gap-2`}>
                <div>
                  <h2 className={`text-base sm:text-lg font-bold ${theme.textPrimary}`}>Faculty Staff Room</h2>
                  <p className={`text-xs ${theme.textMuted}`}>Chat with fellow teachers and school administration</p>
                </div>
                <div className={`flex items-center gap-1.5 text-xs font-semibold ${theme.isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                  <ShieldCheck size={15} />
                  <span>Safe Room Guidelines Active</span>
                </div>
              </div>

              {moderationError && (
                <div className={`border-b px-4 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold ${statusRejectedCls}`}>
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={16} className="shrink-0" />
                    <span>{moderationError}</span>
                  </div>
                  <button onClick={() => setModerationError('')} className="p-1 rounded-lg">
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className={`flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 ${theme.chatRoomBg} custom-scrollbar`}>
                {chatMessages.length === 0 && (
                  <div className={`flex flex-col items-center justify-center h-full py-12 ${theme.textMuted}`}>
                    <div className={`w-12 h-12 rounded-lg ${theme.accentBadge} flex items-center justify-center mb-3`}>
                      <MessageCircle size={24} />
                    </div>
                    <p className={`font-bold text-sm ${theme.textPrimary}`}>Welcome to the Staff Room</p>
                    <p className={`text-xs mt-1 max-w-sm text-center ${theme.textMuted}`}>
                      Coordinate lessons, discuss period swaps, or send quick notes to colleagues.
                    </p>
                  </div>
                )}

                {chatMessages.map(m => {
                  const isMe = m.senderId === teacher.id;
                  const sender = allTeachers.find(t => t.id === m.senderId);
                  const avatar = sender?.profilePicture || (isMe ? profileData.profilePicture : undefined);

                  return (
                    <div key={m.id} className={`flex items-end gap-2.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                      {!isMe && (
                        <div className={`w-8 h-8 rounded-lg overflow-hidden shrink-0 ${theme.softInset} flex items-center justify-center ${theme.textAccent} font-bold text-xs`}>
                          {avatar ? (
                            <img src={avatar} alt={m.senderName} className="w-full h-full object-cover" />
                          ) : (
                            <span>{(m.senderName || 'Staff').charAt(0)}</span>
                          )}
                        </div>
                      )}

                      <div
                        className={`max-w-[85%] sm:max-w-md rounded-xl p-3.5 ${
                          isMe ? theme.chatMeBubble : theme.chatOtherBubble
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className={`text-[11px] font-bold ${isMe ? 'text-white/90' : theme.textPrimary}`}>
                            {isMe ? 'You' : m.senderName}
                          </span>
                          <span className={`text-[10px] font-mono-num ${isMe ? 'text-white/75' : theme.textMuted}`}>
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <p className={`text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words ${isMe ? 'text-white' : theme.textSecondary}`}>
                          {m.content}
                        </p>

                        {m.isFlagged && (
                          <div
                            className={`mt-2 pt-1.5 border-t text-[10px] font-semibold flex items-center gap-1 ${
                              isMe ? 'border-white/25 text-amber-200' : 'border-current/15 text-amber-500'
                            }`}
                          >
                            <AlertTriangle size={12} />
                            <span>Under moderation review</span>
                          </div>
                        )}
                      </div>

                      {isMe && (
                        <div className={`w-8 h-8 rounded-lg overflow-hidden shrink-0 ${theme.accentBadge} flex items-center justify-center font-bold text-xs`}>
                          {avatar ? (
                            <img src={avatar} alt="You" className="w-full h-full object-cover" />
                          ) : (
                            <span>{teacher.name.charAt(0)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleChatSend} className={`p-3 sm:p-4 backdrop-blur-md border-t ${theme.isDark ? 'bg-black/25 border-white/10' : 'bg-white/80 border-blue-100/80'} flex items-center gap-2`}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => {
                    setChatInput(e.target.value);
                    if (moderationError) setModerationError('');
                  }}
                  placeholder="Write a message to colleagues..."
                  className={`flex-1 rounded-lg px-4 py-2.5 text-xs sm:text-sm font-medium outline-none ${theme.input}`}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className={`min-h-[42px] px-4 sm:px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-xs sm:text-sm rounded-lg transition flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.primaryBtn}`}
                >
                  <Send size={15} />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </form>
            </div>
          )}

          {/* --- SWAPS & REQUESTS TAB --- */}
          {step === 3 && (
            <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in">
              <div className={`lg:col-span-5 ${theme.glassCard} p-5 sm:p-6 h-fit`}>
                <h3 className={`text-lg font-bold mb-1 ${theme.textPrimary}`}>Send a Request to Admin</h3>
                <p className={`text-xs mb-4 ${theme.textMuted}`}>
                  Ask for a timetable change, room adjustment, or special scheduling note.
                </p>
                <textarea
                  className={`w-full p-4 rounded-lg min-h-[140px] outline-none transition resize-none text-sm mb-4 ${theme.input}`}
                  placeholder="Write your request (day, period, class, or reason)..."
                  value={msg}
                  onChange={e => setMsg(e.target.value)}
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleRequestSubmit}
                    disabled={!msg.trim()}
                    className={`min-h-[42px] px-5 py-2.5 disabled:opacity-50 rounded-lg font-bold text-xs sm:text-sm transition flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.primaryBtn}`}
                  >
                    <Send size={15} />
                    <span>Submit Request</span>
                  </button>
                </div>
              </div>

              <div className={`lg:col-span-7 ${theme.glassCard} overflow-hidden`}>
                <div className={`px-5 py-4 ${theme.cardHeader} flex items-center justify-between`}>
                  <h3 className={`text-sm font-bold ${theme.textPrimary}`}>Your Past Requests</h3>
                  <span className={`text-xs font-mono-num font-semibold ${theme.textAccent}`}>{requests.length} total</span>
                </div>
                {requests.length === 0 ? (
                  <div className={`text-xs text-center py-12 ${theme.textMuted}`}>No requests submitted yet.</div>
                ) : (
                  <div className={theme.divider}>
                    {requests.map(r => (
                      <div key={r.id} className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${theme.isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-white/50'}`}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2.5 mb-1">
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                                r.status === 'APPROVED'
                                  ? statusApprovedCls
                                  : r.status === 'REJECTED'
                                    ? statusRejectedCls
                                    : statusPendingCls
                              }`}
                            >
                              {r.status}
                            </span>
                            <span className={`text-xs font-mono-num ${theme.textMuted}`}>
                              {new Date(r.timestamp).toLocaleDateString()}
                            </span>
                          </div>
                          <p className={`text-sm font-semibold leading-snug ${theme.textPrimary}`}>
                            {formatSwapRequestSummary(r, configuredSubjects, catalogClasses, allTeachers)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* --- PROFILE TAB --- */}
          {step === 4 && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in">
              <div className={`${theme.glassCard} overflow-hidden`}>
                <div className={`h-28 ${theme.profileBanner}`} />
                <div className="px-5 sm:px-8 pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-10 mb-6">
                    <div className="relative w-24 h-24 shrink-0">
                      <div className={`w-24 h-24 rounded-xl border-4 ${theme.profileAvatarBorder} shadow-md overflow-hidden ${theme.softInset} flex items-center justify-center`}>
                        {profileData.profilePicture ? (
                          <img src={profileData.profilePicture} alt={teacher.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className={`text-3xl font-bold ${theme.textAccent}`}>{teacher.name.charAt(0)}</span>
                        )}
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="Upload profile photo"
                        className={`absolute -bottom-1.5 -right-1.5 p-2 rounded-lg transition ${theme.primaryBtn}`}
                      >
                        <Camera size={14} />
                      </button>
                      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                    </div>
                    <div className="min-w-0 pb-1">
                      <h2 className={`text-xl sm:text-2xl font-extrabold truncate ${theme.textPrimary}`}>{teacher.name}</h2>
                      <p className={`text-xs sm:text-sm font-medium ${theme.textAccent}`}>
                        @{teacher.username} · {currentSchool.name}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div className="space-y-1.5">
                      <label className={`text-xs font-bold uppercase tracking-wider ${theme.textMuted}`}>About Me / Office Hours</label>
                      <textarea
                        className={`w-full p-3.5 rounded-lg outline-none transition text-sm min-h-[96px] resize-none ${theme.input}`}
                        placeholder="Share your teaching focus, subjects, or best time for student questions..."
                        value={profileData.bio}
                        onChange={e => {
                          setProfileData({ ...profileData, bio: e.target.value });
                          setIsEditingProfile(true);
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className={`text-xs font-bold uppercase tracking-wider ${theme.textMuted}`}>Email</label>
                        <div className="relative">
                          <Mail className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${theme.textAccent}`} size={16} />
                          <input
                            className={`w-full pl-10 pr-3.5 py-2.5 rounded-lg outline-none transition text-sm ${theme.input}`}
                            placeholder="contact@school.edu"
                            value={profileData.contactEmail}
                            onChange={e => {
                              setProfileData({ ...profileData, contactEmail: e.target.value });
                              setIsEditingProfile(true);
                            }}
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className={`text-xs font-bold uppercase tracking-wider ${theme.textMuted}`}>Phone</label>
                        <div className="relative">
                          <Phone className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${theme.textAccent}`} size={16} />
                          <input
                            className={`w-full pl-10 pr-3.5 py-2.5 rounded-lg outline-none transition text-sm ${theme.input}`}
                            placeholder="+234..."
                            value={profileData.contactPhone}
                            onChange={e => {
                              setProfileData({ ...profileData, contactPhone: e.target.value });
                              setIsEditingProfile(true);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    {isEditingProfile && (
                      <div className="flex justify-end pt-2">
                        <button
                          onClick={saveProfile}
                          className={`min-h-[42px] px-6 py-2.5 rounded-lg font-bold text-sm transition flex items-center gap-2 whitespace-nowrap shrink-0 ${theme.primaryBtn}`}
                        >
                          <Save size={16} />
                          <span>Save Profile</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Appearance & Color Themes */}
              <div className={`${theme.glassCard} overflow-hidden`}>
                <div className={`px-5 py-4 ${theme.cardHeader} flex items-center justify-between gap-2`}>
                  <div>
                    <h3 className={`text-sm font-bold ${theme.textPrimary}`}>Appearance & Color Theme</h3>
                    <p className={`text-xs ${theme.textMuted}`}>
                      Choose from 7 glassmorphic color themes — remembered automatically across sessions
                    </p>
                  </div>
                  <Palette size={17} className={theme.textAccent} />
                </div>
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {TEACHER_THEME_LIST.map(tOpt => {
                    const isSelected = theme.id === tOpt.id;
                    return (
                      <button
                        key={tOpt.id}
                        type="button"
                        onClick={() => handleSelectTheme(tOpt.id)}
                        className={`p-3 rounded-lg border text-left transition flex items-center gap-3 ${
                          isSelected
                            ? theme.primaryBtn
                            : theme.isDark
                              ? 'bg-white/5 hover:bg-white/10 border-white/15 text-slate-100'
                              : 'bg-white/80 hover:bg-white border-slate-200 text-slate-800'
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${tOpt.swatchGradient} border border-white/40 shrink-0 shadow-sm`} />
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-bold truncate ${isSelected ? 'text-white' : theme.textPrimary}`}>
                            {tOpt.name}
                          </div>
                          <div className={`text-[11px] truncate ${isSelected ? 'text-white/80' : theme.textMuted}`}>
                            {tOpt.tagline}
                          </div>
                        </div>
                        {isSelected && <Check size={14} className="shrink-0 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Subjects & Classes inside Profile */}
              <div className={`${theme.glassCard} overflow-hidden`}>
                <div className={`px-5 py-4 ${theme.cardHeader} flex items-center justify-between gap-2`}>
                  <div>
                    <h3 className={`text-sm font-bold ${theme.textPrimary}`}>Your Subjects & Classes</h3>
                    <p className={`text-xs ${theme.textMuted}`}>Classes and subjects shown on your Home screen</p>
                  </div>
                  <button
                    onClick={openPortfolioEditor}
                    className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${theme.secondaryBtn}`}
                  >
                    <Pencil size={13} className={theme.textAccent} />
                    <span>Edit Subjects & Classes</span>
                  </button>
                </div>
                {resolvedSubjects.length === 0 ? (
                  <div className={`p-6 text-xs ${theme.textMuted}`}>No subjects assigned yet.</div>
                ) : (
                  <div className={theme.divider}>
                    {resolvedSubjects.map(sub => (
                      <div key={sub.id} className={`px-5 py-3 flex items-center justify-between gap-3 text-xs transition ${theme.isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-white/50'}`}>
                        <div>
                          <span className={`font-bold ${theme.textPrimary}`}>{sub.name}</span>
                          <span className={`font-mono-num ml-2 ${theme.textAccent}`}>{sub.code}</span>
                          {sub.classes.length > 0 && (
                            <div className={`mt-0.5 ${theme.textSecondary}`}>{sub.classes.map(c => c.name).join(' · ')}</div>
                          )}
                        </div>
                        <span className={`font-mono-num font-semibold whitespace-nowrap ${theme.textPrimary}`}>
                          {sub.weeklyPeriods} lessons/wk
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 7 && <UserGuide role="TEACHER" />}
        </main>
      </div>

      {/* EDIT SUBJECTS & CLASSES MODAL */}
      {showPortfolioModal && (
        <div className={`fixed inset-0 z-[100] ${theme.modalBackdrop} flex items-center justify-center p-0 sm:p-4 overflow-hidden`}>
          <div className={`${theme.modalPanel} w-full h-[100dvh] sm:h-[85dvh] sm:max-w-3xl flex flex-col overflow-hidden`}>
            <div className={`px-5 py-4 ${theme.modalHeader} flex items-center justify-between shrink-0`}>
              <div>
                <h3 className={`text-base font-bold ${theme.textPrimary}`}>Edit Subjects & Classes</h3>
                <p className={`text-xs ${theme.textMuted}`}>Update the classes and subjects displayed on your Home screen</p>
              </div>
              <button
                onClick={() => setShowPortfolioModal(false)}
                aria-label="Close editor"
                className={`p-2 rounded-lg ${theme.iconBtn}`}
              >
                <X size={18} />
              </button>
            </div>
            {renderClassAndSubjectPicker('PORTFOLIO_EDIT')}
          </div>
        </div>
      )}

      {/* SWAP MODAL */}
      {swapModalData && (
        <div className={`fixed inset-0 z-50 ${theme.modalBackdrop} flex items-center justify-center p-3 sm:p-6 animate-in fade-in`}>
          <div className={`${theme.modalPanel} p-5 sm:p-6 max-w-md w-full max-h-[92dvh] overflow-y-auto`}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3 className={`text-lg font-bold ${theme.textPrimary}`}>Propose Period Swap</h3>
              <button
                onClick={() => setSwapModalData(null)}
                aria-label="Close swap modal"
                className={`p-1.5 rounded-lg ${theme.iconBtn}`}
              >
                <X size={18} />
              </button>
            </div>
            <p className={`text-xs sm:text-sm mb-5 leading-relaxed ${theme.textSecondary}`}>
              Asking to swap for{' '}
              <span className={`font-bold ${theme.textPrimary}`}>
                {resolveSubjectDisplayName(swapModalData.targetCell.subjectId, configuredSubjects)}
              </span>{' '}
              with{' '}
              <span className={`font-bold ${theme.textPrimary}`}>
                {resolveTeacherDisplayName(swapModalData.targetCell.teacherId, allTeachers)}
              </span>{' '}
              at{' '}
              <span className={`font-bold font-mono-num ${theme.textPrimary}`}>
                {DAYS[swapModalData.coords.d]} {PERIODS[swapModalData.coords.p]?.label}
              </span>
              .
            </p>
            <div className="space-y-2 mb-6">
              <label className={`text-xs font-bold uppercase tracking-wider block ${theme.textMuted}`}>
                Offer one of your periods
              </label>
              <select
                className={`w-full p-3 rounded-lg outline-none font-semibold text-xs sm:text-sm ${theme.input}`}
                value={myOfferSlot}
                onChange={e => setMyOfferSlot(e.target.value)}
              >
                <option value="" className={theme.selectOption}>-- Select one of your slots --</option>
                {getMySlots().map(slot => (
                  <option key={slot.value} value={slot.value} className={theme.selectOption}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setSwapModalData(null)}
                className={`flex-1 min-h-[42px] py-2.5 font-semibold rounded-lg transition text-xs sm:text-sm ${theme.secondaryBtn}`}
              >
                Cancel
              </button>
              <button
                onClick={sendAutomatedSwapRequest}
                disabled={!myOfferSlot}
                className={`flex-1 min-h-[42px] py-2.5 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed transition text-xs sm:text-sm ${theme.primaryBtn}`}
              >
                Send Swap Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ICAL CALENDAR MODAL */}
      {showCalendarModal && teacher && (
        <div className={`fixed inset-0 z-[100] ${theme.modalBackdrop} flex items-center justify-center p-3 sm:p-4 animate-in fade-in`}>
          <div className={`${theme.modalPanel} p-5 sm:p-6 max-w-md w-full relative max-h-[92dvh] overflow-y-auto`}>
            <button
              onClick={() => setShowCalendarModal(false)}
              aria-label="Close calendar modal"
              className={`absolute top-4 right-4 p-2 rounded-lg ${theme.iconBtn}`}
            >
              <X className="w-4 h-4" />
            </button>
            <div className={`w-11 h-11 ${theme.accentBadge} rounded-lg flex items-center justify-center mb-4`}>
              <Calendar className="w-5 h-5" />
            </div>
            <h3 className={`text-lg font-bold mb-1 ${theme.textPrimary}`}>Calendar Sync Feed</h3>
            <p className={`text-xs mb-5 ${theme.textMuted}`}>
              Subscribe to your live timetable in Apple Calendar, Google Calendar, or Outlook.
            </p>

            <div className="space-y-3 mb-5">
              <label className={`text-xs font-bold uppercase tracking-wider block ${theme.textMuted}`}>
                Personal iCal Feed URL
              </label>
              <div className={`p-3 ${theme.softInset} rounded-lg text-xs font-mono-num break-all select-all ${theme.textSecondary}`}>
                {`${window.location.origin}/api/calendar/${teacher.id}/${teacher.calendarToken || 'master'}.ics`}
              </div>
            </div>

            <button
              onClick={() => {
                const url = `${window.location.origin}/api/calendar/${teacher.id}/${teacher.calendarToken || 'master'}.ics`;
                navigator.clipboard.writeText(url);
                setCopiedCalendar(true);
                setTimeout(() => setCopiedCalendar(false), 2000);
              }}
              className={`w-full min-h-[42px] py-2.5 font-bold rounded-lg text-xs sm:text-sm transition flex items-center justify-center gap-2 ${theme.primaryBtn}`}
            >
              {copiedCalendar ? <Check size={16} /> : <Copy size={16} />}
              <span>{copiedCalendar ? 'Copied Link' : 'Copy Feed Link'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ABSENCE REQUEST MODAL */}
      {showAbsenceModal && (
        <div className={`fixed inset-0 z-[100] ${theme.modalBackdrop} flex items-center justify-center p-3 sm:p-4 animate-in fade-in`}>
          <div className={`${theme.modalPanel} p-5 sm:p-6 max-w-md w-full relative max-h-[92dvh] overflow-y-auto`}>
            <button
              onClick={() => setShowAbsenceModal(false)}
              aria-label="Close absence modal"
              className={`absolute top-4 right-4 p-2 rounded-lg ${theme.iconBtn}`}
            >
              <X className="w-4 h-4" />
            </button>
            <div className={`w-11 h-11 border rounded-lg flex items-center justify-center mb-4 ${statusRejectedCls}`}>
              <CalendarX className="w-5 h-5" />
            </div>
            <h3 className={`text-lg font-bold mb-1 ${theme.textPrimary}`}>Request Time Off</h3>
            <p className={`text-xs mb-5 ${theme.textMuted}`}>
              Submit dates when you will be unavailable so Administration can arrange cover.
            </p>

            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs font-bold uppercase block mb-1 ${theme.textMuted}`}>Start Date</label>
                  <input
                    type="date"
                    value={absenceForm.startDate}
                    onChange={e => setAbsenceForm({ ...absenceForm, startDate: e.target.value })}
                    className={`w-full p-2.5 rounded-lg text-xs font-semibold outline-none ${theme.input}`}
                  />
                </div>
                <div>
                  <label className={`text-xs font-bold uppercase block mb-1 ${theme.textMuted}`}>End Date</label>
                  <input
                    type="date"
                    value={absenceForm.endDate}
                    onChange={e => setAbsenceForm({ ...absenceForm, endDate: e.target.value })}
                    className={`w-full p-2.5 rounded-lg text-xs font-semibold outline-none ${theme.input}`}
                  />
                </div>
              </div>

              <div>
                <label className={`text-xs font-bold uppercase block mb-1 ${theme.textMuted}`}>Reason</label>
                <textarea
                  rows={3}
                  placeholder="Medical, workshop, official school duty..."
                  value={absenceForm.reason}
                  onChange={e => setAbsenceForm({ ...absenceForm, reason: e.target.value })}
                  className={`w-full p-3 rounded-lg text-xs font-medium outline-none resize-none ${theme.input}`}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowAbsenceModal(false)}
                className={`flex-1 min-h-[42px] py-2.5 font-semibold rounded-lg text-xs transition ${theme.secondaryBtn}`}
              >
                Cancel
              </button>
              <button
                onClick={handleRequestAbsence}
                className="flex-1 min-h-[42px] py-2.5 bg-gradient-to-r from-rose-600 to-rose-500 text-white font-bold rounded-lg text-xs hover:from-rose-700 hover:to-rose-600 shadow-md shadow-rose-500/20 transition"
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LESSON NOTE MODAL */}
      {lessonModal && (
        <div className={`fixed inset-0 z-[100] ${theme.modalBackdrop} flex items-center justify-center p-3 sm:p-4 animate-in fade-in`}>
          <div className={`${theme.modalPanel} p-5 sm:p-6 max-w-md w-full relative max-h-[92dvh] overflow-y-auto`}>
            <button
              onClick={() => setLessonModal(null)}
              aria-label="Close lesson note modal"
              className={`absolute top-4 right-4 p-2 rounded-lg ${theme.iconBtn}`}
            >
              <X className="w-4 h-4" />
            </button>
            <div className={`w-11 h-11 ${theme.accentBadge} rounded-lg flex items-center justify-center mb-4`}>
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className={`text-lg font-bold mb-1 ${theme.textPrimary}`}>Lesson Note & Materials</h3>
            <p className={`text-xs mb-5 ${theme.textMuted}`}>
              {lessonModal.subjectName ? (
                <>
                  {lessonModal.subjectName} · {lessonModal.className} · {DAYS[lessonModal.day]} {PERIODS[lessonModal.period]?.label}
                </>
              ) : (
                'Attach teaching notes or class links to this lesson.'
              )}
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className={`text-xs font-bold uppercase block mb-1 ${theme.textMuted}`}>Lesson Note / Topic</label>
                <textarea
                  rows={4}
                  placeholder="E.g., Topic outline, worksheet exercises, homework..."
                  value={lessonModal.note}
                  onChange={e => setLessonModal({ ...lessonModal, note: e.target.value })}
                  className={`w-full p-3 rounded-lg text-xs sm:text-sm font-medium outline-none resize-none ${theme.input}`}
                />
              </div>

              <div>
                <label className={`text-xs font-bold uppercase block mb-1 ${theme.textMuted}`}>Resource Link (Optional)</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    placeholder="https://docs.google.com/..."
                    value={lessonModal.link}
                    onChange={e => setLessonModal({ ...lessonModal, link: e.target.value })}
                    className={`flex-1 p-2.5 rounded-lg text-xs font-semibold outline-none ${theme.input}`}
                  />
                  {lessonModal.link && lessonModal.link.startsWith('http') && (
                    <a
                      href={lessonModal.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open resource link"
                      className={`px-3 rounded-lg flex items-center justify-center ${theme.secondaryBtn}`}
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setLessonModal(null)}
                className={`flex-1 min-h-[42px] py-2.5 font-semibold rounded-lg text-xs transition ${theme.secondaryBtn}`}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLessonNote}
                className={`flex-1 min-h-[42px] py-2.5 font-bold rounded-lg text-xs transition ${theme.primaryBtn}`}
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {showAboutModal && <AboutUsModal onClose={() => setShowAboutModal(false)} />}
    </div>
  );
};
