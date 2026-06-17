import React, { useState, useMemo } from 'react';
import {
    BrainCircuit, Code2, Users, Send, CheckCircle,
    Layers, Clock, BarChart3, Mail, BookOpen, AlertCircle,
    Search, UserPlus, ListFilter, Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import API_URL from '../apiConfig';


// --- Candidate Selection Component ---

const FormHelper = ({ title, required, children }) => (
    <div className="space-y-1 mb-4">
        <label className="block text-sm font-medium text-gray-700 whitespace-nowrap">
            {title} {required && <span className="text-red-500">*</span>}
        </label>
        {children}
    </div>
);

const DifficultySelector = ({ selected, onSelect }) => (
    <div className="flex gap-3">
        {['Easy', 'Medium', 'Hard'].map((level) => (
            <button
                key={level}
                onClick={() => onSelect(level)}
                className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition-all border ${selected === level
                    ? 'bg-white border-blue-500 text-blue-700 shadow-sm ring-1 ring-blue-500/10'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
            >
                {level}
            </button>
        ))}
    </div>
);

// --- Candidate Selection Component ---

const CandidateSelector = ({ roundParams, jobRole, onSelectionChange }) => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [selectedIds, setSelectedIds] = useState([]);

    // Fetch Candidates on mount and when roundParams/jobRole changes
    React.useEffect(() => {
        const fetchCandidates = async () => {
            setLoading(true);
            const token = localStorage.getItem('token');

            try {
                // Flexible Pipeline Logic:
                // 1. Fetch Candidates in "Resume Screening" who are "Qualified" (The Base Pool)
                // 2. Fetch Candidates already in the Target Round (e.g. Aptitude Round) (The Active Pool)
                // 3. Merge and Deduplicate

                // Helper to fetch by query
                const fetchByQuery = async (params) => {
                    const q = new URLSearchParams(params);
                    if (jobRole && jobRole !== 'All Roles') q.append('role', jobRole);
                    const res = await fetch(`${API_URL}/api/resume/candidates/?${q.toString()}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    return res.ok ? await res.json() : [];
                };

                // Fetch 1: Base Pool (Qualified from Screening)
                const basePool = await fetchByQuery({ stage: 'Resume Screening', status: 'Qualified' });

                // Fetch 2: Active Pool (Already in this round)
                // Note: roundParams.requiredStage is the "Target Round" now
                let activePool = [];
                if (roundParams.requiredStage && roundParams.requiredStage !== 'Resume Screening') {
                    // We don't filter by status here to ensure we see everyone in the round (Applied, In Progress, etc)
                    // Client side will filter out Rejected if needed.
                    activePool = await fetchByQuery({ stage: roundParams.requiredStage });
                }

                // Merge & Deduplicate
                const allCandidates = [...basePool, ...activePool];
                const uniqueCandidates = Array.from(new Map(allCandidates.map(c => [c.id, c])).values());

                // Filter out Rejected/Hired (Global Safety)
                const eligible = uniqueCandidates.filter(c => c.status !== 'Rejected' && c.status !== 'Hired');

                setCandidates(eligible);
            } catch (error) {
                console.error("Failed to fetch candidates", error);
                setCandidates([]);
            } finally {
                setLoading(false);
            }
        };
        fetchCandidates();
    }, [roundParams, jobRole]);

    // Filter Logic based on Search Text
    const eligibleCandidates = useMemo(() => {
        return candidates.filter(c => {
            return c.name.toLowerCase().includes(filter.toLowerCase()) || c.email.toLowerCase().includes(filter.toLowerCase());
        });
    }, [candidates, filter]);

    const toggleSelection = (candidate) => {
        const id = candidate.id;
        const isSelected = selectedIds.includes(id);
        const newSelectedIds = isSelected
            ? selectedIds.filter(sid => sid !== id)
            : [...selectedIds, id];

        setSelectedIds(newSelectedIds);

        // Return full candidate objects
        const newSelectedObjects = candidates.filter(c => newSelectedIds.includes(c.id));
        onSelectionChange(newSelectedObjects);
    };

    const toggleAll = () => {
        if (selectedIds.length === eligibleCandidates.length) {
            setSelectedIds([]);
            onSelectionChange([]);
        } else {
            const allIds = eligibleCandidates.map(c => c.id);
            setSelectedIds(allIds);
            onSelectionChange(eligibleCandidates);
        }
    };

    return (
        <div className="bg-gray-50/50 rounded-xl border border-gray-200 overflow-hidden flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 bg-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <ListFilter className="text-gray-400" size={18} />
                    <h4 className="font-semibold text-gray-800 text-sm">Eligible Candidates</h4>
                    <span className="bg-white border border-blue-200 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
                        {eligibleCandidates.length}
                    </span>
                </div>
                <div className="relative w-48">
                    <Search className="absolute left-2.5 top-2 text-gray-400" size={14} />
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Search..."
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-500 text-gray-900"
                    />
                </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto max-h-[300px] min-h-[100px] p-2 space-y-1 bg-gray-50 flex-1">
                {loading ? (
                    <div className="flex justify-center items-center py-12">
                        <Clock className="animate-spin text-blue-500" size={24} />
                    </div>
                ) : eligibleCandidates.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 text-sm italic">
                        {jobRole ? "No candidates found for this role & stage." : "No candidates available for this round yet."}
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-3 px-3 py-2 text-xs font-bold text-gray-500 uppercase sticky top-0 bg-gray-50 z-10">
                            <input
                                type="checkbox"
                                checked={selectedIds.length === eligibleCandidates.length && eligibleCandidates.length > 0}
                                onChange={toggleAll}
                                className="w-4 h-4 rounded text-green-600 focus:ring-green-500"
                            />
                            <span className="flex-1">Name</span>
                            <span className="w-24">Role</span>
                            <span className="w-16 text-right">Score</span>
                        </div>
                        {eligibleCandidates.map(candidate => (
                            <div
                                key={candidate.id}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all cursor-pointer ${selectedIds.includes(candidate.id)
                                    ? 'bg-white border-green-500 shadow-md transform -translate-y-0.5'
                                    : 'bg-white border-gray-100 hover:border-green-200'
                                    }`}
                                onClick={() => toggleSelection(candidate)}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedIds.includes(candidate.id)}
                                    onChange={() => { }}
                                    className="w-4 h-4 rounded text-green-600 focus:ring-green-500 pointer-events-none"
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">{candidate.name}</p>
                                    <p className="text-xs text-gray-500 truncate">{candidate.email}</p>
                                </div>
                                <div className="w-24">
                                    <span className="text-xs text-gray-600 truncate block" title={candidate.role}>{candidate.role}</span>
                                </div>
                                <div className="w-16 text-right font-mono text-sm font-semibold text-green-600">
                                    {(candidate.score || 0).toFixed(1)}%
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
};

// --- Tab Content Components ---

// --- REFACTORED CONFIG COMPONENTS ---

const AptitudeConfig = ({ config, onChange }) => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="bg-white border-l-4 border-blue-500 p-4 rounded-r-lg shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                <BookOpen size={18} className="text-blue-600" /> Aptitude Assessment
            </h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                Evaluate candidates on logical reasoning, quantitative analysis, and verbal ability. Questions are randomly generated based on selected difficulty.
            </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-5">
                <FormHelper title="Assessment Topics" required>
                    <div className="grid grid-cols-2 gap-2">
                        {['Logical Reasoning', 'Quantitative Analysis', 'Verbal', 'Data Interpretation'].map(topic => (
                            <label key={topic} className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-all ${(config.topics || []).includes(topic) ? 'bg-white border-blue-500 shadow-md ring-1 ring-blue-500/10' : 'bg-white border-gray-200 hover:border-blue-300'
                                }`}>
                                <input
                                    type="checkbox"
                                    checked={(config.topics || []).includes(topic)}
                                    onChange={() => {
                                        const current = config.topics || [];
                                        const newTopics = current.includes(topic) ? current.filter(t => t !== topic) : [...current, topic];
                                        onChange('topics', newTopics);
                                    }}
                                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                />
                                <span className="text-sm font-medium text-gray-700">{topic}</span>
                            </label>
                        ))}
                    </div>
                </FormHelper>

                <div className="grid grid-cols-2 gap-4">
                    <FormHelper title="Duration (mins)" required>
                        <div className="relative">
                            <Clock className="absolute left-3 top-2.5 text-gray-400" size={16} />
                            <input
                                type="number"
                                value={config.duration}
                                onChange={(e) => onChange('duration', e.target.value)}
                                className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-100 focus:border-green-400 outline-none transition-all font-medium text-gray-700"
                            />
                        </div>
                    </FormHelper>
                    <FormHelper title="Questions" required>
                        <div className="relative">
                            <BarChart3 className="absolute left-3 top-2.5 text-gray-400" size={16} />
                            <input
                                type="number"
                                value={config.qCount}
                                onChange={(e) => onChange('qCount', e.target.value)}
                                className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-100 focus:border-green-400 outline-none transition-all font-medium text-gray-700"
                            />
                        </div>
                    </FormHelper>
                </div>
            </div>

            <div className="space-y-5">
                <FormHelper title="Difficulty Level" required>
                    <DifficultySelector selected={config.difficulty} onSelect={(val) => onChange('difficulty', val)} />
                </FormHelper>

                <FormHelper title="Instructions / AI Context (Optional)">
                    <textarea
                        value={config.description || ''}
                        onChange={(e) => onChange('description', e.target.value)}
                        placeholder="Provide specific instructions or focus areas for the AI generation..."
                        className="w-full p-3 border border-gray-300 rounded-lg text-sm h-36 resize-none focus:ring-2 focus:ring-green-100 focus:border-green-400 outline-none transition-all"
                    />
                    <p className="text-[11px] text-gray-500 mt-1.5 flex items-center gap-1">
                        <AlertCircle size={10} /> Visible to AI context only.
                    </p>
                </FormHelper>
            </div>
        </div>
    </div>
);

const CodingConfig = ({ config, onChange }) => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="bg-white border-l-4 border-green-500 p-4 rounded-r-lg shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                <Code2 size={18} className="text-green-600" /> Coding Challenge
            </h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                Test algorithmic thinking and problem-solving skills. Candidates write code in a real-time environment with test cases.
            </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-5">
                <FormHelper title="Programming Topics" required>
                    <div className="relative">
                        <select
                            multiple
                            value={config.topics || []}
                            onChange={(e) => {
                                const selected = Array.from(e.target.selectedOptions, option => option.value);
                                onChange('topics', selected);
                            }}
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 h-40 focus:ring-2 focus:ring-green-100 focus:border-green-400 outline-none"
                        >
                            <option value="arrays">Arrays & Strings</option>
                            <option value="linkedlist">Linked Lists</option>
                            <option value="trees">Trees & Graphs</option>
                            <option value="dp">Dynamic Programming</option>
                            <option value="sorting">Sorting & Searching</option>
                            <option value="greedy">Greedy Algorithms</option>
                        </select>
                        <p className="text-[10px] text-gray-400 mt-1 absolute right-2 bottom-2 bg-white/80 px-1 rounded pointer-events-none">Ctrl/Cmd to select multiple</p>
                    </div>
                </FormHelper>

                <FormHelper title="Time Limit (mins)" required>
                    <div className="relative">
                        <Clock className="absolute left-3 top-2.5 text-gray-400" size={16} />
                        <input
                            type="number"
                            value={config.timeLimit}
                            onChange={(e) => onChange('timeLimit', e.target.value)}
                            className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-100 focus:border-green-400 outline-none font-medium text-gray-700"
                        />
                    </div>
                </FormHelper>

                {/* NEW FIELD: Time Allocation Mode */}
                <FormHelper title="Time Allocation">
                    <div className="space-y-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="timeMode"
                                value="overall"
                                checked={config.timeMode === 'overall' || !config.timeMode}
                                onChange={(e) => onChange('timeMode', e.target.value)}
                                className="text-green-500 focus:ring-green-400"
                            />
                            <span className="text-sm text-gray-700">Overall Time (Single timer)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="timeMode"
                                value="perQuestion"
                                checked={config.timeMode === 'perQuestion'}
                                onChange={(e) => onChange('timeMode', e.target.value)}
                                className="text-green-500 focus:ring-green-400"
                            />
                            <span className="text-sm text-gray-700">Per-Question Time</span>
                        </label>
                    </div>
                </FormHelper>
            </div>

            <div className="space-y-5">
                <FormHelper title="Difficulty Level" required>
                    <DifficultySelector selected={config.difficulty} onSelect={(val) => onChange('difficulty', val)} />
                </FormHelper>

                <div className="grid grid-cols-2 gap-4">
                    {/* NEW FIELD: Number of Questions */}
                    <FormHelper title="Questions" required>
                        <div className="relative">
                            <ListFilter className="absolute left-3 top-2.5 text-gray-400" size={16} />
                            <input
                                type="number"
                                min="1"
                                max="10"
                                value={config.questionCount === undefined ? '' : config.questionCount}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    onChange('questionCount', val === '' ? '' : parseInt(val));
                                }}
                                className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-100 focus:border-green-400 outline-none font-medium text-gray-700"
                            />
                        </div>
                    </FormHelper>

                    {/* NEW FIELD: Test Case Intensity */}
                    <FormHelper title="Test Cases">
                        <div className="relative">
                            <CheckCircle className="absolute left-3 top-2.5 text-gray-400" size={16} />
                            <input
                                type="number"
                                min="1"
                                max="20"
                                value={config.testIntensity === undefined ? '' : (config.testIntensity === 'low' ? 3 : config.testIntensity === 'medium' ? 5 : config.testIntensity === 'high' ? 8 : config.testIntensity)}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    onChange('testIntensity', val === '' ? '' : parseInt(val));
                                }}
                                className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-100 focus:border-green-400 outline-none font-medium text-gray-700"
                            />
                        </div>
                    </FormHelper>
                </div>

                <FormHelper title="Challenge Description / Notes (Optional)">
                    <textarea
                        value={config.description || ''}
                        onChange={(e) => onChange('description', e.target.value)}
                        placeholder="e.g. Focus on edge cases and memory optimization..."
                        className="w-full p-3 border border-gray-300 rounded-lg text-sm h-24 resize-none focus:ring-2 focus:ring-green-100 focus:border-green-400 outline-none"
                    />
                    <p className="text-[11px] text-gray-500 mt-1.5 flex items-center gap-1">
                        <AlertCircle size={10} /> Provides context to the AI generator.
                    </p>
                </FormHelper>
            </div>
        </div>
    </div>
);

const InterviewConfig = ({ config, onChange }) => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="bg-white border-l-4 border-purple-500 p-4 rounded-r-lg shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                <BrainCircuit size={18} className="text-purple-600" /> AI Technical Interview
            </h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                Conduct an automated voice-based technical interview. The AI adapts questions based on the candidate's resume and responses.
            </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-5">
                <FormHelper title="Duration (mins)" required>
                    <div className="relative">
                        <Clock className="absolute left-3 top-2.5 text-gray-400" size={16} />
                        <input
                            type="number"
                            value={config.duration}
                            onChange={(e) => onChange('duration', e.target.value)}
                            className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-100 focus:border-purple-400 outline-none font-medium text-gray-700"
                        />
                    </div>
                </FormHelper>

                <FormHelper title="Difficulty Level" required>
                    <DifficultySelector selected={config.difficulty} onSelect={(val) => onChange('difficulty', val)} />
                </FormHelper>
            </div>

            <div className="space-y-5">
                <FormHelper title="Interview Instructions (Optional)">
                    <textarea
                        value={config.instructions || ''}
                        onChange={(e) => onChange('instructions', e.target.value)}
                        placeholder="e.g. Focus on React optimization and System Design. Act as a Senior Architect, press for depth rather than breadth..."
                        className="w-full p-3 border border-gray-300 rounded-lg text-sm h-40 resize-none focus:ring-2 focus:ring-purple-100 focus:border-purple-400 outline-none"
                    />
                    <p className="text-[11px] text-gray-500 mt-1.5 flex items-center gap-1">
                        <AlertCircle size={10} /> Custom instructions for the AI interviewer.
                    </p>
                </FormHelper>
            </div>
        </div>
    </div>
);

// --- Main Page Component ---

const RecruitmentRoundsManager = () => {
    const [activeTab, setActiveTab] = useState('aptitude');
    const [entryMode, setEntryMode] = useState('manual');
    const [candidateEmail, setCandidateEmail] = useState('');
    const [selectedCandidates, setSelectedCandidates] = useState([]);
    const [isSending, setIsSending] = useState(false);

    // Valid Job Roles (Ideally fetched from backend)
    const [availableRoles, setAvailableRoles] = useState([]);
    const [selectedRole, setSelectedRole] = useState('');

    // Fetch Unique Roles Effect
    React.useEffect(() => {
        const fetchRoles = async () => {
            try {
                const res = await fetch(`${API_URL}/api/resume/active-roles/`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.ok) {
                    const roles = await res.json();
                    setAvailableRoles(roles);
                }
            } catch (error) {
                console.error("Failed to fetch roles", error);
            }
        };
        fetchRoles();
    }, []);

    // Initialized 'description' field for all configs
    const [aptitudeConfig, setAptitudeConfig] = useState({ difficulty: 'Medium', topics: [], duration: 45, qCount: 30, description: '' });
    const [codingConfig, setCodingConfig] = useState({
        difficulty: 'Medium',
        topics: [],
        timeLimit: 60,
        description: '',
        questionCount: 2,
        testIntensity: 5,
        timeMode: 'overall'
    });
    const [interviewConfig, setInterviewConfig] = useState({ difficulty: 'Medium', instructions: '', duration: 30 });

    const handleConfigChange = (round, key, value) => {
        if (round === 'aptitude') setAptitudeConfig(p => ({ ...p, [key]: value }));
        if (round === 'coding') setCodingConfig(p => ({ ...p, [key]: value }));
        if (round === 'interview') setInterviewConfig(p => ({ ...p, [key]: value }));
    };

    const validateConfig = () => {
        if (activeTab === 'aptitude') {
            if (!aptitudeConfig.topics || aptitudeConfig.topics.length === 0) return "Please select at least one topic for Aptitude Assessment.";
            if (!aptitudeConfig.duration || aptitudeConfig.duration <= 0) return "Please set a valid duration.";
        }
        if (activeTab === 'coding') {
            if (!codingConfig.topics || codingConfig.topics.length === 0) return "Please select at least one topic for Challenge.";
            if (!codingConfig.timeLimit || codingConfig.timeLimit <= 0) return "Please set a valid time limit.";
        }
        if (activeTab === 'interview') {
            if (!interviewConfig.duration || interviewConfig.duration <= 0) return "Please set a valid duration.";
        }
        return null;
    };

    const stageConfigs = {
        'resume': { requiredStage: 'Resume Screening', requiredStatus: 'Qualified' },
        'aptitude': { requiredStage: 'Aptitude Round' },
        'coding': { requiredStage: 'Coding Round' },
        'interview': { requiredStage: 'Technical Interview' }
    };

    // Mapping tabs to what stage candidates should be in to receive this test
    // E.g. To send Aptitude Test, candidate must be in 'Aptitude Round' stage.
    const [sourceStage, setSourceStage] = useState('aptitude');

    React.useEffect(() => {
        setSourceStage(activeTab); // Sync source stage with active tab (Simplification: Aptitude tab manages Aptitude candidates)
    }, [activeTab]);

    const handleSendLink = async () => {
        if (entryMode === 'manual' && !candidateEmail) { alert("Please enter a candidate email."); return; }
        if (entryMode === 'fetch' && selectedCandidates.length === 0) { alert("Please select at least one candidate."); return; }

        const configError = validateConfig();
        if (configError) { alert(configError); return; }

        // Confirmation
        const count = entryMode === 'manual' ? 1 : selectedCandidates.length;
        const roleText = selectedRole ? ` for ${selectedRole}` : '';
        if (!window.confirm(`Send ${activeTab} assessment to ${count} candidate(s)${roleText}?`)) return;

        setIsSending(true);

        let candidatesPayload = entryMode === 'manual' ? [{ email: candidateEmail }] : selectedCandidates.map(c => ({ email: c.email, name: c.name }));
        const baseConfig = activeTab === 'aptitude' ? aptitudeConfig : activeTab === 'coding' ? codingConfig : interviewConfig;

        // Ensure role is injected into a FRESH copy of the config
        const finalConfig = { ...baseConfig };
        if (selectedRole) {
            finalConfig.role = selectedRole;
        }

        try {
            const response = await fetch(`${API_URL}/api/assessments/assign/`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    candidates: candidatesPayload,
                    type: activeTab,
                    config: finalConfig
                })
            });

            if (response.ok) {
                const data = await response.json();
                alert(`Details: \n${data.message}`); // Show detailed backend message

                if (entryMode === 'manual') setCandidateEmail('');
                else setSelectedCandidates([]);

                // Trigger refresh if we had a way (CandidateSelector has internal state, forcing re-mount or ref is needed. 
                // Simple hack: Toggle entry mode or just let user re-select role to refresh).
                // Ideally passing a refresh trigger.

            } else throw new Error("Failed to send");
        } catch (err) {
            console.error(err);
            alert("Error sending links. Please try again.");
        } finally {
            setIsSending(false);
        }
    };

    const tabs = [
        { id: 'aptitude', label: 'Aptitude Round', icon: BookOpen, color: 'text-indigo-600' },
        { id: 'coding', label: 'Coding Round', icon: Code2, color: 'text-green-600' },
        { id: 'interview', label: 'Technical Interview', icon: Users, color: 'text-purple-600' },
    ];

    return (
        <div className="space-y-8 max-w-[1600px] mx-auto pb-12 px-4 sm:px-6 lg:px-8">
            <div className="border-b border-gray-200 pb-5">
                <h1 className="text-3xl font-semibold text-[#5d8c2c] tracking-tight">
                    Recruitment Rounds Manager
                </h1>
                <p className="text-black mt-2 text-sm font-medium">Configure and dispatch assessments to move candidates through the hiring pipeline.</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">

                {/* LEFT: Configuration Panel */}
                <div className="xl:col-span-7 flex flex-col gap-0 shadow-md rounded-2xl border border-gray-200 bg-white overflow-hidden min-h-[640px]">
                    <div className="flex bg-gray-50/50 border-b border-gray-200">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-semibold transition-all relative ${isActive
                                        ? `bg-white border-green-600 text-[#5d8c2c]`
                                        : 'bg-transparent border-transparent text-gray-900 hover:bg-gray-100'
                                        }`}
                                >
                                    <Icon size={18} className={isActive ? 'text-green-600' : 'text-gray-900'} />
                                    {tab.label}
                                    {isActive && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-green-600 shadow-[0_-2px_6px_rgba(93,140,44,0.4)]" />}
                                </button>
                            );
                        })}
                    </div>

                    <div className="p-8 flex-1 bg-white">
                        <AnimatePresence mode="wait">
                            {activeTab === 'aptitude' && <AptitudeConfig key="aptitude" config={aptitudeConfig} onChange={(k, v) => handleConfigChange('aptitude', k, v)} />}
                            {activeTab === 'coding' && <CodingConfig key="coding" config={codingConfig} onChange={(k, v) => handleConfigChange('coding', k, v)} />}
                            {activeTab === 'interview' && <InterviewConfig key="interview" config={interviewConfig} onChange={(k, v) => handleConfigChange('interview', k, v)} />}
                        </AnimatePresence>
                    </div>
                </div>

                {/* RIGHT: Candidate Selection */}
                <div className="xl:col-span-5 flex flex-col h-full sticky top-6">
                    <div className="bg-white border border-gray-200 rounded-2xl shadow-md overflow-hidden flex flex-col h-[640px]">
                        <div className="p-5 border-b border-gray-200 bg-gray-50/30 flex justify-between items-center">
                            <h3 className="font-semibold text-[#5d8c2c] flex items-center gap-2">
                                <UserPlus size={18} className="text-green-600" /> Dispatch Center
                            </h3>
                            <div className="flex bg-gray-200/50 p-1 rounded-lg">
                                <button onClick={() => setEntryMode('manual')} className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${entryMode === 'manual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Manual</button>
                                <button onClick={() => setEntryMode('fetch')} className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${entryMode === 'fetch' ? 'bg-white text-[#5d8c2c] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Auto-Fetch</button>
                            </div>
                        </div>

                        <div className="p-6 flex-1 flex flex-col overflow-hidden">
                            {entryMode === 'manual' ? (
                                <div className="flex-1 flex flex-col justify-center items-center text-center p-8 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                                    <div className="w-16 h-16 bg-white border border-gray-200 shadow-sm rounded-full flex items-center justify-center mb-4">
                                        <Mail className="text-green-600" size={32} />
                                    </div>
                                    <h4 className="text-gray-900 font-bold mb-2">Direct Invite</h4>
                                    <p className="text-gray-500 text-xs mb-6 max-w-xs">Send a specialized assessment link directly to a candidate via email.</p>

                                    <div className="w-full max-w-sm text-left">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Candidate Email</label>
                                        <input
                                            type="email"
                                            value={candidateEmail}
                                            onChange={(e) => setCandidateEmail(e.target.value)}
                                            placeholder="name@company.com"
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col h-full gap-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="w-full">
                                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Stage</label>
                                            <div className="relative">
                                                <ListFilter className="absolute left-3 top-3 text-gray-400" size={16} />
                                                <select
                                                    value={sourceStage}
                                                    disabled
                                                    className="w-full pl-10 pr-4 py-2.5 bg-gray-100 border border-gray-200 rounded-xl text-sm outline-none font-bold text-gray-500 cursor-not-allowed"
                                                >
                                                    <option value={activeTab}>{tabs.find(t => t.id === activeTab)?.label}</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="w-full">
                                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Job Role (Optional)</label>
                                            <div className="relative">
                                                <Briefcase className="absolute left-3 top-3 text-gray-400" size={16} />
                                                <select
                                                    value={selectedRole}
                                                    onChange={(e) => setSelectedRole(e.target.value)}
                                                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 focus:outline-none appearance-none cursor-pointer font-bold text-gray-700 hover:border-green-400 transition-colors"
                                                >
                                                    <option value="">All Roles</option>
                                                    {availableRoles.map(role => (
                                                        <option key={role} value={role}>{role}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex-1 border border-gray-200 rounded-xl overflow-hidden shadow-inner">
                                        <CandidateSelector
                                            roundParams={stageConfigs[sourceStage]}
                                            jobRole={selectedRole}
                                            onSelectionChange={setSelectedCandidates}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-5 border-t border-gray-100 bg-gray-50">
                            <div className="flex justify-between items-center text-xs font-medium text-gray-500 mb-4 px-1">
                                <span>Selected: <span className="text-gray-900 font-bold">{entryMode === 'manual' ? (candidateEmail ? '1' : '0') : selectedCandidates.length}</span></span>
                                <span className="flex items-center gap-1"><Clock size={12} /> Link expires in 48h</span>
                            </div>
                            <button
                                onClick={handleSendLink}
                                disabled={isSending || (entryMode === 'fetch' && selectedCandidates.length === 0)}
                                className={`w-full py-3.5 rounded-xl text-white font-bold text-sm tracking-wide shadow-lg flex items-center justify-center gap-2 ${isSending || (entryMode === 'fetch' && selectedCandidates.length === 0)
                                    ? 'bg-gray-300 cursor-not-allowed transform-none shadow-none'
                                    : 'bg-primary'}`}
                            >
                                {isSending ? <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending...</span> : <><Send size={16} /> Dispatch Assessment</>}
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default RecruitmentRoundsManager;
