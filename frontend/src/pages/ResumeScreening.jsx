import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import {
    Upload, FileText, Brain, Loader2, CheckCircle, AlertCircle,
    Filter, ChevronRight, X, Sparkles, ChevronDown, ChevronUp,
    Search, Play, Minus, ArrowRight, FolderOpen, FilePlus, Cloud, HardDrive
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import API_URL from '../apiConfig';

// --- Processing Overlay Component ---
const ProcessingStatus = ({ batchStatus, completedCount, totalCount, filesCount }) => {
    const stages = [
        { id: 'queued', label: 'Uploading Resumes', icon: Upload },
        { id: 'processing', label: 'AI Screening Active', icon: Brain },
        { id: 'scoring', label: 'Calculating Scores', icon: Sparkles },
        { id: 'completed', label: 'Results Ready', icon: CheckCircle },
    ];

    const stageMap = { queued: 0, processing: 1, scoring: 2, completed: 3 };
    const currentIdx = stageMap[batchStatus] ?? 1;
    const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white border border-blue-100 rounded-2xl p-6 shadow-xl mb-8 relative overflow-hidden"
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gray-100">
                <motion.div
                    className="h-full bg-green-600"
                    initial={{ width: "0%" }}
                    animate={{ width: `${progressPct || ((currentIdx + 1) / 4) * 100}%` }}
                    transition={{ duration: 0.5 }}
                />
            </div>

            <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-white border border-gray-100 rounded-xl flex items-center justify-center text-green-600">
                    <Loader2 className="animate-spin" size={24} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-gray-900">
                        Processing {filesCount} resume{filesCount !== 1 ? 's' : ''}…
                    </h3>
                    <p className="text-sm text-gray-500">
                        {completedCount} / {totalCount} completed · Worker is screening in background
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {stages.map((s, idx) => {
                    const isActive = idx === currentIdx;
                    const isDone = idx < currentIdx;
                    const Icon = s.icon;

                    return (
                        <div key={s.id} className={`flex flex-col items-center text-center gap-2 p-3 rounded-xl transition-colors ${isActive ? 'bg-gray-50' : 'opacity-50'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isActive ? 'bg-green-600 text-white shadow-lg scale-110' : isDone ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                                {isDone ? <CheckCircle size={16} /> : <Icon size={16} />}
                            </div>
                            <span className={`text-xs font-semibold ${isActive ? 'text-green-700' : 'text-gray-500'}`}>{s.label}</span>
                        </div>
                    );
                })}
            </div>
        </motion.div>
    );
};

// --- Result Card Component ---
const CandidateResultCard = ({ candidate, rank }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Safety check for analysis data
    const analysis = candidate.analysis || {};
    const missingSkills = analysis.missing_skills || [];
    const matchedSkills = analysis.key_skills_match || [];

    const getScoreColor = (score) => {
        if (score >= 80) return 'text-green-600 border-green-200 bg-white';
        if (score >= 60) return 'text-green-600 border-green-200 bg-white';
        return 'text-red-600 border-red-200 bg-white';
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white border border-gray-200 rounded-xl p-0 hover:shadow-md transition-shadow overflow-hidden"
        >
            <div className={`p-5 flex flex-col md:flex-row items-start md:items-center gap-5 cursor-pointer ${isExpanded ? 'bg-gray-50/50' : ''}`} onClick={() => setIsExpanded(!isExpanded)}>
                {/* Rank Badge */}
                <div className="flex-shrink-0 flex flex-col items-center justify-center w-12 text-center">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Rank</span>
                    <span className="text-2xl font-black text-gray-300">#{rank}</span>
                </div>

                {/* Candidate Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-slate-900 truncate">{candidate.name || "Unknown"}</h3>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${candidate.status === 'Failed' ? 'bg-white border border-red-200 text-red-600' : 'bg-white border border-green-200 text-[#5d8c2c]'}`}>
                            {candidate.status}
                        </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500 font-medium">
                        <span className="flex items-center gap-1.5"><Brain size={14} className="text-green-600" /> {matchedSkills.length} Matching Skills</span>
                        <span className="flex items-center gap-1.5"><AlertCircle size={14} className="text-green-500" /> {missingSkills.length} Missing</span>
                    </div>
                </div>

                {/* Score */}
                <div className="flex items-center gap-4 flex-shrink-0">
                    <div className={`flex flex-col items-end`}>
                        <span className="text-xs font-semibold text-gray-500 uppercase">Match Score</span>
                        <div className={`text-2xl font-black ${getScoreColor(candidate.score).split(' ')[0]}`}>
                            {candidate.score || 0}%
                        </div>
                    </div>
                    <button className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400">
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>
                </div>
            </div>

            {/* Expanded AI Summary */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-gray-100 bg-white px-5 py-6 space-y-4"
                    >
                        <div className="flex items-start gap-3">
                            <Sparkles className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                            <div className="space-y-2">
                                <h4 className="text-sm font-bold text-gray-900">AI Screening Summary</h4>
                                <p className="text-sm text-gray-600 leading-relaxed">
                                    {candidate.reasoning}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-8">
                            <div>
                                <h5 className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">Relevant Strengths</h5>
                                <div className="flex flex-wrap gap-2">
                                    {matchedSkills.slice(0, 5).map((s, i) => (
                                        <span key={i} className="px-2 py-1 bg-white text-green-700 rounded text-xs border border-green-100">{s}</span>
                                    ))}
                                    {matchedSkills.length > 5 && <span className="text-xs text-gray-400">+{matchedSkills.length - 5} more</span>}
                                </div>
                            </div>
                            <div>
                                <h5 className="text-xs font-bold text-red-700 uppercase tracking-wide mb-2">Potential Gaps</h5>
                                <div className="flex flex-wrap gap-2">
                                    {missingSkills.slice(0, 5).map((s, i) => (
                                        <span key={i} className="px-2 py-1 bg-white text-red-700 rounded text-xs border border-red-100">{s}</span>
                                    ))}
                                    {missingSkills.length === 0 && <span className="text-xs text-gray-400 italic">No major gaps identified.</span>}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

// --- Main Page Component ---
const ResumeScreening = () => {
    const [jobDescription, setJobDescription] = useState('');
    const [files, setFiles] = useState([]);
    const folderInputRef = useRef(null);
    const jdFileInputRef = useRef(null);
    const [showFolderMenu, setShowFolderMenu] = useState(false);

    // Screening Settings
    const [shortlistCount, setShortlistCount] = useState(5);

    // Screening State
    const [isScreening, setIsScreening] = useState(false);
    const [batchStatus, setBatchStatus] = useState('idle'); // idle | queued | processing | completed | failed
    const [batchCompleted, setBatchCompleted] = useState(0);
    const [batchTotal, setBatchTotal] = useState(0);
    const pollTimerRef = useRef(null);

    const [results, setResults] = useState([]);
    const [isPromoting, setIsPromoting] = useState(false);
    const [promoteSuccess, setPromoteSuccess] = useState(false);

    // Validation
    const handleFolderUpload = (e) => {
        const folderFiles = Array.from(e.target.files).filter(f =>
            f.name.endsWith('.pdf') || f.name.endsWith('.doc') || f.name.endsWith('.docx')
        );
        setFiles(prev => {
            const existing = new Set(prev.map(f => f.name));
            return [...prev, ...folderFiles.filter(f => !existing.has(f.name))];
        });
        e.target.value = '';
    };

    const handleJDFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // For plain text / txt files, read directly
        if (file.type === 'text/plain') {
            const reader = new FileReader();
            reader.onload = (ev) => setJobDescription(ev.target.result);
            reader.readAsText(file);
        } else {
            // For PDF/DOC, send to backend to extract text
            const formData = new FormData();
            formData.append('file', file);
            const token = localStorage.getItem('token');
            fetch(`${API_URL}/api/resume/extract-text/`, {
                method: 'POST',
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                body: formData
            })
            .then(r => r.json())
            .then(d => { if (d.text) setJobDescription(d.text); })
            .catch(() => alert('Could not extract text from file. Please paste the JD manually.'));
        }
        e.target.value = '';
    };

    const handlePromoteToNextStage = async () => {
        if (!results.length) return;
        setIsPromoting(true);
        try {
            const token = localStorage.getItem('token');
            const candidateIds = results
                .filter(r => r.status === 'Screened' && r.candidate?.id)
                .map(r => r.candidate.id);
            if (!candidateIds.length) { setIsPromoting(false); return; }
            const response = await fetch(`${API_URL}/api/resume/candidates/bulk-update/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                body: JSON.stringify({ candidate_ids: candidateIds, stage: 'NEXT' })
            });
            if (response.ok) {
                setPromoteSuccess(true);
            }
        } catch (err) {
            console.error('Promote failed:', err);
        }
        setIsPromoting(false);
    };

    // Validation
    const isCountInvalid = files.length > 0 && shortlistCount > files.length;
    const isValidToStart = files.length > 0 && jobDescription.trim() && !isCountInvalid && shortlistCount > 0;

    // Drag & Drop
    const onDrop = useCallback((acceptedFiles) => {
        setFiles(prev => [...prev, ...acceptedFiles]);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'application/pdf': ['.pdf'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] }
    });

    // Clean up polling on unmount
    useEffect(() => {
        return () => {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        };
    }, []);

    const startScreening = async () => {
        if (!isValidToStart) return;

        // Clear old polling
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);

        setIsScreening(true);
        setResults([]);
        setBatchStatus('queued');
        setBatchCompleted(0);
        setBatchTotal(files.length);
        setPromoteSuccess(false);

        const formData = new FormData();
        formData.append('job_description', jobDescription);
        formData.append('top_n', shortlistCount);
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }

        try {
            const token = localStorage.getItem('token');

            // Step 1: Submit the batch — backend enqueues to Redis, returns batch_id
            const response = await fetch(`${API_URL}/api/resume/screen/`, {
                method: 'POST',
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: formData
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${response.status}`);
            }

            const data = await response.json();
            const batchId = data.batch_id;

            if (!batchId) {
                throw new Error('No batch_id returned from server.');
            }

            setBatchStatus('processing');

            // Step 2: Poll batch status every 3 seconds
            const pollBatch = async () => {
                try {
                    const pollRes = await fetch(`${API_URL}/api/resume/screen/batch/${batchId}`, {
                        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
                    });
                    if (!pollRes.ok) return;
                    const pollData = await pollRes.json();

                    setBatchCompleted(pollData.completed || 0);
                    setBatchTotal(pollData.total || files.length);

                    // Update stage indicator
                    if (pollData.completed > 0) {
                        setBatchStatus('scoring');
                    }

                    const isDone = pollData.status === 'completed';
                    if (isDone) {
                        clearInterval(pollTimerRef.current);
                        pollTimerRef.current = null;

                        setBatchStatus('completed');

                        // Map completed job results → display cards
                        const mappedResults = (pollData.results || [])
                            .filter(res => res.status === 'completed' && res.candidate)
                            .map((res, i) => ({
                                id: `res-${Date.now()}-${i}`,
                                name: res.candidate?.name || res.filename || `Candidate ${i + 1}`,
                                score: res.candidate?.score || (res.analysis?.score) || 0,
                                status: 'Screened',
                                analysis: res.analysis || {},
                                reasoning: res.analysis?.reasoning || 'Analysis complete.',
                                candidate: res.candidate,
                                error: null
                            }));

                        // Include failed jobs too
                        const failedResults = (pollData.results || [])
                            .filter(res => res.status === 'failed' || res.status === 'dead')
                            .map((res, i) => ({
                                id: `fail-${Date.now()}-${i}`,
                                name: res.filename || `Resume ${i + 1}`,
                                score: 0,
                                status: 'Failed',
                                analysis: {},
                                reasoning: res.error || 'Processing failed.',
                                candidate: null,
                                error: res.error
                            }));

                        const allResults = [...mappedResults, ...failedResults]
                            .sort((a, b) => b.score - a.score);

                        setResults(allResults);
                        setIsScreening(false);
                        setBatchStatus('idle');
                    }
                } catch (err) {
                    console.error('Polling error:', err);
                }
            };

            // Start polling immediately then every 3s
            pollBatch();
            pollTimerRef.current = setInterval(pollBatch, 3000);

        } catch (err) {
            console.error('Screening error:', err);
            setIsScreening(false);
            setBatchStatus('idle');
        }
    };

    return (
        <div className="max-w-7xl mx-auto pb-10 px-4 sm:px-6 lg:px-8">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-3xl font-semibold text-[#5d8c2c] tracking-tight">AI Resume Screening</h1>
                <p className="text-black mt-2 text-sm font-medium">
                    Upload resumes to parse, evaluate, and rank candidates against your specific job criteria in real-time.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-180px)]">

                {/* LEFT COLUMN: Inputs & Upload (Sticky & Scrollable) */}
                <div className="lg:col-span-4 space-y-4 flex flex-col h-full overflow-hidden">
                    {/* JD Input */}
                    <div className="bg-white border border-gray-200/80 rounded-2xl p-5 shadow-sm flex-shrink-0 hover:shadow-md transition-shadow duration-300">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-[#5d8c2c] flex items-center gap-2 text-sm tracking-tight">
                                <div className="w-7 h-7 bg-green-100 rounded-lg flex items-center justify-center">
                                    <FileText size={14} className="text-[#5d8c2c]" />
                                </div>
                                Job Description
                            </h3>
                            <div className="flex items-center gap-2">
                                {/* JD File Upload */}
                                <button
                                    onClick={() => jdFileInputRef.current?.click()}
                                    title="Upload JD from file (PDF, DOC, TXT)"
                                    className="text-xs font-semibold text-white flex items-center gap-1.5 bg-gradient-to-r from-[#5d8c2c] to-[#4a7a1f] px-3 py-1.5 rounded-lg hover:shadow-md hover:shadow-green-200/50 hover:-translate-y-0.5 transition-all duration-200"
                                >
                                    <FilePlus size={12} /> Upload File
                                </button>
                                <input
                                    ref={jdFileInputRef}
                                    type="file"
                                    accept=".pdf,.doc,.docx,.txt"
                                    onChange={handleJDFileUpload}
                                    className="hidden"
                                />
                                <button onClick={() => setJobDescription('')} className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors">Clear</button>
                            </div>
                        </div>
                        <textarea
                            value={jobDescription}
                            onChange={(e) => setJobDescription(e.target.value)}
                            placeholder={`Paste or type job description here...`}
                            className="w-full h-32 bg-gray-50/80 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]/50 resize-none transition-all placeholder:text-gray-400"
                        />
                    </div>

                    {/* Upload Zone */}
                    <div className="bg-white border border-gray-200/80 rounded-2xl p-5 shadow-sm flex flex-col flex-1 min-h-0 hover:shadow-md transition-shadow duration-300">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-bold text-[#5d8c2c] flex items-center gap-2 text-sm tracking-tight">
                                <div className="w-7 h-7 bg-green-100 rounded-lg flex items-center justify-center">
                                    <Upload size={14} className="text-[#5d8c2c]" />
                                </div>
                                Upload Resumes
                            </h3>
                            {/* Folder Upload Button with Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowFolderMenu(v => !v)}
                                    title="Upload entire folder of resumes"
                                    className="text-xs font-semibold text-white flex items-center gap-1.5 bg-gradient-to-r from-[#5d8c2c] to-[#4a7a1f] px-3 py-1.5 rounded-lg hover:shadow-md hover:shadow-green-200/50 hover:-translate-y-0.5 transition-all duration-200"
                                >
                                    <FolderOpen size={12} /> Folder Upload <ChevronDown size={10} />
                                </button>

                                {/* Dropdown Menu */}
                                {showFolderMenu && (
                                    <>
                                        {/* Backdrop to close menu */}
                                        <div className="fixed inset-0 z-40" onClick={() => setShowFolderMenu(false)} />
                                        <div className="absolute right-0 top-full mt-1.5 w-48 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                            <div className="p-1.5 space-y-0.5">
                                                <button
                                                    onClick={() => {
                                                        setShowFolderMenu(false);
                                                        alert('OneDrive integration coming soon! Please use local folder upload for now.');
                                                    }}
                                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                                >
                                                    <Cloud size={16} className="text-blue-500" />
                                                    OneDrive
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setShowFolderMenu(false);
                                                        folderInputRef.current?.click();
                                                    }}
                                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-green-50 hover:text-green-700 transition-colors"
                                                >
                                                    <HardDrive size={16} className="text-green-600" />
                                                    From Local
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                            {/* Hidden folder input */}
                            <input
                                ref={folderInputRef}
                                type="file"
                                webkitdirectory="true"
                                multiple
                                accept=".pdf,.doc,.docx"
                                onChange={handleFolderUpload}
                                className="hidden"
                            />
                        </div>

                        <div
                            {...getRootProps()}
                            className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 group ${files.length > 0 ? 'p-3' : 'p-8'} ${isDragActive ? 'border-[#5d8c2c] bg-green-50/80 scale-[1.01]' : 'border-gray-300 hover:border-[#5d8c2c]/60 hover:bg-green-50/30'}`}
                        >
                            <input {...getInputProps()} />
                            {files.length === 0 ? (
                                <>
                                    <div className="w-12 h-12 bg-gradient-to-br from-green-100 to-green-50 text-[#5d8c2c] rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 group-hover:shadow-md group-hover:shadow-green-100 transition-all duration-300">
                                        <Upload size={20} />
                                    </div>
                                    <p className="text-sm font-semibold text-gray-700">Click or drag files here</p>
                                    <p className="text-xs text-gray-400 mt-1">Supports PDF, DOC, DOCX</p>
                                </>
                            ) : (
                                <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
                                    <Upload size={14} className="text-[#5d8c2c]" />
                                    <span>Click or drag to add more files</span>
                                </div>
                            )}
                        </div>

                        {/* File Queue - Internal Scroll */}
                        {files.length > 0 && (
                            <div className="mt-3 flex-1 min-h-0 flex flex-col">
                                <div className="flex justify-between text-xs text-gray-500 font-medium mb-2">
                                    <span>{files.length} files queued</span>
                                    <button onClick={() => setFiles([])} className="text-red-500 hover:underline">Remove All</button>
                                </div>
                                <div className="overflow-y-auto custom-scrollbar flex-1 min-h-[120px] space-y-1.5 pr-1">
                                    {files.map((file, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg text-xs border border-gray-100">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${idx < batchCompleted ? 'bg-green-500' : isScreening ? 'bg-amber-400 animate-pulse' : 'bg-gray-300'}`} />
                                                <span className="truncate max-w-[180px] font-medium text-gray-700">{file.name}</span>
                                            </div>
                                            {isScreening && <Loader2 size={12} className="animate-spin text-green-600" />}
                                            {!isScreening && (
                                                <button onClick={() => setFiles(files.filter(f => f !== file))} className="text-gray-400 hover:text-red-500 p-0.5">
                                                    <X size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT COLUMN: Results & Actions */}
                <div className="lg:col-span-8 flex flex-col h-full overflow-hidden">

                    {/* Header with Actions (Sticky) */}
                    <div className="bg-white border border-gray-200/80 rounded-2xl p-4 mb-4 shadow-sm transition-all duration-300 hover:shadow-md">
                        {/* Row 1: Title + Process to Next Stage */}
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <h2 className="text-lg font-bold text-[#5d8c2c] flex items-center gap-2 tracking-tight">
                                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                                    <Sparkles size={16} className="text-[#5d8c2c]" />
                                </div>
                                Screening Results
                                {results.length > 0 && (
                                    <span className="text-xs font-semibold text-[#5d8c2c] px-2.5 py-0.5 bg-green-50 rounded-full border border-green-200">
                                        {results.length} result{results.length !== 1 ? 's' : ''} / {batchTotal || files.length} submitted
                                    </span>
                                )}
                            </h2>

                        </div>

                        {/* Row 2: Top-N input + Start Screening button */}
                        <div className="flex items-center justify-end gap-3">
                            {/* Shortlist Setting */}
                            <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200" title="Top candidates to return">
                                <span className="text-xs font-bold text-gray-500">Top:</span>
                                <input
                                    type="number"
                                    min="1"
                                    value={shortlistCount}
                                    onChange={(e) => setShortlistCount(parseInt(e.target.value) || 0)}
                                    className={`w-10 bg-transparent text-center text-sm font-bold focus:outline-none ${isCountInvalid ? 'text-red-600' : 'text-gray-900'}`}
                                />
                            </div>

                            <button
                                onClick={startScreening}
                                disabled={!isValidToStart || isScreening}
                                className={`px-6 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 transition-all shadow-md whitespace-nowrap ${!isValidToStart || isScreening
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                                    : 'bg-gradient-to-r from-green-600 to-green-700 text-white hover:shadow-lg hover:-translate-y-0.5'
                                    }`}
                            >
                                {isScreening ? (
                                    <><Loader2 size={16} className="animate-spin" /> Processing...</>
                                ) : (
                                    <>Start Screening <Play size={16} fill="currentColor" /></>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Validation Error Banner (If Invalid) */}
                    {isCountInvalid && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                            className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-sm text-red-700"
                        >
                            <AlertCircle size={16} />
                            <strong>Action Required:</strong> Candidate count ({shortlistCount}) cannot exceed uploaded resumes ({files.length}).
                        </motion.div>
                    )}

                    {/* Scrollable Content Area */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 pb-4">
                        {/* 1. Active Processing Card */}
                        <AnimatePresence>
                            {isScreening && (
                                <ProcessingStatus
                                    batchStatus={batchStatus}
                                    completedCount={batchCompleted}
                                    totalCount={batchTotal}
                                    filesCount={files.length}
                                />
                            )}
                        </AnimatePresence>

                        {/* 2. Results List */}
                        <div className="space-y-4">
                            {results.length === 0 && !isScreening && (
                                <div className="border-2 border-dashed border-gray-200 rounded-2xl h-full min-h-[300px] flex flex-col items-center justify-center text-gray-400 bg-gray-50/50">
                                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
                                        <Brain size={24} className="text-green-500 opacity-20" />
                                    </div>
                                    <p className="font-bold text-[#5d8c2c]">Ready to Analyze</p>
                                    <p className="text-sm text-gray-500">Upload resumes → Click Start Screening</p>
                                </div>
                            )}

                            <AnimatePresence>
                                {results.map((candidate, idx) => (
                                    <CandidateResultCard key={candidate.id} candidate={candidate} rank={idx + 1} />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ResumeScreening;
