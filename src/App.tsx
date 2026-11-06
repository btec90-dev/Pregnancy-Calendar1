import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PREGNANCY_WEEKS, PregnancyWeekData } from './weeksData';
import { ConfettiCanvas, ConfettiCanvasRef } from './ConfettiCanvas';
import { exportJournalToPdf } from './utils/pdfExport';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, addDoc, deleteDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}


declare global {
  interface Window {
    PREGNANCY_WEEKS: PregnancyWeekData[];
    currentActiveWeek: number;
    selectWeekDirect?: (w: number, triggerAudio?: boolean) => void;
    triggerMainNarrationClick?: () => void;
    replayNarrationCurrentWeek?: () => void;
    speakCurrentWeekSection?: (sectionKey: 'inUtero' | 'morpho' | 'steps' | 'advice') => void;
    updateFetus3DScale?: (week: number) => void;
    toggleVideoPlayback?: () => boolean;
    webkitAudioContext?: typeof AudioContext;
  }
}

function generateFrenchNarrationText(data: PregnancyWeekData): string {
  return (
    `Semaine ${data.week} de votre grossesse. ` +
    `Votre petit garçon mesure environ ${data.metrics}, ce qui correspond à la taille d'une ${data.fruit.toLowerCase()}. ` +
    `Développement in utero : ${data.inUtero} ` +
    `Sur le plan morphologique : ${data.morpho} ` +
    `Conseil de bien-être : ${data.advice}`
  );
}

function getDoorColor(w: number): string {
  if (w <= 13) return 'bg-[#c9dbc9] text-[#2c3d2c] border-[#a5bea5]';
  if (w <= 27) return 'bg-[#f6d2c1] text-[#4d2c1e] border-[#e2b49e]';
  return 'bg-[#f7e0b2] text-[#493517] border-[#e4c489]';
}

const JOURNAL_STORAGE_KEY = 'pregnancy_calendar_journal_fatou';
const JOURNAL_LAST_SAVED_KEY = 'pregnancy_calendar_journal_last_saved';
const CHECKLISTS_STORAGE_KEY = 'pregnancy_calendar_checklists_fatou';
const SNAPSHOTS_STORAGE_KEY = 'pregnancy_calendar_snapshots';
const APPOINTMENTS_STORAGE_KEY = 'pregnancy_calendar_appointments';

export interface PatientIvfFile {
  clinicName: string;
  clinicAddress: string;
  embryologyLab: string;
  embryologist: string;
  surgicalFacility: string;
  surgicalAddress: string;
  intervention: string;
  eggsRetrieved: string;
  matureFertilized: string;
  biopsiedVitrified: string;
  pgtaResult: string;
  medication: string;
  medStartDate: string;
  medPurpose: string;
  notesSummary: string;
}

const DEFAULT_IVF_FILE: PatientIvfFile = {
  clinicName: "RMA — East Side",
  clinicAddress: "635 Madison Ave, 10th Floor, New York, NY",
  embryologyLab: "RMA Manhattan Embryology Laboratory",
  embryologist: "Alex",
  surgicalFacility: "Gramercy Surgery Center",
  surgicalAddress: "380 2nd Avenue, Suite 1000, 10th Floor, New York, NY 10010",
  intervention: "Hysteroscopy for intrauterine debris removal completed on October 28, 2026.",
  eggsRetrieved: "42 oocytes (Oct 1, 2026)",
  matureFertilized: "34 / 11 (Oct 2, 2026)",
  biopsiedVitrified: "8 blastocysts (Oct 9, 2026)",
  pgtaResult: "5 embryos came back genetically normal (euploid) as confirmed on October 26, 2026. 💙",
  medication: "Estrace 2 mg PO AM & PM",
  medStartDate: "November 6, 2026",
  medPurpose: "Endometrial lining preparation and hormonal optimization prior to the Frozen Embryo Transfer (FET).",
  notesSummary: "Nov 6, 2026: Started Estrace 2 mg PO AM & PM today for endometrial lining preparation. Oct 26, 2026: Received PGT-A results today! 5 of the embryos came back genetically normal (euploid). Oct 15, 2026: Saline Infusion Sonogram completed at RMA East Side @ 8:00 AM."
};

export type AppointmentCategory = 'echo' | 'consultation' | 'labo' | 'prep' | 'autre';

export interface CustomAppointment {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  practitioner?: string;
  notes?: string;
  category: AppointmentCategory;
  completed: boolean;
  createdAt: number;
}

const DEFAULT_APPOINTMENTS: CustomAppointment[] = [
  {
    id: 'apt-default-1',
    title: 'Échographie T1 (Clarté nucale & DPNI)',
    date: '2026-11-18',
    time: '09:30',
    practitioner: 'Cabinet RMA of New York · Dr. Laurent',
    notes: 'Mesure de clarté nucale et prise de sang pour marqueurs sériques',
    category: 'echo',
    completed: true,
    createdAt: 1700000000000
  },
  {
    id: 'apt-default-2',
    title: 'Consultation Obstétrique du 4ème mois',
    date: '2026-12-16',
    time: '14:00',
    practitioner: 'Maternité & Centre Prénatal',
    notes: 'Examen de routine, hauteur utérine & doppler fœtal',
    category: 'consultation',
    completed: false,
    createdAt: 1700000001000
  },
  {
    id: 'apt-default-3',
    title: 'Échographie Morphologique T2 (Niveau II)',
    date: '2027-01-27',
    time: '11:15',
    practitioner: 'Centre d\'Imagerie Diagnostique Fœtale',
    notes: 'Examen morphologique complet des organes du petit prince (46, XY)',
    category: 'echo',
    completed: false,
    createdAt: 1700000002000
  },
  {
    id: 'apt-default-4',
    title: 'Bilan de dépistage glycémie (HGPO 75g)',
    date: '2027-03-03',
    time: '08:00',
    practitioner: 'Laboratoire d\'Analyses Médicales',
    notes: 'À jeun strict depuis la veille pour le test du diabète gestationnel',
    category: 'labo',
    completed: false,
    createdAt: 1700000003000
  }
];

function formatAppointmentDate(dateStr: string): string {
  try {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    return d.toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

function getRelativeDateLabel(dateStr: string): { label: string; isPast: boolean; isToday: boolean } {
  try {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return { label: '', isPast: false, isToday: false };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const target = new Date(year, month, day);

    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return { label: "Aujourd'hui", isPast: false, isToday: true };
    if (diffDays === 1) return { label: 'Demain', isPast: false, isToday: false };
    if (diffDays > 1) return { label: `Dans ${diffDays} j`, isPast: false, isToday: false };
    if (diffDays === -1) return { label: 'Hier', isPast: true, isToday: false };
    return { label: `Il y a ${Math.abs(diffDays)} j`, isPast: true, isToday: false };
  } catch {
    return { label: '', isPast: false, isToday: false };
  }
}

export interface FetalSnapshot {
  id: string;
  week: number;
  fruit: string;
  metrics: string;
  heartRate: number;
  dateStr: string;
  timestamp: number;
  dataUrl: string;
  viewMode: '3d' | 'art';
}

const DUE_DATE = new Date('2027-07-22T00:00:00');

interface CountdownRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isTerme: boolean;
}

function calculateCountdown(): CountdownRemaining {
  const now = new Date();
  const diffMs = DUE_DATE.getTime() - now.getTime();
  if (diffMs <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isTerme: true };
  }
  const totalSeconds = Math.floor(diffMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, isTerme: false };
}

