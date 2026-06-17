import React, { useState, useEffect } from 'react';
import API_URL from '../apiConfig';
import { BarChart2, Download, FileText, FileSpreadsheet, Loader2, Eye, X, Search, Trash2 } from 'lucide-react';

// ─── Utility: Clean phone numbers ────────────────────────────────────────────
const cleanPhone = (phone) => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length > 10) {
        return digits.slice(-10);
    }
    return digits || phone;
};

const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ─── Export Utilities ────────────────────────────────────────────────────────

const exportToPDF = async (candidates) => {
    const rows = candidates.map((c, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${c.name || '—'}</td>
            <td>${cleanPhone(c.phone) || '—'}</td>
            <td>${c.email || '—'}</td>
            <td>${c.score != null ? `${c.score.toFixed(1)}%` : '—'}</td>
            <td>${c.role || '—'}</td>
            <td>${formatDate(c.created_at)}</td>
        </tr>
    `).join('');

    const html = `
        <html>
        <head>
            <title>Screened Candidates Report</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 30px; color: #111; }
                h1 { color: #5d8c2c; font-size: 22px; margin-bottom: 4px; }
                p { color: #555; font-size: 13px; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th { background: #5d8c2c; color: white; padding: 8px 10px; text-align: left; font-size: 11px; }
                td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
                tr:nth-child(even) td { background: #f9fafb; }
            </style>
        </head>
        <body>
            <h1>Screened Candidates Report</h1>
            <p>Generated on ${new Date().toLocaleDateString()} — Total: ${candidates.length} candidates</p>
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Candidate Name</th>
                        <th>Phone</th>
                        <th>Email</th>
                        <th>Score</th>
                        <th>Role</th>
                        <th>Screened Date</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </body>
        </html>
    `;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
};

const exportToExcel = (candidates) => {
    const headers = ['Rank', 'Candidate Name', 'Phone Number', 'Email', 'Screening Score', 'Role', 'Screened Date'];
    const rows = candidates.map((c, i) => [
        i + 1,
        `"${(c.name || '').replace(/"/g, '""')}"`,
        `"${cleanPhone(c.phone)}"`,
        `"${(c.email || '').replace(/"/g, '""')}"`,
        c.score != null ? `${c.score.toFixed(1)}%` : '—',
        `"${(c.role || '').replace(/"/g, '""')}"`,
        `"${formatDate(c.created_at)}"`
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screened_candidates_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

const exportToWord = (candidates) => {
    const rows = candidates.map((c, i) =>
        `<tr>
            <td>${i + 1}</td>
            <td>${c.name || '—'}</td>
            <td>${cleanPhone(c.phone) || '—'}</td>
            <td>${c.email || '—'}</td>
            <td>${c.score != null ? `${c.score.toFixed(1)}%` : '—'}</td>
            <td>${c.role || '—'}</td>
            <td>${formatDate(c.created_at)}</td>
        </tr>`
    ).join('');

    const html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:w="urn:schemas-microsoft-com:office:word"
              xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="utf-8"><title>Screened Candidates</title>
        <style>
            body { font-family: Calibri, Arial, sans-serif; margin: 40px; }
            h1 { color: #5d8c2c; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #5d8c2c; color: white; padding: 8px; }
            td { padding: 8px; border: 1px solid #ccc; vertical-align: top; }
        </style>
        </head>
        <body>
        <h1>Screened Candidates Report</h1>
        <p>Generated: ${new Date().toLocaleDateString()} | Total: ${candidates.length}</p>
        <table>
            <thead><tr><th>Rank</th><th>Name</th><th>Phone</th><th>Email</th><th>Score</th><th>Role</th><th>Screened Date</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        </body></html>
    `;

    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screened_candidates_${new Date().toISOString().slice(0, 10)}.doc`;
    a.click();
    URL.revokeObjectURL(url);
};

// ─── Analysis Modal ──────────────────────────────────────────────────────────

const AnalysisModal = ({ candidate, onClose }) => {
    if (!candidate) return null;
    const analysis = candidate.analysis_data || {};
    const matchedSkills = analysis.key_skills_match || [];
    const missingSkills = analysis.missing_skills || [];
    const reasoning = analysis.reasoning || 'No detailed analysis available.';
    const score = candidate.score ?? 0;

    const getScoreColor = (s) => {
        if (s >= 75) return 'text-green-600';
        if (s >= 50) return 'text-yellow-600';
        return 'text-red-500';
    };

    const getScoreRing = (s) => {
        if (s >= 75) return 'border-green-500';
        if (s >= 50) return 'border-yellow-500';
        return 'border-red-400';
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">{candidate.name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">{candidate.email} • {candidate.role || 'N/A'}</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                    {/* Score Circle */}
                    <div className="flex items-center justify-center">
                        <div className={`w-28 h-28 rounded-full border-4 ${getScoreRing(score)} flex flex-col items-center justify-center shadow-lg`}>
                            <span className={`text-3xl font-black ${getScoreColor(score)}`}>{score.toFixed(1)}</span>
                            <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Score</span>
                        </div>
                    </div>

                    {/* AI Summary */}
                    <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">AI Screening Summary</h4>
                        <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-xl p-4 border border-gray-100">{reasoning}</p>
                    </div>

                    {/* Matched Skills */}
                    {matchedSkills.length > 0 && (
                        <div>
                            <h4 className="text-xs font-bold text-green-600 uppercase tracking-wider mb-2">
                                ✓ Matched Skills ({matchedSkills.length})
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                                {matchedSkills.map((skill, i) => (
                                    <span key={i} className="px-2.5 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-lg border border-green-200">
                                        {skill}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Missing Skills */}
                    {missingSkills.length > 0 && (
                        <div>
                            <h4 className="text-xs font-bold text-red-500 uppercase tracking-wider mb-2">
                                ✗ Missing Skills ({missingSkills.length})
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                                {missingSkills.map((skill, i) => (
                                    <span key={i} className="px-2.5 py-1 bg-red-50 text-red-600 text-xs font-medium rounded-lg border border-red-200">
                                        {skill}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Additional Info */}
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2 text-xs text-gray-500">
                        <div className="flex justify-between"><span>Phone:</span><span className="font-medium text-gray-700">{cleanPhone(candidate.phone) || 'Not provided'}</span></div>
                        <div className="flex justify-between"><span>Role Applied:</span><span className="font-medium text-gray-700">{candidate.role || '—'}</span></div>
                        <div className="flex justify-between"><span>Stage:</span><span className="font-medium text-gray-700">{candidate.stage || '—'}</span></div>
                        <div className="flex justify-between"><span>Screened On:</span><span className="font-medium text-gray-700">{formatDate(candidate.created_at)}</span></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Main Component ──────────────────────────────────────────────────────────

const ScreenedCandidates = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [analysisCandidate, setAnalysisCandidate] = useState(null);
    const [resumeCandidate, setResumeCandidate] = useState(null);
    const [resetting, setResetting] = useState(false);

    const handleReset = async () => {
        if (!window.confirm("Are you sure you want to delete all screened candidates and reset the screening history? This will also clear the AI search index for these candidates. This action cannot be undone.")) {
            return;
        }
        setResetting(true);
        try {
            const response = await fetch(`${API_URL}/api/resume/reset-screened/`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (response.ok) {
                setCandidates([]);
                alert("Screened candidates list has been reset successfully.");
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || `Server returned ${response.status}`);
            }
        } catch (err) {
            console.error('Failed to reset candidates', err);
            alert(`Error resetting candidates: ${err.message}`);
        } finally {
            setResetting(false);
        }
    };

    const handleDeleteIndividual = async (id) => {
        if (!window.confirm("Are you sure you want to delete this candidate? This action cannot be undone.")) {
            return;
        }
        try {
            const response = await fetch(`${API_URL}/api/resume/candidates/${id}/`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (response.ok) {
                setCandidates(prev => prev.filter(c => c.id !== id));
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || `Server returned ${response.status}`);
            }
        } catch (err) {
            console.error('Failed to delete candidate', err);
            alert(`Error deleting candidate: ${err.message}`);
        }
    };

    const fetchCandidates = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_URL}/api/resume/candidates/`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (response.ok) {
                const data = await response.json();
                const screened = data
                    .filter(c => c.stage === 'Resume Screening')
                    .sort((a, b) => (b.score || 0) - (a.score || 0));
                setCandidates(screened);
            } else {
                throw new Error(`Server returned ${response.status}`);
            }
        } catch (err) {
            console.error('Failed to fetch candidates', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCandidates();
    }, []);

    useEffect(() => {
        const close = (e) => { if (!e.target.closest('#export-menu-container')) setShowExportMenu(false); };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, []);

    const getScoreBadge = (score) => {
        if (score == null) return { bg: 'bg-gray-100', text: 'text-gray-500', label: '—' };
        if (score >= 75) return { bg: 'bg-green-50', text: 'text-green-700', label: `${score.toFixed(1)}%` };
        if (score >= 50) return { bg: 'bg-yellow-50', text: 'text-yellow-700', label: `${score.toFixed(1)}%` };
        return { bg: 'bg-red-50', text: 'text-red-600', label: `${score.toFixed(1)}%` };
    };

    const openResume = (candidate) => {
        if (candidate.resume_file) {
            setResumeCandidate(candidate);
        } else {
            alert('Resume file not available for this candidate.');
        }
    };

    return (
        <div className="min-h-screen bg-transparent pb-12">
            <div className="w-full space-y-6">

                {/* ── Header ── */}
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
                    <div className="flex justify-between items-center flex-wrap gap-4">
                        <div>
                            <h1 className="text-3xl font-semibold text-[#5d8c2c] tracking-tight">Screened Candidates</h1>
                            <p className="text-gray-500 text-sm mt-1">
                                AI-ranked candidate pool from resume screening. Export to share results.
                            </p>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="bg-white text-[#5d8c2c] px-4 py-2.5 rounded-xl text-sm font-bold border border-gray-200 flex items-center gap-2 shadow-sm">
                                <BarChart2 size={16} className="text-green-600" />
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Total</span>
                                <span className="text-xl font-semibold text-[#5d8c2c]">{candidates.length}</span>
                            </div>

                            {candidates.length > 0 && (
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleReset}
                                        disabled={resetting}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl font-semibold text-sm hover:bg-red-100 hover:text-red-700 disabled:opacity-55 transition-all shadow-sm"
                                        title="Delete all screened candidates and clear history"
                                    >
                                        {resetting ? (
                                            <Loader2 size={16} className="animate-spin text-red-600" />
                                        ) : (
                                            <Trash2 size={16} />
                                        )}
                                        Reset Candidates
                                    </button>

                                    <div id="export-menu-container" className="relative">
                                        <button
                                            onClick={() => setShowExportMenu(v => !v)}
                                            className="flex items-center gap-2 px-5 py-2.5 bg-[#5d8c2c] text-white rounded-xl font-semibold text-sm hover:bg-[#4a7023] transition-all shadow-md hover:shadow-lg"
                                        >
                                            <Download size={16} />
                                            Export Data
                                        </button>

                                        {showExportMenu && (
                                            <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                                                <div className="p-2 space-y-1">
                                                    <button
                                                        onClick={() => { exportToPDF(candidates); setShowExportMenu(false); }}
                                                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-red-700 transition-colors"
                                                    >
                                                        <FileText size={16} className="text-red-500" />
                                                        Export as PDF
                                                    </button>
                                                    <button
                                                        onClick={() => { exportToExcel(candidates); setShowExportMenu(false); }}
                                                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-green-50 hover:text-green-700 transition-colors"
                                                    >
                                                        <FileSpreadsheet size={16} className="text-green-600" />
                                                        Export as Excel
                                                    </button>
                                                    <button
                                                        onClick={() => { exportToWord(candidates); setShowExportMenu(false); }}
                                                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                                    >
                                                        <FileText size={16} className="text-blue-500" />
                                                        Export as Word
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Error ── */}
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
                        <span><strong>Error:</strong> {error}</span>
                        <button onClick={fetchCandidates} className="text-sm underline hover:text-red-800">Retry</button>
                    </div>
                )}

                {/* ── Table ── */}
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
                            <Loader2 size={24} className="animate-spin text-[#5d8c2c]" />
                            <span className="font-medium">Loading candidates...</span>
                        </div>
                    ) : candidates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                            <BarChart2 size={36} className="mb-3 opacity-20 text-[#5d8c2c]" />
                            <p className="font-semibold text-[#5d8c2c]">No screened candidates yet</p>
                            <p className="text-sm mt-1">Run Resume Screening to populate this list.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200">
                                        <th className="px-4 py-4 text-left font-semibold text-gray-500 uppercase tracking-wide text-xs w-14">Rank</th>
                                        <th className="px-4 py-4 text-left font-semibold text-gray-500 uppercase tracking-wide text-xs">Candidate Name</th>
                                        <th className="px-4 py-4 text-left font-semibold text-gray-500 uppercase tracking-wide text-xs">Phone Number</th>
                                        <th className="px-4 py-4 text-left font-semibold text-gray-500 uppercase tracking-wide text-xs">Email</th>
                                        <th className="px-4 py-4 text-left font-semibold text-gray-500 uppercase tracking-wide text-xs w-24">Score</th>
                                        <th className="px-4 py-4 text-center font-semibold text-gray-500 uppercase tracking-wide text-xs w-24">Analysis</th>
                                        <th className="px-4 py-4 text-center font-semibold text-gray-500 uppercase tracking-wide text-xs w-36">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {candidates.map((c, idx) => {
                                        const badge = getScoreBadge(c.score);
                                        return (
                                            <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-4 py-4">
                                                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#5d8c2c]/10 text-[#5d8c2c] font-bold text-sm">
                                                        #{idx + 1}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="font-semibold text-gray-900">{c.name || '—'}</span>
                                                </td>
                                                <td className="px-4 py-4 text-gray-600 font-mono text-xs">
                                                    {cleanPhone(c.phone) || <span className="text-gray-300 italic text-xs font-sans">Not provided</span>}
                                                </td>
                                                <td className="px-4 py-4 text-gray-600">
                                                    {c.email ? (
                                                        <a href={`mailto:${c.email}`} className="text-[#5d8c2c] hover:underline">{c.email}</a>
                                                    ) : '—'}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${badge.bg} ${badge.text}`}>
                                                        {badge.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-center">
                                                    <button
                                                        onClick={() => setAnalysisCandidate(c)}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-100 hover:shadow-sm transition-all border border-indigo-200"
                                                        title="View detailed analysis"
                                                    >
                                                        <Search size={13} />
                                                        Analysis
                                                    </button>
                                                </td>
                                                <td className="px-4 py-4 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            onClick={() => openResume(c)}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 hover:shadow-sm transition-all border border-blue-200"
                                                            title="View resume in browser"
                                                        >
                                                            <Eye size={13} />
                                                            View
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteIndividual(c.id)}
                                                            className="inline-flex items-center justify-center p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 hover:shadow-sm transition-all border border-red-200"
                                                            title="Delete Candidate"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

            </div>

            {/* ── Analysis Modal ── */}
            {analysisCandidate && (
                <AnalysisModal candidate={analysisCandidate} onClose={() => setAnalysisCandidate(null)} />
            )}

            {/* ── Resume Viewer Modal ── */}
            {resumeCandidate && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setResumeCandidate(null)}>
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50 rounded-t-2xl">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                                    <FileText size={16} className="text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-gray-900">{resumeCandidate.name}'s Resume</h3>
                                    <p className="text-xs text-gray-400">{resumeCandidate.resume_file}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <a
                                    href={`${API_URL}/media/resumes/${resumeCandidate.resume_file}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors border border-blue-200"
                                >
                                    Open in New Tab
                                </a>
                                <button
                                    onClick={() => setResumeCandidate(null)}
                                    className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                        {/* PDF Viewer */}
                        <div className="flex-1 bg-gray-100">
                            <iframe
                                src={`${API_URL}/media/resumes/${resumeCandidate.resume_file}`}
                                className="w-full h-full border-0"
                                title="Resume Viewer"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScreenedCandidates;
