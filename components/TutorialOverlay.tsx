
import React, { useState } from 'react';
import { storage } from '../services/storage';
import { ArrowRight, Check, Zap, Shield, Users, Globe } from 'lucide-react';

interface Props {
    onComplete: () => void;
}

export const TutorialOverlay: React.FC<Props> = ({ onComplete }) => {
    const [step, setStep] = useState(0);

    const handleNext = () => {
        if (step < 3) setStep(step + 1);
        else {
            storage.setAppWalkthroughSeen();
            onComplete();
        }
    };

    const steps = [
        {
            title: "Welcome to Pentric",
            desc: "The comprehensive academic scheduling management system created by PPF Innovations and Technology Group.",
            icon: <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg animate-bounce"><Zap size={40}/></div>
        },
        {
            title: "Choose Your Role",
            desc: "Log in as an Admin to generate schedules, or as Faculty to view your classes and chat.",
            icon: <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg"><Shield size={40}/></div>
        },
        {
            title: "Live Cloud Sync",
            desc: "Changes happen instantly across devices. It works like a shared cloud storage system—updated in real-time.",
            icon: <div className="w-20 h-20 bg-purple-500 rounded-full flex items-center justify-center text-white shadow-lg"><Globe size={40}/></div>
        },
        {
            title: "You're All Set!",
            desc: "Explore the system, manage timetables, and collaborate with your team.",
            icon: <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center text-white shadow-lg"><Check size={40}/></div>
        }
    ];

    return (
        <div className="fixed inset-0 z-[99999] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-500">
            <div className="bg-white max-w-md w-full rounded-[2.5rem] p-10 text-center shadow-2xl relative overflow-hidden animate-in zoom-in-95">
                <div className="absolute top-0 left-0 w-full h-2 bg-slate-100">
                    <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${((step + 1) / 4) * 100}%` }}></div>
                </div>

                <div className="flex justify-center mb-8 mt-4">
                    {steps[step].icon}
                </div>

                <h2 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">{steps[step].title}</h2>
                <p className="text-slate-500 text-lg leading-relaxed mb-10 h-20">
                    {steps[step].desc}
                </p>

                <button 
                    onClick={handleNext}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold text-lg hover:bg-slate-800 transition-transform active:scale-95 shadow-xl flex items-center justify-center gap-2"
                >
                    {step === 3 ? "Let's Go" : "Next"} <ArrowRight size={20}/>
                </button>
                
                <div className="mt-6 flex justify-center gap-2">
                    {[0,1,2,3].map(i => (
                        <div key={i} className={`w-2 h-2 rounded-full transition-all duration-300 ${i === step ? 'bg-blue-600 w-6' : 'bg-slate-200'}`}></div>
                    ))}
                </div>
            </div>
        </div>
    );
};
