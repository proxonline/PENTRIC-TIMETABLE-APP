
import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import './index.css';
import { Auth } from "./components/Auth";
import { TeacherDashboard } from "./components/TeacherDashboard";
import { AdminDashboard } from "./components/AdminDashboard";
import { PublicTimetable } from "./components/PublicTimetable";
import { SchoolPortal } from "./components/SchoolPortal";
import { AboutUsModal } from "./components/AboutUsModal";
import { TutorialOverlay } from "./components/TutorialOverlay";
import { storage } from "./services/storage";
import { School } from "./types";
import { X, Sparkles, Users, Info, Heart, Code2, Cpu, Lightbulb, WifiOff, Globe, ArrowRight, ShieldCheck, Calendar, Bell, RefreshCw, AlertOctagon, Terminal, Router, Cloud, CheckCircle2, School as SchoolIcon, Loader2 } from "lucide-react";

const App = () => {
  const [role, setRole] = useState<'TEACHER' | 'ADMIN' | null>(null);
  
  // Multi-School Portal Selection State
  // When opening app fresh, user is presented with the School Portal
  const [selectedSchool, setSelectedSchool] = useState<School | null>(() => {
    if (storage.isAdminLoggedIn() || storage.getLoggedInTeacherId()) {
      return storage.getCurrentSchool();
    }
    return null;
  });

  // School Specific Loading States
  const [showOtaSplash, setShowOtaSplash] = useState(false);
  const [isSplashFading, setIsSplashFading] = useState(false);
  const [otherSchoolLoading, setOtherSchoolLoading] = useState<string | null>(null);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [retryTimer, setRetryTimer] = useState(15);
  
  // New UI States
  const [showAbout, setShowAbout] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showPublicView, setShowPublicView] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isStorageReady, setIsStorageReady] = useState(storage.isReady());

  useEffect(() => {
    // Clean up any dynamic injected theme styles or root classes
    const existingDynamicStyle = document.getElementById('ota-dynamic-theme-style');
    if (existingDynamicStyle) {
      existingDynamicStyle.remove();
    }
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    document.body.style.backgroundColor = '';
    document.body.style.color = '';

    const onReadyCallback = () => {
        setIsStorageReady(true);
        if (storage.isAdminLoggedIn()) {
          setRole('ADMIN');
          if (!selectedSchool) setSelectedSchool(storage.getCurrentSchool());
        } else if (storage.getLoggedInTeacherId()) {
          setRole('TEACHER');
          if (!selectedSchool) setSelectedSchool(storage.getCurrentSchool());
        }
        
        if (!storage.hasSeenAppWalkthrough()) {
            setTimeout(() => setShowTutorial(true), 4000);
        }
    };

    if (storage.isReady()) {
        onReadyCallback();
    } else {
        storage.onReady(onReadyCallback);
    }

    // Fail-safe timeout: Always unblock UI after 300ms max
    const maxWaitTimer = setTimeout(() => {
        setIsStorageReady(true);
    }, 300);

    // Storage Listener for "Live Sync" Visualization
    const unsub = storage.subscribe((showIndicator = true) => {
        if (showIndicator) {
            setIsSyncing(true);
            setTimeout(() => setIsSyncing(false), 800);
        }
    });

    // Network Listeners & Server Health Check
    const checkConnectivity = async () => {
      if (!navigator.onLine) {
        setIsOnline(false);
        return;
      }
      const isServerReachable = await storage.forceSync();
      setIsOnline(isServerReachable);
    };

    const handleOnline = () => {
      setIsOnline(true);
      checkConnectivity();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial ping and periodic health check
    checkConnectivity();
    const syncInterval = setInterval(() => {
      if (navigator.onLine) {
        storage.forceSync().then((ok) => {
          if (ok) setIsOnline(true);
        });
      } else {
        setIsOnline(false);
      }
    }, 4000);

    // Migration: Fix nested arrays in localStorage
    try {
        const teachersData = localStorage.getItem('ota_teachers_v3');
        if (teachersData) {
            const parsed = JSON.parse(teachersData);
            const teachersList = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? Object.values(parsed) : []);
            let migrated = false;
            teachersList.forEach((t: any) => {
                if (t && Array.isArray(t.availability)) {
                    t.availability = Array.from({ length: 5 }).reduce((acc: any, _, day) => {
                        acc[day] = Array.from({ length: 8 }).reduce((pAcc: any, _, period) => {
                            pAcc[period] = 'AVAILABLE';
                            return pAcc;
                        }, {});
                        return acc;
                    }, {});
                    migrated = true;
                }
            });
            if (migrated) {
                localStorage.setItem('ota_teachers_v3', JSON.stringify(teachersList));
            }
        }
    } catch (e) {
        console.error("Migration failed", e);
    }

    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        clearTimeout(maxWaitTimer);
        clearInterval(syncInterval);
        unsub();
    };
  }, []);

  // Selection Handler: Trigger OTA Total Academy loading screen ONLY for OTA Total Academy
  const handleSelectSchool = (school: School) => {
    storage.setCurrentSchool(school);
    setSelectedSchool(school);

    const isOta = school.isOta || school.id === 'ota_total_academy';
    if (isOta) {
      // Exclusively show OTA Total Academy Loading Screen
      setShowOtaSplash(true);
      setIsSplashFading(false);
      setTimeout(() => {
        setIsSplashFading(true);
      }, 3000);
      setTimeout(() => {
        setShowOtaSplash(false);
        setIsSplashFading(false);
      }, 4000);
    } else {
      // For any other school, DO NOT show OTA Total Academy splash screen!
      setShowOtaSplash(false);
      setOtherSchoolLoading(school.name);
      setTimeout(() => {
        setOtherSchoolLoading(null);
      }, 500);
    }
  };

  const handleSwitchSchool = () => {
    setSelectedSchool(null);
    setShowPublicView(false);
  };

  // Auto-Retry Countdown Effect
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (!isOnline) {
      setRetryTimer(15);
      interval = setInterval(() => {
        setRetryTimer((prev) => {
          if (prev <= 1) {
             window.location.reload();
             return 15;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isOnline]);

  const handleLogout = () => {
    if (role === 'ADMIN') storage.setAdminSession(null);
    else storage.setTeacherSession(null);
    setRole(null);
  };

  const renderContent = () => {
    if (!isStorageReady) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-4">
                    <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
                    <p className="text-sm font-medium text-slate-500">Syncing with cloud...</p>
                </div>
            </div>
        );
    }
    // If no school has been picked yet, show the School Portal ("Open your school portal")
    if (!selectedSchool) {
        return <SchoolPortal onSelectSchool={handleSelectSchool} />;
    }
    if (showPublicView) {
        return <PublicTimetable onBackToLogin={() => setShowPublicView(false)} />;
    }
    if (role === 'ADMIN') {
        return <AdminDashboard onLogout={handleLogout} onSwitchSchool={handleSwitchSchool} />;
    } else if (role === 'TEACHER') {
        return <TeacherDashboard onLogout={handleLogout} onSwitchSchool={handleSwitchSchool} />;
    } else {
        return <Auth onLogin={setRole} onSelectPublicView={() => setShowPublicView(true)} onSwitchSchool={handleSwitchSchool} />;
    }
  };

  return (
      <>
        {/* Offline Banner Indicator */}
        {!isOnline && (
          <div className="fixed top-0 left-0 right-0 z-[9999] bg-slate-900 text-white px-4 py-2.5 text-xs font-semibold flex items-center justify-between border-b border-amber-500/30 shadow-xl backdrop-blur-md bg-slate-900/95 animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
              <WifiOff size={15} className="text-amber-400" />
              <span><strong>Offline Mode:</strong> Viewing cached data. Timetable updates will sync across all devices automatically once reconnected.</span>
            </div>
            <button 
              onClick={async () => {
                const online = await storage.forceSync();
                setIsOnline(online || navigator.onLine);
              }} 
              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 px-3 py-1 rounded-lg font-bold text-[11px] transition flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw size={12} className="animate-spin" /> Retry Sync ({retryTimer}s)
            </button>
          </div>
        )}

        {/* OTA Total Academy Cinematic Loading Screen - ONLY shown for OTA Total Academy */}
        {showOtaSplash && (
            <div className={`fixed inset-0 z-[10000] bg-black flex flex-col items-center justify-center overflow-hidden transition-all duration-1000 ease-[cubic-bezier(0.76,0,0.24,1)] ${isSplashFading ? 'opacity-0 scale-110 pointer-events-none blur-3xl grayscale' : 'opacity-100 scale-100 blur-0 grayscale-0'}`}>
                
                {/* Dynamic Background Layers */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_#1a1a1a_0%,_#000000_100%)]"></div>
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.15] mix-blend-overlay"></div>
                
                {/* Animated Grid */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)] opacity-20"></div>

                {/* Atmospheric Glow */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100vh] h-[100vh] bg-amber-500/5 rounded-full blur-[150px] animate-pulse-slow mix-blend-screen"></div>

                <div className="relative z-10 flex flex-col items-center justify-center text-center w-full px-4">
                    
                    {/* Top Tagline with cinematic line reveal */}
                    <div className="mb-8 relative overflow-hidden p-4">
                         <div className="absolute top-1/2 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-amber-500/50 to-transparent -translate-y-1/2 animate-expand-line opacity-50"></div>
                         <div className="relative text-[10px] md:text-xs font-bold tracking-[0.8em] text-amber-200/80 uppercase animate-reveal-text bg-black/50 px-4 py-1 backdrop-blur-sm border border-amber-500/20 rounded-full">
                            Strictly for the
                         </div>
                    </div>

                    {/* Main Title Typography */}
                    <div className="relative flex flex-col items-center leading-[0.85] select-none mix-blend-lighten">
                        
                        {/* SERIOUS - Impact Entry */}
                        <div className="relative group">
                            <h1 className="text-5xl md:text-[7rem] lg:text-[10rem] font-black text-white tracking-tight animate-impact-in z-20 drop-shadow-[0_0_50px_rgba(255,255,255,0.1)]">
                                SERIOUS
                            </h1>
                            {/* Ghost Effect */}
                            <h1 className="absolute inset-0 text-5xl md:text-[7rem] lg:text-[10rem] font-black text-transparent tracking-tight z-10 animate-ghost-pulse stroke-white opacity-20" style={{ WebkitTextStroke: '1px white' }}>
                                SERIOUS
                            </h1>
                        </div>
                        
                        {/* MINDED - Outline & Fill Reveal */}
                        <div className="relative -mt-2 md:-mt-6 lg:-mt-10">
                             <h1 className="text-5xl md:text-[7rem] lg:text-[10rem] font-black text-transparent tracking-tight animate-slide-up-reveal z-10 bg-clip-text bg-gradient-to-b from-amber-100 to-amber-600" 
                                 style={{ WebkitTextStroke: '0px' }}>
                                MINDED
                            </h1>
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12 animate-shine pointer-events-none"></div>
                        </div>
                    </div>

                    {/* Academy Exclusive Badge */}
                    <div className="mt-8 flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold tracking-widest uppercase animate-fade-in-up">
                        <Sparkles size={14} className="text-amber-400" />
                        OTA TOTAL ACADEMY
                    </div>

                    {/* Technical Loader */}
                    <div className="mt-12 flex flex-col items-center gap-4 animate-fade-in-up opacity-0" style={{animationDelay: '1.2s', animationFillMode: 'forwards'}}>
                        <div className="h-[1px] w-28 bg-zinc-800 relative overflow-hidden">
                            <div className="absolute inset-0 bg-amber-500 w-1/2 animate-loading-bar"></div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping"></span>
                            <span className="text-[10px] font-mono text-zinc-400 tracking-[0.2em] uppercase">Opening OTA Academy Portal...</span>
                        </div>
                    </div>
                </div>

                 <style>{`
                    @keyframes expandLine { 0% { transform: translateY(-50%) scaleX(0); opacity: 0; } 100% { transform: translateY(-50%) scaleX(1); opacity: 0.5; } }
                    @keyframes revealText { 0% { opacity: 0; letter-spacing: 0em; filter: blur(8px); } 100% { opacity: 1; letter-spacing: 0.8em; filter: blur(0); } }
                    @keyframes impactIn { 0% { transform: scale(1.5); opacity: 0; filter: blur(20px); } 100% { transform: scale(1); opacity: 1; filter: blur(0); } }
                    @keyframes ghostPulse { 0%, 100% { transform: scale(1); opacity: 0.1; } 50% { transform: scale(1.05); opacity: 0.2; } }
                    @keyframes slideUpReveal { 
                        0% { transform: translateY(40px); opacity: 0; } 
                        100% { transform: translateY(0); opacity: 1; } 
                    }
                    @keyframes shine { 0% { transform: translateX(-150%) skewX(12deg); } 100% { transform: translateX(150%) skewX(12deg); } }
                    @keyframes pulseSlow { 0%, 100% { opacity: 0.2; transform: translate(-50%, -50%) scale(1); } 50% { opacity: 0.4; transform: translate(-50%, -50%) scale(1.2); } }
                    @keyframes fadeInUp { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
                    @keyframes loadingBar { 0% { transform: translateX(-100%); } 50% { transform: translateX(0); } 100% { transform: translateX(100%); } }

                    .animate-expand-line { animation: expandLine 1.5s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
                    .animate-reveal-text { animation: revealText 2s cubic-bezier(0.22, 1, 0.36, 1) forwards; animation-delay: 0.5s; opacity: 0; animation-fill-mode: forwards; }
                    .animate-impact-in { animation: impactIn 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards; animation-delay: 0.8s; opacity: 0; animation-fill-mode: forwards; }
                    .animate-ghost-pulse { animation: ghostPulse 4s ease-in-out infinite; animation-delay: 2s; }
                    .animate-slide-up-reveal { animation: slideUpReveal 1.5s cubic-bezier(0.22, 1, 0.36, 1) forwards; animation-delay: 1s; opacity: 0; animation-fill-mode: forwards; }
                    .animate-shine { animation: shine 5s linear infinite; }
                    .animate-pulse-slow { animation: pulseSlow 6s ease-in-out infinite; }
                    .animate-fade-in-up { animation: fadeInUp 1s ease-out forwards; }
                    .animate-loading-bar { animation: loadingBar 2s ease-in-out infinite; }
                `}</style>
            </div>
        )}

        {/* Transition Loading for Other Schools (NOT the OTA Total Academy screen) */}
        {otherSchoolLoading && (
            <div className="fixed inset-0 z-[10000] bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-200">
                <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center mb-4">
                    <SchoolIcon size={32} className="animate-pulse" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Opening {otherSchoolLoading} Portal</h3>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 size={14} className="animate-spin text-blue-400" />
                    <span>Configuring school workspace...</span>
                </div>
            </div>
        )}

        {/* Tutorial Overlay */}
        {showTutorial && <TutorialOverlay onComplete={() => setShowTutorial(false)} />}
        
        {/* About Us Modal */}
        {showAbout && <AboutUsModal onClose={() => setShowAbout(false)} />}

        {/* Main App Content */}
        {renderContent()}
        
        {/* Persistent UI Elements */}
        
        {/* Cloud Sync Status (Top Right) */}
        {!showOtaSplash && (
            <div className={`fixed top-4 right-4 z-[9000] transition-all duration-300 pointer-events-none ${isSyncing ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
                <div className="bg-white/90 backdrop-blur border border-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 text-xs font-bold">
                    <RefreshCw size={12} className="animate-spin"/> Cloud Syncing...
                </div>
            </div>
        )}

        {/* Floating About Us Button (Only on Public / Auth Views, and cleanly hidden on mobile when logged in) */}
        {!showOtaSplash && !showAbout && !role && (
            <button 
                onClick={() => setShowAbout(true)}
                className="hidden sm:flex fixed bottom-6 right-6 z-[8000] bg-white text-slate-900 px-4 py-3 rounded-2xl font-bold text-xs shadow-xl border border-slate-200 hover:border-blue-400 hover:scale-105 active:scale-95 transition-all items-center gap-2 group"
            >
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center transition-colors">
                    <Info size={14}/> 
                </div>
                About Pentric
            </button>
        )}
      </>
  );
};

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Application Error Caught]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mb-4 border border-amber-500/30">
            <AlertOctagon size={32} />
          </div>
          <h2 className="text-xl font-bold mb-2">Workspace Resiliency Recovery</h2>
          <p className="text-slate-400 text-sm max-w-md mb-6">
            The timetable environment encountered a client refresh event. Your persistent data remains saved.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition shadow-lg cursor-pointer"
          >
            Reload Timetable System
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById("root")!;
let root = (container as any)._reactRoot;
if (!root) {
  root = createRoot(container);
  (container as any)._reactRoot = root;
}
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
