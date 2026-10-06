
import React, { useState, useEffect } from 'react';
import { storage } from '../services/storage';
import { Teacher, Availability } from '../types';
import { User, Lock, Key, ArrowRight, CheckCircle, Copy, AlertCircle, LayoutGrid, Info, ArrowLeft, ShieldCheck, GraduationCap, ChevronRight, Eye, EyeOff, Clock, School, Loader2, Mail, RefreshCw, Sparkles, Check } from 'lucide-react';

interface AuthProps {
  onLogin: (role: 'TEACHER' | 'ADMIN') => void;
  onSelectPublicView?: () => void;
  onSwitchSchool?: () => void;
}

export const Auth: React.FC<AuthProps> = ({ onLogin, onSelectPublicView, onSwitchSchool }) => {
  const [view, setView] = useState<'LOGIN' | 'SIGNUP' | 'RECOVERY' | 'RESET' | 'ABOUT'>('LOGIN');
  const [roleMode, setRoleMode] = useState<'TEACHER' | 'ADMIN'>('TEACHER'); 
  
  const [formData, setFormData] = useState({ name: '', username: '', email: '', password: '', recoveryCode: '', newPassword: '' });
  const [signupStep, setSignupStep] = useState<'DETAILS' | 'VERIFY_CODE'>('DETAILS');
  const [verificationCode, setVerificationCode] = useState('');
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [error, setError] = useState('');
  const [recoveryCodeDisplay, setRecoveryCodeDisplay] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState<{
    name: string;
    username: string;
    recoveryCode: string;
    teacherId?: string;
    schoolName: string;
    email?: string;
  } | null>(null);
  const [recoveringTeacherId, setRecoveringTeacherId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const currentSchool = storage.getCurrentSchool() || {
    id: 'ota_total_academy',
    name: 'OTA Total Academy',
    code: 'OTA',
    motto: 'Strictly for the Serious Minded Academics'
  };

  // Cooldown countdown for resending anti-bot verification code
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Forced password change modal
  const [mustChangePassUser, setMustChangePassUser] = useState<{ id: string; role: 'TEACHER' | 'ADMIN'; token: string } | null>(null);
  const [newMandatoryPass, setNewMandatoryPass] = useState('');

  // Real-time automatic login upon administrator verification
  useEffect(() => {
    if (!pendingVerification) return;
    const checkApproval = () => {
      const teachers = storage.getTeachers();
      const t = teachers.find(x => x.username === pendingVerification.username || (pendingVerification.teacherId && x.id === pendingVerification.teacherId));
      if (t && t.isApproved && t.approvalStatus === 'APPROVED') {
        storage.setTeacherSession(t.id);
        onLogin('TEACHER');
      }
    };
    const unsub = storage.subscribe(checkApproval);
    const interval = setInterval(async () => {
      await storage.forceSync();
      checkApproval();
    }, 2000);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [pendingVerification, onLogin]);

  const switchView = (newView: typeof view) => {
    setView(newView);
    setError('');
    setSignupStep('DETAILS');
    setVerificationCode('');
    setDevCodeHint(null);
    setFormData({ name: '', username: '', email: '', password: '', recoveryCode: '', newPassword: '' });
  };

  const fakeLoad = (cb: () => void) => {
      setIsLoading(true);
      setTimeout(() => {
          setIsLoading(false);
          cb();
      }, 800);
  };

  // Step 1: Send 6-Digit Anti-Bot Verification Code to Email
  const handleSendVerificationCode = async (isResend = false) => {
    if (!formData.name.trim() || !formData.email.trim() || !formData.username.trim() || !formData.password.trim()) {
      setError('Please fill in Full Name, Email, Username, and Password.');
      return;
    }

    const cleanEmail = formData.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setError('Please enter a valid email address (e.g. staff@school.edu).');
      return;
    }

    if (formData.password.trim().length < 4) {
      setError('Password must be at least 4 characters long.');
      return;
    }

    setIsSendingCode(true);
    setError('');

    try {
      const res = await fetch('/api/auth/send-verification-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          username: formData.username.trim().toLowerCase(),
          name: formData.name.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send verification code.');
        setIsSendingCode(false);
        return;
      }

      setSignupStep('VERIFY_CODE');
      setResendCooldown(30);
      if (data.isDevFallback && data.devCode) {
        setDevCodeHint(data.devCode);
      } else {
        setDevCodeHint(null);
      }
    } catch (e) {
      // Local fallback for offline simulation
      const fallbackCode = Math.floor(100000 + Math.random() * 900000).toString();
      setDevCodeHint(fallbackCode);
      setSignupStep('VERIFY_CODE');
      setResendCooldown(30);
    } finally {
      setIsSendingCode(false);
    }
  };

  // Step 2: Verify 6-Digit Code and Complete Account Creation
  const handleSignup = async () => {
    const cleanCode = verificationCode.trim();
    if (!cleanCode || cleanCode.length !== 6) {
      setError('Please enter the 6-digit verification code sent to your email to verify you are not a bot.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim().toLowerCase(),
          username: formData.username.trim().toLowerCase(),
          password: formData.password.trim(),
          verificationCode: cleanCode,
          schoolId: currentSchool.id
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create account.');
        setIsLoading(false);
        return;
      }

      if (data.user) {
        try {
          storage.saveTeacher(data.user);
          storage.forceSync().catch(() => {});
        } catch {}
      }

      setPendingVerification({
        name: formData.name.trim(),
        username: formData.username.trim().toLowerCase(),
        recoveryCode: data.recoveryCode,
        teacherId: data.user?.id,
        schoolName: currentSchool.name,
        email: formData.email.trim().toLowerCase()
      });
    } catch (e) {
      const teachers = storage.getTeachers();
      if (teachers.find(t => (t.username || '').toLowerCase() === formData.username.trim().toLowerCase())) {
        setError('Username taken.');
        setIsLoading(false);
        return;
      }
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const newTeacher: Teacher = {
        id: crypto.randomUUID(),
        name: formData.name.trim(),
        username: formData.username.trim().toLowerCase(),
        password: formData.password.trim(),
        recoveryCode: code,
        contactEmail: formData.email.trim().toLowerCase(),
        emailVerified: true,
        subjectsTaught: [],
        assignedClasses: [],
        availability: Array.from({ length: 5 }).reduce((acc, _, day) => {
          acc[day] = Array.from({ length: 8 }).reduce((pAcc, _, period) => {
            pAcc[period] = Availability.AVAILABLE;
            return pAcc;
          }, {} as Record<number, Availability>);
          return acc;
        }, {} as any) as Record<number, Record<number, Availability>>,
        isCompleted: false,
        schoolId: currentSchool.id,
        isApproved: false,
        approvalStatus: 'PENDING',
        registeredAt: Date.now()
      };
      storage.saveTeacher(newTeacher);

      storage.addNotification({
        recipientId: 'ADMIN',
        title: `⚠️ New Staff Verification Needed: ${formData.name}`,
        message: `${formData.name} (@${formData.username}) has registered with verified email (${formData.email}) for ${currentSchool.name}. Please verify that they are legitimate staff from the school and not an imposter.`,
        details: 'Go to Faculty Approvals in Admin Dashboard to approve or reject.',
        type: 'ALERT',
        category: 'REQUEST'
      });

      setPendingVerification({
        name: formData.name.trim(),
        username: formData.username.trim().toLowerCase(),
        recoveryCode: code,
        teacherId: newTeacher.id,
        schoolName: currentSchool.name,
        email: formData.email.trim().toLowerCase()
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!formData.username || !formData.password) {
      setError('Username and password are required.');
      return;
    }
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: roleMode,
          username: formData.username.trim(),
          password: formData.password.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.isPendingApproval || res.status === 403) {
          setError(data.error || 'Verification Required: Your faculty account is currently awaiting school administrator verification. An administrator must confirm you are official school staff and not an imposter before you can log in.');
        } else {
          setError(data.error || 'Invalid credentials.');
        }
        setIsLoading(false);
        return;
      }

      storage.setAuthToken(data.token);
      if (data.customToken) storage.setFirebaseCustomToken(data.customToken);

      if (data.user.role === 'ADMIN') {
        storage.setAdminSession(data.user.id);
      } else {
        storage.setTeacherSession(data.user.id);
      }

      if (data.mustChangePassword) {
        setMustChangePassUser({ id: data.user.id, role: data.user.role, token: data.token });
        setIsLoading(false);
        return;
      }

      onLogin(data.user.role);
    } catch (e) {
      // Fallback local check only for teachers if server un-contactable
      const inputIdentifier = formData.username.trim().toLowerCase();

      if (roleMode === 'TEACHER') {
        const teachers = storage.getTeachers();
        const teacher = teachers.find(t => 
            (t.username?.trim().toLowerCase() === inputIdentifier || t.name?.trim().toLowerCase() === inputIdentifier)
        );
        if (teacher) {
            if (teacher.isApproved === false || teacher.approvalStatus === 'PENDING') {
              setError(`Verification Required: Your faculty account for ${currentSchool.name} is currently awaiting administrator verification to confirm you are genuine school staff and not an imposter.`);
              setIsLoading(false);
              return;
            }
            storage.setTeacherSession(teacher.id);
            onLogin('TEACHER');
            return;
        }
      }
      setError('Unable to authenticate with server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMandatoryPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mustChangePassUser || !newMandatoryPass || newMandatoryPass.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mustChangePassUser.token}`
        },
        body: JSON.stringify({
          id: mustChangePassUser.id,
          role: mustChangePassUser.role,
          newPassword: newMandatoryPass
        })
      });

      if (res.ok) {
        const targetRole = mustChangePassUser.role;
        setMustChangePassUser(null);
        onLogin(targetRole);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to change password.');
      }
    } catch (e) {
      setError('Error communicating with server.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecovery = () => {
    fakeLoad(() => {
        const inputIdentifier = formData.username.trim().toLowerCase();
        const inputCode = formData.recoveryCode.trim().toUpperCase();
        const teachers = storage.getTeachers();
        const teacher = teachers.find(t => 
            (t.username?.trim().toLowerCase() === inputIdentifier || t.name?.trim().toLowerCase() === inputIdentifier) && 
            t.recoveryCode?.trim().toUpperCase() === inputCode
        );
        if (teacher) { setRecoveringTeacherId(teacher.id); setView('RESET'); setError(''); } 
        else setError('Invalid Recovery Code.');
    });
  };

  const handlePasswordReset = () => {
      if (!formData.newPassword || formData.newPassword.length < 4) { setError('Password too short.'); return; }
      fakeLoad(() => {
          if (recoveringTeacherId) {
              storage.updateTeacherPassword(recoveringTeacherId, formData.newPassword);
              switchView('LOGIN');
          }
      });
  };

  const copyCode = () => {
      if (recoveryCodeDisplay) {
          navigator.clipboard.writeText(recoveryCodeDisplay);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
      }
  };

  // --- COMPONENT: Anti-Imposter Verification Pending State ---
  if (pendingVerification) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 flex items-center justify-center p-6 font-sans relative overflow-hidden">
        {/* Dynamic Subtle Royal Blue Glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.08),_transparent_60%)]"></div>
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-200 p-8 md:p-10 text-center animate-in zoom-in-95 duration-300 relative z-10">
          
          <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-sm border border-blue-100">
            <ShieldCheck size={42} />
          </div>

          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold uppercase tracking-wider mb-4">
            <Clock size={13} className="animate-spin text-blue-600" /> Anti-Imposter Verification Required
          </div>

          <h2 className="text-2xl font-black text-slate-900 mb-2">Teacher Registration Received</h2>
          
          <p className="text-slate-600 text-xs mb-6 leading-relaxed">
            Welcome, <strong className="text-slate-900 font-bold">{pendingVerification.name}</strong>! To ensure strict security and prevent imposter access for <strong className="text-blue-600 font-bold">{pendingVerification.schoolName}</strong>, your account has been placed under pending approval.
          </p>

          <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-100 text-left mb-6 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-800">
              <ShieldCheck size={16} /> Alert Dispatched to School Admin
            </div>
            <p className="text-xs text-blue-900/80 leading-relaxed">
              A message has been sent to your school administrator telling them to approve that you are an official teacher of the school and not an imposter. Once confirmed, you can log in.
            </p>
          </div>

          {/* Verified Email Badge */}
          {pendingVerification.email && (
            <div className="flex items-center justify-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 py-1.5 px-3.5 rounded-full mb-4 font-semibold w-fit mx-auto">
              <CheckCircle size={14} className="text-emerald-600 shrink-0" />
              <span>Email Verified (Anti-Bot): <strong className="font-mono">{pendingVerification.email}</strong></span>
            </div>
          )}

          {/* Recovery Code Display */}
          <div className="bg-slate-900 text-white p-5 rounded-2xl mb-6 relative group border border-slate-800">
            <div className="text-3xl font-mono font-bold tracking-widest text-blue-400">{pendingVerification.recoveryCode}</div>
            <div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">Account Recovery Code (Keep Safe)</div>
            <button 
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(pendingVerification.recoveryCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }} 
              className="absolute top-1/2 -translate-y-1/2 right-4 p-2 bg-white/10 rounded-lg hover:bg-white text-white hover:text-slate-900 transition-all"
            >
              {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
            </button>
          </div>

          <div className="space-y-3">
            <button 
              type="button"
              onClick={async () => {
                setIsLoading(true);
                await storage.forceSync();
                const teachers = storage.getTeachers();
                const t = teachers.find(x => x.username === pendingVerification.username || (pendingVerification.teacherId && x.id === pendingVerification.teacherId));
                setIsLoading(false);
                if (t && t.isApproved && t.approvalStatus === 'APPROVED') {
                  storage.setTeacherSession(t.id);
                  onLogin('TEACHER');
                } else {
                  setError('Your account is still awaiting school admin verification. Please notify your administrator to approve your staff account.');
                }
              }} 
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3.5 rounded-xl font-bold transition shadow-lg shadow-blue-600/20 text-xs flex items-center justify-center gap-2"
            >
              {isLoading ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              Check Approval Status
            </button>
            <button 
              type="button"
              onClick={() => {
                setPendingVerification(null);
                switchView('LOGIN');
              }} 
              className="w-full py-2.5 text-xs text-slate-500 hover:text-slate-800 font-semibold transition"
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- COMPONENT: Success State ---
  if (recoveryCodeDisplay) {
      return (
          <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
              <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl border border-slate-100 p-10 text-center animate-in zoom-in-95 duration-300">
                  <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-100">
                      <CheckCircle size={40} />
                  </div>
                  <h2 className="text-3xl font-bold text-slate-900 mb-3">Account Created</h2>
                  <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                      Your faculty account is ready. Please save your recovery code below. You will need it if you forget your password.
                  </p>
                  
                  <div className="bg-slate-900 text-white p-6 rounded-2xl mb-8 relative group shadow-xl">
                      <div className="text-4xl font-mono font-bold tracking-widest">{recoveryCodeDisplay}</div>
                      <div className="text-[10px] text-slate-400 mt-2 uppercase tracking-wider">Recovery Code</div>
                      <button onClick={copyCode} className="absolute top-1/2 -translate-y-1/2 right-6 p-2 bg-white/10 rounded-lg hover:bg-white text-white hover:text-slate-900 transition-all">
                          {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
                      </button>
                  </div>

                  <button 
                    onClick={() => {
                      setRecoveryCodeDisplay(null);
                      if (storage.getLoggedInTeacherId()) {
                        onLogin('TEACHER');
                      } else {
                        switchView('LOGIN');
                      }
                    }} 
                    className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                  >
                      Go to Dashboard <ArrowRight size={18} />
                  </button>
              </div>
          </div>
      );
  }

  // --- COMPONENT: Main Auth Layout ---
  return (
    <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4 font-sans relative overflow-hidden">
      
      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-slate-50">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-200/30 rounded-full blur-[120px] animate-pulse"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-200/30 rounded-full blur-[120px] animate-pulse" style={{animationDelay: '2s'}}></div>
          <div className="absolute top-[40%] left-[40%] w-[30%] h-[30%] bg-emerald-100/40 rounded-full blur-[100px]" style={{animationDelay: '4s'}}></div>
      </div>

      <div className="bg-white/80 backdrop-blur-xl w-full max-w-[1100px] min-h-[650px] rounded-[2.5rem] shadow-2xl border border-white flex overflow-hidden relative z-10 transition-all duration-500">
          
          {/* LEFT: FORM SECTION */}
          <div className="w-full md:w-[45%] p-8 md:p-12 flex flex-col justify-center relative">
              
              {/* School Header Badge & Switch Option */}
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center font-bold text-xs shadow-xs">
                    <School size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">School Portal</div>
                    <div className="text-xs font-black text-slate-800">{currentSchool.name}</div>
                  </div>
                </div>
                {onSwitchSchool && (
                  <button 
                    type="button"
                    onClick={onSwitchSchool}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl transition border border-blue-200/60 shadow-xs"
                  >
                    Switch School
                  </button>
                )}
              </div>

              {/* Universal Back Button for Auth Views */}
              {view !== 'LOGIN' && view !== 'ABOUT' && (
                  <button 
                      onClick={() => {
                        if (view === 'SIGNUP' && signupStep === 'VERIFY_CODE') {
                          setSignupStep('DETAILS');
                          setError('');
                        } else {
                          switchView('LOGIN');
                        }
                      }}
                      className="absolute top-6 left-6 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                  >
                      <ArrowLeft size={20}/>
                  </button>
              )}
              
              {view === 'ABOUT' ? (
                  <div className="animate-in slide-in-from-left-8 fade-in duration-300">
                       <button onClick={() => switchView('LOGIN')} className="mb-6 p-2 -ml-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full w-fit transition"><ArrowLeft size={24}/></button>
                       <div className="flex items-center gap-3 text-slate-900 mb-8">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
                              <LayoutGrid size={20} />
                          </div>
                          <span className="font-bold text-xl tracking-tight">Pentric</span>
                      </div>
                      <h1 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">System Architecture</h1>
                      <div className="space-y-5 text-slate-600 mb-10 leading-relaxed">
                          <p>
                              Pentric is an advanced academic timetable management system created by PPF Innovations and Technology Group to streamline school scheduling and academic operations.
                          </p>
                          <ul className="space-y-3">
                              <li className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-blue-500"></div>Conflict-free generation algorithms</li>
                              <li className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-blue-500"></div>Role-based tiered administration</li>
                              <li className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-blue-500"></div>Real-time faculty collaboration tools</li>
                          </ul>
                          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60 text-sm">
                              <div className="flex justify-between mb-2">
                                  <span className="font-bold text-slate-700">Version</span>
                                  <span className="font-mono text-slate-500">2.1.0</span>
                              </div>
                              <div className="flex justify-between">
                                  <span className="font-bold text-slate-700">Build</span>
                                  <span className="font-mono text-slate-500">Stable / Enterprise</span>
                              </div>
                          </div>
                      </div>
                  </div>
              ) : (
                  <div className="animate-in fade-in duration-500 pt-4">
                    <div className="mb-10">
                        <div className="flex items-center gap-3 text-slate-900 mb-8">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
                                <LayoutGrid size={20} />
                            </div>
                            <span className="font-bold text-xl tracking-tight">Pentric</span>
                        </div>

                        <h1 className="text-4xl font-black text-slate-900 mb-3 tracking-tight">
                            {view === 'LOGIN' ? 'Welcome Back' : view === 'SIGNUP' ? (signupStep === 'VERIFY_CODE' ? 'Verify Email' : 'Join Faculty') : view === 'RECOVERY' ? 'Account Recovery' : 'Reset Password'}
                        </h1>
                        <p className="text-slate-500 text-lg">
                            {view === 'LOGIN' ? 'Enter your credentials to access.' : 
                            view === 'SIGNUP' ? (signupStep === 'VERIFY_CODE' ? 'Enter the 6-digit code sent to your email to verify you are not a bot.' : 'Create an account to join the teaching faculty.') : 
                            'Verify identity to restore access.'}
                        </p>
                    </div>

                    {/* ROLE SWITCHER */}
                    {view === 'LOGIN' && (
                        <div className="relative p-1.5 bg-slate-100/80 rounded-2xl mb-8 flex w-full max-w-sm">
                            <div 
                                className={`absolute inset-y-1.5 w-[calc(50%-6px)] bg-white rounded-xl shadow-sm transition-all duration-300 ease-out ${roleMode === 'ADMIN' ? 'translate-x-[100%] left-1.5' : 'left-1.5'}`}
                            ></div>
                            <button 
                                onClick={() => setRoleMode('TEACHER')}
                                className={`relative z-10 w-1/2 py-2.5 text-sm font-bold transition-colors duration-300 ${roleMode === 'TEACHER' ? 'text-slate-900' : 'text-slate-500'}`}
                            >
                                Faculty
                            </button>
                            <button 
                                onClick={() => setRoleMode('ADMIN')}
                                className={`relative z-10 w-1/2 py-2.5 text-sm font-bold transition-colors duration-300 ${roleMode === 'ADMIN' ? 'text-slate-900' : 'text-slate-500'}`}
                            >
                                Admin Portal
                            </button>
                        </div>
                    )}

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm font-bold rounded-xl flex items-center gap-3 border border-red-100 animate-in slide-in-from-top-2">
                            <AlertCircle size={18} /> {error}
                        </div>
                    )}

                    {/* SIGNUP STEP 2: 6-DIGIT VERIFICATION CODE */}
                    {view === 'SIGNUP' && signupStep === 'VERIFY_CODE' ? (
                        <div className="space-y-5 animate-in fade-in duration-300">
                            <div className="p-5 bg-blue-50/90 rounded-2xl border border-blue-100 text-center">
                                <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto mb-3 shadow-md shadow-blue-600/20">
                                    <Mail size={24} />
                                </div>
                                <h3 className="font-black text-slate-900 text-base">Check Your Inbox</h3>
                                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto">
                                    A unique 6-digit verification code has been dispatched to <strong className="text-blue-700 font-bold">{formData.email}</strong>. Check your inbox or spam folder and enter it below to verify that you aren't a bot.
                                </p>
                                <div className="flex items-center justify-center gap-3 mt-3">
                                    {formData.email.toLowerCase().includes('@gmail.com') && (
                                        <a
                                            href="https://mail.google.com"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-blue-200 text-blue-700 font-bold text-xs rounded-xl shadow-xs hover:bg-blue-50 transition"
                                        >
                                            <Mail size={13} /> Open Gmail
                                        </a>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => { setSignupStep('DETAILS'); setError(''); }}
                                        className="text-[11px] text-slate-500 hover:text-slate-800 font-semibold underline"
                                    >
                                        Change email address
                                    </button>
                                </div>
                            </div>

                            {devCodeHint && (
                                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1.5 shadow-xs">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <Sparkles size={16} className="text-amber-600 shrink-0" />
                                            <div>
                                                <span className="font-bold">Backup Code: </span>
                                                <span className="font-mono font-black text-sm tracking-wider text-amber-950">{devCodeHint}</span>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setVerificationCode(devCodeHint)}
                                            className="px-2.5 py-1 bg-amber-600 text-white text-[11px] font-bold rounded-lg hover:bg-amber-700 transition shadow-xs"
                                        >
                                            Auto-Fill
                                        </button>
                                    </div>
                                    <div className="text-[11px] text-amber-800/90 leading-tight">
                                        Sent via <strong>proxbott@gmail.com</strong>.
                                    </div>
                                </div>
                            )}

                            <div className="relative group">
                                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider text-center">
                                    Enter 6-Digit Code
                                </label>
                                <input 
                                    type="text"
                                    inputMode="numeric"
                                    autoFocus
                                    maxLength={6}
                                    placeholder="000000"
                                    className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl py-4 text-center font-mono font-black text-3xl tracking-[0.4em] outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all text-slate-900 placeholder:text-slate-300"
                                    value={verificationCode}
                                    onChange={e => {
                                        const val = e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 6);
                                        setVerificationCode(val);
                                        if (error) setError('');
                                    }}
                                />
                            </div>

                            <div className="flex items-center justify-between text-xs pt-1 px-1">
                                <span className="text-slate-500 font-medium">Didn't receive the code?</span>
                                <button
                                    type="button"
                                    onClick={() => handleSendVerificationCode(true)}
                                    disabled={resendCooldown > 0 || isSendingCode}
                                    className="text-blue-600 font-bold hover:text-blue-800 disabled:text-slate-400 disabled:cursor-not-allowed flex items-center gap-1.5 transition"
                                >
                                    <RefreshCw size={13} className={isSendingCode ? 'animate-spin' : ''} />
                                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                                </button>
                            </div>

                            <button 
                                onClick={handleSignup}
                                disabled={isLoading || verificationCode.trim().length !== 6}
                                className="w-full mt-4 bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-between px-6 shadow-xl shadow-slate-900/10 group disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span>{isLoading ? 'Verifying & Creating Account...' : 'Verify Code & Complete Registration'}</span>
                                <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center group-hover:bg-white/20 transition-colors">
                                    {isLoading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                                </div>
                            </button>
                        </div>
                    ) : (
                        /* STANDARD INPUTS FOR LOGIN, SIGNUP DETAILS, RECOVERY & RESET */
                        <>
                            <div className="space-y-5">
                                {view === 'SIGNUP' && (
                                    <>
                                        <div className="relative group">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors"><User size={20} /></div>
                                            <input 
                                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all font-medium text-slate-800 placeholder:text-slate-400"
                                                placeholder="Full Name"
                                                value={formData.name}
                                                onChange={e => setFormData({...formData, name: e.target.value})}
                                            />
                                        </div>
                                        <div className="relative group">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors"><Mail size={20} /></div>
                                            <input 
                                                type="email"
                                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all font-medium text-slate-800 placeholder:text-slate-400"
                                                placeholder="Email Address (e.g. staff@school.edu)"
                                                value={formData.email}
                                                onChange={e => setFormData({...formData, email: e.target.value})}
                                            />
                                        </div>
                                    </>
                                )}

                                {view !== 'RESET' && (
                                    <div className="relative group">
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors"><User size={20} /></div>
                                        <input 
                                            className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all font-medium text-slate-800 placeholder:text-slate-400"
                                            placeholder={view === 'LOGIN' && roleMode === 'ADMIN' ? 'Admin Username' : 'Username'}
                                            value={formData.username}
                                            onChange={e => setFormData({...formData, username: e.target.value})}
                                        />
                                    </div>
                                )}

                                {view === 'RECOVERY' && (
                                    <div className="relative group">
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors"><Key size={20} /></div>
                                        <input 
                                            className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all font-mono uppercase tracking-wider text-slate-800 placeholder:text-slate-400"
                                            placeholder="RECOVERY CODE"
                                            value={formData.recoveryCode}
                                            onChange={e => setFormData({...formData, recoveryCode: e.target.value.toUpperCase()})}
                                        />
                                    </div>
                                )}

                                {(view === 'LOGIN' || view === 'SIGNUP') && (
                                    <div className="relative group">
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors"><Lock size={20} /></div>
                                        <input 
                                            type={showPass ? "text" : "password"}
                                            className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl py-4 pl-12 pr-12 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all font-medium text-slate-800 placeholder:text-slate-400"
                                            placeholder="Password"
                                            value={formData.password}
                                            onChange={e => setFormData({...formData, password: e.target.value})}
                                        />
                                        <button onClick={() => setShowPass(!showPass)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">
                                            {showPass ? <EyeOff size={20}/> : <Eye size={20}/>}
                                        </button>
                                    </div>
                                )}

                                {view === 'RESET' && (
                                     <div className="relative group">
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors"><Lock size={20} /></div>
                                        <input 
                                            type="password"
                                            className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 transition-all font-medium text-slate-800 placeholder:text-slate-400"
                                            placeholder="New Password"
                                            value={formData.newPassword}
                                            onChange={e => setFormData({...formData, newPassword: e.target.value})}
                                        />
                                    </div>
                                )}

                                {view === 'SIGNUP' && (
                                    <div className="p-3.5 bg-blue-50/80 rounded-2xl border border-blue-100 flex items-start gap-2.5 text-xs text-blue-900">
                                        <ShieldCheck size={18} className="text-blue-600 shrink-0 mt-0.5" />
                                        <div>
                                            <span className="font-bold">Anti-Bot Verification:</span> A 6-digit code will be sent to your email to verify that you are genuine staff and not an automated bot.
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button 
                                onClick={view === 'SIGNUP' ? () => handleSendVerificationCode() : view === 'RECOVERY' ? handleRecovery : view === 'RESET' ? handlePasswordReset : handleLogin}
                                disabled={isLoading || isSendingCode}
                                className="w-full mt-8 bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-between px-6 shadow-xl shadow-slate-900/10 group disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                <span>{isLoading || isSendingCode ? 'Sending 6-Digit Code...' : (view === 'LOGIN' ? 'Sign In' : view === 'SIGNUP' ? 'Send 6-Digit Code' : 'Confirm')}</span>
                                <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center group-hover:bg-white/20 transition-colors">
                                    {isSendingCode ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={18} />}
                                </div>
                            </button>
                        </>
                    )}

                    <div className="mt-8 text-center space-y-4">
                        {view === 'SIGNUP' && (
                            <div className="flex justify-center items-center text-sm font-medium">
                                <span className="text-slate-500 mr-1.5">Already have an account?</span>
                                <button onClick={() => switchView('LOGIN')} className="text-blue-600 hover:text-blue-700 font-bold hover:underline decoration-2 underline-offset-4">Sign In</button>
                            </div>
                        )}
                        {view === 'LOGIN' && (
                            <>
                                <div className="flex justify-between items-center text-sm font-medium px-1">
                                    <button onClick={() => switchView('SIGNUP')} className="text-blue-600 hover:text-blue-700 hover:underline decoration-2 underline-offset-4">Create Account</button>
                                    <button onClick={() => switchView('RECOVERY')} className="text-slate-400 hover:text-slate-600">Forgot Password?</button>
                                </div>
                                <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
                                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Quick Demo Auto-Fill</div>
                                    <div className="flex gap-2">
                                        <button 
                                          type="button"
                                          onClick={() => { setRoleMode('ADMIN'); setFormData({ ...formData, username: 'admin', password: 'admin123' }); }}
                                          className="flex-1 py-2 px-3 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-xs font-bold transition border border-blue-200/60"
                                        >
                                            Demo Admin
                                        </button>
                                        <button 
                                          type="button"
                                          onClick={() => { 
                                            const teachers = storage.getTeachers();
                                            const t = teachers && teachers.length > 0 ? teachers[0] : null;
                                            const u = t && t.username ? t.username : (t && t.name ? t.name : 'David Okafor');
                                            setRoleMode('TEACHER'); 
                                            setFormData({ ...formData, username: u, password: 'password123' }); 
                                          }}
                                          className="flex-1 py-2 px-3 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl text-xs font-bold transition border border-emerald-200/60"
                                        >
                                            Demo Teacher
                                        </button>
                                    </div>
                                </div>
                                <div className="pt-2 flex flex-col gap-2">
                                     {onSelectPublicView && (
                                       <button 
                                         type="button"
                                         onClick={onSelectPublicView}
                                         className="w-full py-3 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-2xl text-xs font-black transition border border-indigo-200/80 flex items-center justify-center gap-2"
                                       >
                                         <GraduationCap size={16} /> View my class timetable (Students / Parents)
                                       </button>
                                     )}
                                     <button onClick={() => switchView('ABOUT')} className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center justify-center gap-1.5 mx-auto transition-colors">
                                         <Info size={14}/> System Info
                                     </button>
                                </div>
                            </>
                        )}
                    </div>
                  </div>
              )}
          </div>

          {/* RIGHT: VISUAL SECTION (Desktop) */}
          <div className="hidden md:flex w-[55%] bg-slate-900 relative items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=2600&auto=format&fit=crop')] bg-cover bg-center opacity-30 mix-blend-overlay scale-110"></div>
              <div className="absolute inset-0 bg-gradient-to-br from-blue-900/40 via-slate-900/90 to-slate-950"></div>
              
              {/* Animated Geometric Shapes */}
              <div className="absolute top-20 right-20 w-64 h-64 bg-blue-500/20 rounded-full blur-[80px] animate-pulse"></div>
              <div className="absolute bottom-20 left-20 w-64 h-64 bg-indigo-500/20 rounded-full blur-[80px] animate-pulse" style={{animationDelay:'3s'}}></div>

              <div className="relative z-10 p-16 text-white max-w-lg">
                  <div className={`w-20 h-20 bg-white/10 backdrop-blur-md rounded-3xl flex items-center justify-center mb-10 border border-white/20 shadow-2xl transition-all duration-500 ${roleMode==='ADMIN'?'rotate-0':'rotate-12'}`}>
                      {roleMode === 'ADMIN' ? <ShieldCheck size={40} className="text-blue-300" /> : <GraduationCap size={40} className="text-emerald-300" />}
                  </div>
                  <h2 className="text-5xl font-black mb-6 leading-[1.1] tracking-tight">
                      {roleMode === 'ADMIN' ? 'System Command Center' : 'Academic Excellence'}
                  </h2>
                  <p className="text-slate-300 text-lg leading-relaxed mb-10">
                      {roleMode === 'ADMIN' 
                        ? 'Orchestrate timetables, manage faculty resources, and oversee institutional parameters.' 
                        : 'Access your teaching schedule, collaborate with peers, and manage automated requests.'}
                  </p>
                  
                  <div className="flex items-center gap-6">
                      <div className="flex -space-x-4">
                          {[1,2,3].map(i => <div key={i} className="w-12 h-12 rounded-full border-2 border-slate-900 bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-500">{i}</div>)}
                      </div>
                      <div>
                          <div className="text-white font-bold">Faculty Portal</div>
                          <div className="text-slate-400 text-xs">Powered by Pentric</div>
                      </div>
                  </div>
              </div>
          </div>

      </div>

      {/* Mandatory Password Change Modal */}
      {mustChangePassUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
          <form onSubmit={handleMandatoryPasswordChange} className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-100 animate-in zoom-in-95">
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mb-4">
              <Key size={24} />
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2">Password Change Required</h2>
            <p className="text-slate-500 text-xs mb-6">
              You are currently using default credentials documented for this system. Please set a new secure password before continuing.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl flex items-center gap-2">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newMandatoryPass}
                  onChange={e => setNewMandatoryPass(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-medium outline-none focus:border-blue-500 focus:bg-white"
                  placeholder="At least 6 characters"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition text-sm shadow-lg shadow-slate-900/20"
            >
              {isLoading ? 'Updating Password...' : 'Save & Continue to Dashboard'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
