import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
// import Dashboard from './pages/Dashboard';               // COMMENTED OUT
import ResumeScreening from './pages/ResumeScreening';
// import CodingRound from './pages/CodingRound';           // COMMENTED OUT
// import TechnicalInterview from './pages/TechnicalInterview'; // COMMENTED OUT
// import AptitudeRound from './pages/AptitudeRound';       // COMMENTED OUT
// import RecruitmentRoundsManager from './pages/RecruitmentRoundsManager'; // COMMENTED OUT
// import Candidates from './pages/Candidates';             // COMMENTED OUT
import ScreenedCandidates from './pages/ScreenedCandidates';
import ResumeChat from './pages/ResumeChat';
// import Analytics from './pages/Analytics';               // COMMENTED OUT
import AuthLayout from './layouts/AuthLayout';
import DashboardLayout from './layouts/DashboardLayout';
import CandidateLayout from './layouts/CandidateLayout';
import CandidateLogin from './pages/candidate/CandidateLogin';
import InstructionsPage from './pages/candidate/InstructionsPage';
import CandidateCodingAssessment from './pages/candidate/CandidateCodingAssessment';
import CandidateAptitudeAssessment from './pages/candidate/CandidateAptitudeAssessment';

import VapiInterview from './pages/candidate/VapiInterview';
// import VapiTest from './pages/VapiTest';                 // COMMENTED OUT
import CandidateStartPage from './pages/candidate/CandidateStartPage';

import Home from './pages/Home';
import GlobalSettings from './pages/GlobalSettings';
import ClerkAdminGuard from './components/ClerkAdminGuard';

function App() {
    return (
        <Router>
            <div className="min-h-screen bg-dark text-white">
                <Routes>
                    {/* Public Home */}
                    <Route path="/" element={<Home />} />

                    {/* Public/Auth Routes */}
                    <Route path="/login" element={<Home />} />

                    {/* Admin Dashboard Routes - Protected by Clerk */}
                    <Route element={<ClerkAdminGuard><DashboardLayout /></ClerkAdminGuard>}>
                        {/* COMMENTED OUT: <Route path="/dashboard" element={<Dashboard />} /> */}
                        {/* COMMENTED OUT: <Route path="/recruitment/rounds" element={<RecruitmentRoundsManager />} /> */}
                        <Route path="/resume-screening" element={<ResumeScreening />} />
                        <Route path="/screened-candidates" element={<ScreenedCandidates />} />
                        {/* COMMENTED OUT: <Route path="/coding-round" element={<CodingRound />} /> */}
                        {/* COMMENTED OUT: <Route path="/aptitude-round" element={<AptitudeRound />} /> */}
                        {/* COMMENTED OUT: <Route path="/technical-interview" element={<TechnicalInterview />} /> */}
                        {/* COMMENTED OUT: <Route path="/candidates" element={<Candidates />} /> */}
                        {/* COMMENTED OUT: <Route path="/analytics" element={<Analytics />} /> */}
                        <Route path="/resume-chat" element={<ResumeChat />} />
                        <Route path="/settings" element={<GlobalSettings />} />
                        {/* Default redirect to Resume Screening */}
                        <Route path="/dashboard" element={<Navigate to="/resume-screening" replace />} />
                    </Route>

                    {/* Candidate Portal Routes - Isolated Environment */}
                    <Route path="/portal" element={<CandidateLayout />}>
                        <Route index element={<Navigate to="/portal/login" replace />} />
                        <Route path="login" element={<CandidateLogin />} />
                        <Route path="start" element={<CandidateStartPage />} />
                        <Route path="instructions" element={<InstructionsPage />} />
                        <Route path="assessment/coding" element={<CandidateCodingAssessment />} />
                        <Route path="assessment/aptitude" element={<CandidateAptitudeAssessment />} />
                        <Route path="assessment/interview" element={<VapiInterview />} />
                        {/* COMMENTED OUT: <Route path="test-vapi" element={<VapiTest />} /> */}
                    </Route>

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App;
