
import React, { useState, useEffect } from 'react';
import { storage } from '../services/storage';
import { Teacher, Availability } from '../types';
import { User, Lock, Key, ArrowRight, CheckCircle, Copy, AlertCircle, LayoutGrid, Info, ArrowLeft, ShieldCheck, GraduationCap, ChevronRight, Eye, EyeOff, Clock, School, Loader2, Mail, RefreshCw, Sparkles, Check, Calendar, Users } from 'lucide-react';

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
  const [dispatchSender, setDispatchSender] = useState<string>('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [error, setError] = useState('');
  const [recoveryCodeDisplay, setRecoveryCodeDisplay] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState<{
    name: string;
    username: string;
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
    let cancelled = false;

    const handleStatusResult = (status: string, rejectionReason?: string) => {
      if (cancelled) return;
      if (status === 'APPROVED') {
        if (pendingVerification.teacherId) {
          storage.setTeacherSession(pendingVerification.teacherId);
        } else {
          const t = storage.getTeachers().find(x => x.username === pendingVerification.username);
          if (t) storage.setTeacherSession(t.id);
        }
        onLogin('TEACHER');
      } else if (status === 'REJECTED' || status === 'NOT_FOUND') {
        const reasonMsg = status === 'REJECTED'
          ? `Registration denied by school administration${rejectionReason ? `: ${rejectionReason}` : '.'}`
          : 'Registration rejected and removed by school administration (flagged as unverified/imposter).';
        setPendingVerification(null);
        setError(reasonMsg);
        setView('LOGIN');
      }
    };

    const checkLocalTeachers = () => {
      const teachers = storage.getTeachers();
      const t = teachers.find(x => x.username === pendingVerification.username || (pendingVerification.teacherId && x.id === pendingVerification.teacherId));
      if (t) {
        if (t.isApproved && t.approvalStatus === 'APPROVED') {
          storage.setTeacherSession(t.id);
          onLogin('TEACHER');
          return true;
        }
        if (t.approvalStatus === 'REJECTED') {
          handleStatusResult('REJECTED', t.rejectionReason);
          return true;
        }
      }
      return false;
    };

    const checkServerApproval = async () => {
      if (checkLocalTeachers()) return;
      try {
        const params = new URLSearchParams();
        if (pendingVerification.teacherId) params.set('teacherId', pendingVerification.teacherId);
        if (pendingVerification.username) params.set('username', pendingVerification.username);
        const res = await fetch(`/api/auth/approval-status?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.status === 'APPROVED' || data?.status === 'REJECTED' || data?.status === 'NOT_FOUND') {
            if (data.status === 'APPROVED') {
              await storage.fetchLatestFromApi(true).catch(() => {});
            }
            handleStatusResult(data.status, data.rejectionReason);
          }
        }
      } catch {}
    };

    const unsub = storage.subscribe(() => { checkLocalTeachers(); });
    checkServerApproval();
    const interval = setInterval(checkServerApproval, 2500);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(interval);
    };
  }, [pendingVerification, onLogin]);

  const switchView = (newView: typeof view) => {
    setView(newView);
    setError('');
    setSignupStep('DETAILS');
    setVerificationCode('');
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
    if (!formData.name.trim() || !formData.email.trim() || !formData.username.trim() || !formData.password) {
      setError('Please fill in Full Name, Email, Username, and Password.');
      return;
    }

    const cleanEmail = formData.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setError('Please enter a valid email address (e.g. staff@school.edu).');
      return;
    }

    if (formData.password.length < 4) {
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

      // Strictly never auto-fill verification code on any environment
      setVerificationCode('');
      setDispatchSender(typeof data.sender === 'string' ? data.sender : '');
      setSignupStep('VERIFY_CODE');
      setResendCooldown(30);
    } catch (e: any) {
      setError(e?.message || 'Network error: Failed to reach the verification service. Please try again.');
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
          password: formData.password,
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

      if (data.token) storage.setAuthToken(data.token);
      if (data.customToken) storage.setFirebaseCustomToken(data.customToken);
      if (data.user) {
        storage.mergeTeacherInMemory(data.user);
        storage.fetchLatestFromApi(true).catch(() => {});
      }

      setPendingVerification({
        name: formData.name.trim(),
        username: formData.username.trim().toLowerCase(),
        teacherId: data.user?.id,
        schoolName: currentSchool.name,
        email: formData.email.trim().toLowerCase()
      });
    } catch (e: any) {
      // Strictly enforce authoritative server registration. Do not create local accounts or bypasses on failure.
      setError(e?.message || 'Server registration failed. Please check your network connection and try again.');
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
          password: formData.password
        })
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'USERNAME_NOT_FOUND') {
          setError('Username not found.');
        } else if (data.code === 'EMAIL_NOT_FOUND') {
          setError('Email not found.');
        } else if (data.code === 'INVALID_PASSWORD') {
          setError('Incorrect password.');
        } else if (data.code === 'ROLE_MISMATCH') {
          setError(data.error || (roleMode === 'ADMIN' ? 'This account belongs to a teacher. Select Teacher Login.' : 'This account belongs to an administrator. Select Administrator Login.'));
        } else if (data.code === 'ACCOUNT_PENDING_APPROVAL' || data.isPendingApproval) {
          setError('Your account is awaiting administrator approval.');
        } else if (data.code === 'ACCOUNT_REJECTED') {
          setError('Your teacher registration has been rejected. Contact your administrator.');
        } else if (data.code === 'ACCOUNT_DISABLED') {
          setError('This account has been disabled. Contact your administrator.');
        } else if (data.code === 'CREDENTIAL_MISSING') {
          setError('Your account requires a password reset.');
        } else if (data.code === 'AUTH_DATA_UNAVAILABLE') {
          setError('Authentication service is temporarily unavailable. Please try again.');
        } else if (data.code === 'RATE_LIMITED') {
          setError('Too many attempts. Please wait before trying again.');
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
      // Authoritative security: Fail closed on network failure, no offline credential bypass
      setError('Unable to reach the authentication server. Check your internet connection and try again.');
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

  const handleRecovery = async () => {
    const inputIdentifier = formData.username.trim().toLowerCase();
    const inputCode = formData.recoveryCode.trim().toUpperCase();
    if (!inputIdentifier || !inputCode) {
      setError('Username/Email and recovery code are required.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/recover-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: inputIdentifier, recoveryCode: inputCode })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRecoveringTeacherId(data.teacherId);
        setView('RESET');
        setError('');
      } else {
        setError(data.error || 'Invalid recovery code or account not found.');
      }
    } catch {
      setError('Unable to contact server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!formData.newPassword || formData.newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (!recoveringTeacherId) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/reset-password-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId: recoveringTeacherId,
          recoveryCode: formData.recoveryCode.trim().toUpperCase(),
          newPassword: formData.newPassword.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        switchView('LOGIN');
        setError('');
      } else {
        setError(data.error || 'Failed to reset password.');
      }
    } catch {
      setError('Unable to contact server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyCode = () => {
      if (recoveryCodeDisplay) {
          navigator.clipboard.writeText(recoveryCodeDisplay);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
      }
  };

  const glassBackdrop = (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-br from-[#f6f9ff] via-[#eef3ff] to-[#f4f1ff]">
      {/* Sculpted Vibrant Color Spheres & Ribbons So White Frosted Glass Visibly Refracts Light */}
      <div className="absolute -top-24 -left-20 w-[440px] h-[440px] rounded-full bg-gradient-to-br from-sky-400/55 to-blue-500/45 blur-[64px]" />
      <div className="absolute -bottom-28 -right-16 w-[480px] h-[480px] rounded-full bg-gradient-to-tr from-indigo-500/45 via-violet-400/40 to-fuchsia-300/35 blur-[72px]" />
      <div className="absolute top-[22%] right-[18%] w-[300px] h-[300px] rounded-full bg-gradient-to-br from-cyan-300/45 to-blue-400/35 blur-[56px]" />
      <div className="absolute bottom-[18%] left-[24%] w-[260px] h-[260px] rounded-full bg-gradient-to-tr from-blue-300/45 to-emerald-200/40 blur-[56px]" />

      {/* Crisp Hairline Architectural Grid */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.5]" aria-hidden="true">
        <defs>
          <pattern id="pentric-white-glass-grid" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(100, 116, 139, 0.14)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#pentric-white-glass-grid)" />
      </svg>

      {/* Layered Floating Frosted White Glass Accents Framing the Main Card */}
      <div className="hidden md:block absolute top-10 left-[6%] w-40 h-40 rounded-[2rem] rotate-12 border border-white bg-white/50 backdrop-blur-xl shadow-[0_16px_40px_rgba(37,99,235,0.12),inset_0_1px_1px_rgba(255,255,255,1)]" />
      <div className="hidden md:block absolute bottom-10 right-[6%] w-44 h-44 rounded-full border border-white bg-white/50 backdrop-blur-xl shadow-[0_16px_40px_rgba(99,102,241,0.12),inset_0_1px_1px_rgba(255,255,255,1)]" />
    </div>
  );

  // --- COMPONENT: Anti-Imposter Verification Pending State ---
  if (pendingVerification) {
    return (
      <div className="min-h-screen text-slate-900 flex items-center justify-center p-6 font-teacher-ui relative overflow-hidden">
        {glassBackdrop}
        <div className="max-w-md w-full bg-white/75 backdrop-blur-2xl backdrop-saturate-150 rounded-[2rem] shadow-[0_28px_72px_-16px_rgba(37,99,235,0.18),0_10px_30px_-10px_rgba(15,23,42,0.06),inset_0_1.5px_1px_rgba(255,255,255,1)] border border-white ring-1 ring-slate-900/[0.04] p-8 md:p-10 text-center animate-in zoom-in-95 duration-300 relative z-10">
          
          <div className="w-20 h-20 bg-white/85 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-[0_10px_28px_-6px_rgba(37,99,235,0.22),inset_0_1px_1px_rgba(255,255,255,1)] border border-white backdrop-blur-md">
            <ShieldCheck size={40} />
          </div>

          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-blue-50/90 border border-blue-200/80 text-blue-700 text-xs font-bold uppercase tracking-wider mb-4 backdrop-blur-md">
            <Clock size={13} className="animate-spin text-blue-600" /> Anti-Imposter Verification Required
          </div>

          <h2 className="text-2xl font-extrabold text-slate-900 mb-2 tracking-tight">Teacher Registration Received</h2>
          
          <p className="text-slate-600 text-xs mb-6 leading-relaxed">
            Welcome, <strong className="text-slate-900 font-bold">{pendingVerification.name}</strong>! To ensure strict security and prevent imposter access for <strong className="text-blue-600 font-bold">{pendingVerification.schoolName}</strong>, your account has been placed under pending approval.
          </p>

          <div className="p-4 bg-white/70 rounded-2xl border border-white ring-1 ring-blue-100 text-left mb-5 space-y-2 backdrop-blur-md shadow-xs">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-800">
              <ShieldCheck size={16} className="text-blue-600" /> Alert Dispatched to School Admin
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              A message has been sent to your school administrator telling them to approve that you are an official teacher of the school and not an imposter. Once confirmed, you can log in.
            </p>
          </div>

          {/* Verified Email Badge */}
          {pendingVerification.email && (
            <div className="flex items-center justify-center gap-2 text-xs text-emerald-700 bg-emerald-50/90 border border-emerald-200/80 py-1.5 px-3.5 rounded-full mb-5 font-semibold w-fit mx-auto backdrop-blur-md">
              <CheckCircle size={14} className="text-emerald-600 shrink-0" />
              <span>Email Verified (Anti-Bot): <strong className="font-mono text-emerald-900">{pendingVerification.email}</strong></span>
            </div>
          )}

          {/* Secure Faculty Account Notice (Backup codes reserved for Developer Console only) */}
          <div className="bg-white/75 text-slate-800 p-5 rounded-2xl mb-6 relative group border border-white ring-1 ring-slate-200/70 text-left backdrop-blur-md shadow-xs">
            <div className="flex items-center gap-2 mb-1.5 text-blue-600 font-bold text-xs uppercase tracking-wider">
              <ShieldCheck size={16} />
              <span>Institutional Faculty Escrow</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Your staff credentials have been securely registered and hashed. Backup recovery keys are held strictly in the developer security console to prevent credential theft.
            </p>
          </div>

          <div className="space-y-3">
            <button 
              type="button"
              onClick={async () => {
                setIsLoading(true);
                setError('');
                try {
                  const params = new URLSearchParams();
                  if (pendingVerification.teacherId) params.set('teacherId', pendingVerification.teacherId);
                  if (pendingVerification.username) params.set('username', pendingVerification.username);
                  const res = await fetch(`/api/auth/approval-status?${params.toString()}`);
                  if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'APPROVED') {
                      await storage.fetchLatestFromApi(true).catch(() => {});
                      const t = storage.getTeachers().find(x => x.username === pendingVerification.username || (pendingVerification.teacherId && x.id === pendingVerification.teacherId));
                      storage.setTeacherSession(t?.id || pendingVerification.teacherId || null);
                      onLogin('TEACHER');
                      return;
                    }
                    if (data.status === 'REJECTED' || data.status === 'NOT_FOUND') {
                      setPendingVerification(null);
                      setError(data.status === 'REJECTED'
                        ? `Registration denied by school administration${data.rejectionReason ? `: ${data.rejectionReason}` : '.'}`
                        : 'Registration rejected and removed by school administration.');
                      switchView('LOGIN');
                      return;
                    }
                  }
                } catch {} finally {
                  setIsLoading(false);
                }
                setError('Your account is still awaiting school admin verification. Please notify your administrator to approve your staff account.');
              }} 
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white py-3.5 rounded-xl font-bold transition shadow-[0_14px_30px_-8px_rgba(79,70,229,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)] text-xs flex items-center justify-center gap-2"
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

  // --- COMPONENT: Success State (Code hidden from teachers) ---
  if (recoveryCodeDisplay) {
      return (
          <div className="min-h-screen flex items-center justify-center p-6 font-teacher-ui relative overflow-hidden">
              {glassBackdrop}
              <div className="max-w-md w-full bg-white/75 backdrop-blur-2xl backdrop-saturate-150 rounded-[2rem] shadow-[0_28px_72px_-16px_rgba(37,99,235,0.18),0_10px_30px_-10px_rgba(15,23,42,0.06),inset_0_1.5px_1px_rgba(255,255,255,1)] border border-white ring-1 ring-slate-900/[0.04] p-10 text-center animate-in zoom-in-95 duration-300 relative z-10">
                  <div className="w-20 h-20 bg-emerald-50/90 text-emerald-600 border border-white ring-1 ring-emerald-200/70 rounded-full flex items-center justify-center mx-auto mb-6 shadow-md backdrop-blur-md">
                      <CheckCircle size={40} />
                  </div>
                  <h2 className="text-3xl font-extrabold text-slate-900 mb-3 tracking-tight">Account Ready</h2>
                  <p className="text-slate-600 text-sm mb-8 leading-relaxed">
                      Your faculty account has been registered successfully. Security verification is complete and your schedule is available in your portal.
                  </p>
                  
                  <button 
                    onClick={() => {
                      setRecoveryCodeDisplay(null);
                      if (storage.getLoggedInTeacherId()) {
                        onLogin('TEACHER');
                      } else {
                        switchView('LOGIN');
                      }
                    }} 
                    className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 text-white py-4 rounded-xl font-bold transition shadow-[0_14px_30px_-8px_rgba(79,70,229,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)] flex items-center justify-center gap-2"
                  >
                      Go to Dashboard <ArrowRight size={18} />
                  </button>
              </div>
          </div>
      );
  }

  // --- COMPONENT: Main Auth Layout ---
  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 font-teacher-ui relative overflow-hidden">
      {glassBackdrop}

      <div className="bg-white/65 backdrop-blur-2xl backdrop-saturate-150 w-full max-w-[1060px] min-h-[615px] rounded-[2rem] shadow-[0_30px_80px_-18px_rgba(37,99,235,0.22),0_12px_32px_-12px_rgba(15,23,42,0.08),inset_0_1.5px_1px_rgba(255,255,255,1)] border border-white ring-1 ring-slate-900/[0.04] flex overflow-hidden relative z-10 transition-all duration-500">
          
          {/* Top White Crystal Specular Rim */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />

          {/* LEFT: WHITE FROSTED GLASS FORM PANE */}
          <div className="w-full md:w-[46%] bg-white/60 backdrop-blur-xl border-b md:border-b-0 md:border-r border-white/90 p-7 sm:p-9 md:p-10 flex flex-col justify-center relative">
              
              {/* School Header Badge & Switch Option */}
              <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-200/60">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white/90 text-blue-600 border border-white ring-1 ring-blue-100 flex items-center justify-center shrink-0 backdrop-blur-md shadow-[0_4px_14px_rgba(37,99,235,0.1)]">
                    <School size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">School Portal</div>
                    <div className="text-xs font-extrabold text-slate-900 truncate">{currentSchool.name}</div>
                  </div>
                </div>
                {onSwitchSchool && (
                  <button 
                    type="button"
                    onClick={onSwitchSchool}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-white/85 hover:bg-white px-3 py-1.5 rounded-xl transition border border-white ring-1 ring-blue-200/70 backdrop-blur-md shadow-[0_4px_12px_rgba(37,99,235,0.08)] shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    Switch School
                  </button>
                )}
              </div>

              {/* Contextual Back Action for Non-Login Auth Views */}
              {view !== 'LOGIN' && view !== 'ABOUT' && (
                  <button 
                      type="button"
                      onClick={() => {
                        if (view === 'SIGNUP' && signupStep === 'VERIFY_CODE') {
                          setSignupStep('DETAILS');
                          setError('');
                        } else {
                          switchView('LOGIN');
                        }
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 mb-3 w-fit py-1 px-2.5 -ml-2 rounded-lg hover:bg-white/80 transition"
                  >
                      <ArrowLeft size={15}/>
                      <span>{view === 'SIGNUP' && signupStep === 'VERIFY_CODE' ? 'Back to Details' : 'Back to Sign In'}</span>
                  </button>
              )}
              
              {view === 'ABOUT' ? (
                  <div className="animate-in slide-in-from-left-8 fade-in duration-300">
                       <button
                         type="button"
                         onClick={() => switchView('LOGIN')}
                         className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 mb-5 py-1 px-2.5 -ml-2 rounded-lg hover:bg-white/80 transition"
                       >
                         <ArrowLeft size={16}/>
                         <span>Back to Sign In</span>
                       </button>
                       <div className="flex items-center gap-3 text-slate-900 mb-6">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 rounded-xl flex items-center justify-center text-white shadow-[0_8px_20px_-4px_rgba(79,70,229,0.45),inset_0_1px_1px_rgba(255,255,255,0.4)]">
                              <LayoutGrid size={20} />
                          </div>
                          <span className="font-extrabold text-xl tracking-tight">Pentric</span>
                      </div>
                      <h1 className="text-3xl font-extrabold text-slate-900 mb-3 tracking-tight">System Architecture</h1>
                      <div className="space-y-4 text-sm text-slate-600 mb-4 leading-relaxed">
                          <p>
                              Pentric is an advanced academic timetable management system created by PBFA INNOVATIONS AND TECHNOLOGY (<a href="https://pbfa.netlify.app" target="_blank" rel="noopener noreferrer" className="underline font-bold text-blue-600 hover:text-blue-700">pbfa.netlify.app</a>) to streamline school scheduling and academic operations.
                          </p>
                          <ul className="space-y-2.5">
                              <li className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-blue-500 shrink-0"></div>Conflict-free generation algorithms</li>
                              <li className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-blue-500 shrink-0"></div>Role-based tiered administration</li>
                              <li className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-blue-500 shrink-0"></div>Real-time faculty collaboration tools</li>
                          </ul>
                          <div className="p-4 bg-white/80 rounded-xl border border-white ring-1 ring-slate-200/70 text-sm backdrop-blur-md shadow-xs">
                              <div className="flex justify-between mb-2">
                                  <span className="font-semibold text-slate-700">Version</span>
                                  <span className="font-mono-num text-blue-600 font-semibold">2.1.0</span>
                              </div>
                              <div className="flex justify-between">
                                  <span className="font-semibold text-slate-700">Build</span>
                                  <span className="font-mono text-slate-500">Stable / Enterprise</span>
                              </div>
                          </div>
                      </div>
                  </div>
              ) : (
                  <div className="animate-in fade-in duration-500">
                    <div className="mb-6">
                        <div className="flex items-center gap-2.5 text-slate-900 mb-4">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 rounded-xl flex items-center justify-center text-white shadow-[0_10px_24px_-6px_rgba(79,70,229,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)]">
                                <LayoutGrid size={20} />
                            </div>
                            <span className="font-extrabold text-xl tracking-tight text-slate-900">Pentric</span>
                        </div>

                        <h1 className="text-3xl sm:text-[2.15rem] font-extrabold text-slate-900 mb-1.5 tracking-tight leading-tight">
                            {view === 'LOGIN' ? 'Welcome Back' : view === 'SIGNUP' ? (signupStep === 'VERIFY_CODE' ? 'Verify Email' : 'Join Faculty') : view === 'RECOVERY' ? 'Account Recovery' : 'Reset Password'}
                        </h1>
                        <p className="text-slate-500 text-sm sm:text-[15px] font-medium">
                            {view === 'LOGIN' ? 'Sign in with your school credentials to continue.' : 
                            view === 'SIGNUP' ? (signupStep === 'VERIFY_CODE' ? 'Enter the 6-digit code sent to your email to verify you are not a bot.' : 'Create an account to join the teaching faculty.') : 
                            'Verify identity to restore access.'}
                        </p>
                    </div>

                    {/* FROSTED WHITE GLASS ROLE SWITCHER */}
                    {view === 'LOGIN' && (
                        <div className="relative p-1 bg-slate-200/55 border border-white backdrop-blur-md rounded-xl mb-5 flex w-full shadow-[inset_0_1px_3px_rgba(15,23,42,0.07)]">
                            <div 
                                className={`absolute inset-y-1 w-[calc(50%-4px)] bg-white rounded-lg border border-white shadow-[0_6px_18px_-4px_rgba(37,99,235,0.18),0_1px_3px_rgba(15,23,42,0.06)] transition-all duration-300 ease-out ${roleMode === 'ADMIN' ? 'translate-x-[100%] left-1' : 'left-1'}`}
                            ></div>
                            <button 
                                type="button"
                                onClick={() => setRoleMode('TEACHER')}
                                className={`relative z-10 w-1/2 py-2 text-[13px] font-bold transition-colors duration-300 rounded-lg focus-visible:outline-none ${roleMode === 'TEACHER' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-800'}`}
                            >
                                Faculty
                            </button>
                            <button 
                                type="button"
                                onClick={() => setRoleMode('ADMIN')}
                                className={`relative z-10 w-1/2 py-2 text-[13px] font-bold transition-colors duration-300 rounded-lg focus-visible:outline-none ${roleMode === 'ADMIN' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-800'}`}
                            >
                                Admin Portal
                            </button>
                        </div>
                    )}

                    {error && (
                        <div className="mb-5 p-3.5 bg-red-50/90 text-red-600 text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2.5 border border-red-200/80 backdrop-blur-md animate-in slide-in-from-top-2">
                            <AlertCircle size={17} className="shrink-0" /> <span>{error}</span>
                        </div>
                    )}

                    {/* SIGNUP STEP 2: 6-DIGIT VERIFICATION CODE */}
                    {view === 'SIGNUP' && signupStep === 'VERIFY_CODE' ? (
                        <form
                            onSubmit={e => { e.preventDefault(); handleSignup(); }}
                            className="space-y-4 animate-in fade-in duration-300"
                        >
                            <div className="p-4 bg-white/80 rounded-xl border border-white ring-1 ring-blue-100 text-center backdrop-blur-md shadow-xs">
                                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center mx-auto mb-2.5 shadow-sm shadow-blue-500/25">
                                    <Mail size={21} />
                                </div>
                                <h3 className="font-bold text-slate-900 text-sm sm:text-base">Check Your Inbox</h3>
                                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                                    A unique 6-digit verification code has been dispatched to <strong className="text-blue-700 font-bold">{formData.email}</strong>{dispatchSender ? <> from <strong className="text-slate-800 font-mono">{dispatchSender}</strong></> : null}. Check your Inbox, Updates, or Spam folder and enter it below.
                                </p>
                                <div className="flex items-center justify-center gap-3 mt-3">
                                    {formData.email.toLowerCase().includes('@gmail.com') && (
                                        <a
                                            href="https://mail.google.com"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/95 border border-blue-200 text-blue-700 font-bold text-xs rounded-lg shadow-2xs hover:bg-blue-50 transition"
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


                            <div className="relative group">
                                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider text-center">
                                    Enter 6-Digit Code
                                </label>
                                <input 
                                    type="text"
                                    name="manual_otp_code"
                                    autoComplete="off"
                                    inputMode="numeric"
                                    autoFocus
                                    maxLength={6}
                                    placeholder="000000"
                                    className="w-full bg-white/80 border border-white ring-1 ring-slate-200/80 rounded-xl py-3.5 text-center font-mono-num font-black text-2xl sm:text-3xl tracking-[0.4em] outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/15 transition-all text-slate-900 placeholder:text-slate-300 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,1)]"
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
                                type="submit"
                                disabled={isLoading || verificationCode.trim().length !== 6}
                                className="w-full mt-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 text-white py-3.5 rounded-xl font-bold text-sm active:scale-[0.99] transition-all flex items-center justify-between px-5 shadow-[0_14px_30px_-8px_rgba(79,70,229,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)] group disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span>{isLoading ? 'Verifying & Creating Account...' : 'Verify Code & Complete Registration'}</span>
                                <div className="w-7 h-7 bg-white/15 rounded-full flex items-center justify-center group-hover:bg-white/25 transition-colors">
                                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                                </div>
                            </button>
                        </form>
                    ) : (
                        /* STANDARD WHITE FROSTED INPUTS FOR LOGIN, SIGNUP DETAILS, RECOVERY & RESET */
                        <form
                            onSubmit={e => {
                                e.preventDefault();
                                if (view === 'SIGNUP') {
                                    handleSendVerificationCode();
                                } else if (view === 'RECOVERY') {
                                    handleRecovery();
                                } else if (view === 'RESET') {
                                    handlePasswordReset();
                                } else {
                                    handleLogin();
                                }
                            }}
                        >
                            <div className="space-y-3.5">
                                {view === 'SIGNUP' && (
                                    <>
                                        <div className="relative group">
                                            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none"><User size={18} /></div>
                                            <input 
                                                className="w-full bg-white/75 hover:bg-white/95 focus:bg-white border border-white ring-1 ring-slate-200/80 rounded-xl py-3.5 pl-11 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all font-medium text-slate-900 placeholder:text-slate-400 backdrop-blur-md shadow-[0_4px_14px_rgba(37,99,235,0.04),inset_0_1px_0_rgba(255,255,255,1)]"
                                                placeholder="Full Name"
                                                value={formData.name}
                                                onChange={e => setFormData({...formData, name: e.target.value})}
                                            />
                                        </div>
                                        <div className="relative group">
                                            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none"><Mail size={18} /></div>
                                            <input 
                                                type="email"
                                                className="w-full bg-white/75 hover:bg-white/95 focus:bg-white border border-white ring-1 ring-slate-200/80 rounded-xl py-3.5 pl-11 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all font-medium text-slate-900 placeholder:text-slate-400 backdrop-blur-md shadow-[0_4px_14px_rgba(37,99,235,0.04),inset_0_1px_0_rgba(255,255,255,1)]"
                                                placeholder="Email Address (e.g. staff@school.edu)"
                                                value={formData.email}
                                                onChange={e => setFormData({...formData, email: e.target.value})}
                                            />
                                        </div>
                                    </>
                                )}

                                {view !== 'RESET' && (
                                    <div className="relative group">
                                        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none"><User size={18} /></div>
                                        <input 
                                            autoComplete="username"
                                            className="w-full bg-white/75 hover:bg-white/95 focus:bg-white border border-white ring-1 ring-slate-200/80 rounded-xl py-3.5 pl-11 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all font-medium text-slate-900 placeholder:text-slate-400 backdrop-blur-md shadow-[0_4px_14px_rgba(37,99,235,0.04),inset_0_1px_0_rgba(255,255,255,1)]"
                                            placeholder={view === 'LOGIN' && roleMode === 'ADMIN' ? 'Admin Username' : 'Username'}
                                            value={formData.username}
                                            onChange={e => setFormData({...formData, username: e.target.value})}
                                        />
                                    </div>
                                )}

                                {view === 'RECOVERY' && (
                                    <div className="relative group">
                                        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none"><Key size={18} /></div>
                                        <input 
                                            className="w-full bg-white/75 hover:bg-white/95 focus:bg-white border border-white ring-1 ring-slate-200/80 rounded-xl py-3.5 pl-11 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all font-mono uppercase tracking-wider text-slate-900 placeholder:text-slate-400 backdrop-blur-md shadow-[0_4px_14px_rgba(37,99,235,0.04),inset_0_1px_0_rgba(255,255,255,1)]"
                                            placeholder="RECOVERY CODE"
                                            value={formData.recoveryCode}
                                            onChange={e => setFormData({...formData, recoveryCode: e.target.value.toUpperCase()})}
                                        />
                                    </div>
                                )}

                                {(view === 'LOGIN' || view === 'SIGNUP') && (
                                    <div className="relative group">
                                        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none"><Lock size={18} /></div>
                                        <input 
                                            type={showPass ? "text" : "password"}
                                            autoComplete={view === 'LOGIN' ? 'current-password' : 'new-password'}
                                            className="w-full bg-white/75 hover:bg-white/95 focus:bg-white border border-white ring-1 ring-slate-200/80 rounded-xl py-3.5 pl-11 pr-11 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all font-medium text-slate-900 placeholder:text-slate-400 backdrop-blur-md shadow-[0_4px_14px_rgba(37,99,235,0.04),inset_0_1px_0_rgba(255,255,255,1)]"
                                            placeholder="Password"
                                            value={formData.password}
                                            onChange={e => setFormData({...formData, password: e.target.value})}
                                        />
                                        <button
                                            type="button"
                                            aria-label={showPass ? 'Hide password' : 'Show password'}
                                            onClick={() => setShowPass(!showPass)}
                                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded-md transition"
                                        >
                                            {showPass ? <EyeOff size={18}/> : <Eye size={18}/>}
                                        </button>
                                    </div>
                                )}

                                {view === 'RESET' && (
                                     <div className="relative group">
                                        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none"><Lock size={18} /></div>
                                        <input 
                                            type={showPass ? "text" : "password"}
                                            autoComplete="new-password"
                                            className="w-full bg-white/75 hover:bg-white/95 focus:bg-white border border-white ring-1 ring-slate-200/80 rounded-xl py-3.5 pl-11 pr-11 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all font-medium text-slate-900 placeholder:text-slate-400 backdrop-blur-md shadow-[0_4px_14px_rgba(37,99,235,0.04),inset_0_1px_0_rgba(255,255,255,1)]"
                                            placeholder="New Password"
                                            value={formData.newPassword}
                                            onChange={e => setFormData({...formData, newPassword: e.target.value})}
                                        />
                                        <button
                                            type="button"
                                            aria-label={showPass ? 'Hide password' : 'Show password'}
                                            onClick={() => setShowPass(!showPass)}
                                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded-md transition"
                                        >
                                            {showPass ? <EyeOff size={18}/> : <Eye size={18}/>}
                                        </button>
                                    </div>
                                )}

                                {view === 'SIGNUP' && (
                                    <div className="p-3 bg-white/80 rounded-xl border border-white ring-1 ring-blue-100 flex items-start gap-2.5 text-xs text-slate-700 backdrop-blur-md">
                                        <ShieldCheck size={17} className="text-blue-600 shrink-0 mt-0.5" />
                                        <div>
                                            <span className="font-bold text-slate-900">Anti-Bot Verification:</span> A 6-digit code will be sent to your email to verify that you are genuine staff and not an automated bot.
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button 
                                type="submit"
                                disabled={isLoading || isSendingCode}
                                className="w-full mt-5 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 text-white py-3.5 rounded-xl font-bold text-sm active:scale-[0.99] transition-all flex items-center justify-between px-5 shadow-[0_14px_30px_-8px_rgba(79,70,229,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)] group disabled:opacity-70 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                            >
                                <span>
                                    {isSendingCode
                                      ? 'Sending 6-Digit Code...'
                                      : isLoading
                                        ? (view === 'LOGIN' ? 'Signing In...' : 'Processing...')
                                        : (view === 'LOGIN' ? 'Sign In' : view === 'SIGNUP' ? 'Send 6-Digit Code' : 'Confirm')}
                                </span>
                                <div className="w-7 h-7 bg-white/15 rounded-full flex items-center justify-center group-hover:bg-white/25 group-hover:translate-x-0.5 transition-all">
                                    {(isLoading || isSendingCode) ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={17} />}
                                </div>
                            </button>
                        </form>
                    )}

                    <div className="mt-5 text-center space-y-3.5">
                        {view === 'SIGNUP' && (
                            <div className="flex justify-center items-center text-xs sm:text-sm font-medium">
                                <span className="text-slate-500 mr-1.5">Already have an account?</span>
                                <button type="button" onClick={() => switchView('LOGIN')} className="text-blue-600 hover:text-blue-700 font-bold hover:underline decoration-2 underline-offset-4">Sign In</button>
                            </div>
                        )}
                        {view === 'LOGIN' && (
                            <>
                                <div className="flex justify-between items-center text-xs sm:text-sm font-medium px-0.5">
                                    <button type="button" onClick={() => switchView('SIGNUP')} className="text-blue-600 hover:text-blue-700 font-semibold hover:underline decoration-2 underline-offset-4 transition-colors">Create Account</button>
                                    <button type="button" onClick={() => switchView('RECOVERY')} className="text-slate-500 hover:text-slate-800 transition-colors">Forgot Password?</button>
                                </div>
                                <div className="pt-3.5 border-t border-slate-200/60 flex flex-col gap-2.5">
                                     {onSelectPublicView && (
                                       <button 
                                         type="button"
                                         onClick={onSelectPublicView}
                                         className="w-full py-2.5 px-4 bg-white/80 hover:bg-white text-blue-700 hover:text-blue-800 rounded-xl text-xs font-bold transition border border-white ring-1 ring-blue-200/75 backdrop-blur-md shadow-[0_4px_14px_rgba(37,99,235,0.08),inset_0_1px_0_rgba(255,255,255,1)] flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                       >
                                         <GraduationCap size={16} className="text-blue-600" /> View my class timetable (Students / Parents)
                                       </button>
                                     )}
                                     <button type="button" onClick={() => switchView('ABOUT')} className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1.5 mx-auto py-1 transition-colors">
                                         <Info size={13}/> System Info
                                     </button>
                                </div>
                            </>
                        )}
                    </div>
                  </div>
              )}
          </div>

          {/* RIGHT: LUMINOUS WHITE GLASSMORPHIC TIMETABLE SHOWCASE PANE (Desktop) */}
          <div className="hidden md:flex w-[54%] relative items-center justify-center overflow-hidden bg-gradient-to-br from-sky-100/55 via-white/40 to-indigo-100/65 backdrop-blur-xl p-10 lg:p-12">
              {/* Crisp Sculpted Pastel Shapes Behind Glass Cards */}
              <div className="pointer-events-none absolute -top-8 right-6 w-60 h-60 rounded-full bg-gradient-to-br from-sky-400/50 to-blue-500/40 blur-[48px]" />
              <div className="pointer-events-none absolute -bottom-10 left-4 w-64 h-64 rounded-full bg-gradient-to-tr from-indigo-400/45 to-violet-400/35 blur-[56px]" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/15 via-white/30 to-white/65" />

              <div className="relative z-10 text-slate-900 max-w-md w-full">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 backdrop-blur-xl border border-white shadow-[0_6px_18px_-4px_rgba(37,99,235,0.14),inset_0_1px_0_rgba(255,255,255,1)] text-xs font-bold text-blue-700 mb-5">
                      {roleMode === 'ADMIN' ? <ShieldCheck size={14} className="text-blue-600" /> : <GraduationCap size={14} className="text-indigo-600" />}
                      <span>{roleMode === 'ADMIN' ? 'Administration Command' : 'Faculty Workspace'}</span>
                  </div>

                  <h2 className="text-4xl lg:text-[2.55rem] font-extrabold text-slate-900 mb-3 leading-[1.12] tracking-tight">
                      {roleMode === 'ADMIN' ? (
                        <>System Command <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Center</span></>
                      ) : (
                        <>Academic <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Excellence</span></>
                      )}
                  </h2>
                  <p className="text-slate-600 text-sm lg:text-[15px] leading-relaxed mb-6">
                      {roleMode === 'ADMIN' 
                        ? 'Orchestrate timetables, manage faculty resources, and oversee institutional parameters.' 
                        : 'Access your teaching schedule, collaborate with peers, and manage automated requests.'}
                  </p>

                  {/* Layered White Frosted Glass Timetable Preview Card */}
                  <div className="relative mb-7">
                      <div className="p-4 rounded-2xl bg-white/75 backdrop-blur-2xl backdrop-saturate-150 border border-white shadow-[0_20px_48px_-14px_rgba(37,99,235,0.22),inset_0_1px_1px_rgba(255,255,255,1)]">
                          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200/60">
                              <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-sm">
                                      <Calendar size={14} />
                                  </div>
                                  <div>
                                      <div className="text-xs font-extrabold text-slate-900">
                                          {roleMode === 'ADMIN' ? 'Master Schedule Matrix' : 'Weekly Class Schedule'}
                                      </div>
                                      <div className="text-[10px] font-medium text-slate-500">{currentSchool.name}</div>
                                  </div>
                              </div>
                              <span className="px-2.5 py-1 rounded-full bg-emerald-50/90 border border-emerald-200/80 text-emerald-700 text-[10px] font-bold">
                                  Conflict-Free
                              </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                              <div className="p-2.5 rounded-xl bg-blue-50/85 border border-white ring-1 ring-blue-100">
                                  <div className="text-[10px] font-bold text-blue-600 uppercase">Period 1</div>
                                  <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                                      {roleMode === 'ADMIN' ? 'SS3 Science' : 'Mathematics'}
                                  </div>
                              </div>
                              <div className="p-2.5 rounded-xl bg-indigo-50/85 border border-white ring-1 ring-indigo-100">
                                  <div className="text-[10px] font-bold text-indigo-600 uppercase">Period 2</div>
                                  <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                                      {roleMode === 'ADMIN' ? 'SS2 Commercial' : 'Physics'}
                                  </div>
                              </div>
                              <div className="p-2.5 rounded-xl bg-sky-50/85 border border-white ring-1 ring-sky-100">
                                  <div className="text-[10px] font-bold text-sky-600 uppercase">Period 3</div>
                                  <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                                      {roleMode === 'ADMIN' ? 'JSS3 Gold' : 'Chemistry'}
                                  </div>
                              </div>
                          </div>
                      </div>

                      {/* Overlapping Secondary Frosted Glass Pill */}
                      <div className="mt-3 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-white/80 backdrop-blur-xl border border-white shadow-[0_12px_32px_-10px_rgba(37,99,235,0.16),inset_0_1px_0_rgba(255,255,255,1)]">
                          <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                  <Users size={15} />
                              </div>
                              <div>
                                  <div className="text-xs font-bold text-slate-900">
                                      {roleMode === 'ADMIN' ? 'Instant Faculty Onboarding' : 'Real-Time Schedule Sync'}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                      {roleMode === 'ADMIN' ? 'Approve staff & auto-bind personal classes' : 'Automatically synced with published updates'}
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>
                  
                  <div className="flex items-center gap-4 pt-4 border-t border-white/90">
                      <div className="flex -space-x-2.5">
                          <div className="w-9 h-9 rounded-full ring-2 ring-white bg-white/90 backdrop-blur-md border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm">
                              <Calendar size={15} />
                          </div>
                          <div className="w-9 h-9 rounded-full ring-2 ring-white bg-white/90 backdrop-blur-md border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
                              <Users size={15} />
                          </div>
                          <div className="w-9 h-9 rounded-full ring-2 ring-white bg-white/90 backdrop-blur-md border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
                              <ShieldCheck size={15} />
                          </div>
                      </div>
                      <div>
                          <div className="text-slate-900 text-sm font-bold tracking-tight">
                              {roleMode === 'ADMIN' ? 'Administration Portal' : 'Faculty Portal'}
                          </div>
                          <div className="text-slate-500 text-xs">Powered by Pentric</div>
                      </div>
                  </div>
              </div>
          </div>

      </div>

      {/* Mandatory Password Change Modal */}
      {mustChangePassUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-xl flex items-center justify-center p-4">
          <form onSubmit={handleMandatoryPasswordChange} className="bg-white/85 backdrop-blur-2xl backdrop-saturate-150 rounded-[2rem] p-8 max-w-md w-full shadow-[0_28px_72px_-16px_rgba(37,99,235,0.2),inset_0_1px_1px_rgba(255,255,255,1)] border border-white animate-in zoom-in-95 text-slate-900">
            <div className="w-12 h-12 bg-amber-50 border border-amber-200/70 text-amber-600 rounded-2xl flex items-center justify-center mb-4">
              <Key size={24} />
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 mb-2 tracking-tight">Password Change Required</h2>
            <p className="text-slate-500 text-xs mb-6 leading-relaxed">
              You are currently using default credentials documented for this system. Please set a new secure password before continuing.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-xl flex items-center gap-2">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">New Password</label>
                <input
                  type="password"
                  value={newMandatoryPass}
                  onChange={e => setNewMandatoryPass(e.target.value)}
                  className="w-full bg-white/80 border border-white ring-1 ring-slate-200/80 rounded-xl p-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/15 backdrop-blur-md"
                  placeholder="At least 6 characters"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 text-white font-bold rounded-xl transition text-sm shadow-[0_14px_30px_-8px_rgba(79,70,229,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)]"
            >
              {isLoading ? 'Updating Password...' : 'Save & Continue to Dashboard'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