export function App() {
  const [currentWeek, setCurrentWeek] = useState<number>(12);
  const [countdown, setCountdown] = useState<CountdownRemaining>(calculateCountdown);
  const [autoPlayVoice, setAutoPlayVoice] = useState<boolean>(true);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [voiceLabel, setVoiceLabel] = useState<string>('Voix : Humaine naturelle (fr-FR)');
  const [transcriptionWords, setTranscriptionWords] = useState<string[]>(() =>
    generateFrenchNarrationText(PREGNANCY_WEEKS[11])
      .split(/\s+/)
      .filter((w) => w.trim().length > 0)
  );
  const [activeWordIdx, setActiveWordIdx] = useState<number>(-1);
  const [allWordsPast, setAllWordsPast] = useState<boolean>(false);

  const [viewMode, setViewMode] = useState<'3d' | 'art'>('3d');
  const [isVideoPlaying, setIsVideoPlaying] = useState<boolean>(true);
  const [videoScrubberVal, setVideoScrubberVal] = useState<number>(30);
  const [isDopplerPlaying, setIsDopplerPlaying] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<'module-fet' | 'module-timeline' | 'module-checklists' | 'module-journal' | 'module-ivf-file'>('module-ivf-file');
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
  const [userEmail, setUserEmail] = useState<string>('410bala@gmail.com');
  const [isGmailLoggedIn, setIsGmailLoggedIn] = useState<boolean>(true);
  const [showGmailModal, setShowGmailModal] = useState<boolean>(false);
  const [loginInputEmail, setLoginInputEmail] = useState<string>('410bala@gmail.com');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [userStatus, setUserStatus] = useState<'active' | 'pending'>('active');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (user && user.email) {
        setUserEmail(user.email);
        setIsGmailLoggedIn(true);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (result.user && result.user.email) {
        setUserEmail(result.user.email);
        setIsGmailLoggedIn(true);
        setShowGmailModal(false);
        setIvfSaveToast(language === 'en' ? 'Successfully connected with Gmail!' : 'Connecté avec succès via Gmail !');
        setTimeout(() => setIvfSaveToast(null), 3500);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'auth');
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await signOut(auth);
      setFirebaseUser(null);
      setIsGmailLoggedIn(false);
      setUserEmail('invite@gmail.com');
      setIvfSaveToast(language === 'en' ? 'Gmail account successfully disconnected.' : 'Compte Gmail déconnecté avec succès.');
      setTimeout(() => setIvfSaveToast(null), 3500);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'auth');
    }
  };

  const handleRemoveMyInfo = useCallback(async () => {
    if (window.confirm(language === 'en' ? 'Are you sure you want to remove all your personal info, journal entries, and snapshots from this app?' : 'Êtes-vous sûr de vouloir supprimer toutes vos informations personnelles, notes de journal et captures de cette application ?')) {
      try {
        localStorage.removeItem('pregnancy_calendar_journal_fatou');
        localStorage.removeItem('pregnancy_calendar_ivf_file_fatou');
        localStorage.removeItem('pregnancy_calendar_week_overrides_fatou');
        localStorage.removeItem('pregnancy_calendar_snapshots');
        localStorage.removeItem('pregnancy_calendar_appointments');
        localStorage.removeItem('pregnancy_calendar_checklists_fatou');
        localStorage.removeItem('pregnancy_calendar_journal_last_saved');

        setJournalText('');
        setIvfFile(DEFAULT_IVF_FILE);
        setWeekOverrides({});
        setSnapshots([]);
        setAppointments(DEFAULT_APPOINTMENTS);
        setChecklists([true, true, true, false]);
        setUserEmail('invite@gmail.com');
        setIsGmailLoggedIn(false);

        await signOut(auth);
        setFirebaseUser(null);

        setIvfSaveToast(language === 'en' ? 'All personal info successfully removed from this app.' : 'Toutes vos informations personnelles ont été supprimées avec succès de l\'application.');
        setTimeout(() => setIvfSaveToast(null), 4000);
      } catch (err) {
        console.error('Error removing user info:', err);
      }
    }
  }, [language]);

  const IVF_FILE_STORAGE_KEY = 'pregnancy_calendar_ivf_file_fatou';
  const WEEK_OVERRIDES_STORAGE_KEY = 'pregnancy_calendar_week_overrides_fatou';

  const [ivfFile, setIvfFile] = useState<PatientIvfFile>(() => {
    try {
      const saved = localStorage.getItem(IVF_FILE_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_IVF_FILE;
  });

  const [weekOverrides, setWeekOverrides] = useState<Record<number, Partial<PregnancyWeekData>>>(() => {
    try {
      const saved = localStorage.getItem(WEEK_OVERRIDES_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const [isEditingActiveWeek, setIsEditingActiveWeek] = useState<boolean>(false);
  const [editWeekTitle, setEditWeekTitle] = useState<string>('');
  const [editWeekDates, setEditWeekDates] = useState<string>('');
  const [editWeekFruit, setEditWeekFruit] = useState<string>('');
  const [editWeekMetrics, setEditWeekMetrics] = useState<string>('');
  const [editWeekMorpho, setEditWeekMorpho] = useState<string>('');
  const [editWeekInUtero, setEditWeekInUtero] = useState<string>('');
  const [editWeekAdvice, setEditWeekAdvice] = useState<string>('');
  const [ivfSaveToast, setIvfSaveToast] = useState<string | null>(null);
  const [isEditingIvfFile, setIsEditingIvfFile] = useState<boolean>(false);
  const [editClinicName, setEditClinicName] = useState<string>(ivfFile.clinicName);
  const [editClinicAddress, setEditClinicAddress] = useState<string>(ivfFile.clinicAddress);
  const [editEmbryologyLab, setEditEmbryologyLab] = useState<string>(ivfFile.embryologyLab);
  const [editEmbryologist, setEditEmbryologist] = useState<string>(ivfFile.embryologist);
  const [editSurgicalFacility, setEditSurgicalFacility] = useState<string>(ivfFile.surgicalFacility);
  const [editSurgicalAddress, setEditSurgicalAddress] = useState<string>(ivfFile.surgicalAddress);
  const [editIntervention, setEditIntervention] = useState<string>(ivfFile.intervention);
  const [editEggsRetrieved, setEditEggsRetrieved] = useState<string>(ivfFile.eggsRetrieved);
  const [editMatureFertilized, setEditMatureFertilized] = useState<string>(ivfFile.matureFertilized);
  const [editBiopsiedVitrified, setEditBiopsiedVitrified] = useState<string>(ivfFile.biopsiedVitrified);
  const [editPgtaResult, setEditPgtaResult] = useState<string>(ivfFile.pgtaResult);
  const [editMedication, setEditMedication] = useState<string>(ivfFile.medication);
  const [editMedStartDate, setEditMedStartDate] = useState<string>(ivfFile.medStartDate);
  const [editMedPurpose, setEditMedPurpose] = useState<string>(ivfFile.medPurpose);
  const [editNotesSummary, setEditNotesSummary] = useState<string>(ivfFile.notesSummary);

  const handleSaveIvfFileForm = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const updated: PatientIvfFile = {
      clinicName: editClinicName,
      clinicAddress: editClinicAddress,
      embryologyLab: editEmbryologyLab,
      embryologist: editEmbryologist,
      surgicalFacility: editSurgicalFacility,
      surgicalAddress: editSurgicalAddress,
      intervention: editIntervention,
      eggsRetrieved: editEggsRetrieved,
      matureFertilized: editMatureFertilized,
      biopsiedVitrified: editBiopsiedVitrified,
      pgtaResult: editPgtaResult,
      medication: editMedication,
      medStartDate: editMedStartDate,
      medPurpose: editMedPurpose,
      notesSummary: editNotesSummary,
    };
    setIvfFile(updated);
    try {
      localStorage.setItem(IVF_FILE_STORAGE_KEY, JSON.stringify(updated));
    } catch {}
    setIsEditingIvfFile(false);
    setIvfSaveToast(language === 'en' ? 'Patient file successfully saved & synced!' : 'Dossier patient enregistré et synchronisé avec succès !');
    setTimeout(() => setIvfSaveToast(null), 3500);
  }, [editBiopsiedVitrified, editClinicAddress, editClinicName, editEggsRetrieved, editEmbryologist, editEmbryologyLab, editIntervention, editMatureFertilized, editMedStartDate, editMedication, editMedPurpose, editNotesSummary, editPgtaResult, editSurgicalAddress, editSurgicalFacility, language]);
  const [checklists, setChecklists] = useState<boolean[]>(() => {
    try {
      const saved = localStorage.getItem(CHECKLISTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === 4) return parsed;
      }
    } catch {
      // fallback
    }
    return [true, true, true, false];
  });
  const [journalText, setJournalText] = useState<string>(() => {
    try {
      return localStorage.getItem(JOURNAL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [journalLastSaved, setJournalLastSaved] = useState<string | null>(() => {
    try {
      return localStorage.getItem(JOURNAL_LAST_SAVED_KEY);
    } catch {
      return null;
    }
  });
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [pdfExportSuccess, setPdfExportSuccess] = useState<boolean>(false);

  const [snapshots, setSnapshots] = useState<FetalSnapshot[]>(() => {
    try {
      const saved = localStorage.getItem(SNAPSHOTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.warn('Erreur chargement snapshots:', err);
    }
    return [];
  });
  const [selectedSnapshot, setSelectedSnapshot] = useState<FetalSnapshot | null>(null);
  const [snapshotFeedback, setSnapshotFeedback] = useState<string | null>(null);
  const [isTakingSnapshot, setIsTakingSnapshot] = useState<boolean>(false);

  const [appointments, setAppointments] = useState<CustomAppointment[]>(() => {
    try {
      const saved = localStorage.getItem(APPOINTMENTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.warn('Erreur chargement rendez-vous :', err);
    }
    return DEFAULT_APPOINTMENTS;
  });

  const [aptFormDate, setAptFormDate] = useState<string>('');
  const [aptFormTitle, setAptFormTitle] = useState<string>('');
  const [aptFormTime, setAptFormTime] = useState<string>('');
  const [aptFormDoctor, setAptFormDoctor] = useState<string>('');
  const [aptFormNotes, setAptFormNotes] = useState<string>('');
  const [aptFormCategory, setAptFormCategory] = useState<AppointmentCategory>('consultation');
  const [isAptFormOpen, setIsAptFormOpen] = useState<boolean>(false);
  const [aptFilter, setAptFilter] = useState<'all' | 'upcoming' | 'completed'>('all');
  const [aptFeedback, setAptFeedback] = useState<string | null>(null);

  const sortedAppointments = React.useMemo(() => {
    return [...appointments].sort((a, b) => {
      const keyA = `${a.date}T${a.time || '00:00'}`;
      const keyB = `${b.date}T${b.time || '00:00'}`;
      return keyA.localeCompare(keyB);
    });
  }, [appointments]);

  const filteredAppointments = React.useMemo(() => {
    if (aptFilter === 'all') return sortedAppointments;
    if (aptFilter === 'completed') return sortedAppointments.filter((a) => a.completed);
    return sortedAppointments.filter((a) => !a.completed);
  }, [sortedAppointments, aptFilter]);

  const handleAddAppointment = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!aptFormDate || !aptFormTitle.trim()) return;

    const newApt: CustomAppointment = {
      id: 'apt-' + Date.now(),
      title: aptFormTitle.trim(),
      date: aptFormDate,
      time: aptFormTime ? aptFormTime.trim() : undefined,
      practitioner: aptFormDoctor.trim() ? aptFormDoctor.trim() : undefined,
      notes: aptFormNotes.trim() ? aptFormNotes.trim() : undefined,
      category: aptFormCategory,
      completed: false,
      createdAt: Date.now()
    };

    setAppointments((prev) => {
      const updated = [...prev, newApt];
      try {
        localStorage.setItem(APPOINTMENTS_STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.warn('Erreur sauvegarde rdv:', err);
      }
      return updated;
    });

    setAptFormTitle('');
    setAptFormDate('');
    setAptFormTime('');
    setAptFormDoctor('');
    setAptFormNotes('');
    setIsAptFormOpen(false);
    setAptFeedback('Rendez-vous ajouté et classé chronologiquement !');
    window.setTimeout(() => setAptFeedback(null), 3500);
  }, [aptFormCategory, aptFormDate, aptFormDoctor, aptFormNotes, aptFormTime, aptFormTitle]);

  const handleToggleAppointment = useCallback((id: string) => {
    setAppointments((prev) => {
      const updated = prev.map((a) => (a.id === id ? { ...a, completed: !a.completed } : a));
      try {
        localStorage.setItem(APPOINTMENTS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const handleDeleteAppointment = useCallback((id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setAppointments((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      try {
        localStorage.setItem(APPOINTMENTS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const threeContainerRef = useRef<HTMLDivElement | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const updateFetusScaleRef = useRef<((week: number) => void) | null>(null);
  const takeViewerSnapshotRef = useRef<(() => string | null) | null>(null);
  const isPlayingRef = useRef<boolean>(true);
  const heartRateRef = useRef<number>(158);
  const confettiRef = useRef<ConfettiCanvasRef | null>(null);
  const prevWeekRef = useRef<number>(12);

  const karaokeIntervalRef = useRef<number | null>(null);
  const dopplerAudioCtxRef = useRef<AudioContext | null>(null);
  const dopplerIntervalRef = useRef<number | null>(null);
  const frenchVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const activeData = PREGNANCY_WEEKS[currentWeek - 1] || PREGNANCY_WEEKS[11];
  const currentBpm = activeData.heartRate || 158;
  heartRateRef.current = currentBpm;

  const loadAndSelectFrenchVoice = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    try {
      const availableVoices = window.speechSynthesis.getVoices() || [];
      if (availableVoices.length > 0) {
        const frVoices = availableVoices.filter(
          (v) =>
            v.lang &&
            (v.lang.toLowerCase() === 'fr-fr' ||
              v.lang.toLowerCase() === 'fr_fr' ||
              v.lang.toLowerCase().startsWith('fr'))
        );

        const maleKeywords = /thomas|nicolas|paul|antoine|henri|mathieu|claude|bernard|guy|male|homme|google\s*français/i;
        const femaleKeywords = /hortense|julie|celine|céline|audrey|amelie|amélie|denise|virginie|charlotte|marie|female|femme/i;

        const maleVoiceCandidates = frVoices.filter(
          (v) => maleKeywords.test(v.name) && !femaleKeywords.test(v.name)
        );
        const nonFemaleVoices = frVoices.filter((v) => !femaleKeywords.test(v.name));

        const chosen =
          maleVoiceCandidates[0] ||
          nonFemaleVoices.find((v) => v.lang.toLowerCase() === 'fr-fr') ||
          frVoices.find((v) => v.lang.toLowerCase() === 'fr-fr') ||
          frVoices[0] ||
          null;

        frenchVoiceRef.current = chosen;

        if (chosen) {
          const cleanName = chosen.name
            .replace(/Microsoft|Google|Apple/gi, '')
            .trim()
            .substring(0, 16);
          setVoiceLabel(`Voix : ${cleanName || 'Masculine'} (fr-FR)`);
        } else {
          setVoiceLabel('Voix : Masculine (fr-FR)');
        }
      }
    } catch (err) {
      console.warn('Erreur chargement des voix :', err);
    }
    return frenchVoiceRef.current;
  }, []);

  useEffect(() => {
    window.PREGNANCY_WEEKS = PREGNANCY_WEEKS;
    window.currentActiveWeek = currentWeek;
  }, [currentWeek]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      loadAndSelectFrenchVoice();
      window.speechSynthesis.onvoiceschanged = loadAndSelectFrenchVoice;
    }
    return () => {
      if (karaokeIntervalRef.current) window.clearInterval(karaokeIntervalRef.current);
      if (dopplerIntervalRef.current) window.clearInterval(dopplerIntervalRef.current);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [loadAndSelectFrenchVoice]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown(calculateCountdown());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clearKaraokeTimer = useCallback(() => {
    if (karaokeIntervalRef.current) {
      window.clearInterval(karaokeIntervalRef.current);
      karaokeIntervalRef.current = null;
    }
  }, []);

  const stopNarration = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    clearKaraokeTimer();
    setIsSpeaking(false);
    setActiveWordIdx(-1);
    setAllWordsPast(false);
  }, [clearKaraokeTimer]);

  const playGentleNarratorChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(554.37, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // Ignorer si bloqué
    }
  }, []);

  const startKaraokeFallback = useCallback(
    (words: string[]) => {
      clearKaraokeTimer();
      setIsSpeaking(true);
      setAllWordsPast(false);
      let step = 0;
      karaokeIntervalRef.current = window.setInterval(() => {
        if (step < words.length) {
          setActiveWordIdx(step);
          const el = document.getElementById(`kw-${step}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          step++;
        } else {
          clearKaraokeTimer();
          setIsSpeaking(false);
          setActiveWordIdx(-1);
          setAllWordsPast(true);
        }
      }, 390);
    },
    [clearKaraokeTimer]
  );

  const speakTextWithKaraoke = useCallback(
    (fullText: string) => {
      clearKaraokeTimer();
      playGentleNarratorChime();

      const words = fullText.split(/\s+/).filter((w) => w.trim().length > 0);
      setTranscriptionWords(words);
      setActiveWordIdx(-1);
      setAllWordsPast(false);

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }

          const chosenVoice = loadAndSelectFrenchVoice();
          const utterance = new SpeechSynthesisUtterance(fullText);
          utterance.lang = 'fr-FR';
          utterance.rate = 0.83;
          utterance.pitch = 0.92;
          if (chosenVoice) {
            utterance.voice = chosenVoice;
          }

          let wordCounter = 0;
          const totalWords = words.length;

          utterance.onboundary = (event) => {
            if (event.name === 'word') {
              setActiveWordIdx(wordCounter);
              const el = document.getElementById(`kw-${wordCounter}`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              wordCounter = Math.min(totalWords - 1, wordCounter + 1);
            }
          };

          utterance.onstart = () => {
            setIsSpeaking(true);
            if (!karaokeIntervalRef.current) {
              let step = 0;
              karaokeIntervalRef.current = window.setInterval(() => {
                if (step < totalWords) {
                  setActiveWordIdx(step);
                  const el = document.getElementById(`kw-${step}`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  step++;
                } else {
                  clearKaraokeTimer();
                }
              }, 390);
            }
          };

          utterance.onend = () => {
            clearKaraokeTimer();
            setIsSpeaking(false);
            setActiveWordIdx(-1);
            setAllWordsPast(true);
          };

          utterance.onerror = () => {
            startKaraokeFallback(words);
          };

          window.speechSynthesis.speak(utterance);
          return;
        } catch {
          // Bascule fallback
        }
      }

      startKaraokeFallback(words);
    },
    [clearKaraokeTimer, loadAndSelectFrenchVoice, playGentleNarratorChime, startKaraokeFallback]
  );

  const playNarrationForWeek = useCallback(
    (weekNum: number) => {
      const data = PREGNANCY_WEEKS[weekNum - 1];
      if (!data) return;
      const fullText = generateFrenchNarrationText(data);
      speakTextWithKaraoke(fullText);
    },
    [speakTextWithKaraoke]
  );

  const selectWeek = useCallback(
    (weekNum: number, triggerAudio = false, forceCelebrate = false) => {
      const clamped = Math.max(1, Math.min(40, weekNum));
      const wasNotTerme = prevWeekRef.current !== 40;
      prevWeekRef.current = clamped;

      setCurrentWeek(clamped);
      window.currentActiveWeek = clamped;
      setVideoScrubberVal(Math.round((clamped / 40) * 100));

      if (clamped === 40 && (wasNotTerme || forceCelebrate)) {
        confettiRef.current?.fire('🎉 Félicitations ! Le Terme clinique est atteint (S40 · 22 Juillet 2027) !');
      }

      const data = PREGNANCY_WEEKS[clamped - 1];
      if (!data) return;

      const fullNarration = generateFrenchNarrationText(data);
      const words = fullNarration.split(/\s+/).filter((w) => w.trim().length > 0);
      setTranscriptionWords(words);
      setActiveWordIdx(-1);
      setAllWordsPast(false);

      if (updateFetusScaleRef.current) {
        updateFetusScaleRef.current(clamped);
      }

      const doorEl = document.querySelector(`.door-item[data-week="${clamped}"]`);
      doorEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      if (triggerAudio || isSpeaking) {
        playNarrationForWeek(clamped);
      }
    },
    [isSpeaking, playNarrationForWeek]
  );

  const triggerMainNarrationClick = useCallback(() => {
    if (isSpeaking) {
      stopNarration();
    } else {
      playNarrationForWeek(currentWeek);
    }
  }, [currentWeek, isSpeaking, playNarrationForWeek, stopNarration]);

  const replayNarrationCurrentWeek = useCallback(() => {
    stopNarration();
    window.setTimeout(() => {
      playNarrationForWeek(currentWeek);
    }, 60);
  }, [currentWeek, playNarrationForWeek, stopNarration]);

  const speakCurrentWeekSection = useCallback(
    (sectionKey: 'inUtero' | 'morpho' | 'steps' | 'advice') => {
      const data = PREGNANCY_WEEKS[currentWeek - 1];
      if (!data) return;
      stopNarration();

      let textToRead = '';
      if (sectionKey === 'inUtero') textToRead = `Semaine ${data.week}, développement in utero. ` + data.inUtero;
      else if (sectionKey === 'morpho') textToRead = `Semaine ${data.week}, morphologie et croissance. ` + data.morpho;
      else if (sectionKey === 'steps') textToRead = `Semaine ${data.week}, démarches cliniques et suivi. ` + data.steps.join('. ');
      else if (sectionKey === 'advice') textToRead = `Semaine ${data.week}, conseil de bien-être. ` + data.advice;

      speakTextWithKaraoke(textToRead);
    },
    [currentWeek, speakTextWithKaraoke, stopNarration]
  );

  const handleToggleChecklist = useCallback((idx: number) => {
    setChecklists((prev) => {
      const next = prev.map((v, i) => (i === idx ? !v : v));
      try {
        localStorage.setItem(CHECKLISTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      const wasAllComplete = prev.every(Boolean);
      const isAllComplete = next.every(Boolean);
      if (!wasAllComplete && isAllComplete) {
        confettiRef.current?.fire('🎉 Bravo ! Tous les engagements cliniques de la check-list sont validés !');
      }
      return next;
    });
  }, []);

  const handleJournalChange = useCallback((text: string) => {
    setJournalText(text);
    try {
      localStorage.setItem(JOURNAL_STORAGE_KEY, text);
      const nowStr = new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      localStorage.setItem(JOURNAL_LAST_SAVED_KEY, nowStr);
      setJournalLastSaved(nowStr);
    } catch (e) {
      console.warn('Erreur lors de la sauvegarde locale du carnet :', e);
    }
  }, []);

  const handleExportPdf = useCallback(() => {
    setIsExportingPdf(true);
    try {
      exportJournalToPdf({
        week: currentWeek,
        weekData: activeData,
        journalText,
        checklists,
        appointments: sortedAppointments,
      });
      setPdfExportSuccess(true);
      window.setTimeout(() => setPdfExportSuccess(false), 3500);
    } catch (err) {
      console.error("Erreur lors de l'exportation PDF :", err);
    } finally {
      setIsExportingPdf(false);
    }
  }, [activeData, checklists, currentWeek, journalText, sortedAppointments]);

  useEffect(() => {
    window.selectWeekDirect = (w: number, triggerAudio = true, forceCelebrate = false) => selectWeek(w, triggerAudio, forceCelebrate);
    window.triggerMainNarrationClick = triggerMainNarrationClick;
    window.replayNarrationCurrentWeek = replayNarrationCurrentWeek;
    window.speakCurrentWeekSection = speakCurrentWeekSection;
  }, [replayNarrationCurrentWeek, selectWeek, speakCurrentWeekSection, triggerMainNarrationClick]);

  // Doppler heartbeat synthesizer
  const toggleDopplerHeartbeat = useCallback(() => {
    if (isDopplerPlaying) {
      if (dopplerIntervalRef.current) {
        window.clearInterval(dopplerIntervalRef.current);
        dopplerIntervalRef.current = null;
      }
      setIsDopplerPlaying(false);
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!dopplerAudioCtxRef.current) {
        dopplerAudioCtxRef.current = new AudioCtx();
      }
      if (dopplerAudioCtxRef.current.state === 'suspended') {
        dopplerAudioCtxRef.current.resume();
      }

      setIsDopplerPlaying(true);

      const playThump = (freq: number, duration: number, gainVal: number) => {
        const ctx = dopplerAudioCtxRef.current;
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(32, ctx.currentTime + duration);

        gain.gain.setValueAtTime(gainVal, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + duration);
      };

      const bpm = heartRateRef.current || 158;
      const intervalMs = (60 / bpm) * 1000;
      if (dopplerIntervalRef.current) window.clearInterval(dopplerIntervalRef.current);

      dopplerIntervalRef.current = window.setInterval(() => {
        playThump(85, 0.12, 0.22);
        window.setTimeout(() => {
          playThump(65, 0.1, 0.16);
        }, 110);
      }, intervalMs);
    } catch (e) {
      console.warn('Web Audio non disponible', e);
    }
  }, [isDopplerPlaying]);

  // Three.js scene initialization
  useEffect(() => {
    const container = threeContainerRef.current;
    if (!container) return;

    container.innerHTML = '';
    const w = container.clientWidth || 450;
    const h = container.clientHeight || 280;

    const isSoftwareGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return false;
      }
    })();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    camera.position.set(0, 0.2, 13);

    resetCameraRef.current = () => {
      camera.position.set(0, 0.2, 13);
      camera.lookAt(0, 0, 0);
    };

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isSoftwareGl,
      preserveDrawingBuffer: true
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    takeViewerSnapshotRef.current = () => {
      try {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/jpeg', 0.9);
      } catch (err) {
        console.warn('Erreur capture Three.js:', err);
        return null;
      }
    };

    const ambientLight = new THREE.AmbientLight(0xffb5a0, 1.4);
    scene.add(ambientLight);

    const mainLight = new THREE.PointLight(0xff7a59, 3.8, 45);
    mainLight.position.set(6, 8, 9);
    scene.add(mainLight);

    const backLight = new THREE.PointLight(0xd94b26, 3.2, 35);
    backLight.position.set(-7, 5, -5);
    scene.add(backLight);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // Sac amniotique translucide enrichi et paroi utérine
    const sacMesh = new THREE.Mesh(
      new THREE.SphereGeometry(6.4, 36, 36),
      new THREE.MeshPhongMaterial({
        color: 0x9e341f,
        emissive: 0x481409,
        specular: 0xffcaa8,
        transparent: true,
        opacity: 0.25,
        side: THREE.BackSide
      })
    );
    rootGroup.add(sacMesh);

    // Particules flottantes vernix / liquide amniotique
    const particleGeo = new THREE.BufferGeometry();
    const particleCount = 70;
    const posArray = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      posArray[i] = (Math.random() - 0.5) * 8;
      posArray[i + 1] = (Math.random() - 0.5) * 8;
      posArray[i + 2] = (Math.random() - 0.5) * 6;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particleMat = new THREE.PointsMaterial({
      size: 0.08,
      color: 0xffe2d1,
      transparent: true,
      opacity: 0.45
    });
    const vernixParticles = new THREE.Points(particleGeo, particleMat);
    rootGroup.add(vernixParticles);

    // Fœtus modélisé & cordon ombilical
    const fetus = new THREE.Group();
    rootGroup.add(fetus);

    const skinMat = new THREE.MeshPhongMaterial({
      color: 0xfcbda4,
      emissive: 0x471d15,
      specular: 0xffe4db,
      shininess: 42
    });
    const limbMat = new THREE.MeshPhongMaterial({
      color: 0xf9b199,
      emissive: 0x3d1710,
      shininess: 32
    });

    const head = new THREE.Mesh(new THREE.SphereGeometry(1.35, 26, 26), skinMat);
    head.position.set(0, 1.45, 0.3);
    fetus.add(head);

    const torso = new THREE.Mesh(new THREE.SphereGeometry(1.45, 26, 26), skinMat);
    torso.position.set(-0.25, -0.2, 0.05);
    torso.scale.set(0.95, 1.35, 1.0);
    fetus.add(torso);

    // Membres foetaux
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 1.2, 16), limbMat);
    armL.position.set(0.9, 0.2, 0.5);
    armL.rotation.z = -0.5;
    fetus.add(armL);

    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 1.2, 16), limbMat);
    armR.position.set(-1.1, 0.3, 0.4);
    armR.rotation.z = 0.5;
    fetus.add(armR);

    // Jambes repliées in utero
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 1.3, 16), limbMat);
    legL.position.set(0.6, -1.3, 0.6);
    legL.rotation.x = 0.9;
    legL.rotation.z = -0.3;
    fetus.add(legL);

    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 1.3, 16), limbMat);
    legR.position.set(-0.6, -1.3, 0.6);
    legR.rotation.x = 0.9;
    legR.rotation.z = 0.3;
    fetus.add(legR);

    // Cordon ombilical spiralé vers placenta
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.1, -0.2, 0.9),
      new THREE.Vector3(-0.6, -0.7, 1.4),
      new THREE.Vector3(-1.4, -0.3, 1.8),
      new THREE.Vector3(-2.2, -1.2, 2.2)
    ]);
    const cordGeo = new THREE.TubeGeometry(curve, 20, 0.12, 8, false);
    const cordMat = new THREE.MeshPhongMaterial({
      color: 0x9b2a26,
      emissive: 0x3d0b09,
      transparent: true,
      opacity: 0.85
    });
    const umbilicalCord = new THREE.Mesh(cordGeo, cordMat);
    fetus.add(umbilicalCord);

    // Cœur fœtal pulsatile
    const heartLight = new THREE.PointLight(0xff1d4a, 2.8, 6.5);
    heartLight.position.set(0.04, 0.45, 0.9);
    fetus.add(heartLight);

    const updateFetusAnatomyMesh = (week: number) => {
      const t = (Math.max(1, Math.min(40, week)) - 1) / 39;
      const scale = 0.35 + Math.pow(t, 0.72) * 1.35;
      fetus.scale.set(scale, scale, scale);

      if (week <= 4) {
        head.scale.set(0.4, 0.4, 0.4);
        armL.visible = false;
        armR.visible = false;
        legL.visible = false;
        legR.visible = false;
      } else if (week <= 8) {
        head.scale.set(0.7, 0.7, 0.7);
        armL.visible = true;
        armR.visible = true;
        armL.scale.set(0.5, 0.5, 0.5);
        armR.scale.set(0.5, 0.5, 0.5);
        legL.visible = false;
        legR.visible = false;
      } else {
        head.scale.set(1.0, 1.0, 1.0);
        armL.visible = true;
        armR.visible = true;
        legL.visible = true;
        legR.visible = true;
        armL.scale.set(1, 1, 1);
        armR.scale.set(1, 1, 1);
      }
    };

    updateFetusScaleRef.current = updateFetusAnatomyMesh;
    window.updateFetus3DScale = updateFetusAnatomyMesh;
    updateFetusAnatomyMesh(12);

    let mouseX = 0;
    let mouseY = 0;
    let rotX = 0;
    let rotY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    container.addEventListener('mousemove', handleMouseMove);

    const clock = new THREE.Clock();
    let frameId = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function animate() {
      const t = clock.getElapsedTime();

      rotX += (mouseX * 0.7 - rotX) * 0.06;
      rotY += (mouseY * 0.4 - rotY) * 0.06;

      if (isPlayingRef.current) {
        fetus.rotation.y = t * 0.35 + rotX;
        fetus.rotation.x = Math.sin(t * 0.4) * 0.12 + rotY * 0.4;
        fetus.position.y = Math.sin(t * 0.8) * 0.14;
        vernixParticles.rotation.y = t * 0.05;
        const bpm = heartRateRef.current || 158;
        heartLight.intensity = Math.sin(t * (bpm / 60) * Math.PI * 2) > 0.35 ? 3.2 : 0.6;
      }

      renderer.render(scene, camera);
      if (isSoftwareGl) {
        afterDraw(animate);
      } else {
        frameId = requestAnimationFrame(animate);
      }
    }
    animate();

    const handleResize = () => {
      if (!container) return;
      const nw = container.clientWidth || 450;
      const nh = container.clientHeight || 280;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      takeViewerSnapshotRef.current = null;
      renderer.dispose();
    };
  }, []);

  const handleTogglePlayPause = () => {
    const nextState = !isVideoPlaying;
    isPlayingRef.current = nextState;
    setIsVideoPlaying(nextState);
  };

  const handleTrimesterKnobClick = () => {
    if (activeData.trimester === 1) selectWeek(14, autoPlayVoice);
    else if (activeData.trimester === 2) selectWeek(28, autoPlayVoice);
    else selectWeek(12, autoPlayVoice);
  };

  const handleTakeSnapshot = useCallback(() => {
    setIsTakingSnapshot(true);
    window.setTimeout(() => setIsTakingSnapshot(false), 450);

    const canvas = document.createElement('canvas');
    const width = 800;
    const height = 500;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Dégradé in utero profond et parois amniotiques
    const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 60, width / 2, height / 2, 450);
    bgGrad.addColorStop(0, '#3a110a');
    bgGrad.addColorStop(0.55, '#1e0705');
    bgGrad.addColorStop(1, '#090202');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Cercles acoustiques concentriques / grille échographique subtile
    ctx.save();
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.08)';
    ctx.lineWidth = 1;
    for (let r = 80; r < 400; r += 50) {
      ctx.beginPath();
      ctx.arc(width / 2, height / 2 + 10, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    const currentFetusData = PREGNANCY_WEEKS[currentWeek - 1] || PREGNANCY_WEEKS[11];
    const now = new Date();
    const formattedDate =
      now.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }) +
      ' · ' +
      now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const drawTelemetryAndSave = () => {
      // Bandeau télémétrique supérieur
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.fillRect(0, 0, width, 58);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 58);
      ctx.lineTo(width, 58);
      ctx.stroke();

      // En-tête gauche : Statut LIVE + Semaine
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(28, 29, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`HD-4D SOUVENIR · SEMAINE ${currentWeek} (${currentWeek} SA)`, 44, 34);

      // En-tête droit : Fréquence cardiaque & taille
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`♥ ${currentBpm} BPM`, width - 28, 25);
      ctx.fillStyle = '#fde68a';
      ctx.font = '12px monospace';
      ctx.fillText(`${currentFetusData.metrics} · ${currentFetusData.fruit}`, width - 28, 44);

      // Bandeau inférieur
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.fillRect(0, height - 48, width, 48);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
      ctx.beginPath();
      ctx.moveTo(0, height - 48);
      ctx.lineTo(width, height - 48);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '12px sans-serif';
      ctx.fillText(`Instant Télémétrique : ${formattedDate}`, 24, height - 20);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'italic 12px serif';
      ctx.fillText(`Carnet de Grossesse · Petit Prince Garçon (DPA 22/07/2027)`, width - 24, height - 20);

      // Cadre laiton raffiné
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.75)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, width - 4, height - 4);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      const newSnapshot: FetalSnapshot = {
        id: 'snap-' + Date.now(),
        week: currentWeek,
        fruit: currentFetusData.fruit,
        metrics: currentFetusData.metrics,
        heartRate: currentBpm,
        dateStr: formattedDate,
        timestamp: Date.now(),
        dataUrl,
        viewMode
      };

      setSnapshots((prev) => {
        const updated = [newSnapshot, ...prev.slice(0, 24)];
        try {
          localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(updated));
        } catch (err) {
          console.warn('Erreur stockage snapshot', err);
        }
        return updated;
      });

      setSnapshotFeedback(`📸 Cliché S${currentWeek} (${currentFetusData.fruit}) sauvegardé dans la galerie !`);
      window.setTimeout(() => setSnapshotFeedback(null), 3800);
    };

    const drawFallbackIllustration = () => {
      const halo = ctx.createRadialGradient(width / 2, height / 2 + 5, 20, width / 2, height / 2 + 5, 140);
      halo.addColorStop(0, 'rgba(244, 63, 94, 0.45)');
      halo.addColorStop(0.6, 'rgba(245, 158, 11, 0.25)');
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2 + 5, 140, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '72px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(currentFetusData.icon, width / 2, height / 2 - 20);

      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 20px serif';
      ctx.fillText(`Évolution In Utero · Semaine ${currentWeek}`, width / 2, height / 2 + 50);

      ctx.fillStyle = '#fde68a';
      ctx.font = 'italic 14px serif';
      ctx.fillText(
        `Taille estimée : ${currentFetusData.metrics} (${currentFetusData.fruit})`,
        width / 2,
        height / 2 + 76
      );
    };

    const threeDataUrl = takeViewerSnapshotRef.current ? takeViewerSnapshotRef.current() : null;
    if (viewMode === '3d' && threeDataUrl) {
      const img = new Image();
      img.onload = () => {
        const targetW = width - 80;
        const targetH = height - 120;
        const x = 40;
        const y = 62;
        ctx.drawImage(img, x, y, targetW, targetH);
        drawTelemetryAndSave();
      };
      img.onerror = () => {
        drawFallbackIllustration();
        drawTelemetryAndSave();
      };
      img.src = threeDataUrl;
    } else {
      drawFallbackIllustration();
      drawTelemetryAndSave();
    }
  }, [currentWeek, currentBpm, viewMode]);

  const handleDeleteSnapshot = useCallback((id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSnapshots((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      try {
        localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.warn('Erreur suppression snapshot', err);
      }
      return updated;
    });
    setSelectedSnapshot((curr) => (curr?.id === id ? null : curr));
  }, []);

  const handleClearAllSnapshots = useCallback(() => {
    if (window.confirm('Voulez-vous supprimer toutes les captures de la galerie locale ?')) {
      setSnapshots([]);
      try {
        localStorage.removeItem(SNAPSHOTS_STORAGE_KEY);
      } catch (err) {
        console.warn('Erreur vidage snapshots', err);
      }
      setSelectedSnapshot(null);
    }
  }, []);

  const handleDownloadSnapshot = useCallback((snap: FetalSnapshot, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const link = document.createElement('a');
    link.href = snap.dataUrl;
    link.download = `Echo_Foetus_S${snap.week}_${snap.fruit.replace(/\s+/g, '_')}_Fatou.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const metricParts = activeData.metrics.split('·');
  const lccValue = metricParts[0]?.trim() || activeData.metrics;
  const weightValue = metricParts[1]?.trim() || 'Variable';

  const trimesterLabel =
    activeData.trimester === 1
      ? 'Premier Trimestre'
      : activeData.trimester === 2
      ? 'Deuxième Trimestre'
      : 'Troisième Trimestre';

  const trimesterKnobText =
    activeData.trimester === 1
      ? 'T1 • 1er Trimestre'
      : activeData.trimester === 2
      ? 'T2 • 2e Trimestre'
      : 'T3 • 3e Trimestre';

  const trimesterNeedleDeg =
    activeData.trimester === 1 ? 45 : activeData.trimester === 2 ? 135 : 225;

  const milestoneDialDeg = Math.floor((currentWeek / 40) * 360);
  const milestoneDialDesc =
    currentWeek <= 12
      ? 'Clarté Nucale T1'
      : currentWeek <= 24
      ? 'Morphologie T2'
      : 'Maturation T3';

  if (userStatus === 'pending' && userEmail.toLowerCase() !== '410bala@gmail.com') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8 text-center border border-gray-200">
          <div className="mb-4 text-amber-500 text-4xl">⏳</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Inscription en attente</h2>
          <p className="text-gray-600 mb-6">
            Votre compte a bien été créé. Un e-mail de validation a été envoyé à l'administrateur (<strong>410bala@gmail.com</strong>). 
            Vous aurez accès à l'application dès que votre inscription sera approuvée.
          </p>
          <button
            onClick={() => {
              if (userEmail.toLowerCase() === '410bala@gmail.com') {
                setUserStatus('active');
              } else {
                alert('Votre compte est toujours en attente d\'approbation par l\'administrateur.');
              }
            }}
            className="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded hover:bg-blue-700 transition cursor-pointer"
          >
            Vérifier mon statut
          </button>
          <button
            onClick={() => {
              setIsGmailLoggedIn(false);
              setUserEmail('');
              handleGoogleLogout();
            }}
            className="mt-4 text-sm text-gray-500 hover:underline cursor-pointer"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-6 px-3 sm:px-6 lg:px-8 flex flex-col items-center justify-start relative">
      <ConfettiCanvas ref={confettiRef} />
      {/* Cadre principal en bois */}
      <main
        className="w-full max-w-[1440px] wood-board rounded-3xl p-5 sm:p-8 lg:p-10 relative overflow-hidden"
        data-purpose="pregnancy-calendar-board"
      >
        {/* Rivets supérieurs en laiton */}
        <div className="flex justify-between items-center px-4 -mt-3 mb-4 opacity-75">
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-3.5 rounded-full brass-knob border border-amber-900 inline-block"></span>
            <span className="w-3.5 h-3.5 rounded-full brass-knob border border-amber-900 inline-block"></span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-3.5 rounded-full brass-knob border border-amber-900 inline-block"></span>
            <span className="w-3.5 h-3.5 rounded-full brass-knob border border-amber-900 inline-block"></span>
          </div>
        </div>

        {/* MOBILE HEADER - B&F PARCOURS LEATHER TEXTURE */}
        <div className="block sm:hidden mb-4 leather-texture text-white shadow-md rounded-2xl border border-amber-500/40 relative overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-700 to-amber-900 border border-amber-400 flex items-center justify-center shadow-inner">
                <span className="text-amber-200 font-bold text-sm tracking-tighter">B&amp;F</span>
              </div>
              <div>
                <h1 className="text-xs font-bold tracking-wide uppercase text-amber-100">Volets des 40 Semaines</h1>
                <p className="text-[10px] text-amber-200/80 font-medium">B&amp;F Parcours Mobile</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                className="p-2 rounded-xl bg-amber-950/80 text-amber-200 border border-amber-500/40 hover:bg-amber-900 active:scale-95 transition-all shadow cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">menu</span>
              </button>
            </div>
          </div>

          {/* Horizontal Category Pills Bar */}
          <div className="bg-amber-950/90 px-3 py-2 border-t border-amber-900/40 flex items-center space-x-2 overflow-x-auto no-scrollbar text-xs">
            <button
              type="button"
              onClick={() => { setActiveTab('module-ivf-file'); setMobileMenuOpen(false); }}
              className="whitespace-nowrap px-3 py-1 rounded-full font-semibold bg-amber-500 text-amber-950 shadow-sm transition flex-shrink-0 cursor-pointer"
            >
              ✨ Tous les Volets
            </button>
            <button
              type="button"
              onClick={() => { selectWeek(6, autoPlayVoice); setMobileMenuOpen(false); }}
              className="whitespace-nowrap px-3 py-1 rounded-full font-medium bg-amber-900/60 text-amber-100 border border-amber-600/40 hover:bg-amber-800 transition flex-shrink-0 cursor-pointer"
            >
              🌱 Trimestre 1 (S1-S13)
            </button>
            <button
              type="button"
              onClick={() => { selectWeek(20, autoPlayVoice); setMobileMenuOpen(false); }}
              className="whitespace-nowrap px-3 py-1 rounded-full font-medium bg-amber-900/60 text-amber-100 border border-amber-600/40 hover:bg-amber-800 transition flex-shrink-0 cursor-pointer"
            >
              🌿 Trimestre 2 (S14-S27)
            </button>
            <button
              type="button"
              onClick={() => { selectWeek(34, autoPlayVoice); setMobileMenuOpen(false); }}
              className="whitespace-nowrap px-3 py-1 rounded-full font-medium bg-amber-900/60 text-amber-100 border border-amber-600/40 hover:bg-amber-800 transition flex-shrink-0 cursor-pointer"
            >
              🌳 Trimestre 3 (S28-S40)
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('module-fet'); setMobileMenuOpen(false); }}
              className="whitespace-nowrap px-3 py-1 rounded-full font-medium bg-rose-950/80 text-rose-200 border border-rose-500/40 hover:bg-rose-900 transition flex-shrink-0 cursor-pointer"
            >
              💙 Jalons &amp; FET
            </button>
          </div>

          {mobileMenuOpen && (
            <div id="settings-menu" className="p-3 bg-stone-950 border-t border-amber-800/50 space-y-3 text-xs animate-fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-stone-800">
                <span className="font-bold text-amber-300">Menu &amp; Paramètres</span>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-stone-400 hover:text-white">✕</button>
              </div>

              {/* Moved to the top */}
              <div className="p-4 bg-white rounded-lg shadow border border-gray-200 text-gray-900 space-y-2">
                <h3 className="font-bold text-base text-gray-800">Gmail &amp; Confidentialité Cloud</h3>
                <p className="text-xs text-gray-600">Gérez vos paramètres de synchronisation et de sécurité ({userEmail}).</p>
                <div className="pt-2 flex items-center justify-between gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => { handleRemoveMyInfo(); setMobileMenuOpen(false); }}
                    className="px-2.5 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded font-bold text-[11px] shadow cursor-pointer"
                  >
                    Supprimer infos
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowGmailModal(true); setMobileMenuOpen(false); }}
                    className="px-2.5 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded font-bold text-[11px] shadow cursor-pointer"
                  >
                    Gérer le compte
                  </button>
                </div>
                {isGmailLoggedIn && (
                  <div className="pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => { handleGoogleLogout(); setMobileMenuOpen(false); }}
                      className="w-full py-2 bg-stone-800 hover:bg-stone-900 text-amber-100 rounded-lg font-bold text-xs shadow flex items-center justify-center gap-1.5 cursor-pointer transition"
                    >
                      <span className="material-symbols-outlined text-sm">logout</span>
                      <span>Fermer la session (Déconnexion)</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Other settings items */}
              <div className="p-4 bg-white rounded-lg shadow border border-gray-200 text-gray-900 space-y-1.5">
                <h3 className="font-bold text-base text-gray-800">Préférences Générales</h3>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-gray-600">Langue de l'interface</span>
                  <button
                    type="button"
                    onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
                    className="px-2.5 py-1 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded font-semibold text-xs"
                  >
                    {language === 'fr' ? 'Français 🇫🇷' : 'English 🇬🇧'}
                  </button>
                </div>
              </div>

              <div>
                <span className="font-bold text-amber-200 block mb-1.5">⚡ Sélecteur Rapide des 40 Semaines :</span>
                <div className="grid grid-cols-8 gap-1 max-h-36 overflow-y-auto p-1 bg-stone-900 rounded-xl">
                  {PREGNANCY_WEEKS.map((w) => (
                    <button
                      key={w.week}
                      type="button"
                      onClick={() => {
                        selectWeek(w.week, autoPlayVoice);
                        setMobileMenuOpen(false);
                      }}
                      className={`py-1.5 rounded text-[11px] font-mono font-bold transition cursor-pointer ${
                        currentWeek === w.week
                          ? 'bg-amber-500 text-stone-950 shadow'
                          : 'bg-stone-800 text-amber-200 hover:bg-stone-700'
                      }`}
                    >
                      {w.week}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-stone-800">
                <button
                  type="button"
                  onClick={() => { setActiveTab('module-ivf-file'); setMobileMenuOpen(false); }}
                  className="p-2 rounded-lg bg-stone-900 hover:bg-stone-800 text-amber-200 font-medium text-left"
                >
                  📋 Dossier Patient
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('module-fet'); setMobileMenuOpen(false); }}
                  className="p-2 rounded-lg bg-stone-900 hover:bg-stone-800 text-amber-200 font-medium text-left"
                >
                  🔬 Calculateur FET
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('module-timeline'); setMobileMenuOpen(false); }}
                  className="p-2 rounded-lg bg-stone-900 hover:bg-stone-800 text-amber-200 font-medium text-left"
                >
                  📅 Chronologie S1-S40
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('module-checklists'); setMobileMenuOpen(false); }}
                  className="p-2 rounded-lg bg-stone-900 hover:bg-stone-800 text-amber-200 font-medium text-left"
                >
                  ✅ Checklists &amp; RDV
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('module-journal'); setMobileMenuOpen(false); }}
                  className="p-2 rounded-lg bg-stone-900 hover:bg-stone-800 text-amber-200 font-medium col-span-2 text-left"
                >
                  📖 Carnet Intime de Fatou
                </button>
              </div>
            </div>
          )}
        </div>

        {/* En-tête gravé */}
        <header className="text-center pb-6 border-b border-amber-800/25 relative">
          <div className="flex justify-between items-center mb-4">
            <button
              type="button"
              onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
              className="px-2.5 py-1 rounded bg-amber-900/20 hover:bg-amber-900/35 text-amber-950 font-bold text-xs transition flex items-center gap-1 cursor-pointer"
            >
              <span>{language === 'fr' ? '🇬🇧 English' : '🇫🇷 Français'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowGmailModal(true)}
              className="px-3 py-1.5 rounded-lg bg-amber-800 hover:bg-amber-900 text-amber-50 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer shadow"
            >
              <span className="material-symbols-outlined text-sm">account_circle</span>
              <span>{isGmailLoggedIn ? userEmail : (language === 'en' ? 'Gmail Account' : 'Compte Gmail')}</span>
            </button>
          </div>

          {/* Modal Gmail / Google Privacy Registration */}
          {showGmailModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
              <div className="bg-amber-50 border-2 border-amber-800/60 rounded-2xl max-w-md w-full p-6 shadow-2xl relative space-y-4 text-left">
                <div className="flex items-center justify-between border-b border-amber-900/20 pb-3">
                  <h3 className="font-serif font-bold text-lg text-amber-950 flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-800">mail</span>
                    <span>{language === 'en' ? 'Gmail Account Management' : 'Gestion du Compte Gmail'}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowGmailModal(false)}
                    className="w-7 h-7 rounded-full bg-amber-900/10 hover:bg-amber-900/20 flex items-center justify-center text-amber-950 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                {isGmailLoggedIn ? (
                  <div className="space-y-4 pt-1">
                    <div className="p-3.5 bg-emerald-950/10 border border-emerald-600/30 rounded-xl text-xs text-emerald-950 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse"></span>
                        <span>Connecté : <strong>{userEmail}</strong></span>
                      </span>
                    </div>
                    <p className="text-xs text-amber-900/90 leading-relaxed font-serif">
                      {language === 'en'
                        ? 'Your Gmail account is currently connected for secure cloud sync and privacy protection.'
                        : 'Votre compte Gmail est actuellement connecté pour la synchronisation sécurisée et la protection de la confidentialité.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        handleGoogleLogout();
                        setShowGmailModal(false);
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-stone-800 hover:bg-stone-900 text-amber-100 font-bold text-xs shadow-md flex items-center justify-center gap-2 cursor-pointer transition"
                    >
                      <span className="material-symbols-outlined text-sm">logout</span>
                      <span>{language === 'en' ? 'Disconnect Gmail Account' : 'Déconnecter mon compte Gmail'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4 pt-1">
                    <p className="text-xs text-amber-900/90 leading-relaxed font-serif">
                      {language === 'en'
                        ? 'Enter your Gmail address or connect with Google to securely register and sync your IVF protocol and journal entries.'
                        : 'Saisissez votre adresse Gmail ou connectez-vous avec Google pour vous inscrire et synchroniser votre protocole FIV et vos notes.'}
                    </p>
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-amber-950">Adresse Gmail / Google Account</label>
                      <input
                        type="email"
                        value={loginInputEmail}
                        onChange={(e) => setLoginInputEmail(e.target.value)}
                        placeholder="ex: 410bala@gmail.com"
                        className="w-full px-3.5 py-2 rounded-xl border border-amber-900/30 bg-white text-amber-950 text-xs focus:ring-2 focus:ring-amber-700 focus:outline-none"
                      />
                    </div>

                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-stone-100 text-stone-900 font-bold text-xs shadow-md border border-amber-900/20 flex items-center justify-center gap-2 cursor-pointer transition"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.13 0-5.78-2.11-6.73-4.96H1.18v3.15C3.17 21.32 7.23 24 12 24z"/>
                          <path fill="#FBBC05" d="M5.27 14.24c-.25-.72-.39-1.49-.39-2.24s.14-1.52.39-2.24V6.61H1.18C.43 8.13 0 9.87 0 12s.43 3.87 1.18 5.39l4.09-3.15z"/>
                          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.23 0 3.17 2.68 1.18 6.61l4.09 3.15c.95-2.85 3.6-4.96 6.73-4.96z"/>
                        </svg>
                        <span>{language === 'en' ? 'Sign in with Google (Firebase Auth)' : 'Se connecter avec Google (Auth Firebase)'}</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-900/20">
                  <button
                    type="button"
                    onClick={() => setShowGmailModal(false)}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-900/10 text-amber-950 text-xs font-semibold cursor-pointer"
                  >
                    {language === 'en' ? 'Close' : 'Fermer'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {ivfSaveToast && (
            <div className="mb-4 p-3 bg-emerald-950/90 text-emerald-200 text-xs font-bold rounded-xl border border-emerald-500/40 shadow flex items-center justify-center gap-2 animate-bounce">
              <span className="material-symbols-outlined text-sm text-emerald-400">cloud_done</span>
              <span>{ivfSaveToast}</span>
            </div>
          )}

          <div className="inline-flex items-center justify-center space-x-3 mb-1">
            <span className="h-px w-12 sm:w-24 bg-amber-900/40"></span>
            <span className="text-xs uppercase tracking-widest font-semibold text-amber-900/70">
              Protocole FET · Suivi Obstétrique Personnalisé
            </span>
            <span className="h-px w-12 sm:w-24 bg-amber-900/40"></span>
          </div>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black engraved-wood-title tracking-tight mb-2">
            Pregnancy Calendar
          </h1>
          <p className="font-serif italic text-base sm:text-xl font-medium tracking-wide text-amber-900">
            Fatou • Transfert Blastocyste J5 Euploïde Garçon • RMA of New York • Nov 2026 – Juil 2027
          </p>
          {/* Badges de télémétrie obstétricale */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-xs sm:text-sm font-medium">
            <span className="px-3.5 py-1.5 rounded-full bg-amber-900/10 border border-amber-800/30 text-amber-950 font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
              Statut : FET Réussi (J5 Euploïde)
            </span>
            <span className="px-3.5 py-1.5 rounded-full bg-amber-900/10 border border-amber-800/30 text-amber-950">
              DDR Médicale : <strong>15 Octobre 2026</strong>
            </span>
            <span className="px-3.5 py-1.5 rounded-full bg-amber-900/10 border border-amber-800/30 text-amber-950">
              DPA Estimée : <strong>22 Juillet 2027</strong>
            </span>
            <span
              className="px-3.5 py-1.5 rounded-full bg-amber-800/20 border border-amber-800/40 text-amber-950 font-bold"
              id="banner-active-week-label"
            >
              Semaine active : S{currentWeek} ({activeData.fruit})
            </span>
          </div>

          {/* Horloge de Gestation en Laiton / Compte à Rebours Raffiné */}
          <div className="mt-5 flex justify-center px-1">
            <div
              className="brass-cartouche rounded-2xl px-4 py-2.5 sm:px-6 sm:py-3.5 max-w-xl w-full relative overflow-hidden text-center shadow-md"
              data-purpose="brass-countdown-clock"
            >
              {/* Petits rivets d'angles en laiton */}
              <span className="w-2.5 h-2.5 rounded-full brass-knob border border-amber-950 absolute top-2 left-2 inline-block"></span>
              <span className="w-2.5 h-2.5 rounded-full brass-knob border border-amber-950 absolute top-2 right-2 inline-block"></span>
              <span className="w-2.5 h-2.5 rounded-full brass-knob border border-amber-950 absolute bottom-2 left-2 inline-block"></span>
              <span className="w-2.5 h-2.5 rounded-full brass-knob border border-amber-950 absolute bottom-2 right-2 inline-block"></span>

              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-950/70"></span>
                <span className="text-[10px] sm:text-[11px] uppercase tracking-widest font-serif font-bold text-amber-950">
                  Horloge de Gestation · Compte à Rebours du Terme
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-950/70"></span>
              </div>

              {/* Cellules en laiton poli pour les chiffres */}
              <div className="flex items-center justify-center gap-2 sm:gap-3 py-1">
                {/* Jours */}
                <div className="flex flex-col items-center">
                  <div className="brass-plate-inner min-w-[58px] sm:min-w-[68px] px-2 py-1 rounded-lg">
                    <span className="font-serif font-extrabold text-xl sm:text-2xl text-amber-950 tabular-nums">
                      {countdown.days}
                    </span>
                  </div>
                  <span className="text-[9px] sm:text-[10px] uppercase font-bold text-amber-950 tracking-wider mt-1">
                    Jours
                  </span>
                </div>

                <span className="text-lg sm:text-xl font-bold font-serif text-amber-950/70 -mt-4">:</span>

                {/* Heures */}
                <div className="flex flex-col items-center">
                  <div className="brass-plate-inner min-w-[46px] sm:min-w-[56px] px-2 py-1 rounded-lg">
                    <span className="font-serif font-extrabold text-xl sm:text-2xl text-amber-950 tabular-nums">
                      {String(countdown.hours).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="text-[9px] sm:text-[10px] uppercase font-bold text-amber-950 tracking-wider mt-1">
                    Heures
                  </span>
                </div>

                <span className="text-lg sm:text-xl font-bold font-serif text-amber-950/70 -mt-4">:</span>

                {/* Minutes */}
                <div className="flex flex-col items-center">
                  <div className="brass-plate-inner min-w-[46px] sm:min-w-[56px] px-2 py-1 rounded-lg">
                    <span className="font-serif font-extrabold text-xl sm:text-2xl text-amber-950 tabular-nums">
                      {String(countdown.minutes).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="text-[9px] sm:text-[10px] uppercase font-bold text-amber-950 tracking-wider mt-1">
                    Minutes
                  </span>
                </div>

                <span className="text-lg sm:text-xl font-bold font-serif text-amber-950/70 -mt-4">:</span>

                {/* Secondes */}
                <div className="flex flex-col items-center">
                  <div className="brass-plate-inner min-w-[46px] sm:min-w-[56px] px-2 py-1 rounded-lg">
                    <span className="font-serif font-extrabold text-xl sm:text-2xl text-amber-900 tabular-nums">
                      {String(countdown.seconds).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="text-[9px] sm:text-[10px] uppercase font-bold text-amber-950 tracking-wider mt-1">
                    Sec
                  </span>
                </div>
              </div>

              <p className="text-[10px] sm:text-[11px] text-amber-950/85 font-medium italic mt-1.5 font-serif">
                {countdown.isTerme
                  ? '🎉 Le terme est atteint ! Bienvenue à votre précieux petit prince garçon !'
                  : `Temps exact jusqu'à la DPA du 22 Juillet 2027 · ${countdown.days} jours et ${countdown.hours} heures restants`}
              </p>
            </div>
          </div>
        </header>

        {/* Disposition principale : 40 Volets + Niche Intégrée Vidéo & 3D Directe (Aucune Popup) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-7 items-start">
          {/* GAUCHE : Grille des 40 Volets en bois (6 colonnes) */}
          <div className="lg:col-span-6 flex flex-col space-y-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="font-serif font-bold text-xl sm:text-2xl text-amber-950 flex items-center gap-2">
                <span>Volets des 40 Semaines</span>
              </h2>
              <span className="text-xs font-medium text-amber-900 bg-amber-900/10 px-2.5 py-1 rounded-full border border-amber-900/20 flex items-center gap-1">
                <span>✨ Cliquez pour charger directement à droite</span>
              </span>
            </div>

            {/* Grille des 40 volets */}
            <div
              className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5 sm:gap-3 p-3.5 sm:p-4 rounded-2xl recessed-groove max-h-[720px] overflow-y-auto"
              id="doors-grid"
            >
              {PREGNANCY_WEEKS.map((info) => {
                const isActive = info.week === currentWeek;
                return (
                  <div
                    key={info.week}
                    className={`door-item rounded-xl p-2.5 border-2 flex flex-col justify-between cursor-pointer select-none ${getDoorColor(
                      info.week
                    )} ${isActive ? 'is-active-week' : ''}`}
                    data-week={info.week}
                    onClick={() => selectWeek(info.week, autoPlayVoice, info.week === 40)}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black font-serif">S{info.week}</span>
                      <span className="w-2.5 h-2.5 rounded-full brass-knob border border-amber-900 inline-block"></span>
                    </div>
                    <div className="text-center my-1">
                      <span className="text-2xl">{info.icon}</span>
                      <p className="text-[10px] font-bold truncate mt-0.5">{info.fruit}</p>
                    </div>
                    <button
                      type="button"
                      className="w-full text-[9px] py-1 px-1 bg-amber-900/15 hover:bg-amber-900/30 rounded font-bold text-amber-950 transition flex items-center justify-center gap-1 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectWeek(info.week, true, info.week === 40);
                      }}
                    >
                      <span>S{info.week}</span>{' '}
                      <span className="material-symbols-outlined text-[10px]">volume_up</span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Légende des trimestres */}
            <div className="flex flex-wrap items-center justify-between text-xs text-amber-900/80 px-2 pt-1 font-medium gap-2">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#c5dac5] border border-stone-400"></span> T1
                  (S1-S13) Vert Sauge
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#f5d0bd] border border-stone-400"></span> T2
                  (S14-S27) Pêche Douce
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#f8e0ad] border border-stone-400"></span> T3
                  (S28-S40) Miel Doré
                </span>
              </div>
              <span className="flex items-center gap-1.5 font-semibold text-amber-900">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span> Rendu
                direct dans la niche
              </span>
            </div>
          </div>

          {/* DROITE : Niche Centrale 3D & Lecteur Vidéo In Utero Pleinement Intégré (6 colonnes, SANS POP-UP) */}
          <div className="lg:col-span-6 flex flex-col space-y-4">
            <div className="parchment-sheet rounded-2xl p-5 sm:p-6 border-2 border-[#bfa278] relative shadow-lg">
              {/* Écusson supérieur de laiton */}
              <div className="absolute -top-3.5 right-6 px-3 py-0.5 brass-hinge rounded text-[11px] font-bold text-amber-950 uppercase tracking-widest shadow flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                <span>Niche Centrale • Vidéo &amp; 3D Directe</span>
              </div>

              {/* En-tête de la niche latérale */}
              <div className="border-b border-amber-900/15 pb-4 mb-3 flex flex-col sm:flex-row justify-between sm:items-start gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-bold uppercase tracking-wider text-amber-800"
                      id="display-trimester-tag"
                    >
                      {trimesterLabel}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-900/10 text-amber-900 border border-amber-900/20">
                      Blastocyste J5 Garçon (46, XY)
                    </span>
                  </div>
                  <h3
                    className="text-2xl sm:text-3xl font-extrabold font-serif text-amber-950 mt-0.5"
                    id="display-week-title"
                  >
                    SEMAINE {currentWeek}
                  </h3>
                  <p className="text-xs text-amber-900 font-medium" id="display-date-range">
                    {activeData.dates} • Étape Garçon J5
                  </p>
                </div>
                <div className="sm:text-right bg-amber-900/5 sm:bg-transparent p-2.5 sm:p-0 rounded-xl border sm:border-0 border-amber-900/10">
                  <span className="text-[11px] font-semibold text-amber-800 block uppercase">
                    Biométrie &amp; Échelle
                  </span>
                  <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1">
                    <span
                      className="text-base sm:text-lg font-bold font-serif text-amber-950"
                      id="display-size-metrics"
                    >
                      {activeData.metrics}
                    </span>
                    <span className="text-xs text-amber-900 font-medium italic" id="display-fruit-compare">
                      Taille : {activeData.fruit}
                    </span>
                  </div>
                </div>
              </div>

              {/* MODULE AUDIO DE NARRATION VOCALE & TRANSCRIPTION EN FRANÇAIS */}
              <div className="bg-gradient-to-r from-amber-950/15 via-amber-900/20 to-amber-950/15 border-2 border-amber-800/40 rounded-xl p-3.5 mb-3 shadow-inner">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Bouton Principal Lecture Voix Française */}
                    <button
                      className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-amber-800 hover:bg-amber-900 text-amber-50 font-bold text-xs shadow-md transition transform active:scale-95 border border-amber-600/50 cursor-pointer"
                      id="btn-audio-narrate"
                      onClick={triggerMainNarrationClick}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-base" id="icon-voice-action">
                        {isSpeaking ? 'pause' : 'play_arrow'}
                      </span>
                      <span id="text-voice-action">
                        {isSpeaking
                          ? 'Mettre en pause'
                          : 'Écouter la narration posée (Français naturel)'}
                      </span>
                    </button>
                    {/* Bouton Rejouer */}
                    <button
                      className="w-8 h-8 rounded-lg bg-amber-900/20 hover:bg-amber-900/35 border border-amber-900/30 flex items-center justify-center text-amber-950 transition cursor-pointer"
                      id="btn-audio-replay"
                      onClick={replayNarrationCurrentWeek}
                      title="Réécouter depuis le début"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-sm">replay</span>
                    </button>

                    {/* Badge statut & ondes vocales animées */}
                    {isSpeaking ? (
                      <div
                        className="flex items-center space-x-1 px-2.5 py-1 bg-amber-800/25 rounded-md border border-amber-800/40"
                        id="audio-wave-container"
                      >
                        <span className="sound-bar w-1 bg-amber-900 rounded-full"></span>
                        <span className="sound-bar w-1 bg-amber-900 rounded-full"></span>
                        <span className="sound-bar w-1 bg-amber-900 rounded-full"></span>
                        <span className="sound-bar w-1 bg-amber-900 rounded-full"></span>
                        <span className="sound-bar w-1 bg-amber-900 rounded-full"></span>
                        <span className="text-[10px] font-bold text-amber-950 ml-1.5 animate-pulse">
                          🎙️ Voix humaine posée &amp; chaleureuse...
                        </span>
                      </div>
                    ) : (
                      <span
                        className="text-[11px] font-semibold text-amber-900/90 italic flex items-center gap-1"
                        id="audio-idle-badge"
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                        <span>
                          ▶ Écouter en{' '}
                          <span id="audio-style-subtext" className="font-bold not-italic text-amber-950">
                            Français Naturel (débit posé &amp; chaleureux)
                          </span>
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Toggle d'Auto-Lecture vocale au clic */}
                  <div className="flex items-center space-x-2 text-xs text-amber-950 font-medium">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        checked={autoPlayVoice}
                        onChange={(e) => setAutoPlayVoice(e.target.checked)}
                        className="sr-only peer"
                        id="toggle-voice-autoplay"
                        type="checkbox"
                      />
                      <div className="w-8 h-4 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-800"></div>
                    </label>
                    <span className="text-[11px] text-amber-900 whitespace-nowrap">
                      Auto-lecture au clic
                    </span>
                  </div>
                </div>

                {/* CARTE DE TRANSCRIPTION EN DIRECT ANIMÉE (KARAOKÉ / SUIVI DE MOTS) */}
                <div className="mt-3 bg-amber-50/90 rounded-lg p-3 border border-amber-900/25 shadow-sm">
                  <div className="flex items-center justify-between pb-1.5 border-b border-amber-900/15 mb-2">
                    <div className="flex items-center space-x-1.5 text-[11px] font-bold text-amber-950">
                      <span className="material-symbols-outlined text-sm text-amber-800">graphic_eq</span>
                      <span>Transcription intégrale en direct (Français) :</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-900/15 text-amber-950"
                        id="audio-lang-indicator"
                      >
                        {voiceLabel}
                      </span>
                      <button
                        className="px-2 py-0.5 bg-amber-900/20 hover:bg-amber-900/35 rounded text-[10px] font-bold text-amber-950 flex items-center gap-1 transition cursor-pointer"
                        onClick={triggerMainNarrationClick}
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[11px]">record_voice_over</span> Lire
                      </button>
                    </div>
                  </div>
                  {/* Zone défilement de texte avec mise en valeur interactive */}
                  <div
                    className="text-xs sm:text-[13px] leading-relaxed text-amber-950 font-serif min-h-[58px] max-h-28 overflow-y-auto pr-1"
                    id="audio-live-transcription-box"
                  >
                    {transcriptionWords.map((word, idx) => {
                      let cls = 'karaoke-word';
                      if (allWordsPast) {
                        cls = 'karaoke-word past-word';
                      } else if (activeWordIdx >= 0) {
                        if (idx < activeWordIdx) cls = 'karaoke-word past-word';
                        else if (idx === activeWordIdx) cls = 'karaoke-word active-word';
                      }
                      return (
                        <span key={idx} className={cls} id={`kw-${idx}`}>
                          {word}{' '}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* LECTEUR ÉCHOGRAPHIQUE & CANVAS 3D / ILLUSTRATION RÉALISTE IN UTERO */}
              <div className="relative w-full rounded-2xl overflow-hidden bg-stone-950 shadow-2xl border-2 border-amber-900/60 select-none group">
                {/* Ambiance in utero chaude, parois utérines transluminescentes et sac amniotique */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-amber-950/70 via-rose-950/90 to-stone-950 pointer-events-none"></div>

                {/* Effet visuel d'obturateur photo au déclenchement */}
                {isTakingSnapshot && (
                  <div className="absolute inset-0 bg-white/70 z-50 pointer-events-none transition-opacity duration-300"></div>
                )}

                {/* Commutateur de vue : 3D Interactif vs Illustration Réaliste Anatomique HD */}
                <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-30 flex items-center bg-stone-900/85 backdrop-blur-md p-0.5 rounded-lg border border-amber-600/40 text-[10px] font-semibold text-amber-200">
                  <button
                    className={
                      viewMode === '3d'
                        ? 'px-2.5 py-1 rounded bg-amber-800/80 text-amber-50 shadow font-bold transition flex items-center gap-1 cursor-pointer'
                        : 'px-2.5 py-1 rounded text-amber-300 hover:text-amber-100 transition flex items-center gap-1 cursor-pointer'
                    }
                    id="toggle-view-3d"
                    onClick={() => setViewMode('3d')}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-xs">view_in_ar</span> 3D Temps Réel
                  </button>
                  <button
                    className={
                      viewMode === 'art'
                        ? 'px-2.5 py-1 rounded bg-amber-800/80 text-amber-50 shadow font-bold transition flex items-center gap-1 cursor-pointer'
                        : 'px-2.5 py-1 rounded text-amber-300 hover:text-amber-100 transition flex items-center gap-1 cursor-pointer'
                    }
                    id="toggle-view-art"
                    onClick={() => setViewMode('art')}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-xs">auto_awesome</span> Illustration
                    HD Womb
                  </button>
                </div>

                {/* Écran 3D Three.js interactif (Modélisation utérine réaliste) */}
                <div
                  ref={threeContainerRef}
                  className={`w-full h-64 sm:h-72 cursor-grab active:cursor-grabbing relative z-10 ${
                    viewMode === 'art' ? 'hidden' : ''
                  }`}
                  id="threejs-container-womb-wood"
                />

                {/* Vue Illustration Réaliste HD In Utero (Alternative Anatomique Dynamique) */}
                <div
                  className={`${
                    viewMode === 'art' ? 'flex' : 'hidden'
                  } w-full h-64 sm:h-72 relative z-15 bg-gradient-to-b from-[#2a0e08] via-[#1c0805] to-[#120504] items-center justify-center p-4`}
                  id="artistic-womb-view"
                >
                  <div className="relative w-full h-full flex flex-col items-center justify-center text-center">
                    {/* Halo amniotique vasculaire lumineux */}
                    <div className="absolute w-56 h-56 rounded-full bg-gradient-to-br from-rose-600/25 via-amber-600/20 to-transparent blur-xl doppler-ring pointer-events-none"></div>
                    <div className="relative z-10 p-4 border border-rose-400/25 rounded-2xl bg-black/40 backdrop-blur-sm max-w-sm">
                      <div
                        className="w-16 h-16 mx-auto rounded-full bg-amber-950/60 border border-rose-500/40 flex items-center justify-center text-3xl shadow-inner mb-2"
                        id="womb-icon-display"
                      >
                        {activeData.icon}
                      </div>
                      <h4 className="text-sm font-bold text-amber-100 font-serif" id="womb-art-title">
                        Illustration Médicale In Utero · Semaine {currentWeek}
                      </h4>
                      <p
                        className="text-[11px] text-amber-200/85 mt-1 leading-relaxed font-serif italic"
                        id="womb-art-desc"
                      >
                        {activeData.inUtero} (Taille fœtale estimée : {activeData.metrics}, comparable à
                        une {activeData.fruit.toLowerCase()}).
                      </p>
                      <div className="mt-2 pt-2 border-t border-amber-500/20 flex justify-center items-center gap-3 text-[10px] font-mono text-rose-300">
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping"></span>{' '}
                          Cordon spiralé
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Échange
                          placentaire optimal
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Incrustations télémétriques échographiques */}
                <div className="absolute top-2.5 left-2.5 z-20 pointer-events-none bg-black/60 backdrop-blur-md px-2.5 py-1.5 rounded-lg text-[10px] sm:text-[11px] text-amber-100 font-mono flex flex-col space-y-0.5 border border-amber-500/20">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                    <span>
                      Cœur :{' '}
                      <strong className="text-rose-300 font-bold" id="fetal-heart-rate">
                        {currentBpm} bpm
                      </strong>
                    </span>
                  </div>
                  <div className="text-amber-300/80 text-[10px]" id="fetal-age-telemetry">
                    ÂGE : S{currentWeek} ({currentWeek} SA)
                  </div>
                </div>

                <div className="absolute top-2.5 right-2.5 z-20 pointer-events-none bg-black/60 backdrop-blur-md px-2.5 py-1.5 rounded-lg text-right text-[10px] sm:text-[11px] font-mono text-amber-200/90 border border-amber-500/20">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
                    <span className="text-red-400 font-bold tracking-wider">LIVE HD-4D</span>
                  </div>
                  <span className="text-amber-300/80" id="fetal-live-metrics">
                    {activeData.metrics} · {activeData.fruit}
                  </span>
                </div>

                {/* Avatar / Fruit & Effet liquide in utero */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10 opacity-30">
                  <div className="w-48 h-48 rounded-full border border-amber-500/20 fetal-halo flex items-center justify-center">
                    <span className="text-6xl filter drop-shadow" id="screen-fruit-avatar">
                      {activeData.icon}
                    </span>
                  </div>
                </div>

                {/* Barre de commande multimédia directement intégrée */}
                <div className="relative z-20 bg-stone-950/95 backdrop-blur-md px-3 sm:px-4 py-2 border-t border-amber-900/50 flex flex-col space-y-1.5">
                  <div className="w-full flex items-center space-x-2">
                    <span className="text-[10px] font-mono text-amber-300" id="video-timecode-cur">
                      00:{String(currentWeek).padStart(2, '0')}
                    </span>
                    <input
                      className="w-full h-1.5 bg-amber-950 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      id="video-scrubber"
                      max="100"
                      min="0"
                      type="range"
                      value={videoScrubberVal}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setVideoScrubberVal(val);
                        const targetW = Math.max(1, Math.min(40, Math.round((val / 100) * 40)));
                        selectWeek(targetW, false);
                      }}
                    />
                    <span className="text-[10px] font-mono text-amber-400/70" id="video-timecode-tot">
                      00:40
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between text-xs text-amber-200 gap-2">
                    <div className="flex items-center space-x-2.5">
                      <button
                        className="w-7 h-7 rounded-full bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 flex items-center justify-center text-amber-200 transition cursor-pointer"
                        id="inline-video-play-btn"
                        onClick={handleTogglePlayPause}
                        type="button"
                      >
                        {isVideoPlaying ? (
                          <svg
                            className="w-3.5 h-3.5"
                            fill="currentColor"
                            id="play-pause-icon"
                            viewBox="0 0 24 24"
                          >
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>
                          </svg>
                        ) : (
                          <svg
                            className="w-3.5 h-3.5"
                            fill="currentColor"
                            id="play-pause-icon"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z"></path>
                          </svg>
                        )}
                      </button>
                      <span className="text-[11px] font-semibold text-amber-100 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                        <span id="video-status-text">
                          {isVideoPlaying
                            ? 'Flux Écho 3D In Utero Actif'
                            : 'Pause (Vidéo figée)'}
                        </span>
                      </span>
                    </div>
                    {/* Contrôles interactifs du visualiseur */}
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      {/* Doppler Audio Synthétiseur Interactif */}
                      <button
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-500/50 text-[11px] text-rose-200 font-semibold transition shadow cursor-pointer"
                        id="btn-toggle-doppler-sound"
                        onClick={toggleDopplerHeartbeat}
                        type="button"
                      >
                        <span className="material-symbols-outlined text-xs text-rose-400">
                          favorite
                        </span>
                        <span id="doppler-sound-label">
                          {isDopplerPlaying
                            ? `🔊 Battements Actifs (${currentBpm} bpm)`
                            : `Doppler (${currentBpm} bpm)`}
                        </span>
                      </button>

                      {/* Bouton PRENDRE UNE CAPTURE sous le visualiseur 3D */}
                      <button
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/60 text-[11px] text-amber-200 hover:text-white font-bold transition shadow cursor-pointer active:scale-95"
                        id="btn-take-snapshot-viewer"
                        onClick={handleTakeSnapshot}
                        type="button"
                        title="Prendre une capture haute résolution de la vue actuelle"
                      >
                        <span className="material-symbols-outlined text-xs text-amber-300">photo_camera</span>
                        <span>Prendre une capture</span>
                      </button>

                      <button
                        className="bg-amber-900/30 hover:bg-amber-900/50 px-2 py-0.5 rounded text-[10px] border border-amber-700/40 text-amber-200 cursor-pointer"
                        id="btn-reset-cam"
                        onClick={() => resetCameraRef.current?.()}
                        type="button"
                      >
                        Vue Initiale
                      </button>
                      <span className="bg-amber-950 px-2 py-0.5 rounded border border-amber-800/40 text-amber-300 font-mono text-[10px]">
                        Pivoter 360°
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Toast de confirmation de capture enregistrée */}
              {snapshotFeedback && (
                <div className="mt-2.5 p-2 px-3 bg-emerald-950/90 border border-emerald-500/40 rounded-xl text-emerald-200 text-xs font-semibold flex items-center justify-between shadow-lg">
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-emerald-400">check_circle</span>
                    <span>{snapshotFeedback}</span>
                  </span>
                  <a
                    href="#fetal-evolution-gallery"
                    className="text-[11px] text-emerald-300 hover:text-emerald-100 underline font-bold"
                  >
                    Voir dans la galerie ↓
                  </a>
                </div>
              )}

              {/* Badges Biométriques Directs */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs font-serif mt-3.5">
                <div className="p-2 bg-amber-900/10 rounded-xl border border-amber-900/20">
                  <span className="block text-[10px] font-sans font-semibold text-amber-800 uppercase">
                    Longueur Cranio-Caudale
                  </span>
                  <strong className="text-xs sm:text-sm text-amber-950" id="badge-lcc">
                    {lccValue}
                  </strong>
                </div>
                <div className="p-2 bg-amber-900/10 rounded-xl border border-amber-900/20">
                  <span className="block text-[10px] font-sans font-semibold text-amber-800 uppercase">
                    Poids Estimé
                  </span>
                  <strong className="text-xs sm:text-sm text-amber-950" id="badge-weight">
                    {weightValue}
                  </strong>
                </div>
                <div className="p-2 bg-amber-900/10 rounded-xl border border-amber-900/20">
                  <span className="block text-[10px] font-sans font-semibold text-amber-800 uppercase">
                    Équivalence Fruit
                  </span>
                  <strong className="text-xs sm:text-sm text-amber-950" id="badge-fruit">
                    {activeData.fruit}
                  </strong>
                </div>
              </div>

              {/* Détails Cliniques & Explications en Français directement sous la vidéo */}
              <div className="mt-4 space-y-3">
                {/* Développement in utero */}
                <div className="bg-amber-900/5 p-3.5 rounded-xl border border-amber-900/15">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-1 flex items-center justify-between font-sans">
                    <span className="flex items-center gap-1.5">
                      👶 Développement in utero cette semaine
                    </span>
                    <button
                      className="text-[10px] text-amber-800 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                      onClick={() => speakCurrentWeekSection('inUtero')}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-xs">volume_up</span> Lire
                    </button>
                  </h4>
                  <p
                    className="text-xs text-amber-950 leading-relaxed font-serif italic"
                    id="display-desc-inutero"
                  >
                    {activeData.inUtero}
                  </p>
                </div>

                {/* Morphologie & Taille */}
                <div className="bg-amber-900/5 p-3.5 rounded-xl border border-amber-900/15">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-1 flex items-center justify-between font-sans">
                    <span className="flex items-center gap-1.5">
                      🔬 Morphologie Fœtale &amp; Croissance
                    </span>
                    <button
                      className="text-[10px] text-amber-800 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                      onClick={() => speakCurrentWeekSection('morpho')}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-xs">volume_up</span> Lire
                    </button>
                  </h4>
                  <p className="text-xs text-amber-950 leading-relaxed" id="display-desc-morpho">
                    {activeData.morpho}
                  </p>
                </div>

                {/* Démarches RMA & Obstétrique */}
                <div className="bg-amber-900/5 p-3.5 rounded-xl border border-amber-900/15">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-1.5 flex items-center justify-between font-sans">
                    <span className="flex items-center gap-1.5">
                      📋 Démarches Cliniques &amp; Obstétrique
                    </span>
                    <button
                      className="text-[10px] text-amber-800 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                      onClick={() => speakCurrentWeekSection('steps')}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-xs">volume_up</span> Lire
                    </button>
                  </h4>
                  <ul
                    className="text-xs text-amber-950 space-y-1 pl-4 list-disc font-medium"
                    id="display-steps-list"
                  >
                    {activeData.steps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ul>
                </div>

                {/* Conseils de Bien-Être */}
                <div className="bg-amber-900/5 p-3.5 rounded-xl border border-amber-900/15">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-1 flex items-center justify-between font-sans">
                    <span className="flex items-center gap-1.5">💖 Conseils de Bien-Être</span>
                    <button
                      className="text-[10px] text-amber-800 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                      onClick={() => speakCurrentWeekSection('advice')}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-xs">volume_up</span> Lire
                    </button>
                  </h4>
                  <p
                    className="text-xs text-amber-950 leading-relaxed font-serif italic"
                    id="display-desc-advice"
                  >
                    {activeData.advice}
                  </p>
                </div>

                {/* Barre de saut rapide Semaine Précédente / Semaine Suivante */}
                <div className="flex items-center justify-between pt-2 border-t border-amber-900/15 text-xs text-amber-900">
                  <span className="font-medium">Parcourir les semaines fœtales :</span>
                  <div className="flex items-center space-x-2">
                    <button
                      className="px-3 py-1 bg-amber-900/10 hover:bg-amber-900/20 rounded-lg font-bold text-amber-950 transition flex items-center gap-1 cursor-pointer"
                      id="btn-prev-week"
                      onClick={() => {
                        if (currentWeek > 1) selectWeek(currentWeek - 1, autoPlayVoice);
                      }}
                      type="button"
                    >
                      ← S-1
                    </button>
                    <span
                      className="font-bold text-amber-950 px-2 py-0.5 bg-amber-900/15 rounded-md"
                      id="scrubber-week-val"
                    >
                      S{currentWeek} / 40
                    </span>
                    <button
                      className="px-3 py-1 bg-amber-900/10 hover:bg-amber-900/20 rounded-lg font-bold text-amber-950 transition flex items-center gap-1 cursor-pointer"
                      id="btn-next-week"
                      onClick={() => {
                        if (currentWeek < 40) selectWeek(currentWeek + 1, autoPlayVoice);
                      }}
                      type="button"
                    >
                      S+1 →
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* PETITE GALERIE LOCALE D'ÉVOLUTION FŒTALE SOUS LA NICHE */}
            <div
              id="fetal-evolution-gallery"
              className="parchment-sheet rounded-2xl p-4 sm:p-5 border-2 border-[#bfa278] shadow-lg relative overflow-hidden"
            >
              {/* En-tête de la galerie */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-amber-900/15 pb-3 mb-3.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-600 animate-pulse"></span>
                    <h4 className="text-base sm:text-lg font-bold font-serif text-amber-950 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-amber-800 text-lg">photo_library</span>
                      <span>Galerie d'Évolution Fœtale</span>
                    </h4>
                  </div>
                  <p className="text-[11px] text-amber-900/80 font-serif italic mt-0.5">
                    Instantanés in utero sauvegardés localement pour suivre la métamorphose de votre petit garçon.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-900/10 text-amber-950 border border-amber-900/20">
                    {snapshots.length} {snapshots.length > 1 ? 'captures' : 'capture'}
                  </span>
                  {snapshots.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllSnapshots}
                      className="text-[10px] text-rose-900 hover:text-rose-950 hover:underline font-semibold flex items-center gap-0.5 px-2 py-0.5 rounded bg-rose-900/10 transition cursor-pointer"
                      title="Supprimer toutes les captures enregistrées"
                    >
                      <span className="material-symbols-outlined text-xs">delete</span>
                      Vider
                    </button>
                  )}
                </div>
              </div>

              {/* Contenu de la galerie */}
              {snapshots.length === 0 ? (
                <div className="text-center py-7 px-4 bg-amber-900/5 rounded-xl border border-amber-900/15 flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-amber-900/10 flex items-center justify-center text-amber-800 mb-2.5">
                    <span className="material-symbols-outlined text-2xl">photo_camera</span>
                  </div>
                  <h5 className="text-sm font-bold text-amber-950 font-serif">
                    Aucun cliché fœtal pour le moment
                  </h5>
                  <p className="text-xs text-amber-900/80 max-w-sm mt-1 mb-3.5 font-serif italic">
                    Cliquez sur le bouton « Prendre une capture » sous le visualiseur 3D ci-dessus pour immortaliser la vue de la Semaine {currentWeek} ({activeData.fruit}).
                  </p>
                  <button
                    type="button"
                    onClick={handleTakeSnapshot}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-amber-50 text-xs font-bold transition shadow flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <span className="material-symbols-outlined text-sm">camera</span>
                    <span>Capturer la Semaine {currentWeek} maintenant</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-1">
                    {snapshots.map((snap) => (
                      <div
                        key={snap.id}
                        className="group relative bg-stone-900 rounded-xl overflow-hidden border border-amber-900/40 shadow hover:shadow-md transition flex flex-col cursor-pointer"
                        onClick={() => setSelectedSnapshot(snap)}
                      >
                        {/* Miniature photo */}
                        <div className="relative aspect-video w-full overflow-hidden bg-black/60">
                          <img
                            src={snap.dataUrl}
                            alt={`Évolution Semaine ${snap.week}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          />
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-sm border border-amber-500/30 text-[9px] font-mono font-bold text-amber-300">
                            S{snap.week}
                          </div>
                          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-sm text-[9px] font-mono text-rose-300 flex items-center gap-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            {snap.heartRate} bpm
                          </div>
                        </div>

                        {/* Légende */}
                        <div className="p-2 bg-stone-950/90 text-amber-100 flex flex-col justify-between flex-1">
                          <div>
                            <p className="text-[11px] font-bold text-amber-200 truncate font-serif">
                              Semaine {snap.week} · {snap.fruit}
                            </p>
                            <p className="text-[9px] text-amber-400/80 font-mono truncate">
                              {snap.metrics}
                            </p>
                          </div>

                          <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-amber-900/40">
                            <span className="text-[9px] text-stone-400 font-mono truncate">
                              {snap.dateStr.split('·')[0]?.trim()}
                            </span>
                            <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => handleDownloadSnapshot(snap, e)}
                                className="p-1 rounded hover:bg-amber-900/50 text-amber-300 hover:text-white transition"
                                title="Télécharger ce cliché"
                              >
                                <span className="material-symbols-outlined text-[13px]">download</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteSnapshot(snap.id, e)}
                                className="p-1 rounded hover:bg-rose-900/50 text-rose-400 hover:text-rose-200 transition"
                                title="Supprimer"
                              >
                                <span className="material-symbols-outlined text-[13px]">delete</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-amber-900/15 flex items-center justify-between text-[11px] text-amber-900">
                    <span>💡 Cliquez sur un cliché pour l'agrandir en haute définition</span>
                    <button
                      type="button"
                      onClick={handleTakeSnapshot}
                      className="text-amber-800 hover:text-amber-950 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-xs">add_a_photo</span>
                      Nouveau cliché S{currentWeek}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Molette & Cadrans mécaniques en bois */}
        <section className="mt-8 pt-6 border-t-2 border-amber-900/20">
          <div className="text-center mb-4">
            <h3 className="font-serif font-bold text-lg sm:text-xl text-amber-950">
              Cadran Mécanique de Gestation • Gravure Noyer &amp; Laiton
            </h3>
            <p className="text-xs text-amber-900/80">
              Faites glisser le curseur pour explorer les 40 semaines de développement
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center bg-amber-900/10 p-4 sm:p-5 rounded-2xl border border-amber-900/20 shadow-inner">
            <div className="flex flex-col items-center justify-center p-2">
              <span className="text-[11px] uppercase tracking-wider font-bold text-amber-900 mb-2">
                Molette Trimestres
              </span>
              <div
                className="w-14 h-14 rounded-full brass-knob border-2 border-amber-950 flex items-center justify-center shadow-lg cursor-pointer"
                id="trimester-knob"
                onClick={handleTrimesterKnobClick}
                title="Cliquer pour changer de trimestre"
              >
                <div
                  className="w-1.5 h-5 bg-amber-950 rounded-full transform transition-transform"
                  id="trimester-needle"
                  style={{ transform: `rotate(${trimesterNeedleDeg}deg)` }}
                ></div>
              </div>
              <span className="text-xs font-bold text-amber-950 mt-2" id="trimester-knob-label">
                {trimesterKnobText}
              </span>
            </div>

            <div className="md:col-span-2 flex flex-col justify-center px-3">
              <div className="flex justify-between items-center mb-1 text-xs font-semibold text-amber-950">
                <span>Semaine 1 (Nov &apos;26)</span>
                <span
                  className="text-sm font-bold text-amber-900 bg-amber-200/70 px-2 py-0.5 rounded"
                  id="range-indicator"
                >
                  Semaine {currentWeek} ({currentWeek} SA)
                </span>
                <span>Semaine 40 (Juil &apos;27)</span>
              </div>
              <input
                className="wooden-slider w-full cursor-pointer"
                id="gestational-slider"
                max="40"
                min="1"
                type="range"
                value={currentWeek}
                onChange={(e) => selectWeek(parseInt(e.target.value, 10), false)}
              />
              <div className="flex justify-between text-[10px] text-amber-800/80 mt-1 font-mono">
                <span
                  className="cursor-pointer hover:underline"
                  onClick={() => selectWeek(4, autoPlayVoice)}
                >
                  Transfert FET
                </span>
                <span
                  className="cursor-pointer hover:underline"
                  onClick={() => selectWeek(12, autoPlayVoice)}
                >
                  Écho T1 (S12)
                </span>
                <span
                  className="cursor-pointer hover:underline"
                  onClick={() => selectWeek(24, autoPlayVoice)}
                >
                  Viabilité (S24)
                </span>
                <span
                  className="cursor-pointer hover:underline"
                  onClick={() => selectWeek(40, autoPlayVoice, true)}
                >
                  Terme (S40)
                </span>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center p-2">
              <span className="text-[11px] uppercase tracking-wider font-bold text-amber-900 mb-2">
                Jalon Actuel
              </span>
              <div className="w-14 h-14 rounded-full bg-amber-100 border-2 border-amber-900 flex items-center justify-center shadow-inner relative">
                <div
                  className="w-1 h-6 bg-amber-900 rounded-full origin-bottom"
                  id="milestone-dial-needle"
                  style={{ transform: `rotate(${milestoneDialDeg}deg)` }}
                ></div>
                <div className="w-2.5 h-2.5 rounded-full brass-knob absolute"></div>
              </div>
              <span
                className="text-xs font-semibold text-amber-950 mt-2 text-center"
                id="milestone-dial-desc"
              >
                {milestoneDialDesc}
              </span>
            </div>
          </div>
        </section>

        {/* Tiroirs Cliniques Dépliables */}
        <section className="mt-8">
          <div className="flex flex-wrap gap-2 border-b border-amber-900/30 pb-3" role="tablist">
            <button
              className={`tab-btn px-4 py-2 rounded-t-xl font-serif font-bold text-sm cursor-pointer ${
                activeTab === 'module-ivf-file'
                  ? 'bg-parchment-100 border border-[#cfb286] text-amber-950'
                  : 'bg-amber-900/20 text-amber-900 hover:bg-parchment-100'
              }`}
              onClick={() => setActiveTab('module-ivf-file')}
              type="button"
            >
              📋 {language === 'en' ? 'Patient File & IVF Protocol' : 'Dossier Patient & Protocole IVF'}
            </button>
            <button
              className={`tab-btn px-4 py-2 rounded-t-xl font-serif font-bold text-sm cursor-pointer ${
                activeTab === 'module-fet'
                  ? 'bg-parchment-100 border border-[#cfb286] text-amber-950'
                  : 'bg-amber-900/20 text-amber-900 hover:bg-parchment-100'
              }`}
              data-target="module-fet"
              onClick={() => setActiveTab('module-fet')}
              type="button"
            >
              Calculateur Spécifique FET (RMA NY)
            </button>
            <button
              className={`tab-btn px-4 py-2 rounded-t-xl font-serif font-bold text-sm cursor-pointer ${
                activeTab === 'module-timeline'
                  ? 'bg-parchment-100 border border-[#cfb286] text-amber-950'
                  : 'bg-amber-900/20 text-amber-900 hover:bg-parchment-100'
              }`}
              data-target="module-timeline"
              onClick={() => setActiveTab('module-timeline')}
              type="button"
            >
              Chronologie Obstétrique RMA • 40 Semaines
            </button>
            <button
              className={`tab-btn px-4 py-2 rounded-t-xl font-serif font-bold text-sm cursor-pointer ${
                activeTab === 'module-checklists'
                  ? 'bg-parchment-100 border border-[#cfb286] text-amber-950'
                  : 'bg-amber-900/20 text-amber-900 hover:bg-parchment-100'
              }`}
              data-target="module-checklists"
              onClick={() => setActiveTab('module-checklists')}
              type="button"
            >
              Check-lists &amp; Agenda Médical
            </button>
            <button
              className={`tab-btn px-4 py-2 rounded-t-xl font-serif font-bold text-sm cursor-pointer ${
                activeTab === 'module-journal'
                  ? 'bg-parchment-100 border border-[#cfb286] text-amber-950'
                  : 'bg-amber-900/20 text-amber-900 hover:bg-parchment-100'
              }`}
              data-target="module-journal"
              onClick={() => setActiveTab('module-journal')}
              type="button"
            >
              Carnet de Bord &amp; Traitements Fatou
            </button>
          </div>

          <div className="parchment-sheet rounded-b-2xl rounded-tr-2xl p-5 sm:p-7 border border-[#cfb286]">
            {/* Module Dossier Patient & Protocole IVF (Nov 2026) */}
            <div
              className={`tab-pane space-y-6 ${activeTab === 'module-ivf-file' ? '' : 'hidden'}`}
              id="module-ivf-file"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-amber-900/20 pb-4">
                <div>
                  <span className="text-xs uppercase font-bold text-amber-800 tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
                    <span>{language === 'en' ? 'Primary Patient File & Comprehensive Protocol Summary' : 'Dossier Patient & Résumé Complet du Protocole'}</span>
                  </span>
                  <h3 className="font-serif font-bold text-2xl text-amber-950 mt-1">
                    {language === 'en' ? 'RMA of New York • Fatou & Baby Boy' : 'RMA of New York • Fatou & Petit Prince'}
                  </h3>
                  <p className="text-xs text-amber-900/80 font-serif italic">
                    {language === 'en' ? 'Generated & Synced on November 6, 2026 • Secure Gmail Privacy' : 'Généré & Synchronisé le 6 Novembre 2026 • Confidentialité Gmail Sécurisée'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setIsEditingIvfFile((prev) => !prev)}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-800 hover:bg-amber-900 text-amber-50 font-bold text-xs shadow transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {isEditingIvfFile ? 'close' : 'edit_note'}
                    </span>
                    <span>{isEditingIvfFile ? (language === 'en' ? 'Cancel Editing' : 'Annuler') : (language === 'en' ? 'Edit Patient File' : 'Modifier le Dossier')}</span>
                  </button>
                </div>
              </div>

              {isEditingIvfFile ? (
                <form onSubmit={handleSaveIvfFileForm} className="space-y-4 p-4 sm:p-6 bg-amber-900/10 rounded-2xl border border-amber-800/30">
                  <h4 className="font-serif font-bold text-lg text-amber-950 border-b border-amber-900/20 pb-2">
                    {language === 'en' ? 'Edit Primary Patient File' : 'Modification du Dossier Patient'}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Primary Clinic Name</label>
                      <input type="text" value={editClinicName} onChange={(e) => setEditClinicName(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Clinic Address</label>
                      <input type="text" value={editClinicAddress} onChange={(e) => setEditClinicAddress(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Embryology Lab</label>
                      <input type="text" value={editEmbryologyLab} onChange={(e) => setEditEmbryologyLab(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Embryologist</label>
                      <input type="text" value={editEmbryologist} onChange={(e) => setEditEmbryologist(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Surgical Facility (Hysteroscopy)</label>
                      <input type="text" value={editSurgicalFacility} onChange={(e) => setEditSurgicalFacility(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Surgical Address</label>
                      <input type="text" value={editSurgicalAddress} onChange={(e) => setEditSurgicalAddress(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-bold text-amber-950 mb-1">Surgical Intervention Details</label>
                      <input type="text" value={editIntervention} onChange={(e) => setEditIntervention(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Eggs Retrieved (Cycle 2)</label>
                      <input type="text" value={editEggsRetrieved} onChange={(e) => setEditEggsRetrieved(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Mature / ICSI Fertilized</label>
                      <input type="text" value={editMatureFertilized} onChange={(e) => setEditMatureFertilized(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Biopsied & Vitrified</label>
                      <input type="text" value={editBiopsiedVitrified} onChange={(e) => setEditBiopsiedVitrified(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">PGT-A Results / Euploid Normal</label>
                      <input type="text" value={editPgtaResult} onChange={(e) => setEditPgtaResult(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Active Medication</label>
                      <input type="text" value={editMedication} onChange={(e) => setEditMedication(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div>
                      <label className="block font-bold text-amber-950 mb-1">Medication Start Date</label>
                      <input type="text" value={editMedStartDate} onChange={(e) => setEditMedStartDate(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-bold text-amber-950 mb-1">Medication Purpose</label>
                      <input type="text" value={editMedPurpose} onChange={(e) => setEditMedPurpose(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-bold text-amber-950 mb-1">Patient Journal & Medical Notes Summary</label>
                      <textarea rows={3} value={editNotesSummary} onChange={(e) => setEditNotesSummary(e.target.value)} className="w-full px-3 py-1.5 rounded border bg-white" required />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t border-amber-900/20">
                    <button type="button" onClick={() => setIsEditingIvfFile(false)} className="px-3 py-1.5 bg-amber-900/10 text-amber-950 font-semibold rounded text-xs">
                      {language === 'en' ? 'Cancel' : 'Annuler'}
                    </button>
                    <button type="submit" className="px-4 py-1.5 bg-amber-800 hover:bg-amber-900 text-white font-bold rounded text-xs shadow">
                      {language === 'en' ? 'Save & Sync to Cloud' : 'Enregistrer & Synchroniser'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-6 text-xs">
                  {/* 1. Primary Clinic & Surgical Team */}
                  <div className="p-4 bg-amber-950/5 rounded-2xl border border-amber-900/15 space-y-2.5">
                    <h4 className="font-serif font-bold text-base text-amber-950 flex items-center gap-2 border-b border-amber-900/15 pb-2">
                      <span className="material-symbols-outlined text-amber-800 text-base">local_hospital</span>
                      <span>1. Primary Clinic &amp; Surgical Team</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-amber-900">
                      <div>
                        <strong className="text-amber-950 block">Primary Clinic:</strong>
                        <span>{ivfFile.clinicName}</span>
                        <p className="text-[11px] text-amber-900/80">{ivfFile.clinicAddress}</p>
                      </div>
                      <div>
                        <strong className="text-amber-950 block">Embryology Laboratory:</strong>
                        <span>{ivfFile.embryologyLab}</span>
                        <p className="text-[11px] text-amber-900/80">Embryologist: <strong>{ivfFile.embryologist}</strong></p>
                      </div>
                      <div className="sm:col-span-2 pt-2 border-t border-amber-900/10">
                        <strong className="text-amber-950 block">Surgical Center (Hysteroscopy):</strong>
                        <span>{ivfFile.surgicalFacility}</span>
                        <p className="text-[11px] text-amber-900/80">{ivfFile.surgicalAddress}</p>
                        <p className="text-[11px] text-amber-950 font-semibold mt-1">⚡ Intervention: {ivfFile.intervention}</p>
                      </div>
                    </div>
                  </div>

                  {/* 2. Embryology Lab Results (Cycle 2) */}
                  <div className="p-4 bg-amber-950/5 rounded-2xl border border-amber-900/15 space-y-2.5">
                    <h4 className="font-serif font-bold text-base text-amber-950 flex items-center gap-2 border-b border-amber-900/15 pb-2">
                      <span className="material-symbols-outlined text-amber-800 text-base">science</span>
                      <span>2. Embryology Lab Results (Cycle 2)</span>
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="p-2.5 bg-amber-900/10 rounded-xl border border-amber-900/15">
                        <span className="block text-[10px] font-sans font-semibold text-amber-800 uppercase">Eggs Retrieved</span>
                        <strong className="text-xs sm:text-sm text-amber-950">{ivfFile.eggsRetrieved}</strong>
                      </div>
                      <div className="p-2.5 bg-amber-900/10 rounded-xl border border-amber-900/15">
                        <span className="block text-[10px] font-sans font-semibold text-amber-800 uppercase">Mature / ICSI</span>
                        <strong className="text-xs sm:text-sm text-amber-950">{ivfFile.matureFertilized}</strong>
                      </div>
                      <div className="p-2.5 bg-amber-900/10 rounded-xl border border-amber-900/15">
                        <span className="block text-[10px] font-sans font-semibold text-amber-800 uppercase">Biopsied &amp; Vitrified</span>
                        <strong className="text-xs sm:text-sm text-amber-950">{ivfFile.biopsiedVitrified}</strong>
                      </div>
                      <div className="p-2.5 bg-emerald-900/15 rounded-xl border border-emerald-800/30">
                        <span className="block text-[10px] font-sans font-semibold text-emerald-900 uppercase">PGT-A Euploid</span>
                        <strong className="text-xs sm:text-sm text-emerald-950 font-bold">{ivfFile.pgtaResult}</strong>
                      </div>
                    </div>
                  </div>

                  {/* 3. Active Medication Protocol */}
                  <div className="p-4 bg-amber-950/5 rounded-2xl border border-amber-900/15 space-y-2.5">
                    <h4 className="font-serif font-bold text-base text-amber-950 flex items-center gap-2 border-b border-amber-900/15 pb-2">
                      <span className="material-symbols-outlined text-amber-800 text-base">medication</span>
                      <span>3. Active Medication Protocol</span>
                    </h4>
                    <div className="space-y-1 text-amber-900">
                      <p>💊 Medication: <strong className="text-amber-950">{ivfFile.medication}</strong></p>
                      <p>📅 Start Date: <strong className="text-amber-950">{ivfFile.medStartDate}</strong></p>
                      <p className="italic font-serif">🎯 Purpose: {ivfFile.medPurpose}</p>
                    </div>
                  </div>

                  {/* 4. Clinical Steps for Frozen Embryo Transfer (FET) (Dual Language) */}
                  <div className="p-4 bg-amber-950/5 rounded-2xl border border-amber-900/15 space-y-2.5">
                    <h4 className="font-serif font-bold text-base text-amber-950 flex items-center gap-2 border-b border-amber-900/15 pb-2">
                      <span className="material-symbols-outlined text-amber-800 text-base">translate</span>
                      <span>4. Clinical Steps for Frozen Embryo Transfer (FET) • Dual Language</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <span className="font-bold text-amber-950 block">🇫🇷 Français :</span>
                        <ul className="space-y-1.5 list-disc pl-4 text-amber-900">
                          <li><strong>Évaluation &amp; Baseline :</strong> Contrôle écho-doppler initial et bilan hormonal au cabinet RMA East Side pour valider le repos ovarien et l'épaisseur endométriale.</li>
                          <li><strong>Hystéroscopie &amp; Chirurgie :</strong> Intervention au Gramercy Surgery Center pour l'ablation des débris intra-utérins et l'optimisation de la cavité d'accueil.</li>
                          <li><strong>Support Hormonal &amp; Transfert :</strong> Supplémentation en œstrogènes (Estrace 2 mg PO AM &amp; PM) et progestérone pour synchroniser l'endomètre avant le transfert du blastocyste euploïde 💙.</li>
                        </ul>
                      </div>
                      <div className="space-y-2 border-t md:border-t-0 md:border-l border-amber-900/15 pt-3 md:pt-0 md:pl-4">
                        <span className="font-bold text-amber-950 block">🇬🇧 English :</span>
                        <ul className="space-y-1.5 list-disc pl-4 text-amber-900">
                          <li><strong>Evaluation &amp; Baseline:</strong> Initial ultrasound &amp; hormonal check at RMA East Side to validate baseline endometrial thickness.</li>
                          <li><strong>Hysteroscopy &amp; Surgery:</strong> Procedure at Gramercy Surgery Center for intrauterine debris removal and uterine cavity optimization.</li>
                          <li><strong>Hormonal Support &amp; Transfer:</strong> Estrogen supplementation (Estrace 2 mg PO AM &amp; PM) and progesterone to synchronize the endometrium prior to euploid blastocyst transfer 💙.</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* 5. Chronological Treatment Phases */}
                  <div className="p-4 bg-amber-950/5 rounded-2xl border border-amber-900/15 space-y-2.5">
                    <h4 className="font-serif font-bold text-base text-amber-950 flex items-center gap-2 border-b border-amber-900/15 pb-2">
                      <span className="material-symbols-outlined text-amber-800 text-base">timeline</span>
                      <span>5. Chronological Treatment Phases</span>
                    </h4>
                    <div className="space-y-3">
                      <div className="p-2.5 bg-white/70 rounded-xl border border-amber-900/10">
                        <strong className="text-amber-950 block font-serif">Phase 1: Stimulation Ovarienne (Completed)</strong>
                        <p className="text-[11px] text-amber-900">Nortrel suppression (Sep 19) • Gonal-F 150 IU + Menopur 150 IU (Sep 21) • Trigger shot (Sep 29) • Oocyte retrieval: 42 oocytes (Oct 1, 2026).</p>
                      </div>
                      <div className="p-2.5 bg-amber-900/10 rounded-xl border border-amber-800/30">
                        <strong className="text-amber-950 block font-serif">Phase 2: Laboratoire &amp; Préparation (Active)</strong>
                        <p className="text-[11px] text-amber-900">ICSI fertilization &amp; 8 blastocysts vitrified by Alex (Oct 2–9) • SIS scan (Oct 15) • PGT-A 5 euploid confirmed 💙 (Oct 26) • Hysteroscopy at Gramercy Surgery Center (Oct 28) • Estrace started (Nov 6, 2026).</p>
                      </div>
                      <div className="p-2.5 bg-white/70 rounded-xl border border-amber-900/10">
                        <strong className="text-amber-950 block font-serif">Phase 3: Suivi RMA &amp; Obstétrique (Upcoming)</strong>
                        <p className="text-[11px] text-amber-900">Quantitative Beta-hCG blood tests (Nov 2026) • Early viability scans (Weeks 5–8) • Graduation to OB/GYN (Weeks 8–10).</p>
                      </div>
                      <div className="p-2.5 bg-white/70 rounded-xl border border-amber-900/10">
                        <strong className="text-amber-950 block font-serif">Phase 4: Soins Obstétricaux &amp; Naissance (Upcoming)</strong>
                        <p className="text-[11px] text-amber-900">NIPT screening &amp; Level II Anatomy Scan (Week 22) • Glucose screening • Welcoming your baby 💙 (June/July 2027).</p>
                      </div>
                    </div>
                  </div>

                  {/* 6. Patient Journal & Medical Notes Summary */}
                  <div className="p-4 bg-amber-950/5 rounded-2xl border border-amber-900/15 space-y-2.5">
                    <h4 className="font-serif font-bold text-base text-amber-950 flex items-center gap-2 border-b border-amber-900/15 pb-2">
                      <span className="material-symbols-outlined text-amber-800 text-base">edit_note</span>
                      <span>6. Patient Journal &amp; Medical Notes Summary</span>
                    </h4>
                    <p className="text-xs text-amber-900 leading-relaxed font-serif">
                      {ivfFile.notesSummary}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {/* Module FET */}
            <div
              className={`tab-pane space-y-4 ${activeTab === 'module-fet' ? '' : 'hidden'}`}
              id="module-fet"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="p-3.5 bg-amber-950/5 rounded-xl border border-amber-900/10">
                  <h4 className="font-bold text-amber-950 mb-1">Règles de Calcul FET (J5)</h4>
                  <ul className="space-y-1 text-amber-900">
                    <li>
                      • Âge au transfert : <strong>2 Semaines + 5 Jours</strong>
                    </li>
                    <li>
                      • DDR Médicale calculée : <strong>15 Octobre 2026</strong>
                    </li>
                    <li>
                      • Date du Transfert : <strong>05 Novembre 2026</strong>
                    </li>
                    <li>
                      • Embryon : <strong>Blastocyste J5 Euploïde</strong>
                    </li>
                  </ul>
                </div>
                <div className="p-3.5 bg-amber-950/5 rounded-xl border border-amber-900/10">
                  <h4 className="font-bold text-amber-950 mb-1">Profil Génétique Embryonnaire</h4>
                  <ul className="space-y-1 text-amber-900">
                    <li>
                      • Statut PGT-A : <strong>Euploïde normal (46, XY)</strong>
                    </li>
                    <li>
                      • Sexe : <strong>Garçon confirmé</strong>
                    </li>
                    <li>
                      • Qualité blastocyste : <strong>Grade AA Supérieur</strong>
                    </li>
                    <li>
                      • Centre de fertilité : <strong>RMA of New York</strong>
                    </li>
                  </ul>
                </div>
                <div className="p-3.5 bg-amber-950/5 rounded-xl border border-amber-900/10">
                  <h4 className="font-bold text-amber-950 mb-1">Surveillance Bêta-hCG Initiale</h4>
                  <ul className="space-y-1 text-amber-900">
                    <li>
                      • J9 post-transfert : <strong>148 UI/L</strong> (Seuil positif &gt; 50)
                    </li>
                    <li>
                      • J11 post-transfert : <strong>362 UI/L</strong> (Temps de doublement 37h)
                    </li>
                    <li>
                      • J14 post-transfert : <strong>1 490 UI/L</strong> (Cinétique optimale)
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Module Chronologie */}
            <div
              className={`tab-pane space-y-4 ${activeTab === 'module-timeline' ? '' : 'hidden'}`}
              id="module-timeline"
            >
              <h3 className="font-serif font-bold text-2xl text-amber-950">
                Feuille de Route Obstétrique de Fatou (S1 à S40)
              </h3>
              <p className="text-xs text-amber-900">
                Jalons obligatoires de la procréation médicalement assistée jusqu&apos;à la
                maternité.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-amber-950 border-collapse">
                  <thead>
                    <tr className="bg-amber-900/15 border-b border-amber-900/30">
                      <th className="py-2.5 px-3 font-bold">Semaine</th>
                      <th className="py-2.5 px-3 font-bold">Étape Clinique &amp; Obstétrique</th>
                      <th className="py-2.5 px-3 font-bold">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-900/10">
                    <tr>
                      <td className="py-2 px-3 font-bold">S1-S3</td>
                      <td className="py-2 px-3">
                        Préparation endomètre &amp; Transfert Blastocyste J5
                      </td>
                      <td className="py-2 px-3 text-emerald-800 font-bold">Validé ✓</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-bold">S6-S8</td>
                      <td className="py-2 px-3">
                        Échographie précoce de viabilité (Activité cardiaque 120-160)
                      </td>
                      <td className="py-2 px-3 text-emerald-800 font-bold">Validé ✓</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-bold">S10</td>
                      <td className="py-2 px-3">
                        Arrêt progressif de la progestérone &amp; Transfert vers obstétrique
                      </td>
                      <td className="py-2 px-3 text-emerald-800 font-bold">Validé ✓</td>
                    </tr>
                    <tr className="bg-amber-200/40">
                      <td className="py-2 px-3 font-bold">S12 (Active)</td>
                      <td className="py-2 px-3">
                        Échographie T1 (Clarté nucale) + Bilan DPNI sanguin
                      </td>
                      <td className="py-2 px-3 text-amber-900 font-bold">En cours ⏳</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-bold">S22</td>
                      <td className="py-2 px-3">Échographie morphologique de niveau II</td>
                      <td className="py-2 px-3 text-stone-600">À venir</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-bold">S40</td>
                      <td className="py-2 px-3">
                        Date Prévue d&apos;Accouchement (22 Juillet 2027)
                      </td>
                      <td className="py-2 px-3 text-amber-900 font-bold">Terme</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Module Checklists & Agenda Médical */}
            <div
              className={`tab-pane space-y-6 ${activeTab === 'module-checklists' ? '' : 'hidden'}`}
              id="module-checklists"
            >
              {/* Partie 1 : Engagements Cliniques & Progression */}
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-serif font-bold text-2xl text-amber-950">
                      Engagements Cliniques &amp; Progression
                    </h3>
                    <p className="text-xs text-amber-900/80 font-serif italic">
                      Les étapes fondamentales de votre parcours de procréation médicalement assistée.
                    </p>
                  </div>
                  {checklists.every(Boolean) ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-700/15 border border-emerald-600/30 text-emerald-900 font-bold text-xs">
                      <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
                      ✓ 4/4 Objectifs Validés
                    </span>
                  ) : (
                    <span className="text-xs text-amber-900 font-medium bg-amber-900/10 px-2.5 py-1 rounded-full border border-amber-900/15">
                      {checklists.filter(Boolean).length}/4 validés
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {[
                    'Validation du protocole FET & confirmation garçon euploïde (46, XY).',
                    'Transfert blastocyste J5 sous contrôle échographique.',
                    'Bêta-hCG sériés confirmant une cinétique vigoureuse.',
                    'Échographie du premier trimestre (Clarté nucale à S12).'
                  ].map((label, idx) => (
                    <label
                      key={idx}
                      className={`flex items-start space-x-2.5 p-3 rounded-xl border cursor-pointer transition ${
                        checklists[idx]
                          ? 'bg-amber-900/10 border-amber-800/25'
                          : 'bg-amber-950/5 border-amber-900/10'
                      }`}
                    >
                      <input
                        checked={checklists[idx]}
                        onChange={() => handleToggleChecklist(idx)}
                        className="mt-0.5 rounded text-amber-700 cursor-pointer"
                        type="checkbox"
                      />
                      <span className={`text-amber-950 font-medium ${checklists[idx] ? 'font-semibold' : ''}`}>
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Partie 2 : Agenda des Rendez-vous Médicaux Personnalisés (Classés Chronologiquement) */}
              <div className="pt-6 border-t border-amber-900/20 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-700 animate-pulse"></span>
                      <h4 className="font-serif font-bold text-xl text-amber-950 flex items-center gap-2">
                        <span className="material-symbols-outlined text-amber-800 text-xl">event_available</span>
                        <span>Rendez-vous Médicaux Personnalisés</span>
                      </h4>
                    </div>
                    <p className="text-xs text-amber-900/80 font-serif italic mt-0.5">
                      Ajoutez vos dates de consultations, échographies et prises de sang. Classés par ordre chronologique et sauvegardés localement.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setIsAptFormOpen((prev) => !prev)}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-800 hover:bg-amber-900 text-amber-50 font-bold text-xs shadow transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {isAptFormOpen ? 'close' : 'add'}
                      </span>
                      <span>{isAptFormOpen ? 'Fermer le formulaire' : 'Ajouter un rendez-vous'}</span>
                    </button>
                  </div>
                </div>

                {/* Formulaire d'ajout d'un rendez-vous */}
                {isAptFormOpen && (
                  <form
                    onSubmit={handleAddAppointment}
                    className="p-4 sm:p-5 bg-amber-900/10 rounded-2xl border border-amber-800/30 space-y-3.5 animate-fade-in shadow-inner"
                  >
                    <div className="flex items-center justify-between border-b border-amber-900/15 pb-2">
                      <span className="text-xs font-bold font-serif text-amber-950 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-amber-800">calendar_add_on</span>
                        Nouveau Rendez-vous Médical
                      </span>
                      <span className="text-[11px] text-amber-900/80 italic font-serif">
                        Tri automatique par date chronologique
                      </span>
                    </div>

                    {/* Suggestions rapides */}
                    <div>
                      <span className="text-[10px] font-bold text-amber-900 block mb-1.5 uppercase tracking-wider font-sans">
                        💡 Suggestions rapides (cliquez pour pré-remplir) :
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { title: 'Échographie T1 (Clarté nucale)', cat: 'echo' },
                          { title: 'Consultation Obstétrique 4e mois', cat: 'consultation' },
                          { title: 'Échographie Morphologique T2', cat: 'echo' },
                          { title: 'Dépistage Diabète Gestationnel (HGPO)', cat: 'labo' },
                          { title: 'Échographie de Croissance T3', cat: 'echo' },
                          { title: 'Consultation Pré-anesthésie', cat: 'consultation' },
                          { title: 'Séance Préparation à la Naissance', cat: 'prep' },
                          { title: 'Prise de sang / Bilan mensuel', cat: 'labo' },
                        ].map((sug, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setAptFormTitle(sug.title);
                              setAptFormCategory(sug.cat as AppointmentCategory);
                            }}
                            className="text-[11px] px-2.5 py-1 rounded-full bg-white/70 hover:bg-white text-amber-950 border border-amber-900/20 transition cursor-pointer font-medium shadow-2xs"
                          >
                            + {sug.title}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs">
                      {/* Date */}
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-bold text-amber-950 mb-1">
                          Date du rendez-vous *
                        </label>
                        <input
                          type="date"
                          required
                          value={aptFormDate}
                          onChange={(e) => setAptFormDate(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-amber-900/30 bg-white/90 text-amber-950 focus:outline-none focus:ring-1 focus:ring-amber-700 text-xs shadow-2xs"
                        />
                      </div>

                      {/* Heure */}
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-amber-950 mb-1">
                          Heure (optionnel)
                        </label>
                        <input
                          type="time"
                          value={aptFormTime}
                          onChange={(e) => setAptFormTime(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-amber-900/30 bg-white/90 text-amber-950 focus:outline-none focus:ring-1 focus:ring-amber-700 text-xs shadow-2xs"
                        />
                      </div>

                      {/* Catégorie */}
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-bold text-amber-950 mb-1">
                          Type d'examen / Catégorie
                        </label>
                        <select
                          value={aptFormCategory}
                          onChange={(e) => setAptFormCategory(e.target.value as AppointmentCategory)}
                          className="w-full px-3 py-1.5 rounded-lg border border-amber-900/30 bg-white/90 text-amber-950 focus:outline-none focus:ring-1 focus:ring-amber-700 text-xs cursor-pointer shadow-2xs"
                        >
                          <option value="echo">🔬 Échographie (T1, T2, T3)</option>
                          <option value="consultation">🩺 Consultation Médicale / Obstétricien</option>
                          <option value="labo">🧪 Prise de sang / Bilan biologique</option>
                          <option value="prep">👶 Préparation à la naissance / Sage-femme</option>
                          <option value="autre">📌 Autre démarche</option>
                        </select>
                      </div>

                      {/* Intitulé */}
                      <div className="sm:col-span-7">
                        <label className="block text-[11px] font-bold text-amber-950 mb-1">
                          Motif / Intitulé du rendez-vous *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Ex: Échographie morphologique T2 (Dr. Laurent)"
                          value={aptFormTitle}
                          onChange={(e) => setAptFormTitle(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-amber-900/30 bg-white/90 text-amber-950 placeholder-amber-900/40 focus:outline-none focus:ring-1 focus:ring-amber-700 text-xs shadow-2xs"
                        />
                      </div>

                      {/* Praticien / Lieu */}
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-bold text-amber-950 mb-1">
                          Praticien &amp; Lieu (optionnel)
                        </label>
                        <input
                          type="text"
                          placeholder="Ex: Cabinet RMA of NY / Hôpital"
                          value={aptFormDoctor}
                          onChange={(e) => setAptFormDoctor(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-amber-900/30 bg-white/90 text-amber-950 placeholder-amber-900/40 focus:outline-none focus:ring-1 focus:ring-amber-700 text-xs shadow-2xs"
                        />
                      </div>

                      {/* Consignes / Notes */}
                      <div className="sm:col-span-12">
                        <label className="block text-[11px] font-bold text-amber-950 mb-1">
                          Consignes particulières &amp; Notes (optionnel)
                        </label>
                        <input
                          type="text"
                          placeholder="Ex: À jeun depuis minuit, vessie pleine 1h avant, apporter ordonnance DPNI..."
                          value={aptFormNotes}
                          onChange={(e) => setAptFormNotes(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-amber-900/30 bg-white/90 text-amber-950 placeholder-amber-900/40 focus:outline-none focus:ring-1 focus:ring-amber-700 text-xs shadow-2xs"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-900/15">
                      <button
                        type="button"
                        onClick={() => setIsAptFormOpen(false)}
                        className="px-3 py-1.5 rounded-lg bg-amber-900/10 hover:bg-amber-900/20 text-amber-950 font-semibold text-xs transition cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs transition shadow flex items-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <span className="material-symbols-outlined text-sm">check</span>
                        <span>Enregistrer le rendez-vous</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Feedback toast */}
                {aptFeedback && (
                  <div className="p-2.5 bg-emerald-800/15 border border-emerald-700/30 rounded-xl text-emerald-950 text-xs font-semibold flex items-center gap-2 animate-fade-in">
                    <span className="material-symbols-outlined text-sm text-emerald-700">check_circle</span>
                    <span>{aptFeedback}</span>
                  </div>
                )}

                {/* Barre de filtres et statistiques */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[11px] text-amber-900/80 font-bold uppercase tracking-wider mr-1">
                      Filtrer :
                    </span>
                    <button
                      type="button"
                      onClick={() => setAptFilter('all')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        aptFilter === 'all'
                          ? 'bg-amber-900 text-amber-50 shadow-xs'
                          : 'bg-amber-900/10 text-amber-900 hover:bg-amber-900/20'
                      }`}
                    >
                      Tous ({sortedAppointments.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setAptFilter('upcoming')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        aptFilter === 'upcoming'
                          ? 'bg-amber-900 text-amber-50 shadow-xs'
                          : 'bg-amber-900/10 text-amber-900 hover:bg-amber-900/20'
                      }`}
                    >
                      À venir ({sortedAppointments.filter((a) => !a.completed).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setAptFilter('completed')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        aptFilter === 'completed'
                          ? 'bg-amber-900 text-amber-50 shadow-xs'
                          : 'bg-amber-900/10 text-amber-900 hover:bg-amber-900/20'
                      }`}
                    >
                      Effectués ({sortedAppointments.filter((a) => a.completed).length})
                    </button>
                  </div>

                  <span className="text-[11px] text-amber-900/80 italic font-serif">
                    Ordre chronologique ascendant
                  </span>
                </div>

                {/* Liste chronologique des rendez-vous */}
                {filteredAppointments.length === 0 ? (
                  <div className="p-6 text-center bg-amber-900/5 rounded-2xl border border-amber-900/15">
                    <span className="material-symbols-outlined text-3xl text-amber-800/60 block mb-1">
                      calendar_today
                    </span>
                    <p className="text-xs font-serif font-semibold text-amber-950">
                      {aptFilter === 'completed'
                        ? 'Aucun rendez-vous marqué comme effectué pour le moment.'
                        : aptFilter === 'upcoming'
                        ? 'Aucun rendez-vous à venir dans cette vue.'
                        : 'Aucun rendez-vous enregistré.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsAptFormOpen(true)}
                      className="mt-2 text-xs text-amber-800 hover:text-amber-950 font-bold underline cursor-pointer"
                    >
                      + Ajouter votre premier rendez-vous
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredAppointments.map((apt) => {
                      const rel = getRelativeDateLabel(apt.date);
                      const formattedDate = formatAppointmentDate(apt.date);

                      let catBadge = {
                        label: 'Consultation',
                        icon: 'medical_services',
                        color: 'bg-emerald-700/15 text-emerald-950 border-emerald-600/30',
                      };
                      if (apt.category === 'echo') {
                        catBadge = {
                          label: 'Échographie',
                          icon: 'monitor_heart',
                          color: 'bg-rose-700/15 text-rose-950 border-rose-600/30',
                        };
                      } else if (apt.category === 'labo') {
                        catBadge = {
                          label: 'Laboratoire',
                          icon: 'science',
                          color: 'bg-amber-700/15 text-amber-950 border-amber-600/30',
                        };
                      } else if (apt.category === 'prep') {
                        catBadge = {
                          label: 'Préparation',
                          icon: 'child_care',
                          color: 'bg-sky-700/15 text-sky-950 border-sky-600/30',
                        };
                      } else if (apt.category === 'autre') {
                        catBadge = {
                          label: 'Autre',
                          icon: 'event',
                          color: 'bg-stone-700/15 text-stone-950 border-stone-600/30',
                        };
                      }

                      return (
                        <div
                          key={apt.id}
                          className={`p-3.5 rounded-2xl border transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            apt.completed
                              ? 'bg-stone-200/50 border-stone-300 opacity-80'
                              : 'bg-white/85 border-amber-900/25 shadow-xs hover:border-amber-800/50 hover:shadow-sm'
                          }`}
                        >
                          <div className="flex items-start space-x-3 flex-1">
                            {/* Checkbox de complétion */}
                            <button
                              type="button"
                              onClick={() => handleToggleAppointment(apt.id)}
                              className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition cursor-pointer flex-shrink-0 ${
                                apt.completed
                                  ? 'bg-emerald-700 border-emerald-800 text-white'
                                  : 'bg-white border-amber-900/40 hover:border-amber-700'
                              }`}
                              title={apt.completed ? 'Marquer comme non effectué' : 'Marquer comme effectué'}
                            >
                              {apt.completed && (
                                <span className="material-symbols-outlined text-sm font-bold">check</span>
                              )}
                            </button>

                            {/* Date Badge Stylisé */}
                            <div className="flex flex-col min-w-[115px] pr-2 border-r border-amber-900/15">
                              <span className="font-serif font-bold text-xs sm:text-[13px] text-amber-950">
                                {formattedDate}
                              </span>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {apt.time && (
                                  <span className="font-mono text-[10px] text-amber-900/90 font-semibold bg-amber-900/10 px-1.5 py-0.2 rounded">
                                    {apt.time}
                                  </span>
                                )}
                                <span
                                  className={`text-[9px] font-semibold px-1.5 py-0.2 rounded-full ${
                                    rel.isToday
                                      ? 'bg-rose-700/20 text-rose-900 font-bold animate-pulse'
                                      : rel.isPast
                                      ? 'bg-stone-200 text-stone-700'
                                      : 'bg-emerald-700/15 text-emerald-900'
                                  }`}
                                >
                                  {rel.label}
                                </span>
                              </div>
                            </div>

                            {/* Contenu & Détails */}
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`font-serif text-sm font-bold ${
                                    apt.completed ? 'line-through text-stone-600' : 'text-amber-950'
                                  }`}
                                >
                                  {apt.title}
                                </span>
                                <span
                                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.2 rounded-full border ${catBadge.color}`}
                                >
                                  <span className="material-symbols-outlined text-[11px]">
                                    {catBadge.icon}
                                  </span>
                                  <span>{catBadge.label}</span>
                                </span>
                                {apt.completed && (
                                  <span className="text-[10px] text-emerald-800 font-bold bg-emerald-100 px-1.5 py-0.2 rounded">
                                    ✓ Effectué
                                  </span>
                                )}
                              </div>

                              {apt.practitioner && (
                                <p className="text-[11px] text-amber-900 font-medium flex items-center gap-1">
                                  <span className="material-symbols-outlined text-xs text-amber-800">
                                    location_on
                                  </span>
                                  <span>{apt.practitioner}</span>
                                </p>
                              )}

                              {apt.notes && (
                                <p className="text-[11px] text-amber-900/80 italic font-serif bg-amber-950/5 p-1.5 px-2 rounded-lg border border-amber-900/10">
                                  📌 {apt.notes}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Action de suppression */}
                          <div className="flex items-center justify-end sm:flex-col sm:items-end gap-1.5 pt-2 sm:pt-0 border-t sm:border-0 border-amber-900/10">
                            <button
                              type="button"
                              onClick={(e) => handleDeleteAppointment(apt.id, e)}
                              className="p-1.5 rounded-lg text-rose-800/70 hover:text-rose-900 hover:bg-rose-900/10 transition cursor-pointer flex items-center gap-1 text-[11px]"
                              title="Supprimer ce rendez-vous"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                              <span className="sm:hidden">Supprimer</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Module Journal */}
            <div
              className={`tab-pane space-y-4 ${activeTab === 'module-journal' ? '' : 'hidden'}`}
              id="module-journal"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-900/15 pb-2">
                <div>
                  <h3 className="font-serif font-bold text-2xl text-amber-950">
                    Carnet Intime de Fatou
                  </h3>
                  <p className="text-xs text-amber-900">
                    Vos sensations, pensées et suivi des traitements (conservés automatiquement sur cet appareil).
                  </p>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={isExportingPdf}
                    className="px-3 py-1.5 rounded-lg bg-amber-800 hover:bg-amber-900 text-amber-50 font-bold text-xs shadow-md transition transform active:scale-95 border border-amber-600/50 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                    title="Télécharger une version imprimable souvenir au format PDF"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {pdfExportSuccess ? 'check_circle' : 'picture_as_pdf'}
                    </span>
                    <span>
                      {pdfExportSuccess
                        ? 'PDF Téléchargé !'
                        : isExportingPdf
                        ? 'Génération...'
                        : 'Exporter en PDF (Souvenir)'}
                    </span>
                  </button>

                  {journalLastSaved ? (
                    <span className="text-[11px] font-medium text-emerald-900 bg-emerald-700/15 border border-emerald-600/30 px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                      Sauvegardé automatiquement à {journalLastSaved}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-amber-900/80 bg-amber-900/10 border border-amber-900/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                      Sauvegarde locale prête
                    </span>
                  )}
                </div>
              </div>

              <div className="relative">
                <textarea
                  className="w-full text-xs sm:text-sm rounded-xl border border-amber-900/30 bg-white/85 p-3.5 text-amber-950 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-700/50 shadow-inner resize-y min-h-[130px]"
                  placeholder="Notez ici vos sensations du jour, pensées pour votre petit garçon, symptômes ou questions pour votre équipe obstétrique..."
                  rows={5}
                  value={journalText}
                  onChange={(e) => handleJournalChange(e.target.value)}
                ></textarea>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900/80 pt-1">
                <div className="flex items-center gap-3">
                  <span>{journalText.trim() ? `${journalText.trim().split(/\s+/).length} mots` : '0 mot'}</span>
                  <span>·</span>
                  <span>{journalText.length} caractères</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={isExportingPdf}
                    className="px-2.5 py-1 bg-amber-900/15 hover:bg-amber-900/25 rounded text-[11px] font-semibold text-amber-950 transition cursor-pointer flex items-center gap-1 border border-amber-900/20"
                    title="Exporter le carnet et les jalons en PDF"
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      {pdfExportSuccess ? 'check_circle' : 'picture_as_pdf'}
                    </span>
                    {pdfExportSuccess ? 'Téléchargé !' : 'Export PDF'}
                  </button>
                  {journalText && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(journalText);
                          setIsCopied(true);
                          setTimeout(() => setIsCopied(false), 2000);
                        }}
                        className="px-2.5 py-1 bg-amber-900/10 hover:bg-amber-900/20 rounded text-[11px] font-semibold text-amber-950 transition cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {isCopied ? 'check' : 'content_copy'}
                        </span>
                        {isCopied ? 'Copié !' : 'Copier mes notes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Voulez-vous effacer toutes les notes de ce carnet ?')) {
                            handleJournalChange('');
                          }
                        }}
                        className="px-2.5 py-1 bg-rose-900/10 hover:bg-rose-900/20 rounded text-[11px] font-semibold text-rose-950 transition cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[13px]">delete</span>
                        Effacer
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-8 pt-4 border-t border-amber-900/25 text-center text-xs text-amber-950/70 flex flex-col sm:flex-row justify-between items-center gap-2">
          <span>
            Conception Bois Noble d&apos;Inspiration Artisanale · Édition Maternelle Personnalisée
          </span>
          <span>
            RMA of New York • Laboratoire d&apos;Embryologie de Manhattan • DPA 22/07/2027
          </span>
        </footer>

        {/* MODAL LIGHTBOX POUR CLICHÉ AGRANDI EN HAUTE DÉFINITION */}
        {selectedSnapshot && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in"
            onClick={() => setSelectedSnapshot(null)}
          >
            <div
              className="bg-stone-950 border-2 border-amber-600/50 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl relative flex flex-col max-h-[92vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* En-tête Lightbox */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-amber-900/50 bg-stone-900/80">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping"></span>
                  <h4 className="font-serif font-bold text-sm sm:text-base text-amber-100 flex items-center gap-2">
                    <span>Instantané Fœtal · Semaine {selectedSnapshot.week}</span>
                    <span className="text-xs font-mono font-normal text-amber-300">
                      ({selectedSnapshot.fruit} · {selectedSnapshot.metrics})
                    </span>
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSnapshot(null)}
                  className="w-8 h-8 rounded-full bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                  title="Fermer"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              {/* Vue de l'image haute définition */}
              <div className="p-3 sm:p-5 flex items-center justify-center bg-black/90 overflow-y-auto">
                <img
                  src={selectedSnapshot.dataUrl}
                  alt={`Cliché Semaine ${selectedSnapshot.week}`}
                  className="max-h-[64vh] w-auto object-contain rounded-lg border border-amber-700/40 shadow-2xl"
                />
              </div>

              {/* Pied de la modal avec commandes */}
              <div className="px-4 py-3 bg-stone-900/90 border-t border-amber-900/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="text-stone-300 text-[11px] font-mono flex items-center gap-2">
                  <span>📅 {selectedSnapshot.dateStr}</span>
                  <span>·</span>
                  <span className="text-rose-300">♥ {selectedSnapshot.heartRate} bpm</span>
                </div>

                <div className="flex items-center space-x-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      selectWeek(selectedSnapshot.week, autoPlayVoice);
                      setSelectedSnapshot(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-900/40 hover:bg-amber-900/70 border border-amber-700/40 text-amber-200 transition font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">visibility</span>
                    <span>Aller à la Semaine {selectedSnapshot.week}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleDownloadSnapshot(selectedSnapshot, e)}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-amber-50 transition font-bold flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    <span>Télécharger l'image</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleDeleteSnapshot(selectedSnapshot.id, e)}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 text-rose-300 hover:text-rose-100 transition font-medium flex items-center gap-1 cursor-pointer"
                    title="Supprimer définitivement ce cliché"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                    <span>Supprimer</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
