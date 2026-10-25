
import React, { useState, useEffect, useRef } from 'react';
import { storage } from '../services/storage';
import { monitorChatContent } from '../services/ai';
import { checkProfanity } from '../services/moderation';
import { ALL_SUBJECTS, ALL_CLASSES, DAYS, PERIODS } from '../constants';
import { getEligibleSubjectsForClass } from '../services/curriculum_eligibility';
import { Teacher, Room, Availability, SwapRequest, AppNotification, AppSettings, ChatMessage, TimetableGrid, TeacherAbsence } from '../types';
import { TimetableGrid as TimetableGridView } from './TimetableGrid';
import { UserGuide } from './UserGuide';
import { AboutUsModal } from './AboutUsModal';
import { Check, LogOut, Save, LayoutGrid, BookOpen, Clock, AlertCircle, BarChart, Send, Bell, Calendar, X, Info, MessageCircle, Settings, User, AlertTriangle, ArrowUpRight, GraduationCap, ChevronRight, Plus, Camera, Mail, Phone, ArrowRight, CheckCircle, RotateCcw, ThumbsUp, ThumbsDown, Filter, CheckCheck, Trash, Menu, Sparkles, Inbox, Zap, Loader2, ArrowLeft, Search, Book, Lock, CreditCard, Palette, Copy, CalendarX, ExternalLink, QrCode, Sun, Moon, School as SchoolIcon, ShieldCheck, ShieldAlert } from 'lucide-react';

interface Props {
  onLogout: () => void;
  onSwitchSchool?: () => void;
}

const Toast = ({ message, type, onClose }: { message: string, type: 'INFO'|'ALERT'|'SUCCESS', onClose: () => void }) => {
    useEffect(() => { const timer = setTimeout(onClose, 5000); return () => clearTimeout(timer); }, []);
    const styles = {
        'INFO': 'bg-white border-slate-200 text-slate-800', 
        'ALERT': 'bg-red-50 border-red-100 text-red-800', 
        'SUCCESS': 'bg-emerald-50 border-emerald-100 text-emerald-800' 
    };
    return (
        <div className={`fixed top-6 right-6 z-[100] ${styles[type]} border px-6 py-4 rounded-2xl shadow-xl flex items-center gap-4 animate-in slide-in-from-right-10 duration-300`}>
            {type === 'SUCCESS' && <CheckCircle size={20}/>}
            {type === 'ALERT' && <AlertTriangle size={20}/>}
            {type === 'INFO' && <Info size={20}/>}
            <span className="font-medium text-sm">{message}</span>
            <button onClick={onClose} className="opacity-50 hover:opacity-100"><X size={16}/></button>
        </div>
    );
};

