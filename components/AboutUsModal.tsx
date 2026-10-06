import React from 'react';
import { X, Sparkles, CheckCircle2, Shield, Calendar, Users, Cpu, Layers } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export const AboutUsModal: React.FC<Props> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-300 backdrop-blur-md bg-slate-950/70">
      <div className="w-full max-w-4xl bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Top Header */}
        <div className="p-8 md:p-10 border-b border-slate-100 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
          
          <button 
            onClick={onClose} 
            className="absolute top-6 right-6 p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all cursor-pointer backdrop-blur-md"
            title="Close modal"
          >
            <X size={20} />
          </button>

          <div className="relative z-10 space-y-3">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-white/10 text-blue-300 border border-white/10">
              <Sparkles size={13} /> Official System Overview
            </div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight">
              About Pentric
            </h1>
            <p className="text-slate-300 text-sm md:text-base font-medium max-w-xl">
              Created by <span className="text-white font-bold">PPF Innovations and Technology Group</span>
            </p>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-8 md:p-10 overflow-y-auto space-y-8 text-slate-700 leading-relaxed text-sm md:text-base">
          
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">What is Pentric?</h2>
            <p>
              <strong>Pentric</strong> is a comprehensive school timetable management system designed to help schools organize and manage their academic schedule operations in a structured, practical, and dependable way.
            </p>
            <p className="text-slate-600 text-sm">
              From curriculum planning and teacher availability mapping to conflict-free automated scheduling and multi-school administrative governance, Pentric simplifies complex institutional logistics so educators can focus on teaching.
            </p>
          </div>

          <div className="p-6 bg-slate-50 border border-slate-200 rounded-3xl space-y-3">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <CheckCircle2 size={18} className="text-blue-600" />
              Engineering & Development Commitment
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              This application represents extensive planning, development, real-world testing, problem-solving, and continuous refinement. Through multiple iterations of algorithmic optimization and feedback, Pentric has reached a completed, stable, and production-ready stage built for daily academic use.
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">Core Capabilities</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
                  <Calendar size={16} className="text-blue-600" /> Constraint Scheduling
                </div>
                <p className="text-xs text-slate-500">
                  Strict clash prevention ensuring no teacher or classroom is double-booked across Monday–Friday time periods.
                </p>
              </div>

              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
                  <Users size={16} className="text-indigo-600" /> Faculty Management
                </div>
                <p className="text-xs text-slate-500">
                  Two-tier verification, profile management, period swap requests, and individual teacher timetable access.
                </p>
              </div>

              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
                  <Layers size={16} className="text-emerald-600" /> Multi-School Registry
                </div>
                <p className="text-xs text-slate-500">
                  Support for distinct educational institutions with custom branding, accreditation numbers, and isolated data.
                </p>
              </div>

              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
                  <Shield size={16} className="text-amber-600" /> Data Safety & Reliability
                </div>
                <p className="text-xs text-slate-500">
                  Resilient local persistence paired with seamless cloud synchronization for real-time multi-device collaboration.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <strong>Pentric Production Release</strong> • Built by PPF Innovations and Technology Group
            </div>
            <button
              onClick={onClose}
              className="px-5 py-2 bg-slate-900 text-white font-bold rounded-xl text-xs hover:bg-slate-800 transition cursor-pointer"
            >
              Close
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
