import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
    TrendingUp, Users, Award, BarChart3, PieChart as PieIcon, 
    Target, BrainCircuit, ShieldAlert, FileText, CheckCircle,
    SlidersHorizontal, Star, Activity, Clock, RefreshCw, Sparkles,
    Download, FileSpreadsheet, FileDown
} from 'lucide-react';
import { 
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
    Tooltip, Legend, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
    RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import API_URL from '../apiConfig';

const COLORS = ['#5d8c2c', '#85b851', '#a9d67b', '#486d22', '#2f4816', '#76a143'];
const GRADIENT_COLORS = {
    primary: ['#5d8c2c', '#85b851'],
    secondary: ['#3b82f6', '#60a5fa'],
    accent: ['#8b5cf6', '#a78bfa'],
    warning: ['#f59e0b', '#fbbf24']
};

const Analytics = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    // Interactive filter states
    const [selectedRoleFilter, setSelectedRoleFilter] = useState('All Roles');
    const [demoMode, setDemoMode] = useState(false);
    const [showExportDropdown, setShowExportDropdown] = useState(false);
    const [candidateSearch, setCandidateSearch] = useState('');
    const [candidateStageFilter, setCandidateStageFilter] = useState('All Stages');
    const [candidateSort, setCandidateSort] = useState({ field: 'score', dir: 'desc' });
    const [reScreening, setReScreening] = useState(false);

    const handleExportPDF = () => {
        if (filteredCandidates.length === 0) {
            alert("No candidate data available to export.");
            return;
        }
        const doc = new jsPDF();
        
        // Brand Header
        doc.setFontSize(20);
        doc.setTextColor(93, 140, 44); // Brand Color #5d8c2c
        doc.text("HiringAI - Pipeline & Talent Analytics Report", 14, 20);
        
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated on: ${new Date().toLocaleString()} | Filter: ${selectedRoleFilter} | Data Mode: ${demoMode ? 'Demo' : 'Live'}`, 14, 26);
        
        // High Level Metrics Section
        doc.setFontSize(12);
        doc.setTextColor(50, 50, 50);
        doc.text("Executive Summary Metrics:", 14, 35);
        
        doc.setFontSize(10);
        doc.text(`- Total Applicants Evaluated: ${totalCandidates}`, 16, 42);
        doc.text(`- Candidates Active in Tests: ${activeAssessments}`, 16, 48);
        doc.text(`- Overall Placement/Hired Rate: ${totalCandidates ? Math.round((hiredCount / totalCandidates) * 100) : 0}%`, 16, 54);
        doc.text(`- Average Overall Talent Score: ${avgOverallScore}%`, 16, 60);

        // Funnel Table
        doc.setFontSize(12);
        doc.text("Recruitment Funnel Stage Distribution:", 14, 70);
        
        const funnelHeaders = [["Stage Name", "Candidate Count"]];
        const funnelBody = funnelData.map(item => [item.name, item.Candidates]);
        
        autoTable(doc, {
            startY: 74,
            head: funnelHeaders,
            body: funnelBody,
            theme: 'striped',
            headStyles: { fillColor: [93, 140, 44] },
            styles: { fontSize: 8, cellPadding: 2 }
        });
        
        // Recommendations Table
        const currentY = doc.lastAutoTable.finalY + 10;
        doc.text("AI Talent Quality Recommendation Breakdown:", 14, currentY);
        
        const recHeaders = [["Recommendation Level", "Count"]];
        const recBody = recommendationData.map(item => [item.name, item.value]);
        
        autoTable(doc, {
            startY: currentY + 4,
            head: recHeaders,
            body: recBody,
            theme: 'striped',
            headStyles: { fillColor: [93, 140, 44] },
            styles: { fontSize: 8, cellPadding: 2 }
        });

        // Add page for details
        doc.addPage();
        doc.setFontSize(12);
        doc.text("Average Evaluation Scores across Rounds:", 14, 20);
        
        const scoreHeaders = [["Evaluation Round", "Average Score Percentage"]];
        const scoreBody = averageScoresData.map(item => [item.subject, `${item.Score}%`]);
        
        autoTable(doc, {
            startY: 24,
            head: scoreHeaders,
            body: scoreBody,
            theme: 'striped',
            headStyles: { fillColor: [93, 140, 44] },
            styles: { fontSize: 8, cellPadding: 2 }
        });

        const lastY2 = doc.lastAutoTable.finalY + 10;
        doc.text("Performance Insights by Job Role:", 14, lastY2);
        
        const roleHeaders = [["Job Role", "Candidates Evaluated", "Avg Overall Score"]];
        const roleBody = roleAnalysisData.map(item => [item.role, item.Candidates, `${item['Avg Score']}%`]);
        
        autoTable(doc, {
            startY: lastY2 + 4,
            head: roleHeaders,
            body: roleBody,
            theme: 'striped',
            headStyles: { fillColor: [93, 140, 44] },
            styles: { fontSize: 8, cellPadding: 2 }
        });

        doc.save(`HiringAI_Analytics_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
        setShowExportDropdown(false);
    };

    const handleExportWord = () => {
        if (filteredCandidates.length === 0) {
            alert("No candidate data available to export.");
            return;
        }

        const funnelRows = funnelData.map(item => `
            <tr>
                <td style="font-weight: bold;">${item.name}</td>
                <td>${item.Candidates}</td>
            </tr>
        `).join('');

        const recRows = recommendationData.map(item => `
            <tr>
                <td style="font-weight: bold;">${item.name}</td>
                <td>${item.value}</td>
            </tr>
        `).join('');

        const scoreRows = averageScoresData.map(item => `
            <tr>
                <td style="font-weight: bold;">${item.subject}</td>
                <td>${item.Score}%</td>
            </tr>
        `).join('');

        const roleRows = roleAnalysisData.map(item => `
            <tr>
                <td style="font-weight: bold;">${item.role}</td>
                <td>${item.Candidates}</td>
                <td>${item['Avg Score']}%</td>
            </tr>
        `).join('');

        const htmlContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <title>HiringAI Analytics Executive Dossier</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; }
                h1 { color: #5d8c2c; font-size: 24px; border-bottom: 2px solid #5d8c2c; padding-bottom: 8px; }
                h2 { color: #333333; font-size: 18px; margin-top: 24px; }
                .meta { color: #666; font-size: 11px; margin-bottom: 24px; }
                .metric-box { border: 1px solid #ddd; background-color: #f9f9f9; padding: 12px; margin-bottom: 16px; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; }
                th { background-color: #5d8c2c; color: white; padding: 10px; text-align: left; font-size: 12px; font-weight: bold; border: 1px solid #ddd; }
                td { padding: 8px 10px; font-size: 11px; border: 1px solid #ddd; }
                tr:nth-child(even) { background-color: #f9f9f9; }
            </style>
        </head>
        <body>
            <h1>HiringAI Analytics Executive Report</h1>
            <div class="meta">
                Generated: ${new Date().toLocaleString()}<br/>
                Filter applied: ${selectedRoleFilter}<br/>
                Data Source Mode: ${demoMode ? 'Demo Data' : 'Live Data'}<br/>
            </div>
            
            <div class="metric-box">
                <p>Total Applicants: ${totalCandidates}</p>
                <p>Active in Tests: ${activeAssessments}</p>
                <p>Hired Rate: ${totalCandidates ? Math.round((hiredCount / totalCandidates) * 100) : 0}%</p>
                <p>Avg Talent Score: ${avgOverallScore}%</p>
            </div>

            <h2>1. Recruitment Funnel Stage Distribution</h2>
            <table>
                <thead>
                    <tr>
                        <th>Stage Name</th>
                        <th>Candidate Count</th>
                    </tr>
                </thead>
                <tbody>
                    ${funnelRows}
                </tbody>
            </table>

            <h2>2. AI Recommendation Quality Breakdown</h2>
            <table>
                <thead>
                    <tr>
                        <th>Recommendation Quality Level</th>
                        <th>Count</th>
                    </tr>
                </thead>
                <tbody>
                    ${recRows}
                </tbody>
            </table>

            <h2>3. Average Round Evaluation Scores</h2>
            <table>
                <thead>
                    <tr>
                        <th>Evaluation Round</th>
                        <th>Average Score</th>
                    </tr>
                </thead>
                <tbody>
                    ${scoreRows}
                </tbody>
            </table>

            <h2>4. Performance Insights by Job Role</h2>
            <table>
                <thead>
                    <tr>
                        <th>Job Role Name</th>
                        <th>Candidates Evaluated</th>
                        <th>Avg Overall Score</th>
                    </tr>
                </thead>
                <tbody>
                    ${roleRows}
                </tbody>
            </table>
        </body>
        </html>
        `;

        const blob = new Blob(['\ufeff' + htmlContent], {
            type: 'application/msword'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `HiringAI_Analytics_Report_${new Date().toISOString().slice(0, 10)}.doc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShowExportDropdown(false);
    };

    const handleExportExcel = () => {
        if (filteredCandidates.length === 0) {
            alert("No candidate data available to export.");
            return;
        }

        const workbook = XLSX.utils.book_new();

        // Prepare single consolidated dataset with blank rows/headings
        const reportData = [
            ["HiringAI - Pipeline & Talent Analytics Report"],
            [`Generated on: ${new Date().toLocaleString()} | Filter: ${selectedRoleFilter} | Data Source Mode: ${demoMode ? 'Demo Data' : 'Live Data'}`],
            [],
            ["EXECUTIVE SUMMARY METRICS"],
            ["Metric Name", "Value"],
            ["Total Applicants", totalCandidates],
            ["Active in Tests", activeAssessments],
            ["Hired Rate (%)", totalCandidates ? Math.round((hiredCount / totalCandidates) * 100) : 0],
            ["Avg Talent Score (%)", avgOverallScore],
            [],
            ["RECRUITMENT FUNNEL DISTRIBUTION"],
            ["Stage Name", "Candidate Count"],
            ...funnelData.map(item => [item.name, item.Candidates]),
            [],
            ["AI TALENT QUALITY RECOMMENDATION BREAKDOWN"],
            ["Recommendation Level", "Count"],
            ...recommendationData.map(item => [item.name, item.value]),
            [],
            ["AVERAGE EVALUATION SCORES ACROSS ROUNDS"],
            ["Evaluation Round", "Average Score (%)"],
            ...averageScoresData.map(item => [item.subject, item.Score]),
            [],
            ["PERFORMANCE INSIGHTS BY JOB ROLE"],
            ["Job Role", "Candidates Evaluated", "Avg Overall Score (%)"],
            ...roleAnalysisData.map(item => [item.role, item.Candidates, item['Avg Score']])
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(reportData);

        // Autofit column widths
        worksheet['!cols'] = [
            { wch: 45 }, // Column A
            { wch: 25 }, // Column B
            { wch: 25 }  // Column C
        ];

        XLSX.utils.book_append_sheet(workbook, worksheet, "Analytics Report");

        XLSX.writeFile(workbook, `HiringAI_Analytics_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
        setShowExportDropdown(false);
    };

    const fetchCandidates = async () => {
        try {
            setLoading(true);
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/resume/candidates/`, {
                headers: { 'Authorization': `Bearer ${token}` },
                cache: 'no-store'
            });
            if (!response.ok) throw new Error('Failed to fetch candidates');
            const data = await response.json();
            setCandidates(data);
        } catch (err) {
            console.error("Error fetching candidates for analytics:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleReScreenUnscored = async () => {
        const jd = prompt('Paste the Job Description to re-screen unscored candidates:');
        if (!jd || !jd.trim()) return;
        try {
            setReScreening(true);
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/resume/rescreen-unscored/`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_description: jd })
            });
            const data = await res.json();
            alert(`✅ ${data.message}`);
            fetchCandidates(); // Refresh data
        } catch (err) {
            alert('Re-screen failed: ' + err.message);
        } finally {
            setReScreening(false);
        }
    };

    useEffect(() => {
        fetchCandidates();
    }, []);

    const getDemoCandidates = useCallback(() => {
        const names = [
            "Sarah Jenkins", "David Kim", "Amelie Laurent", "Michael Chen", "Sophia Martinez",
            "James Wilson", "Emma Watson", "Alex Thompson", "Jessica Taylor", "Ryan Harris",
            "Olivia Clark", "Daniel Lewis", "Chloe Walker", "Matthew Hall", "Isabella Allen",
            "Andrew Young", "Mia King", "Joshua Wright", "Harper Scott", "Nathan Green",
            "Liam Nelson", "Ava Carter", "Noah Mitchell", "Emily Perez", "Lucas Roberts"
        ];
        const roles = ["Full Stack Software Engineer", "Frontend Developer", "Backend Developer", "Python Developer"];
        const stages = ["Resume Screening", "Screened Candidates", "Aptitude Round", "Coding Round", "Technical Interview", "Offer Sent", "Hired"];
        
        return names.map((name, i) => {
            const role = roles[i % roles.length];
            // Distribute stages realistically
            let stage = stages[0];
            if (i > 3) stage = stages[1];
            if (i > 7) stage = stages[2];
            if (i > 12) stage = stages[3];
            if (i > 16) stage = stages[4];
            if (i > 19) stage = stages[5];
            if (i > 21) stage = stages[6];

            const resumeScore = 65 + (i * 7) % 32;
            const aptScore = 60 + (i * 9) % 36;
            const codingScore = 55 + (i * 11) % 41;
            const interviewScore = 65 + (i * 13) % 31;

            const analysis_data = {};
            if (stage !== "Resume Screening" && stage !== "Screened Candidates") {
                analysis_data.score_percentage = aptScore;
                analysis_data.correct = Math.round(aptScore / 10);
                analysis_data.total = 10;
            }
            if (stage === "Coding Round" || stage === "Technical Interview" || stage === "Offer Sent" || stage === "Hired") {
                analysis_data.passed = Math.round(codingScore / 20);
                analysis_data.total = 5;
            }
            if (stage === "Technical Interview" || stage === "Offer Sent" || stage === "Hired") {
                analysis_data.interview = { score: interviewScore };
            }

            return {
                id: `demo-${i}`,
                name,
                role,
                stage,
                score: resumeScore,
                analysis_data
            };
        });
    }, []);

    const activeCandidates = useMemo(() => {
        if (demoMode) {
            return getDemoCandidates();
        }
        return candidates;
    }, [candidates, demoMode, getDemoCandidates]);

    // Get list of unique roles for dropdown
    const availableRoles = useMemo(() => {
        const roles = new Set(activeCandidates.map(c => c.role).filter(Boolean));
        return ['All Roles', ...Array.from(roles)];
    }, [activeCandidates]);

    // Calculate effective score incorporating resume, aptitude, coding, and interview metrics
    const getEffectiveScore = (c) => {
        const scores = [];
        
        // Resume score
        if (c.score !== undefined && c.score !== null && c.score > 0) {
            scores.push(c.score);
        }
        
        // Aptitude score
        if (c.analysis_data?.score_percentage !== undefined) {
            scores.push(c.analysis_data.score_percentage);
        } else if (c.analysis_data?.correct !== undefined && c.analysis_data?.total) {
            scores.push((c.analysis_data.correct / c.analysis_data.total) * 100);
        }
        
        // Coding score
        if (c.analysis_data?.passed !== undefined && c.analysis_data?.total) {
            scores.push((c.analysis_data.passed / c.analysis_data.total) * 100);
        }
        
        // Interview score
        if (c.analysis_data?.interview?.score !== undefined) {
            scores.push(c.analysis_data.interview.score);
        }
        
        if (scores.length === 0) return c.score || 0;
        
        // Calculate average
        const sum = scores.reduce((a, b) => a + b, 0);
        return Math.round(sum / scores.length);
    };

    // Filter candidates based on user selection
    const filteredCandidates = useMemo(() => {
        if (selectedRoleFilter === 'All Roles') return activeCandidates;
        return activeCandidates.filter(c => c.role === selectedRoleFilter);
    }, [activeCandidates, selectedRoleFilter]);

    // 1. Process Recruitment Funnel Data
    const stagesOrdered = [
        'Resume Screening',
        'Screened Candidates',
        'Aptitude Round',
        'Coding Round',
        'Technical Interview',
        'Offer Sent',
        'Hired'
    ];

    const stageMap = useMemo(() => {
        return filteredCandidates.reduce((acc, c) => {
            const stage = c.stage || 'Resume Screening';
            acc[stage] = (acc[stage] || 0) + 1;
            return acc;
        }, {});
    }, [filteredCandidates]);

    const funnelData = useMemo(() => {
        return stagesOrdered.map(stage => ({
            name: stage,
            Candidates: stageMap[stage] || 0
        }));
    }, [stageMap]);

    // 2. AI Recommendation breakdown based on calculated effective scores
    const getRecommendationCategory = (c) => {
        const score = getEffectiveScore(c);
        if (score >= 88) return 'Strongly Recommend';
        if (score >= 75) return 'Recommend';
        if (score >= 60) return 'Borderline';
        return 'Not Recommended';
    };

    const recommendationData = useMemo(() => {
        const recMap = filteredCandidates.reduce((acc, c) => {
            const cat = getRecommendationCategory(c);
            acc[cat] = (acc[cat] || 0) + 1;
            return acc;
        }, {});

        return [
            { name: 'Strongly Recommend', value: recMap['Strongly Recommend'] || 0, color: '#486d22' },
            { name: 'Recommend', value: recMap['Recommend'] || 0, color: '#5d8c2c' },
            { name: 'Borderline', value: recMap['Borderline'] || 0, color: '#f59e0b' },
            { name: 'Not Recommended', value: recMap['Not Recommended'] || 0, color: '#ef4444' }
        ].filter(d => d.value > 0);
    }, [filteredCandidates]);

    // 3. Assessment Score Metrics
    const averageScoresData = useMemo(() => {
        let aptCount = 0, aptSum = 0;
        let codeCount = 0, codeSum = 0;
        let intCount = 0, intSum = 0;
        let resumeSum = 0, resumeCount = 0;

        filteredCandidates.forEach(c => {
            const hasApt = c.analysis_data?.correct !== undefined || c.analysis_data?.score_percentage !== undefined;
            const hasCode = c.analysis_data?.passed !== undefined;
            const hasInt = c.analysis_data?.interview !== undefined;

            if (c.score !== undefined && c.score !== null) {
                resumeSum += c.score;
                resumeCount++;
            }
            if (hasApt) {
                const pct = c.analysis_data.score_percentage || ((c.analysis_data.correct / (c.analysis_data.total || 1)) * 100) || 0;
                aptSum += pct;
                aptCount++;
            }
            if (hasCode) {
                const pct = ((c.analysis_data.passed / (c.analysis_data.total || 1)) * 100) || 0;
                codeSum += pct;
                codeCount++;
            }
            if (hasInt) {
                const pct = c.analysis_data.interview?.score || 0;
                intSum += pct;
                intCount++;
            }
        });

        return [
            { subject: 'Resume Score', Score: resumeCount ? Math.round(resumeSum / resumeCount) : 0 },
            { subject: 'Aptitude Test', Score: aptCount ? Math.round(aptSum / aptCount) : 0 },
            { subject: 'Coding Round', Score: codeCount ? Math.round(codeSum / codeCount) : 0 },
            { subject: 'AI Interview', Score: intCount ? Math.round(intSum / intCount) : 0 }
        ];
    }, [filteredCandidates]);

    // 4. Score Density Distribution Area Chart
    const scoreDistributionData = useMemo(() => {
        const scoreBuckets = Array(10).fill(0);
        filteredCandidates.forEach(c => {
            const score = getEffectiveScore(c);
            const val = Math.min(Math.floor(score / 10), 9);
            scoreBuckets[val]++;
        });
        return scoreBuckets.map((count, i) => ({
            range: `${i * 10}-${(i + 1) * 10}%`,
            Candidates: count
        }));
    }, [filteredCandidates]);

    // 5. Job Role Breakdown table stats (always calculated on full list for general context)
    const roleAnalysisData = useMemo(() => {
        const roleStats = activeCandidates.reduce((acc, c) => {
            const role = c.role || 'Unspecified';
            if (!acc[role]) {
                acc[role] = { count: 0, scoreSum: 0 };
            }
            acc[role].count++;
            acc[role].scoreSum += getEffectiveScore(c);
            return acc;
        }, {});

        return Object.keys(roleStats).map(role => ({
            role: role.length > 22 ? role.substring(0, 20) + '...' : role,
            Candidates: roleStats[role].count,
            'Avg Score': Math.round(roleStats[role].scoreSum / roleStats[role].count)
        }));
    }, [activeCandidates]);

    // Calculate High Level Metrics
    const totalCandidates = filteredCandidates.length;
    const hiredCount = filteredCandidates.filter(c => c.stage === 'Hired').length;
    const activeAssessments = filteredCandidates.filter(c => ['Aptitude Round', 'Coding Round', 'Technical Interview'].includes(c.stage)).length;
    const avgOverallScore = totalCandidates ? Math.round(filteredCandidates.reduce((sum, c) => sum + getEffectiveScore(c), 0) / totalCandidates) : 0;

    return (
        <div className="space-y-8 w-full pb-12">
            {/* Header with Role Filter */}
            <div className="border-b border-gray-200 pb-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-[#5d8c2c] tracking-tight">
                        Recruitment Intelligence Dashboard
                    </h1>
                    <p className="text-gray-600 mt-2 text-sm font-medium">Real-time hiring analytics — track candidate progression, assessment results, and AI-powered talent insights.</p>
                </div>
                
                <div className="flex flex-wrap md:flex-nowrap items-center gap-3 shrink-0">
                    {/* Demo Mode Toggle */}
                    <button
                        onClick={() => setDemoMode(!demoMode)}
                        className={`flex items-center gap-2 px-4 py-2 border rounded-xl shadow-sm text-sm font-bold transition-all ${
                            demoMode 
                                ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100' 
                                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                        <Sparkles size={16} className={demoMode ? 'text-purple-600 animate-pulse' : 'text-gray-400'} />
                        {demoMode ? 'Demo Mode Active' : 'Live Data Mode'}
                    </button>

                    {/* Interactive Role Filter Dropdown */}
                    <div className="flex items-center gap-2 bg-white px-3 py-2 border border-gray-200 rounded-xl shadow-sm">
                        <SlidersHorizontal size={16} className="text-[#5d8c2c]" />
                        <select
                            value={selectedRoleFilter}
                            onChange={(e) => setSelectedRoleFilter(e.target.value)}
                            className="bg-transparent text-sm font-bold text-slate-800 focus:outline-none cursor-pointer"
                        >
                            {availableRoles.map(role => (
                                <option key={role} value={role}>{role}</option>
                            ))}
                        </select>
                    </div>

                    <button 
                        onClick={fetchCandidates}
                        disabled={loading}
                        className={`px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-sm transition-all shadow-sm flex items-center gap-2 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                        <RefreshCw size={16} className={`text-[#5d8c2c] ${loading ? 'animate-spin' : ''}`} />
                        <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
                    </button>

                    {/* Export Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowExportDropdown(!showExportDropdown)}
                            className="flex items-center gap-2 px-4 py-2 bg-[#5d8c2c] text-white hover:bg-green-700 font-bold rounded-xl text-sm transition-all shadow-sm"
                        >
                            <Download size={16} />
                            <span>Export Report</span>
                        </button>
                        {showExportDropdown && (
                            <div className="absolute right-0 mt-2 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                <button
                                    onClick={handleExportPDF}
                                    className="w-full text-left px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                                >
                                    <FileDown size={16} className="text-red-500" />
                                    <span>Download PDF</span>
                                </button>
                                <button
                                    onClick={handleExportWord}
                                    className="w-full text-left px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                                >
                                    <FileText size={16} className="text-blue-500" />
                                    <span>Download DOCS (Word)</span>
                                </button>
                                <button
                                    onClick={handleExportExcel}
                                    className="w-full text-left px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                                >
                                    <FileSpreadsheet size={16} className="text-green-600" />
                                    <span>Download Excel</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Metric Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Users size={64} className="text-[#5d8c2c]" />
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-green-50 text-[#5d8c2c] border border-green-100">
                            <Users size={24} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Total Applicants</p>
                            <h3 className="text-3xl font-extrabold text-[#5d8c2c] mt-1">{totalCandidates}</h3>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <BrainCircuit size={64} className="text-blue-600" />
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
                            <BrainCircuit size={24} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Candidates in Assessment</p>
                            <h3 className="text-3xl font-extrabold text-blue-600 mt-1">{activeAssessments}</h3>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <CheckCircle size={64} className="text-green-700" />
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-green-50 text-green-700 border border-green-150">
                            <CheckCircle size={24} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Overall Placement Rate</p>
                            <h3 className="text-3xl font-extrabold text-green-700 mt-1">
                                {totalCandidates ? `${Math.round((hiredCount / totalCandidates) * 100)}%` : '0%'}
                            </h3>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Award size={64} className="text-purple-600" />
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
                            <Award size={24} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Average Talent Score</p>
                            <h3 className="text-3xl font-extrabold text-purple-600 mt-1">{avgOverallScore}%</h3>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* 1. Funnel Pipeline Chart */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm lg:col-span-8 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <BarChart3 size={20} className="text-[#5d8c2c]" />
                                Candidate Funnel — Hiring Stage Breakdown
                            </h3>
                            <span className="text-xs font-bold text-gray-505 bg-gray-100 px-2.5 py-1 rounded-full">Live Overview</span>
                        </div>
                        <p className="text-xs text-gray-500 mb-6 font-medium">Number of candidates currently active at each stage of the end-to-end hiring process.</p>
                    </div>
                    <div className="h-[320px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={funnelData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b', fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} 
                                    labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
                                />
                                <Bar dataKey="Candidates" radius={[6, 6, 0, 0]}>
                                    {funnelData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 2. AI Recommendation Pie Chart */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm lg:col-span-4 flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
                            <PieIcon size={20} className="text-[#5d8c2c]" />
                            AI Recommendation Breakdown
                        </h3>
                        <p className="text-xs text-gray-500 mb-6 font-medium">Proportion of candidates classified by the AI engine's hiring recommendation confidence level.</p>
                    </div>
                    
                    {recommendationData.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 py-10 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                            <ShieldAlert size={40} className="mb-2 text-gray-300 animate-pulse" />
                            <span className="text-xs font-semibold">No recommendation data available</span>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center">
                            <div className="h-[220px] w-full relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={recommendationData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={65}
                                            outerRadius={85}
                                            paddingAngle={4}
                                            dataKey="value"
                                        >
                                            {recommendationData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                    <span className="text-2xl font-extrabold text-gray-900">{totalCandidates}</span>
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Evaluated</span>
                                </div>
                            </div>
                            
                            {/* Custom Legend */}
                            <div className="w-full grid grid-cols-2 gap-2 mt-4">
                                {recommendationData.map((d, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs font-medium text-gray-700">
                                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                                        <span className="truncate">{d.name} ({d.value})</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Row Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* 3. Stage-wise Average Scores Radar Chart */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm lg:col-span-5 flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
                            <Target size={20} className="text-[#5d8c2c]" />
                            Round-wise Average Performance
                        </h3>
                        <p className="text-xs text-gray-500 mb-6 font-medium">Average scores achieved by candidates across each evaluation round — Resume, Aptitude, Coding & Interview.</p>
                    </div>
                    <div className="h-[280px] w-full flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="75%" data={averageScoresData}>
                                <PolarGrid stroke="#e2e8f0" />
                                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: '#475569', fontWeight: 'bold' }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8 }} />
                                <Radar name="Average Score" dataKey="Score" stroke="#5d8c2c" fill="#5d8c2c" fillOpacity={0.2} />
                                <Tooltip />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 4. Score Density Distribution Area Chart */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm lg:col-span-7 flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
                            <Award size={20} className="text-[#5d8c2c]" />
                            Applicant Score Distribution
                        </h3>
                        <p className="text-xs text-gray-500 mb-6 font-medium">Frequency distribution of candidate scores across score bands, from 0–10% up to 90–100%.</p>
                    </div>
                    <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={scoreDistributionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="scoreColor" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#5d8c2c" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#5d8c2c" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="range" tick={{ fontSize: 10, fill: '#64748b', fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <Tooltip />
                                <Area type="monotone" dataKey="Candidates" stroke="#5d8c2c" strokeWidth={2.5} fillOpacity={1} fill="url(#scoreColor)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Job Role Comparison Table / Card list */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <FileText size={20} className="text-[#5d8c2c]" />
                            Performance Insights by Job Role
                        </h3>
                        <p className="text-xs text-gray-500 mt-1 font-medium">Aggregated candidate counts and mean overall scores parsed by applicant job positions.</p>
                    </div>
                </div>

                {roleAnalysisData.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm font-semibold">No job roles found.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50/50">
                                    <th className="py-3 px-4 rounded-l-lg">Job Role</th>
                                    <th className="py-3 px-4 text-center">Candidates Evaluated</th>
                                    <th className="py-3 px-4 text-center">Avg overall Score</th>
                                    <th className="py-3 px-4 rounded-r-lg">Performance Index</th>
                                </tr>
                            </thead>
                            <tbody>
                                {roleAnalysisData.map((item, idx) => (
                                    <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                        <td className="py-4 px-4 font-bold text-gray-800 text-sm">{item.role}</td>
                                        <td className="py-4 px-4 text-center text-gray-600 font-semibold text-sm">{item.Candidates}</td>
                                        <td className="py-4 px-4 text-center text-sm font-extrabold text-[#5d8c2c]">{item['Avg Score']}%</td>
                                        <td className="py-4 px-4">
                                            <div className="flex items-center justify-center gap-2">
                                                <div className="w-24 bg-gray-100 h-2 rounded-full overflow-hidden">
                                                    <div 
                                                        className="bg-[#5d8c2c] h-full rounded-full transition-all duration-500" 
                                                        style={{ width: `${item['Avg Score']}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs text-gray-500 font-bold">
                                                    {item['Avg Score'] >= 85 ? 'Exceptional' : item['Avg Score'] >= 75 ? 'Excellent' : item['Avg Score'] >= 60 ? 'Satisfactory' : 'Needs Review'}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Candidate Leaderboard Section */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <Users size={20} className="text-[#5d8c2c]" />
                                Candidate Leaderboard
                            </h3>
                            <p className="text-xs text-gray-500 mt-1 font-medium">All active candidates with stage progression, scores, and AI evaluation results.</p>
                        </div>
                        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2">
                            {/* Re-Screen button — shown when unscored candidates exist */}
                            {filteredCandidates.some(c => !c.score || c.score === 0) && (
                                <button
                                    onClick={handleReScreenUnscored}
                                    disabled={reScreening}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-xs font-bold transition-all disabled:opacity-60"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                                    {reScreening ? 'Re-Screening...' : 'Re-Screen Unscored'}
                                </button>
                            )}
                            {/* Search */}
                            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                                <input
                                    type="text"
                                    placeholder="Search candidate..."
                                    value={candidateSearch}
                                    onChange={e => setCandidateSearch(e.target.value)}
                                    className="bg-transparent text-sm font-medium text-gray-700 focus:outline-none w-36"
                                />
                            </div>
                            {/* Stage Filter */}
                            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                                <Target size={14} className="text-[#5d8c2c]" />
                                <select
                                    value={candidateStageFilter}
                                    onChange={e => setCandidateStageFilter(e.target.value)}
                                    className="bg-transparent text-sm font-bold text-slate-800 focus:outline-none cursor-pointer"
                                >
                                    {['All Stages', 'Resume Screening', 'Screened Candidates', 'Aptitude Round', 'Coding Round', 'Technical Interview', 'Offer Sent', 'Hired'].map(s => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </div>
                            {/* Sort */}
                            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                                <Activity size={14} className="text-[#5d8c2c]" />
                                <select
                                    value={`${candidateSort.field}-${candidateSort.dir}`}
                                    onChange={e => {
                                        const [field, dir] = e.target.value.split('-');
                                        setCandidateSort({ field, dir });
                                    }}
                                    className="bg-transparent text-sm font-bold text-slate-800 focus:outline-none cursor-pointer"
                                >
                                    <option value="score-desc">Score: High → Low</option>
                                    <option value="score-asc">Score: Low → High</option>
                                    <option value="name-asc">Name: A → Z</option>
                                    <option value="name-desc">Name: Z → A</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Table */}
                {(() => {
                    const stagesOrdered2 = ['Resume Screening','Screened Candidates','Aptitude Round','Coding Round','Technical Interview','Offer Sent','Hired'];
                    
                    // Stage rank: candidates who have REACHED or PASSED the selected stage will be shown
                    const selectedStageRank = candidateStageFilter === 'All Stages' 
                        ? -1 
                        : stagesOrdered2.indexOf(candidateStageFilter);
                    
                    const getCandidateStageRank = (c) => {
                        const idx = stagesOrdered2.indexOf(c.stage);
                        return idx === -1 ? 0 : idx;
                    };

                    let tableData = filteredCandidates
                        .filter(c => {
                            const nameMatch = !candidateSearch || (c.name || '').toLowerCase().includes(candidateSearch.toLowerCase());
                            // Show candidates who have REACHED or PASSED the selected stage
                            const stageMatch = candidateStageFilter === 'All Stages' 
                                || getCandidateStageRank(c) >= selectedStageRank;
                            return nameMatch && stageMatch;
                        })
                        .sort((a, b) => {
                            if (candidateSort.field === 'score') {
                                const sa = getEffectiveScore(a), sb = getEffectiveScore(b);
                                return candidateSort.dir === 'desc' ? sb - sa : sa - sb;
                            }
                            if (candidateSort.field === 'name') {
                                const na = (a.name || '').toLowerCase(), nb = (b.name || '').toLowerCase();
                                return candidateSort.dir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
                            }
                            return 0;
                        });

                    if (tableData.length === 0) {
                        return (
                            <div className="text-center py-14 text-gray-400">
                                <Users size={36} className="mx-auto mb-2 opacity-30" />
                                <p className="font-semibold text-sm">No candidates match your filters.</p>
                            </div>
                        );
                    }

                    const getBadge = (score) => {
                        if (score >= 85) return { label: 'Exceptional', cls: 'bg-purple-100 text-purple-700 border-purple-200' };
                        if (score >= 75) return { label: 'Excellent', cls: 'bg-green-100 text-green-700 border-green-200' };
                        if (score >= 60) return { label: 'Satisfactory', cls: 'bg-blue-100 text-blue-700 border-blue-200' };
                        return { label: 'Needs Review', cls: 'bg-red-100 text-red-600 border-red-200' };
                    };

                    const getStageBadge = (stage) => {
                        const map = {
                            'Hired': 'bg-emerald-100 text-emerald-700',
                            'Offer Sent': 'bg-teal-100 text-teal-700',
                            'Technical Interview': 'bg-blue-100 text-blue-700',
                            'Coding Round': 'bg-indigo-100 text-indigo-700',
                            'Aptitude Round': 'bg-violet-100 text-violet-700',
                            'Screened Candidates': 'bg-amber-100 text-amber-700',
                            'Resume Screening': 'bg-gray-100 text-gray-600',
                        };
                        return map[stage] || 'bg-gray-100 text-gray-500';
                    };

                    const getInitials = (name) => (name || 'NA').split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);
                    const avatarColors = ['#5d8c2c','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#06b6d4','#ec4899'];

                    return (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50/50">
                                        <th className="py-3 px-4 rounded-l-lg">#</th>
                                        <th className="py-3 px-4">Candidate</th>
                                        <th className="py-3 px-4">Job Role</th>
                                        <th className="py-3 px-4">Current Stage</th>
                                        <th className="py-3 px-4 text-center">Resume Score</th>
                                        <th className="py-3 px-4 text-center">Overall Score</th>
                                        <th className="py-3 px-4 rounded-r-lg">AI Rating</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableData.map((c, idx) => {
                                        const effScore = getEffectiveScore(c);
                                        const badge = getBadge(effScore);
                                        const stageCls = getStageBadge(c.stage);
                                        const initials = getInitials(c.name);
                                        const avatarBg = avatarColors[idx % avatarColors.length];
                                        return (
                                            <tr key={c.id || idx} className="border-b border-gray-50 hover:bg-green-50/30 transition-colors group">
                                                <td className="py-3.5 px-4 text-xs font-bold text-gray-400">{idx + 1}</td>
                                                <td className="py-3.5 px-4">
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-extrabold shrink-0"
                                                            style={{ backgroundColor: avatarBg }}
                                                        >
                                                            {initials}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-gray-800 text-sm">{c.name || 'Unknown'}</p>
                                                            <p className="text-xs text-gray-400 font-medium">{c.email || '—'}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-3.5 px-4">
                                                    <span className="text-sm font-semibold text-gray-600 max-w-[160px] block truncate">{c.role || 'N/A'}</span>
                                                </td>
                                                <td className="py-3.5 px-4">
                                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${stageCls}`}>
                                                        {c.stage || 'Resume Screening'}
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-4 text-center">
                                                    {(c.score && c.score > 0)
                                                        ? <span className="text-sm font-extrabold text-gray-700">{Math.round(c.score)}%</span>
                                                        : (c.analysis_data?.score && c.analysis_data.score > 0)
                                                            ? <span className="text-sm font-extrabold text-gray-700">{Math.round(c.analysis_data.score)}%</span>
                                                            : <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Pending</span>
                                                    }
                                                </td>
                                                <td className="py-3.5 px-4">
                                                    {effScore > 0 ? (
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-sm font-extrabold text-[#5d8c2c]">{effScore}%</span>
                                                            <div className="w-20 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full bg-[#5d8c2c] transition-all duration-500"
                                                                    style={{ width: `${effScore}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex justify-center">
                                                            <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Not Yet Scored</span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-3.5 px-4">
                                                    {effScore > 0 ? (
                                                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${badge.cls}`}>
                                                            {badge.label}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-gray-100 text-gray-500 border-gray-200">
                                                            Awaiting Score
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <div className="px-6 py-3 bg-gray-50/50 border-t border-gray-100 text-xs text-gray-400 font-semibold">
                                Showing {tableData.length} of {filteredCandidates.length} candidates
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default Analytics;