export const TeacherDashboard: React.FC<Props> = ({ onLogout, onSwitchSchool }) => {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [allTeachers, setAllTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [step, setStep] = useState(0); 
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const currentSchool = storage.getCurrentSchool() || {
    id: 'ota_total_academy',
    name: 'OTA Total Academy',
    code: 'OTA',
    motto: 'Strictly for the Serious Minded Academics'
  };
  
  // Onboarding
  const [onboardingStep, setOnboardingStep] = useState(0); 
  const [tempSelectedClasses, setTempSelectedClasses] = useState<string[]>([]);
  const [tempClassSubjects, setTempClassSubjects] = useState<Record<string, string[]>>({});
  const [currentOnboardingClassIndex, setCurrentOnboardingClassIndex] = useState(0);
  const [onboardingSearch, setOnboardingSearch] = useState('');
  const [classCategoryFilter, setClassCategoryFilter] = useState<'ALL' | 'JS' | 'SS'>('ALL');

  // Sync assigned classes when teacher object loads
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

  // Data
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [stats, setStats] = useState({ totalHours: 0, freePeriods: 0 });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [moderationError, setModerationError] = useState('');
  const [grid, setGrid] = useState<TimetableGrid | null>(null);
  const [viewClassId, setViewClassId] = useState(ALL_CLASSES?.[0]?.id || 'JS1A');
  const [swapModalData, setSwapModalData] = useState<any>(null);
  const [myOfferSlot, setMyOfferSlot] = useState<string>('');
  
  // Personal Schedule State
  const [myScheduleGrid, setMyScheduleGrid] = useState<TimetableGrid | null>(null);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [copiedCalendar, setCopiedCalendar] = useState(false);
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [absenceForm, setAbsenceForm] = useState({ startDate: '', endDate: '', reason: '' });
  const [lessonModal, setLessonModal] = useState<{ day: number; period: number; classId: string; note: string; link: string } | null>(null);
  const [dailyBreakdown, setDailyBreakdown] = useState<number[]>([0, 0, 0, 0, 0]);
  const [fatigueWarning, setFatigueWarning] = useState(false);
  
  // Inbox State
  const [inboxFilter, setInboxFilter] = useState<'ALL' | 'UNREAD' | 'ALERTS'>('ALL');
  const [expandedNotif, setExpandedNotif] = useState<string | null>(null);

  // Profile Form State
  const [profileData, setProfileData] = useState({ bio: '', contactEmail: '', contactPhone: '', profilePicture: '' });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  
  const [msg, setMsg] = useState('');
  const [toast, setToast] = useState<{message: string, type: 'INFO'|'ALERT'|'SUCCESS'} | null>(null);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  useEffect(() => {
    loadData();
    let prevGridStr = localStorage.getItem('ota_timetable_v2');

    const unsubscribe = storage.subscribe(() => {
      loadData();
      const newGridStr = localStorage.getItem('ota_timetable_v2');
      if (newGridStr && newGridStr !== prevGridStr) {
        prevGridStr = newGridStr;
        setToast({
          message: '⚡ Live Update: Master timetable was updated by Admin! Your schedule updated instantly.',
          type: 'SUCCESS'
        });
      }
    });

    const unsubConn = storage.subscribeConnectionStatus((connected) => {
      setIsFirebaseConnected(connected);
    });
    return () => { unsubscribe(); unsubConn(); };
  }, []);

  // Presence Tracking
  useEffect(() => {
    const teacherId = storage.getLoggedInTeacherId();
    if (teacherId) {
      storage.updateTeacherPresence(teacherId);
      const interval = setInterval(() => {
        storage.updateTeacherPresence(teacherId);
      }, 30000); // Update every 30 seconds
      return () => clearInterval(interval);
    }
  }, []);

  useEffect(() => { if (step === 2) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, step]);

  // Sync profile data when teacher loads
  useEffect(() => {
      if (teacher && !isEditingProfile) {
          setProfileData({
              bio: teacher.bio || '',
              contactEmail: teacher.contactEmail || '',
              contactPhone: teacher.contactPhone || '',
              profilePicture: teacher.profilePicture || ''
          });
      }
  }, [teacher, isEditingProfile]);

  useEffect(() => {
      if (teacher && grid) {
          let hours = 0;
          const personalGrid: Record<number, Record<number, any>> = {};
          for(let d=0; d<DAYS.length; d++) {
              personalGrid[d] = {};
              for(let p=0; p<8; p++) personalGrid[d][p] = null;
          }

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
                      if (cell && (cell.teacherId === teacher.id || cell.teacherIds?.includes(teacher.id))) {
                          hours++;
                          personalGrid[d][p] = { 
                              ...cell, 
                              _realClassId: cId,
                              _displayClass: ALL_CLASSES.find(c=>c.id===cId)?.name || cId 
                          };
                      }
                  }
              }
          }

          const dayCounts = [0, 0, 0, 0, 0];
          let maxConsecutiveAnyDay = 0;
          for (let d = 0; d < 5; d++) {
              let currentConsecutive = 0;
              for (let p = 0; p < 8; p++) {
                  if (personalGrid[d][p]) {
                      dayCounts[d]++;
                      currentConsecutive++;
                      if (currentConsecutive > maxConsecutiveAnyDay) maxConsecutiveAnyDay = currentConsecutive;
                  } else {
                      currentConsecutive = 0;
                  }
              }
          }

          setMyScheduleGrid({ 'MY_SCHEDULE': personalGrid });
          setDailyBreakdown(dayCounts);
          setFatigueWarning(maxConsecutiveAnyDay > 5);
          setStats({ totalHours: hours, freePeriods: 40 - hours });
      } else if (!grid) {
          setMyScheduleGrid(null);
      }
  }, [grid, teacher]);

  const loadData = () => {
    const teachers = storage.getTeachers();
    setAllTeachers(teachers);
    setRooms(storage.getRooms());
    const t = teachers.find(x => x.id === storage.getLoggedInTeacherId());
    if (t) {
        if (typeof window !== 'undefined' && localStorage.getItem(`ota_teacher_completed_${t.id}`) === 'true') {
          t.isCompleted = true;
        }
        setTeacher(t);
        const allNotes = storage.getNotifications(t.id);
        setNotifications(allNotes);
        setUnreadCount(allNotes.filter(n => !n.isRead).length);
        const allRequests = storage.getRequests();
        setRequests(allRequests.filter(r => r.teacherId === t.id || (r.type === 'AUTOMATED_SWAP' && r.requestData?.targetTeacherId === t.id)));
        
        const currentGrid = storage.getTimetable();
        setGrid(currentGrid);
        
        setChatMessages(storage.getChatMessages());
    }
  };

  const handleMarkRead = (id: string) => { storage.markRead(id); loadData(); };
  const handleChatSend = async (e?: React.FormEvent) => { 
      if (e) e.preventDefault();
      if (!teacher || !chatInput.trim()) return; 

      const content = chatInput.trim();
      setModerationError('');

      // Automated pre-send moderation against swear words and profanity
      const moderation = checkProfanity(content);
      if (!moderation.isClean) {
          setModerationError('⚠️ Message blocked: Swear words and inappropriate language are prohibited in the faculty staff room.');
          showToast('Message blocked by automated moderation.', 'ALERT');
          return;
      }

      setChatInput(''); 
      const msgId = crypto.randomUUID(); 
      storage.addChatMessage({ 
          id: msgId, 
          senderId: teacher.id, 
          senderName: teacher.name, 
          content: content, 
          timestamp: Date.now(), 
          isFlagged: false, 
          handled: true 
      }); 
      loadData(); 

      // Background AI content safety audit
      monitorChatContent(content).then(check => { 
          if (!check.isSafe) storage.flagMessage(msgId, check.flagReason || "Inappropriate language"); 
      }); 
  };
  
  // Logic Handlers
  const showToast = (message: string, type: 'INFO'|'ALERT'|'SUCCESS') => setToast({ message, type });

  const handleCellClickForNote = (d: number, p: number) => {
    if (!myScheduleGrid || !myScheduleGrid['MY_SCHEDULE']) return;
    const cell = myScheduleGrid['MY_SCHEDULE'][d]?.[p];
    if (!cell || cell.subjectId === 'FREE') return;
    setLessonModal({
      day: d,
      period: p,
      classId: cell._realClassId || '',
      note: cell.lessonNote || '',
      link: cell.lessonLink || ''
    });
  };

  const handleSaveLessonNote = () => {
    if (!lessonModal || !teacher) return;
    const currentGrid = storage.getTimetable();
    if (currentGrid && currentGrid[lessonModal.classId]?.[lessonModal.day]?.[lessonModal.period]) {
      currentGrid[lessonModal.classId][lessonModal.day][lessonModal.period].lessonNote = lessonModal.note;
      currentGrid[lessonModal.classId][lessonModal.day][lessonModal.period].lessonLink = lessonModal.link;
      storage.saveTimetable(currentGrid);
      storage.addAuditLog({
        actorName: teacher.name,
        actorRole: 'TEACHER',
        action: 'LESSON_NOTE_UPDATE',
        details: `Updated lesson note for Period ${lessonModal.period + 1}`
      });
      showToast('Lesson note saved', 'SUCCESS');
    }
    setLessonModal(null);
  };

  const handleRequestAbsence = () => {
    if (!teacher || !absenceForm.startDate || !absenceForm.endDate || !absenceForm.reason) {
      showToast('Please complete all absence fields', 'ALERT');
      return;
    }
    const newAbsence: TeacherAbsence = {
      id: 'abs_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      teacherId: teacher.id,
      teacherName: teacher.name,
      startDate: absenceForm.startDate,
      endDate: absenceForm.endDate,
      reason: absenceForm.reason,
      status: 'PENDING',
      createdAt: Date.now()
    };
    storage.saveAbsence(newAbsence);
    storage.addAuditLog({
      actorName: teacher.name,
      actorRole: 'TEACHER',
      action: 'ABSENCE_REQUEST',
      details: `Requested absence: ${absenceForm.startDate} to ${absenceForm.endDate}`
    });
    showToast('Absence request submitted to Admin', 'SUCCESS');
    setShowAbsenceModal(false);
    setAbsenceForm({ startDate: '', endDate: '', reason: '' });
  };
  const toggleClassSelection = (classId: string) => setTempSelectedClasses(prev => prev.includes(classId) ? prev.filter(id => id !== classId) : [...prev, classId]);
  const toggleSubjectForClass = (classId: string, subjectId: string) => setTempClassSubjects(prev => { const cur = prev[classId] || []; const nw = cur.includes(subjectId) ? cur.filter(id => id !== subjectId) : [...cur, subjectId]; return { ...prev, [classId]: nw }; });
  
  const finishOnboarding = () => { 
      if (!teacher) return; 
      const allSubjects = new Set<string>(); 
      Object.keys(tempClassSubjects).forEach(cid => tempClassSubjects[cid]?.forEach(s => allSubjects.add(s))); 
      
      const updatedTeacher: Teacher = { 
          ...teacher, 
          assignedClasses: tempSelectedClasses, 
          subjectsTaught: Array.from(allSubjects), 
          isCompleted: true 
      };
      
      try {
          localStorage.setItem(`ota_teacher_completed_${teacher.id}`, 'true');
      } catch {}
      storage.saveTeacher(updatedTeacher); 
      setTeacher(updatedTeacher); 
      setStep(1); 
      showToast("Teaching setup complete! Welcome to your timetable.", 'SUCCESS'); 
  };
  
  const handleRequestSubmit = () => { if (!teacher || !msg) return; storage.addRequest({ id: crypto.randomUUID(), teacherId: teacher.id, teacherName: teacher.name, type: 'SWAP', details: msg, status: 'PENDING', timestamp: Date.now() }); setMsg(''); setToast({ message: 'Request submitted', type: 'SUCCESS' }); loadData(); };
  const sendAutomatedSwapRequest = () => { if (!swapModalData || !myOfferSlot || !teacher) return; const [offerClassId, offerD, offerP, offerSubId] = myOfferSlot.split('|'); storage.addRequest({ id: crypto.randomUUID(), teacherId: teacher.id, teacherName: teacher.name, type: 'AUTOMATED_SWAP', status: 'PENDING', timestamp: Date.now(), details: `Proposed swap`, requestData: { targetClassId: swapModalData.coords.classId, targetDay: swapModalData.coords.d, targetPeriod: swapModalData.coords.p, targetSubjectId: swapModalData.targetCell.subjectId, targetTeacherId: swapModalData.targetCell.teacherId, offerClassId: offerClassId, offerDay: parseInt(offerD), offerPeriod: parseInt(offerP), offerSubjectId: offerSubId } }); setSwapModalData(null); setToast({ message: "Proposal Sent", type: 'SUCCESS' }); };

  const getMySlots = () => { 
      if (!grid || !teacher) return []; 
      const slots: { label: string, value: string }[] = []; 
      for(const cId in grid) { 
        if (!grid[cId] || typeof grid[cId] !== 'object') continue;
        for(let d=0; d<5; d++) { 
          if (!grid[cId][d] || typeof grid[cId][d] !== 'object') continue;
          for(let p=0; p<8; p++) { 
            const cell = grid[cId]?.[d]?.[p]; 
            if(cell && (cell.teacherId === teacher.id || cell.teacherIds?.includes(teacher.id))) { 
              const subName = ALL_SUBJECTS.find(s=>s.id === cell.subjectId)?.name || cell.subjectId; 
              const className = ALL_CLASSES.find(c=>c.id === cId)?.name || cId; 
              slots.push({ label: `${DAYS[d]} ${PERIODS[p].label} - ${subName} (${className})`, value: `${cId}|${d}|${p}|${cell.subjectId}` }); 
            } 
          } 
        } 
      } 
      return slots; 
  };

  const [showAboutModal, setShowAboutModal] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => { 
      const file = e.target.files?.[0]; 
      if (file) { 
          if (file.size > 8 * 1024 * 1024) {
              setToast({message: "Image too large (max 8MB)", type: 'ALERT'});
              return;
          }
          const reader = new FileReader(); 
          reader.onload = (event) => {
              const img = new Image();
              img.onload = () => {
                  try {
                      // Optimize to crisp 256x256 square avatar for instant sync and zero quota exceptions
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

                          setProfileData(prev => ({...prev, profilePicture: optimizedDataUrl}));
                          if (teacher) {
                              const updatedTeacher: Teacher = { 
                                  ...teacher, 
                                  bio: profileData.bio || teacher.bio,
                                  contactEmail: profileData.contactEmail || teacher.contactEmail,
                                  contactPhone: profileData.contactPhone || teacher.contactPhone,
                                  profilePicture: optimizedDataUrl 
                              };
                              try {
                                  localStorage.setItem(`ota_profile_pic_${teacher.id}`, optimizedDataUrl);
                              } catch {}
                              storage.saveTeacher(updatedTeacher);
                              setTeacher(updatedTeacher);
                              setToast({ message: 'Profile picture updated successfully!', type: 'SUCCESS' });
                          }
                      }
                  } catch (canvasErr) {
                      const rawData = event.target?.result as string;
                      setProfileData(prev => ({...prev, profilePicture: rawData}));
                      if (teacher) {
                          const updatedTeacher: Teacher = { 
                              ...teacher, 
                              bio: profileData.bio || teacher.bio,
                              contactEmail: profileData.contactEmail || teacher.contactEmail,
                              contactPhone: profileData.contactPhone || teacher.contactPhone,
                              profilePicture: rawData 
                          };
                          try {
                              localStorage.setItem(`ota_profile_pic_${teacher.id}`, rawData);
                          } catch {}
                          storage.saveTeacher(updatedTeacher);
                          setTeacher(updatedTeacher);
                          setToast({ message: 'Profile picture updated successfully!', type: 'SUCCESS' });
                      }
                  }
              };
              img.src = event.target?.result as string;
          }; 
          reader.readAsDataURL(file); 
      } 
  };
  
  const saveProfile = () => { 
      if (!teacher) return; 
      storage.saveTeacher({ ...teacher, ...profileData }); 
      setTeacher({ ...teacher, ...profileData }); 
      setIsEditingProfile(false);
      setToast({ message: 'Profile updated successfully', type: 'SUCCESS' }); 
  };

  const filteredNotifications = notifications.filter(n => {
      if (inboxFilter === 'UNREAD') return !n.isRead;
      if (inboxFilter === 'ALERTS') return n.type === 'ALERT';
      return true;
  });

  if (!teacher) return null;

  const isTeacherCompleted = teacher.isCompleted || (typeof window !== 'undefined' && localStorage.getItem(`ota_teacher_completed_${teacher.id}`) === 'true');

  // --- ONBOARDING WIZARD ---
  if (!isTeacherCompleted) {
      const currentClassId = tempSelectedClasses?.[currentOnboardingClassIndex];
      const currentClass = ALL_CLASSES.find(c => c && c.id === currentClassId);
      const search = (onboardingSearch || '').toLowerCase();
      
      const isJunior = (id: string) => id.startsWith('JS');
      const isSenior = (id: string) => id.startsWith('SS');

      const filteredClasses = ALL_CLASSES.filter(c => {
          const matchesSearch = ((c.name || '').toLowerCase().includes(search)) || ((c.category || '').toLowerCase().includes(search));
          if (!matchesSearch) return false;
          if (classCategoryFilter === 'JS') return isJunior(c.id);
          if (classCategoryFilter === 'SS') return isSenior(c.id);
          return true;
      });

      const allConfiguredSubjects = storage.getSubjects();
      const eligibleSubjects = currentClass ? getEligibleSubjectsForClass(currentClass, allConfiguredSubjects) : [];
      const filteredSubjects = eligibleSubjects.filter(s => ((s.name || '').toLowerCase().includes(search) || (s.code || '').toLowerCase().includes(search)));

      const handleSelectAllJunior = () => {
          const juniorIds = ALL_CLASSES.filter(c => isJunior(c.id)).map(c => c.id);
          setTempSelectedClasses(prev => Array.from(new Set([...prev, ...juniorIds])));
      };

      const handleSelectAllSenior = () => {
          const seniorIds = ALL_CLASSES.filter(c => isSenior(c.id)).map(c => c.id);
          setTempSelectedClasses(prev => Array.from(new Set([...prev, ...seniorIds])));
      };

      const handleClearAllClasses = () => {
          setTempSelectedClasses([]);
      };

      const handleSelectAllSubjectsForCurrentClass = () => {
          if (!currentClass) return;
          const eligibleIds = eligibleSubjects
              .filter(s => !allTeachers.some(t => t.id !== teacher.id && t.assignedClasses.includes(currentClass.id) && t.subjectsTaught.includes(s.id)))
              .map(s => s.id);
          setTempClassSubjects(prev => ({
              ...prev,
              [currentClass.id]: eligibleIds
          }));
      };

      const handleClearSubjectsForCurrentClass = () => {
          if (!currentClass) return;
          setTempClassSubjects(prev => ({
              ...prev,
              [currentClass.id]: []
          }));
      };

      return (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4 md:p-6 overflow-hidden">
           <div className="w-full h-[100dvh] sm:h-auto sm:max-h-[92dvh] sm:max-w-4xl bg-white sm:rounded-3xl shadow-2xl border-0 sm:border border-slate-200/80 overflow-hidden flex flex-col md:flex-row">
                
                {/* DESKTOP SIDEBAR */}
                <aside className="hidden md:flex md:w-72 bg-slate-900 text-white p-6 md:p-8 flex-col justify-between shrink-0">
                     <div>
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                                <GraduationCap size={20} className="text-white" />
                            </div>
                            <div>
                                <h1 className="font-bold text-base tracking-tight leading-none text-white">Pentric Faculty</h1>
                                <p className="text-[11px] text-blue-400 font-medium mt-1">Teacher Setup</p>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className={`p-3 rounded-xl transition-all border ${onboardingStep === 0 ? 'bg-white/10 border-blue-500/50 text-white font-bold' : onboardingStep > 0 ? 'bg-white/5 border-emerald-500/30 text-emerald-300' : 'border-transparent text-slate-400'}`}>
                                <div className="flex items-center gap-2.5 text-xs">
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${onboardingStep > 0 ? 'bg-emerald-500 text-white' : onboardingStep === 0 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                        {onboardingStep > 0 ? <Check size={12} /> : '1'}
                                    </span>
                                    <span>1. Welcome & Intro</span>
                                </div>
                            </div>

                            <div className={`p-3 rounded-xl transition-all border ${onboardingStep === 1 ? 'bg-white/10 border-blue-500/50 text-white font-bold' : onboardingStep > 1 ? 'bg-white/5 border-emerald-500/30 text-emerald-300' : 'border-transparent text-slate-400'}`}>
                                <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2.5">
                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${onboardingStep > 1 ? 'bg-emerald-500 text-white' : onboardingStep === 1 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                            {onboardingStep > 1 ? <Check size={12} /> : '2'}
                                        </span>
                                        <span>2. Assigned Classes</span>
                                    </div>
                                    {tempSelectedClasses.length > 0 && (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-200 font-mono font-bold">
                                            {tempSelectedClasses.length}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className={`p-3 rounded-xl transition-all border ${onboardingStep === 2 ? 'bg-white/10 border-blue-500/50 text-white font-bold' : 'border-transparent text-slate-400'}`}>
                                <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2.5">
                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${onboardingStep === 2 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                            3
                                        </span>
                                        <span>3. Subjects per Class</span>
                                    </div>
                                    {tempSelectedClasses.length > 0 && (
                                        <span className="text-[10px] text-slate-400 font-medium">
                                            {currentOnboardingClassIndex + 1}/{tempSelectedClasses.length}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                     </div>

                     <div className="pt-6 border-t border-white/10">
                         <div className="flex items-center gap-3">
                             <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-inner">
                                 {teacher.name.charAt(0)}
                             </div>
                             <div className="min-w-0 flex-1">
                                 <div className="text-xs font-bold truncate text-white">{teacher.name}</div>
                                 <div className="text-[10px] text-slate-400 truncate">@{teacher.username}</div>
                             </div>
                         </div>
                     </div>
                </aside>

                {/* MOBILE STEPPER HEADER */}
                <div className="md:hidden bg-slate-900 text-white px-4 py-3 shrink-0 flex flex-col gap-2 shadow-md">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center shadow-xs">
                                <GraduationCap size={15} className="text-white" />
                            </div>
                            <span className="font-bold text-sm text-white">Teacher Setup</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-white/10 px-2.5 py-1 rounded-full text-xs font-bold text-blue-300">
                            <span>Step {onboardingStep + 1} of 3</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-white">
                                {onboardingStep === 0 ? 'Intro' : onboardingStep === 1 ? 'Classes' : 'Subjects'}
                            </span>
                        </div>
                    </div>
                    {/* Progress segments */}
                    <div className="grid grid-cols-3 gap-1.5 h-1.5 w-full">
                        <div className={`rounded-full transition-all duration-300 ${onboardingStep >= 0 ? 'bg-blue-500' : 'bg-white/20'}`} />
                        <div className={`rounded-full transition-all duration-300 ${onboardingStep >= 1 ? 'bg-blue-500' : 'bg-white/20'}`} />
                        <div className={`rounded-full transition-all duration-300 ${onboardingStep >= 2 ? 'bg-blue-500' : 'bg-white/20'}`} />
                    </div>
                </div>

                {/* CONTENT AREA */}
                <div className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden">
                    
                    {/* STEP 0: INTRO */}
                    {onboardingStep === 0 && (
                        <div className="flex-1 flex flex-col justify-between p-4 sm:p-8 overflow-y-auto custom-scrollbar">
                            <div className="max-w-lg mx-auto w-full my-auto text-center py-4">
                                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-blue-50 text-blue-600 rounded-3xl mx-auto flex items-center justify-center shadow-lg shadow-blue-500/10 mb-5">
                                    <GraduationCap size={36} className="text-blue-600" />
                                </div>
                                <span className="inline-block px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold mb-3 border border-blue-200/60">
                                    {currentSchool.name}
                                </span>
                                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mb-2 tracking-tight">
                                    Welcome, {teacher.name.split(' ')[0]}!
                                </h2>
                                <p className="text-slate-500 text-xs sm:text-sm leading-relaxed mb-6 max-w-md mx-auto">
                                    Let's configure your teaching schedule in 2 simple steps. Once set, your personalized timetable will be ready immediately.
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left mb-6">
                                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                                        <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-black mb-2">1</div>
                                        <div className="font-bold text-xs text-slate-900 mb-0.5">Pick Assigned Classes</div>
                                        <div className="text-[11px] text-slate-500 leading-normal">Select the arms you teach (e.g. JS1A, JS2B, SS2A).</div>
                                    </div>
                                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                                        <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-black mb-2">2</div>
                                        <div className="font-bold text-xs text-slate-900 mb-0.5">Assign Subjects</div>
                                        <div className="text-[11px] text-slate-500 leading-normal">Confirm the specific subjects you teach in each class.</div>
                                    </div>
                                </div>
                            </div>

                            {/* Bottom bar */}
                            <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
                                <button 
                                    onClick={onLogout}
                                    className="px-4 py-2.5 text-xs font-bold text-slate-400 hover:text-red-600 transition"
                                >
                                    Sign Out
                                </button>
                                <button 
                                    onClick={() => setOnboardingStep(1)} 
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-600/20 transition flex items-center gap-2"
                                >
                                    <span>Get Started</span>
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>
                    )}
                    {/* STEP 1: CLASS SELECTION */}
                    {onboardingStep === 1 && (
                        <div className="flex-1 flex flex-col min-h-0">
                            {/* Step Header */}
                            <div className="p-4 sm:p-6 pb-3 border-b border-slate-100 shrink-0">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <div>
                                        <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">Select Classes You Teach</h2>
                                        <p className="text-xs text-slate-400 mt-0.5">Tap the class arms you are assigned to this term.</p>
                                    </div>
                                    <div className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200/60 shrink-0">
                                        {tempSelectedClasses.length} selected
                                    </div>
                                </div>

                                {/* Search & Category Filters */}
                                <div className="flex flex-col sm:flex-row gap-2 mt-3">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                                        <input 
                                            type="text"
                                            placeholder="Search classes (JS1, SS2, A, B...)"
                                            value={onboardingSearch}
                                            onChange={e => setOnboardingSearch(e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 transition"
                                        />
                                    </div>
                                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                                        <button 
                                            onClick={() => setClassCategoryFilter('ALL')}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${classCategoryFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        >
                                            All
                                        </button>
                                        <button 
                                            onClick={() => setClassCategoryFilter('JS')}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${classCategoryFilter === 'JS' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        >
                                            Junior (JS)
                                        </button>
                                        <button 
                                            onClick={() => setClassCategoryFilter('SS')}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${classCategoryFilter === 'SS' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        >
                                            Senior (SS)
                                        </button>
                                    </div>
                                </div>

                                {/* Quick selection shortcuts */}
                                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100 text-[11px]">
                                    <span className="text-slate-400 font-semibold">Shortcuts:</span>
                                    <button onClick={handleSelectAllJunior} className="text-blue-600 hover:text-blue-800 font-bold hover:underline">+ All Junior</button>
                                    <span className="text-slate-300">·</span>
                                    <button onClick={handleSelectAllSenior} className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline">+ All Senior</button>
                                    {tempSelectedClasses.length > 0 && (
                                        <>
                                            <span className="text-slate-300">·</span>
                                            <button onClick={handleClearAllClasses} className="text-red-500 hover:text-red-700 font-bold hover:underline">Clear</button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Scrollable Classes Grid */}
                            <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0 custom-scrollbar">
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                                    {filteredClasses.map(c => {
                                        const isSelected = tempSelectedClasses.includes(c.id);
                                        return (
                                            <button 
                                                key={c.id} 
                                                onClick={() => toggleClassSelection(c.id)} 
                                                className={`min-h-[46px] p-2.5 rounded-xl border text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 select-none ${
                                                    isSelected 
                                                        ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20 ring-2 ring-blue-300' 
                                                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 hover:border-slate-300'
                                                }`}
                                            >
                                                {isSelected && <Check size={14} className="stroke-[3]" />}
                                                <span>{c.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                {filteredClasses.length === 0 && (
                                    <div className="py-12 text-center text-slate-400 text-xs">
                                        No classes matching your filter.
                                    </div>
                                )}
                            </div>

                            {/* Sticky Bottom Actions */}
                            <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
                                <button 
                                    onClick={() => setOnboardingStep(0)} 
                                    className="px-4 py-2.5 text-slate-600 hover:bg-slate-200/70 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-1.5"
                                >
                                    <ArrowLeft size={16} />
                                    <span>Intro</span>
                                </button>
                                <button 
                                    onClick={() => {
                                        setOnboardingStep(2);
                                        setCurrentOnboardingClassIndex(0);
                                        setOnboardingSearch('');
                                    }} 
                                    disabled={tempSelectedClasses.length === 0} 
                                    className="px-5 py-2.5 sm:px-7 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    <span>Assign Subjects ({tempSelectedClasses.length})</span>
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>
                    )}
                    {/* STEP 2: SUBJECTS PER CLASS */}
                    {onboardingStep === 2 && (
                         <div className="flex-1 flex flex-col min-h-0">
                            {/* Step Header with Class Progress & Navigator */}
                            <div className="p-4 sm:p-6 pb-3 border-b border-slate-100 shrink-0">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                                                Class {currentOnboardingClassIndex + 1} of {tempSelectedClasses.length}
                                            </span>
                                            <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">
                                                {currentClass?.name || 'Class'}
                                            </h2>
                                        </div>
                                        <p className="text-xs text-slate-400 mt-0.5">Select the subjects you teach in {currentClass?.name}.</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <span className="text-xs font-bold text-slate-600">
                                            {tempClassSubjects[currentClass?.id || '']?.length || 0} subjects picked
                                        </span>
                                    </div>
                                </div>

                                {/* Class Navigation Pills Strip */}
                                <div className="flex items-center gap-1.5 overflow-x-auto pb-2 custom-scrollbar">
                                    {tempSelectedClasses.map((cId, idx) => {
                                        const c = ALL_CLASSES.find(cls => cls.id === cId);
                                        const isCurrent = idx === currentOnboardingClassIndex;
                                        const count = tempClassSubjects[cId]?.length || 0;
                                        return (
                                            <button 
                                                key={cId}
                                                onClick={() => {
                                                    setCurrentOnboardingClassIndex(idx);
                                                    setOnboardingSearch('');
                                                }}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                                                    isCurrent 
                                                        ? 'bg-blue-600 text-white shadow-sm' 
                                                        : count > 0 
                                                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                            >
                                                <span>{c?.name || cId}</span>
                                                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                                                    isCurrent ? 'bg-white/20 text-white' : count > 0 ? 'bg-emerald-200 text-emerald-900' : 'bg-slate-200 text-slate-600'
                                                }`}>
                                                    {count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Search & Quick Actions */}
                                <div className="flex flex-col sm:flex-row gap-2 mt-2 pt-2 border-t border-slate-100">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                                        <input 
                                            type="text"
                                            placeholder={`Search subjects for ${currentClass?.name}...`}
                                            value={onboardingSearch}
                                            onChange={e => setOnboardingSearch(e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 transition"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={handleSelectAllSubjectsForCurrentClass}
                                            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl whitespace-nowrap transition"
                                        >
                                            Select All Eligible
                                        </button>
                                        <button 
                                            onClick={handleClearSubjectsForCurrentClass}
                                            className="px-3 py-2 text-slate-400 hover:text-red-600 text-xs font-bold rounded-xl whitespace-nowrap transition"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Scrollable Subjects Grid */}
                            <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0 custom-scrollbar">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-2.5">
                                    {filteredSubjects.map(s => {
                                        if (!currentClass) return null;
                                        // Check if already taken by another teacher for this class
                                        const takenBy = allTeachers.find(t => 
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
                                                className={`p-3 rounded-xl border text-left transition-all flex items-start gap-3 select-none active:scale-98 ${
                                                    isTaken 
                                                        ? 'bg-slate-50/80 border-slate-200 opacity-60 cursor-not-allowed' 
                                                        : isSelected 
                                                            ? 'bg-blue-50 border-blue-500 text-blue-900 shadow-xs ring-2 ring-blue-500/20' 
                                                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                                                }`}
                                            >
                                                <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                                                    isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-100 border-slate-300'
                                                }`}>
                                                    {isSelected && <Check size={13} className="stroke-[3]" />}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-bold text-xs sm:text-sm leading-tight text-slate-900 truncate">
                                                        {s.name}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <span className="text-[10px] font-mono font-bold text-slate-400">
                                                            {s.code || s.id}
                                                        </span>
                                                        {s.category && (
                                                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                                                                {s.category}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {isTaken && (
                                                        <span className="inline-block mt-1 text-[10px] text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200/50">
                                                            Taken by {takenBy?.name ? takenBy.name.split(' ')[0] : 'Staff'}
                                                        </span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                {filteredSubjects.length === 0 && (
                                    <div className="py-12 text-center text-slate-400 text-xs">
                                        No subjects found matching your search.
                                    </div>
                                )}
                            </div>

                            {/* Sticky Bottom Actions */}
                            <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
                                {currentOnboardingClassIndex > 0 ? (
                                    <button 
                                        onClick={() => {
                                            setCurrentOnboardingClassIndex(prev => prev - 1);
                                            setOnboardingSearch('');
                                        }} 
                                        className="px-4 py-2.5 text-slate-600 hover:bg-slate-200/70 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-1.5"
                                    >
                                        <ArrowLeft size={16} />
                                        <span>Previous Class</span>
                                    </button>
                                ) : (
                                    <button 
                                        onClick={() => setOnboardingStep(1)} 
                                        className="px-4 py-2.5 text-slate-600 hover:bg-slate-200/70 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-1.5"
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
                                        className="px-5 py-2.5 sm:px-7 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md transition flex items-center gap-2"
                                    >
                                        <span>Next: {ALL_CLASSES.find(c => c.id === tempSelectedClasses[currentOnboardingClassIndex + 1])?.name || 'Class'}</span>
                                        <ChevronRight size={18} />
                                    </button>
                                ) : (
                                    <button 
                                        onClick={finishOnboarding} 
                                        className="px-6 py-2.5 sm:px-8 sm:py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-lg shadow-emerald-600/20 transition flex items-center gap-2"
                                    >
                                        <CheckCircle size={18} />
                                        <span>Finish & View Timetable</span>
                                    </button>
                                )}
                            </div>
                         </div>
                    )}
                </div>
           </div>
        </div>
      );
  }

  // --- MAIN UI ---
  const SidebarBtn = ({ id, label, icon: Icon, badge }: any) => (
      <button onClick={() => { setStep(id); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-bold transition-all ${step === id ? 'bg-blue-600 text-white shadow-xl shadow-blue-900/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
          <Icon size={20} /> <span className="flex-1 text-left">{label}</span>
          {badge > 0 && <span className="bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center">{badge}</span>}
      </button>
  );

  return (
    <div className="flex h-screen bg-[#f1f5f9] font-sans text-slate-900 overflow-hidden">
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        
        {/* MOBILE OVERLAY */}
        {isMobileMenuOpen && (
            <div 
                className="fixed inset-0 bg-slate-900/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
                onClick={() => setIsMobileMenuOpen(false)}
            />
        )}

        {/* SIDEBAR */}
        <div className={`fixed inset-y-0 left-0 w-72 bg-slate-900 text-white transform transition-transform duration-300 z-50 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 flex flex-col shadow-2xl`}>
             <div className="p-8">
                 <div className="flex items-center gap-3 text-white mb-8">
                     <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg"><GraduationCap size={20}/></div>
                     <span className="font-bold text-lg tracking-tight">Pentric Faculty</span>
                 </div>
                 <div className="flex items-center gap-3 p-3 bg-white/5 rounded-2xl border border-white/5">
                    {teacher.profilePicture ? <img src={teacher.profilePicture} className="w-10 h-10 rounded-full object-cover"/> : <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center font-bold">{teacher.name.charAt(0)}</div>}
                    <div>
                        <div className="font-bold text-sm truncate w-32">{teacher.name}</div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Teacher</div>
                    </div>
                 </div>
             </div>
             
             <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
                 <SidebarBtn id={0} label="Home" icon={LayoutGrid} />
                 <SidebarBtn id={6} label="Inbox" icon={Inbox} badge={unreadCount} />
                 <SidebarBtn id={1} label="My Schedule" icon={Calendar} />
                 <SidebarBtn id={2} label="Staff Room" icon={MessageCircle} />
                 <SidebarBtn id={3} label="Requests" icon={RotateCcw} />
                 <SidebarBtn id={5} label="All Schedules" icon={BookOpen} />
                 <SidebarBtn id={7} label="User Guide" icon={Book} />
                 <SidebarBtn id={4} label="Profile" icon={User} />
                 <button
                    onClick={() => setShowAboutModal(true)}
                    className="w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition font-bold text-sm text-slate-400 hover:text-white hover:bg-white/5 text-left"
                 >
                     <Sparkles size={20} className="text-amber-400" />
                     About Pentric
                 </button>
             </nav>

             <div className="p-4 border-t border-white/10">
                 <button onClick={onLogout} className="flex items-center gap-3 w-full px-6 py-4 text-red-400 font-bold hover:bg-white/5 rounded-2xl transition"><LogOut size={20}/> Sign Out</button>
             </div>
        </div>

        {/* CONTENT */}
        <div className="flex-1 flex flex-col h-full relative overflow-hidden">
            {/* Header */}
            <header className="h-16 md:h-20 bg-white/80 backdrop-blur-sm border-b border-slate-200 px-3 sm:px-6 md:px-8 flex justify-between items-center z-20">
                <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"><Menu size={20}/></button>
                    {step !== 0 && (
                        <button onClick={() => setStep(0)} className="p-1.5 sm:p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors text-slate-600" title="Back to Dashboard">
                            <ArrowLeft size={16}/>
                        </button>
                    )}
                    <h2 className="text-sm sm:text-xl font-bold text-slate-800 truncate max-w-[140px] sm:max-w-none">
                        {step === 0 ? 'Dashboard' : step === 6 ? 'Inbox' : step === 1 ? 'My Schedule' : step === 2 ? 'Staff Room' : step === 3 ? 'Requests' : step === 4 ? 'My Profile' : step === 5 ? 'Master View' : 'User Guide'}
                    </h2>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    {/* Active Institution Badge */}
                    <div className="hidden lg:flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-900 shadow-2xs">
                        <span className="font-extrabold text-blue-700 flex items-center gap-1.5" title={currentSchool.name}>
                            <SchoolIcon size={14} className="text-blue-600" />
                            {currentSchool.name}
                        </span>
                        <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full">
                            Faculty Portal
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full text-xs font-semibold bg-slate-100 border border-slate-200 shadow-sm">
                        <span className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${isFirebaseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                        <span className={`hidden sm:inline ${isFirebaseConnected ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {isFirebaseConnected ? 'Live Sync Connected' : 'Syncing...'}
                        </span>
                        <span className={`sm:hidden text-[10px] font-bold ${isFirebaseConnected ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {isFirebaseConnected ? 'Live' : 'Sync'}
                        </span>
                    </div>
                    <div className="relative group">
                        <button onClick={() => setStep(6)} className="w-9 h-9 sm:w-10 sm:h-10 bg-white rounded-full border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-blue-600 transition-colors">
                            <Bell size={18}/>
                            {unreadCount > 0 && <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>}
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 custom-scrollbar bg-slate-50/50">
                
                {/* --- DASHBOARD VIEW --- */}
                {step === 0 && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
                        {/* Welcome Banner */}
                        <div className="bg-slate-900 rounded-[2.5rem] p-8 md:p-12 relative overflow-hidden text-white shadow-2xl">
                             <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/30 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2"></div>
                             <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-600/30 rounded-full blur-[60px] translate-y-1/2 -translate-x-1/2"></div>
                             
                             <div className="relative z-10">
                                 <h1 className="text-3xl md:text-5xl font-black mb-4 tracking-tight">Good Morning, <br/>{teacher?.name ? teacher.name.split(' ')[0] : 'Teacher'}</h1>
                                 <p className="text-slate-400 text-lg max-w-lg mb-8">Ready to inspire some minds today? You have {stats.freePeriods} free periods this week.</p>
                                 
                                 <div className="flex gap-4">
                                     <button onClick={() => setStep(1)} className="px-6 py-3 bg-white text-slate-900 rounded-xl font-bold hover:bg-blue-50 transition-colors flex items-center gap-2">
                                         <Calendar size={18}/> View Schedule
                                     </button>
                                     <button onClick={() => setStep(2)} className="px-6 py-3 bg-white/10 text-white rounded-xl font-bold hover:bg-white/20 transition-colors flex items-center gap-2 backdrop-blur-sm">
                                         <MessageCircle size={18}/> Staff Room
                                     </button>
                                 </div>
                             </div>
                        </div>

                        {/* Quick Stats */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                                <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Teaching Load</div>
                                <div className="text-3xl font-black text-slate-900">{stats.totalHours}<span className="text-sm text-slate-400 font-medium ml-1">hrs</span></div>
                            </div>
                            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                                <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Classes</div>
                                <div className="text-3xl font-black text-slate-900">{teacher.assignedClasses.length}</div>
                            </div>
                            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                                <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Subjects</div>
                                <div className="text-3xl font-black text-slate-900">{teacher.subjectsTaught.length}</div>
                            </div>
                             <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                                <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Notifications</div>
                                <div className="text-3xl font-black text-slate-900">{unreadCount}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- SCHEDULE VIEW (PERSONALIZED) --- */}
                {step === 1 && (
                    <div className="space-y-6 animate-in fade-in duration-500">
                        {/* Stats & Workload Panel */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
                                <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block mb-1">Weekly Workload</span>
                                <div className="text-2xl font-black text-slate-900">{stats.totalHours} <span className="text-sm font-normal text-slate-500">hrs / wk</span></div>
                                <span className="text-xs text-slate-500 mt-1 block">{stats.freePeriods} free periods remaining</span>
                            </div>

                            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm md:col-span-2">
                                <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block mb-2">Daily Period Distribution</span>
                                <div className="grid grid-cols-5 gap-2 text-center">
                                    {DAYS.map((day, idx) => (
                                        <div key={day} className="bg-slate-50 p-2 rounded-2xl border border-slate-100">
                                            <span className="text-[10px] font-extrabold text-slate-400 block uppercase">{day.substring(0,3)}</span>
                                            <span className="text-sm font-black text-slate-800">{dailyBreakdown[idx] || 0} p</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                                <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block mb-1">Fatigue Warning</span>
                                {fatigueWarning ? (
                                    <div className="bg-amber-50 border border-amber-200 p-2 rounded-xl text-amber-800 text-xs font-bold flex items-center gap-2">
                                        <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                                        <span>5+ consecutive periods detected on schedule</span>
                                    </div>
                                ) : (
                                    <div className="bg-emerald-50 border border-emerald-200 p-2 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2">
                                        <CheckCircle size={16} className="text-emerald-600 shrink-0" />
                                        <span>Healthy period spacing</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="bg-white p-4 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                                <div>
                                    <h3 className="text-xl md:text-2xl font-black text-slate-900">My Personalized Schedule</h3>
                                    <p className="text-xs text-slate-400 mt-0.5">Click on any period to view or attach lesson notes</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setShowCalendarModal(true)}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-xs rounded-xl border border-indigo-200 transition"
                                    >
                                        <Calendar size={14} />
                                        <span>iCal Feed</span>
                                    </button>
                                    <button
                                        onClick={() => setShowAbsenceModal(true)}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold text-xs rounded-xl border border-rose-200 transition"
                                    >
                                        <CalendarX size={14} />
                                        <span>Mark Unavailable</span>
                                    </button>
                                    <div className="text-sm font-bold bg-blue-50 text-blue-700 px-4 py-2 rounded-xl border border-blue-100 w-fit">
                                        {teacher.name}
                                    </div>
                                </div>
                            </div>
                            {myScheduleGrid ? (
                                <TimetableGridView 
                                    timetable={myScheduleGrid} 
                                    classId="MY_SCHEDULE" 
                                    isEditable={false} 
                                    teachers={allTeachers}
                                    rooms={rooms}
                                    onCellClick={handleCellClickForNote}
                                />
                            ) : (
                                <div className="text-center py-20 text-slate-400">Schedule not yet published by admin or no classes assigned.</div>
                            )}
                        </div>
                    </div>
                )}

                {/* --- ALL TIMETABLES VIEW --- */}
                {step === 5 && (
                    <div className="space-y-6 animate-in fade-in duration-500">
                         <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm w-fit mb-6">
                            <Filter size={20} className="text-slate-400"/>
                            <select 
                                value={viewClassId} 
                                onChange={e => setViewClassId(e.target.value)} 
                                className="bg-transparent font-bold text-slate-700 outline-none cursor-pointer"
                            >
                                {ALL_CLASSES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div className="bg-white p-4 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
                            <div className="mb-6">
                                <h3 className="text-xl md:text-2xl font-black text-slate-900 mb-2">Master View: {ALL_CLASSES.find(c=>c.id===viewClassId)?.name}</h3>
                                <p className="text-slate-500 text-sm">Tap any slot occupied by another teacher to request a swap.</p>
                            </div>
                            {grid ? (
                                <TimetableGridView 
                                    timetable={grid} 
                                    classId={viewClassId} 
                                    isEditable={true} 
                                    teachers={allTeachers}
                                    rooms={rooms}
                                    onCellClick={(d, p) => {
                                        const cell = grid?.[viewClassId]?.[d]?.[p];
                                        if (cell && cell.teacherId !== teacher.id && cell.subjectId !== 'FREE') {
                                            setSwapModalData({ coords: {classId: viewClassId, d, p}, targetCell: cell });
                                        }
                                    }}
                                />
                            ) : <div className="text-center py-20 text-slate-400">Schedule not published.</div>}
                        </div>
                    </div>
                )}
                
                {/* --- INBOX / CHAT / REQUESTS / PROFILE (Standard Views) --- */}
                {/* (Keeping existing implementation for Step 6, 2, 3, 4, 7) */}
                {step === 6 && (
                    <div className="h-[calc(100vh-140px)] flex flex-col bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h2 className="text-xl font-bold text-slate-800">Inbox</h2>
                                <p className="text-sm text-slate-500">Notifications & System Alerts</p>
                            </div>
                            <div className="flex gap-2">
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
                {step === 2 && (
                    <div className="h-[calc(100vh-140px)] flex flex-col bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
                        {/* Staff Room Header */}
                        <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg sm:text-xl font-black text-slate-900">Faculty Staff Room</h2>
                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-100 text-emerald-800 tracking-wider">
                                        Live
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5">Real-time collaboration and discussions between verified faculty & administration</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs text-slate-600 font-semibold shadow-2xs">
                                    <ShieldCheck size={14} className="text-emerald-600" />
                                    <span>Automated Moderation Active</span>
                                </div>
                            </div>
                        </div>

                        {/* Moderation Alert Banner if triggered */}
                        {moderationError && (
                            <div className="bg-rose-50 border-b border-rose-200 p-3 sm:px-6 flex items-center justify-between gap-2 text-xs text-rose-800 font-semibold animate-in slide-in-from-top-2">
                                <div className="flex items-center gap-2">
                                    <ShieldAlert size={16} className="text-rose-600 shrink-0" />
                                    <span>{moderationError}</span>
                                </div>
                                <button onClick={() => setModerationError('')} className="p-1 hover:bg-rose-100 rounded-lg text-rose-600 transition">
                                    <X size={14} />
                                </button>
                            </div>
                        )}

                        {/* Messages Stream */}
                        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/40 custom-scrollbar">
                            {chatMessages.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                                        <MessageCircle size={28} />
                                    </div>
                                    <p className="font-bold text-sm text-slate-700">Welcome to the Faculty Staff Room</p>
                                    <p className="text-xs text-slate-400 mt-1 max-w-sm text-center">
                                        Coordinate schedules, communicate with colleagues, or ask administrative questions here.
                                    </p>
                                </div>
                            )}

                            {chatMessages.map((m) => {
                                const isMe = m.senderId === teacher.id;
                                const sender = allTeachers.find(t => t.id === m.senderId);
                                const avatar = sender?.profilePicture || (isMe ? profileData.profilePicture : undefined);

                                return (
                                    <div 
                                        key={m.id} 
                                        className={`flex items-end gap-2.5 ${isMe ? 'justify-end' : 'justify-start'}`}
                                    >
                                        {!isMe && (
                                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-slate-200 bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs shadow-2xs">
                                                {avatar ? (
                                                    <img src={avatar} alt={m.senderName} className="w-full h-full object-cover" />
                                                ) : (
                                                    <span>{(m.senderName || 'Staff').charAt(0)}</span>
                                                )}
                                            </div>
                                        )}

                                        <div className={`max-w-[85%] sm:max-w-md rounded-2xl p-3.5 shadow-xs ${
                                            isMe 
                                                ? 'bg-blue-600 text-white rounded-br-xs' 
                                                : 'bg-white text-slate-800 border border-slate-200/80 rounded-bl-xs'
                                        }`}>
                                            <div className="flex items-center justify-between gap-3 mb-1">
                                                <span className={`text-[11px] font-bold ${isMe ? 'text-blue-100' : 'text-slate-900'}`}>
                                                    {isMe ? 'You' : m.senderName}
                                                </span>
                                                <span className={`text-[10px] ${isMe ? 'text-blue-200' : 'text-slate-400'}`}>
                                                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>

                                            <p className={`text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words ${isMe ? 'text-white' : 'text-slate-700'}`}>
                                                {m.content}
                                            </p>

                                            {m.isFlagged && (
                                                <div className={`mt-2 pt-1.5 border-t text-[10px] font-bold flex items-center gap-1 ${
                                                    isMe ? 'border-blue-500 text-amber-200' : 'border-slate-100 text-amber-600'
                                                }`}>
                                                    <AlertTriangle size={12} />
                                                    <span>Under moderation review</span>
                                                </div>
                                            )}
                                        </div>

                                        {isMe && (
                                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-blue-400 bg-blue-600 flex items-center justify-center text-white font-bold text-xs shadow-2xs">
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

                        {/* Chat Input Bar */}
                        <form onSubmit={handleChatSend} className="p-3 sm:p-4 bg-white border-t border-slate-200 flex items-center gap-2">
                            <input 
                                type="text"
                                value={chatInput}
                                onChange={(e) => {
                                    setChatInput(e.target.value);
                                    if (moderationError) setModerationError('');
                                }}
                                placeholder="Message faculty staff room... (Professional standards monitored)"
                                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs sm:text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                            />
                            <button
                                type="submit"
                                disabled={!chatInput.trim()}
                                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition shadow-md shadow-blue-600/20 flex items-center justify-center gap-2 shrink-0"
                            >
                                <Send size={16} />
                                <span className="hidden sm:inline">Send</span>
                            </button>
                        </form>
                    </div>
                )}
                {step === 3 && (
                    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in">
                         {/* Requests UI (Same as before) */}
                         <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
                             <h3 className="text-2xl font-black text-slate-900 mb-6">New Request</h3>
                             <textarea className="w-full p-6 bg-slate-50 border border-slate-200 rounded-2xl min-h-[150px] outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-400 transition-all resize-none font-medium text-slate-700 mb-4" placeholder="Describe your request..." value={msg} onChange={e => setMsg(e.target.value)}/>
                             <div className="flex justify-end"><button onClick={handleRequestSubmit} className="px-8 py-4 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 shadow-xl transition-all active:scale-95 flex items-center gap-2"><Send size={18}/> Submit Request</button></div>
                         </div>
                         <div className="space-y-4">
                             <h3 className="text-lg font-bold text-slate-400 uppercase tracking-wider px-2">Request History</h3>
                             {requests.length === 0 && <div className="text-slate-400 text-center py-10 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">No history yet.</div>}
                             {requests.map(r => (
                                 <div key={r.id} className="bg-white p-6 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                                     <div>
                                         <div className="flex items-center gap-3 mb-1"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.status==='APPROVED'?'bg-emerald-100 text-emerald-700':r.status==='REJECTED'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}>{r.status}</span><span className="text-xs text-slate-400 font-medium">{new Date(r.timestamp).toLocaleDateString()}</span></div>
                                         <p className="font-bold text-slate-700">{r.type === 'AUTOMATED_SWAP' ? 'Automated Swap Proposal' : r.details}</p>
                                     </div>
                                 </div>
                             ))}
                         </div>
                    </div>
                )}
                {step === 4 && (
                    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in">
                         {/* Profile UI (Same as before) */}
                         <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 relative overflow-hidden">
                             <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-r from-blue-600 to-indigo-600"></div>
                             <div className="relative mt-12 flex flex-col items-center">
                                 <div className="relative group">
                                     <div className="w-32 h-32 rounded-full border-4 border-white shadow-2xl overflow-hidden bg-slate-100 flex items-center justify-center">
                                         {profileData.profilePicture ? <img src={profileData.profilePicture} className="w-full h-full object-cover" /> : <span className="text-4xl font-bold text-slate-300">{teacher.name.charAt(0)}</span>}
                                     </div>
                                     <button onClick={() => fileInputRef.current?.click()} className="absolute bottom-2 right-2 p-2 bg-slate-900 text-white rounded-full shadow-lg hover:scale-110 transition-transform"><Camera size={16}/></button>
                                     <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload}/>
                                 </div>
                                 <h2 className="text-2xl font-black text-slate-900 mt-4 mb-1">{teacher.name}</h2>
                                 <p className="text-slate-500 font-medium">@{teacher.username}</p>
                             </div>
                             <div className="mt-10 space-y-6">
                                 <div className="space-y-2"><label className="text-xs font-bold text-slate-400 uppercase ml-1">Bio</label><textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 transition font-medium text-slate-700 min-h-[100px] resize-none" placeholder="Tell us about yourself..." value={profileData.bio} onChange={e => { setProfileData({...profileData, bio: e.target.value}); setIsEditingProfile(true); }}/></div>
                                 <div className="grid grid-cols-2 gap-4">
                                     <div className="space-y-2"><label className="text-xs font-bold text-slate-400 uppercase ml-1">Email</label><div className="relative"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18}/><input className="w-full pl-12 p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 transition font-medium text-slate-700" placeholder="contact@school.edu" value={profileData.contactEmail} onChange={e => { setProfileData({...profileData, contactEmail: e.target.value}); setIsEditingProfile(true); }}/></div></div>
                                     <div className="space-y-2"><label className="text-xs font-bold text-slate-400 uppercase ml-1">Phone</label><div className="relative"><Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18}/><input className="w-full pl-12 p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 transition font-medium text-slate-700" placeholder="+234..." value={profileData.contactPhone} onChange={e => { setProfileData({...profileData, contactPhone: e.target.value}); setIsEditingProfile(true); }}/></div></div>
                                 </div>
                                 {isEditingProfile && (<div className="flex justify-end pt-4 animate-in slide-in-from-bottom-2 fade-in"><button onClick={saveProfile} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition flex items-center gap-2"><Save size={18}/> Save Changes</button></div>)}
                             </div>
                         </div>
                    </div>
                )}
                {step === 7 && <UserGuide role="TEACHER" />}
            </main>
        </div>

        {/* SWAP MODAL */}
        {swapModalData && (
             <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
                 <div className="bg-white rounded-3xl sm:rounded-[2.5rem] shadow-2xl p-5 sm:p-8 max-w-md w-full animate-in zoom-in-95 max-h-[92dvh] overflow-y-auto">
                     <h3 className="text-xl sm:text-2xl font-black text-slate-900 mb-2">Propose Swap</h3>
                     <p className="text-xs sm:text-sm text-slate-500 mb-6 leading-relaxed">
                         Requesting <span className="font-bold text-slate-800">{ALL_SUBJECTS.find(s=>s.id===swapModalData.targetCell.subjectId)?.name}</span> 
                         {' '}from <span className="font-bold text-slate-800">{swapModalData.targetCell.teacherId}</span> 
                         {' '}at <span className="font-bold text-slate-800">{DAYS[swapModalData.coords.d]} {PERIODS[swapModalData.coords.p].label}</span>.
                     </p>
                     <div className="space-y-4 mb-6">
                         <label className="text-xs font-bold text-slate-400 uppercase ml-1">Offer in exchange</label>
                         <select className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 text-xs sm:text-sm" value={myOfferSlot} onChange={e => setMyOfferSlot(e.target.value)}>
                             <option value="">-- Select one of your slots --</option>
                             {getMySlots().map(slot => (<option key={slot.value} value={slot.value}>{slot.label}</option>))}
                         </select>
                     </div>
                     <div className="flex gap-3">
                         <button onClick={() => setSwapModalData(null)} className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition text-xs sm:text-sm">Cancel</button>
                         <button onClick={sendAutomatedSwapRequest} disabled={!myOfferSlot} className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition text-xs sm:text-sm">Send Proposal</button>
                     </div>
                 </div>
             </div>
        )}

        {/* ICAL CALENDAR MODAL */}
        {showCalendarModal && teacher && (
          <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
            <div className="bg-white rounded-3xl p-5 sm:p-8 max-w-md w-full shadow-2xl relative border border-slate-100 max-h-[92dvh] overflow-y-auto">
              <button
                onClick={() => setShowCalendarModal(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-4">
                <Calendar className="w-6 h-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-1">Calendar Sync Feed</h3>
              <p className="text-xs text-slate-500 mb-6">Subscribe to your live timetable in Apple Calendar, Google Calendar, or Outlook</p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase block mb-1.5">Personal iCal Feed URL</label>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 break-all select-all">
                    {`${window.location.origin}/api/calendar/${teacher.id}/${teacher.calendarToken || 'master'}.ics`}
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/api/calendar/${teacher.id}/${teacher.calendarToken || 'master'}.ics`;
                    navigator.clipboard.writeText(url);
                    setCopiedCalendar(true);
                    setTimeout(() => setCopiedCalendar(false), 2000);
                  }}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition flex items-center justify-center gap-2 shadow-md shadow-indigo-200"
                >
                  {copiedCalendar ? <Check size={16} /> : <Copy size={16} />}
                  <span>{copiedCalendar ? 'Copied Link!' : 'Copy Feed Link'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ABSENCE REQUEST MODAL */}
        {showAbsenceModal && (
          <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
            <div className="bg-white rounded-3xl p-5 sm:p-8 max-w-md w-full shadow-2xl relative border border-slate-100 max-h-[92dvh] overflow-y-auto">
              <button
                onClick={() => setShowAbsenceModal(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mb-4">
                <CalendarX className="w-6 h-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-1">Mark Myself Unavailable</h3>
              <p className="text-xs text-slate-500 mb-6">Submit absence dates for Admin approval and substitute assignment</p>

              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Start Date</label>
                    <input
                      type="date"
                      value={absenceForm.startDate}
                      onChange={e => setAbsenceForm({ ...absenceForm, startDate: e.target.value })}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase block mb-1">End Date</label>
                    <input
                      type="date"
                      value={absenceForm.endDate}
                      onChange={e => setAbsenceForm({ ...absenceForm, endDate: e.target.value })}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Reason for Absence</label>
                  <textarea
                    rows={3}
                    placeholder="Medical, official duty, personal emergency..."
                    value={absenceForm.reason}
                    onChange={e => setAbsenceForm({ ...absenceForm, reason: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowAbsenceModal(false)}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRequestAbsence}
                  className="flex-1 py-3 bg-rose-600 text-white font-bold rounded-xl text-xs hover:bg-rose-700 transition shadow-md shadow-rose-200"
                >
                  Submit Absence
                </button>
              </div>
            </div>
          </div>
        )}

        {/* LESSON NOTE MODAL */}
        {lessonModal && (
          <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
            <div className="bg-white rounded-3xl p-5 sm:p-8 max-w-md w-full shadow-2xl relative border border-slate-100 max-h-[92dvh] overflow-y-auto">
              <button
                onClick={() => setLessonModal(null)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
                <BookOpen className="w-6 h-6" />
              </div>
              <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-1">Lesson Note & Resources</h3>
              <p className="text-xs text-slate-500 mb-6">Attach lesson plans, notes, or external links to this period</p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Lesson Note / Instructions</label>
                  <textarea
                    rows={4}
                    placeholder="E.g., Chapter 4 slides review, homework submission guidelines..."
                    value={lessonModal.note}
                    onChange={e => setLessonModal({ ...lessonModal, note: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Lesson Resource URL / Link</label>
                  <input
                    type="url"
                    placeholder="https://docs.google.com/..."
                    value={lessonModal.link}
                    onChange={e => setLessonModal({ ...lessonModal, link: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setLessonModal(null)}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveLessonNote}
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl text-xs hover:bg-blue-700 transition shadow-md shadow-blue-200"
                >
                  Save Note
                </button>
              </div>
            </div>
          </div>
        )}

        {/* About Pentric Modal */}
        {showAboutModal && <AboutUsModal onClose={() => setShowAboutModal(false)} />}
    </div>
  );
};
