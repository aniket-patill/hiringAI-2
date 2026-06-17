import React, { useState, useEffect } from 'react';
import {
    Save, Building2, Shield, Bell, Mail, Settings, CheckCircle
} from 'lucide-react';
import API_URL from '../apiConfig';

const GlobalSettings = () => {
    const [activeTab, setActiveTab] = useState('scoring');
    const [saving, setSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Initial state with scoring and pipeline defaults
    const [formData, setFormData] = useState({
        orgName: 'Acme Corp',
        timezone: 'UTC-5 (EST)',
        scoring: {
            skills: 40,
            experience: 25,
            projects: 20,
            education: 10,
            bonus: 5
        },
        emails: {
            invitationSubject: 'Invitation to Assessment Round - HiringAI',
            invitationBody: 'Dear Candidate,\n\nYou have been promoted to the next stage of our recruitment process. Please log in to the portal to take your assessment.',
            reminderSubject: 'Reminder: Pending Assessment - HiringAI',
            reminderBody: 'Dear Candidate,\n\nThis is a friendly reminder to complete your pending assessment as soon as possible.'
        },
        security: {
            faceProctoring: true,
            fullscreenProctoring: true,
            autoFlagSuspicious: true
        },
        notifications: {
            emailAlerts: true,
            slackIntegration: false,
            weeklyDigest: true,
            recipientEmail: 'gopalmuri1919@gmail.com'
        }
    });

    useEffect(() => {
        const token = localStorage.getItem('token');
        fetch(`${API_URL}/api/settings/`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        })
            .then(res => res.json())
            .then(data => {
                if (data) {
                    setFormData(prev => ({
                        ...prev,
                        ...data,
                        scoring: { ...prev.scoring, ...(data.scoring || {}) },
                        emails: { ...prev.emails, ...(data.emails || {}) },
                        security: { ...prev.security, ...(data.security || {}) },
                        notifications: { ...prev.notifications, ...(data.notifications || {}) }
                    }));
                    setHasChanges(false);
                }
            })
            .catch(err => console.error("Failed to load settings", err));
    }, []);

    // Calculate dynamic weights sum
    const currentScoring = formData.scoring || { skills: 40, experience: 25, projects: 20, education: 10, bonus: 5 };
    const scoringSum = 
        (currentScoring.skills || 0) + 
        (currentScoring.experience || 0) + 
        (currentScoring.projects || 0) + 
        (currentScoring.education || 0) + 
        (currentScoring.bonus || 0);

    const isScoringValid = scoringSum === 100;

    const handleSave = async () => {
        if (!isScoringValid) {
            alert(`Total scoring weight must equal exactly 100%. Currently it is ${scoringSum}%. Please adjust the sliders before saving.`);
            return;
        }

        setSaving(true);
        try {
            const res = await fetch(`${API_URL}/api/settings/`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ config: formData })
            });

            if (res.ok) {
                setShowSuccess(true);
                setHasChanges(false);
                setTimeout(() => setShowSuccess(false), 3000);
            } else {
                throw new Error("Failed to save");
            }
        } catch (error) {
            console.error("Save failed", error);
            alert("Failed to save settings. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const updateScoringField = (field, val) => {
        setFormData(prev => ({
            ...prev,
            scoring: {
                ...prev.scoring,
                [field]: val
            }
        }));
        setHasChanges(true);
    };

    const updateEmailField = (field, val) => {
        setFormData(prev => ({
            ...prev,
            emails: {
                ...prev.emails,
                [field]: val
            }
        }));
        setHasChanges(true);
    };

    const updateSecurityField = (field, val) => {
        setFormData(prev => ({
            ...prev,
            security: {
                ...prev.security,
                [field]: val
            }
        }));
        setHasChanges(true);
    };

    const updateNotificationField = (field, val) => {
        setFormData(prev => ({
            ...prev,
            notifications: {
                ...prev.notifications,
                [field]: val
            }
        }));
        setHasChanges(true);
    };

    const tabs = [
        { id: 'scoring', label: 'AI Scoring Weights', icon: BrainCircuitIcon },
        // COMMENTED OUT: { id: 'notifications', label: 'Notifications', icon: Bell },
        // COMMENTED OUT: { id: 'email', label: 'Email Templates', icon: Mail },
        // COMMENTED OUT: { id: 'security', label: 'Security & Proctoring', icon: Shield }
    ];

    return (
        <div className="max-w-[1200px] mx-auto pb-20">
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
                        <Settings className="text-gray-600" /> Global Settings
                    </h1>
                    <p className="text-gray-500 mt-2">Manage your hiring pipeline, email templates, and AI configurations centrally.</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving || !isScoringValid || !hasChanges}
                    className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg ${
                        (saving || !isScoringValid || !hasChanges) 
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none' 
                            : 'bg-green-600 hover:bg-green-700 text-white shadow-green-100'
                    }`}
                >
                    {saving ? (
                        <>Saving...</>
                    ) : showSuccess ? (
                        <><CheckCircle size={20} /> Saved!</>
                    ) : (
                        <><Save size={20} /> Save Changes</>
                    )}
                </button>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
                {/* Sidebar Navigation */}
                <div className="w-full lg:w-64 flex-shrink-0">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden sticky top-24">
                        <div className="p-4 bg-gray-50 border-b border-gray-100 font-bold text-gray-500 text-xs uppercase tracking-wider">
                            Configuration
                        </div>
                        <nav className="flex flex-col p-2 space-y-1">
                            {tabs.map(tab => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors w-full text-left
                                            ${isActive
                                                ? 'bg-green-50 text-green-700'
                                                : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        <Icon size={18} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </nav>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 space-y-6">
                    {/* AI SCORING WEIGHTS */}
                    {activeTab === 'scoring' && (
                        <Section title="AI Resume Evaluation Weights" description="Configure the scoring formula used by the Groq AI engine during screening.">
                            <div className="space-y-6">
                                {/* Total Sum Progress Indicator */}
                                <div className={`p-4 rounded-xl border flex items-center gap-3 transition-colors ${
                                    isScoringValid 
                                        ? 'bg-green-50 border-green-200 text-green-800' 
                                        : 'bg-amber-50 border-amber-200 text-amber-800'
                                }}`}>
                                    {isScoringValid ? <CheckCircle className="text-green-600 shrink-0" size={20} /> : <AlertTriangle className="text-amber-600 shrink-0" size={20} />}
                                    <div className="flex-1">
                                        <p className="font-bold text-sm">
                                            Total Target Weight: <span className="underline">{scoringSum}%</span> / 100%
                                        </p>
                                        <p className="text-xs mt-0.5 opacity-90">
                                            {isScoringValid 
                                                ? 'Scoring formula is balanced and valid. Changes can be saved.' 
                                                : `Formula must sum up to exactly 100% to save. Please adjust parameters by ${100 - scoringSum}%`}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    <Range 
                                        label="1. Skills Matching" 
                                        value={currentScoring.skills} 
                                        onChange={(val) => updateScoringField('skills', val)} 
                                        description="Semantic and keyword alignment between resume technical profiles and Job Description demands."
                                    />
                                    <Range 
                                        label="2. Experience Relevance" 
                                        value={currentScoring.experience} 
                                        onChange={(val) => updateScoringField('experience', val)} 
                                        description="Years of experience match, seniority level comparison, and background progression checks."
                                    />
                                    <Range 
                                        label="3. Project & Role Alignment" 
                                        value={currentScoring.projects} 
                                        onChange={(val) => updateScoringField('projects', val)} 
                                        description="Level of technical complexity, scope of contributions, and product alignment detailed in projects."
                                    />
                                    <Range 
                                        label="4. Education Match" 
                                        value={currentScoring.education} 
                                        onChange={(val) => updateScoringField('education', val)} 
                                        description="Verification of degrees, certifications, specializations, and institutional background matches."
                                    />
                                    <Range 
                                        label="5. Preferred & Bonus Skills" 
                                        value={currentScoring.bonus} 
                                        onChange={(val) => updateScoringField('bonus', val)} 
                                        description="Additional nice-to-have parameters, certificates, or extracurricular matches specified in JD."
                                    />
                                </div>
                            </div>
                        </Section>
                    )}

                    {/* COMMENTED OUT: NOTIFICATIONS SETTINGS
                    {activeTab === 'notifications' && (
                        <Section title="Notification Preferences" description="Configure when and how you want to be notified.">
                            ... (preserved, re-enable by removing these comment tags)
                        </Section>
                    )} */}

                    {/* COMMENTED OUT: EMAIL TEMPLATES
                    {activeTab === 'email' && (
                        <Section title="Assessment Email Templates" description="...">
                            ... (preserved, re-enable by removing these comment tags)
                        </Section>
                    )} */}

                    {/* COMMENTED OUT: SECURITY & PROCTORING
                    {activeTab === 'security' && (
                        <Section title="Integrity & Proctoring Controls" description="...">
                            ... (preserved, re-enable by removing these comment tags)
                        </Section>
                    )} */}
                </div>
            </div>
        </div>
    );
};

// --- Reusable Components ---

const Section = ({ title, description, children }) => (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="p-6 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-1">{description}</p>
        </div>
        <div className="p-6">
            {children}
        </div>
    </div>
);

const Input = ({ label, value, disabled, suffix, onChange }) => (
    <div className="space-y-1.5 w-full">
        <label className="block text-sm font-semibold text-gray-700">{label}</label>
        <div className="relative">
            <input
                type="text"
                value={value}
                disabled={disabled}
                onChange={(e) => onChange && onChange(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-950 font-medium focus:ring-2 focus:ring-green-500 outline-none disabled:text-gray-500"
            />
            {suffix && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                    {suffix}
                </span>
            )}
        </div>
    </div>
);

const Select = ({ label, options, value, onChange }) => (
    <div className="space-y-1.5 w-full">
        <label className="block text-sm font-semibold text-gray-700">{label}</label>
        <select 
            value={value} 
            onChange={(e) => onChange && onChange(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-950 font-bold focus:ring-2 focus:ring-green-500 outline-none cursor-pointer"
        >
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
    </div>
);

const Toggle = ({ label, description, checked, onChange }) => (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
        <div className="pr-4">
            <h4 className="font-bold text-gray-900 text-sm">{label}</h4>
            <p className="text-xs text-gray-500 mt-0.5 font-medium leading-relaxed">{description}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input 
                type="checkbox" 
                checked={checked} 
                onChange={(e) => onChange && onChange(e.target.checked)} 
                className="sr-only peer" 
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
        </label>
    </div>
);

const Range = ({ label, value, onChange, description, max = 100 }) => (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2 w-full">
        <div className="flex justify-between items-start gap-4">
            <div>
                <label className="font-bold text-gray-800 text-sm">{label}</label>
                <p className="text-[11px] text-gray-500 font-medium mt-0.5 leading-relaxed">{description}</p>
            </div>
            <span className="font-extrabold text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-lg text-sm shrink-0 min-w-[55px] text-center">
                {value}{max === 100 ? '%' : 'm'}
            </span>
        </div>
        <input 
            type="range" 
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600 hover:accent-green-700 transition-colors" 
            value={value || 0} 
            onChange={(e) => onChange(parseInt(e.target.value) || 0)}
            min="0"
            max={max}
        />
    </div>
);

const AlertTriangle = ({ size, className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);

// Icon for AI Brain
const BrainCircuitIcon = ({ size, className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" /><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" /><path d="M3.477 10.896a4 4 0 0 1 .585-.396" /><path d="M19.938 10.5a4 4 0 0 1 .585.396" /><path d="M6 18a4 4 0 0 1-1.97-3.284" /><path d="M17.97 14.716A4 4 0 0 1 18 18" /></svg>
);

export default GlobalSettings;
