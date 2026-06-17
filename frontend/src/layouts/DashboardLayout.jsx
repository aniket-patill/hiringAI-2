import React, { useState, useCallback, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    LayoutDashboard, FileText, Code2, Users,
    Mic, ChevronLeft, ChevronRight, LogOut, Settings,
    BrainCircuit, UserCheck, Layers, BarChart3
} from 'lucide-react';
import GlobalNavbar from '../components/GlobalNavbar';

const SidebarItem = ({ icon: Icon, label, path, isOpen }) => {
    const location = useLocation();
    const isActive = location.pathname === path;

    return (
        <Link to={path} className="focus:outline-none group block">
            <div
                className={`relative flex items-center transition-all duration-300 cursor-pointer ${isOpen
                    ? 'gap-3 px-4 py-3 mx-3 rounded-xl ' + (isActive ? 'bg-[#5d8c2c] text-white shadow-lg' : 'text-black hover:bg-white/40 hover:text-black')
                    : 'w-12 h-12 mx-auto justify-center rounded-xl ' + (isActive ? 'text-[#5d8c2c]' : 'text-black hover:text-[#5d8c2c]')
                    }`}
            >
                {isActive && (
                    <motion.div
                        layoutId="active-pill"
                        className={`absolute ${isOpen ? 'left-[-12px] w-1 h-7' : 'left-[-8px] w-1.5 h-6'} bg-[#5d8c2c] rounded-r-full shadow-[0_0_15px_rgba(93,140,44,0.5)]`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                    />
                )}

                <Icon size={22} className={`shrink-0 z-10 transition-colors ${isActive ? (isOpen ? 'text-white' : 'text-[#5d8c2c]') : 'text-black group-hover:scale-110'}`} />

                {isOpen && (
                    <motion.span
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2 }}
                        className={`text-[18px] font-semibold tracking-tight whitespace-nowrap z-10 ${isActive ? 'text-white' : 'text-black hover:text-black'}`}
                    >
                        {label}
                    </motion.span>
                )}
            </div>
        </Link>
    );
};

const DashboardLayout = () => {
    const [isSidebarOpen, setSidebarOpen] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(280);
    const [isResizing, setIsResizing] = useState(false);
    const navigate = useNavigate();

    const startResizing = React.useCallback((e) => {
        setIsResizing(true);
        e.preventDefault();
    }, []);

    const stopResizing = React.useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = React.useCallback((e) => {
        if (isResizing) {
            const newWidth = e.clientX;
            if (newWidth > 200 && newWidth < 500) {
                setSidebarWidth(newWidth);
            }
        }
    }, [isResizing]);

    React.useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
            document.body.style.cursor = 'col-resize';
        } else {
            document.body.style.cursor = 'default';
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
            document.body.style.cursor = 'default';
        };
    }, [isResizing, resize, stopResizing]);

    return (
        <div className="h-screen bg-white flex flex-col overflow-hidden font-sans antialiased text-black selection:bg-green-100 selection:text-green-900">
            {/* 1. Global Navbar (Fixed Height) */}
            <div className="flex-none z-50 relative">
                <GlobalNavbar />
            </div>

            {/* 2. Main Layout (Fills remaining height) */}
            <div className="flex flex-1 overflow-hidden relative pt-16">

                {/* Sidebar */}
                <motion.div
                    initial={false}
                    animate={{ width: isSidebarOpen ? sidebarWidth : 88 }}
                    transition={isResizing ? { duration: 0 } : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    className="bg-[#ecefec] border-r border-[#d9e2d9] flex flex-col h-full z-40 relative shadow-sm"
                >
                    {/* Resize Handle - Wider hit area */}
                    <div
                        onMouseDown={startResizing}
                        className={`absolute -right-1 top-0 w-3 h-full cursor-col-resize hover:bg-[#5d8c2c]/20 transition-colors z-[100] ${isResizing ? 'bg-[#5d8c2c]/40' : ''}`}
                    />

                    {/* Toggle */}
                    <div className="absolute -right-3 top-8 z-50">
                        <button
                            onClick={() => setSidebarOpen(!isSidebarOpen)}
                            className="p-1.5 rounded-full bg-white text-[#5d8c2c] shadow-lg hover:scale-110 transition-all border border-gray-100"
                        >
                            {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                        </button>
                    </div>

                    {/* Scrollable Menu */}
                    <div className="flex-1 overflow-y-auto no-scrollbar py-10 space-y-12">
                        {/* Pipeline Stages */}
                        <div>
                            {isSidebarOpen && (
                                <h3 className="text-[12px] font-black text-[#5d8c2c] uppercase tracking-[0.2em] mb-7 px-8 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-[#5d8c2c]" /> Recruitment Pipeline
                                </h3>
                            )}
                            {!isSidebarOpen && <div className="h-4" />}
                            <div className={isSidebarOpen ? "space-y-2" : "space-y-4"}>
                                <SidebarItem icon={LayoutDashboard} label="Dashboard" path="/dashboard" isOpen={isSidebarOpen} />
                                <SidebarItem icon={Layers} label="Rounds Manager" path="/recruitment/rounds" isOpen={isSidebarOpen} />
                                <SidebarItem icon={FileText} label="Resume Screening" path="/resume-screening" isOpen={isSidebarOpen} />
                                <SidebarItem icon={BrainCircuit} label="Screened Candidates" path="/screened-candidates" isOpen={isSidebarOpen} />
                                <SidebarItem icon={UserCheck} label="Aptitude Round" path="/aptitude-round" isOpen={isSidebarOpen} />
                                <SidebarItem icon={Code2} label="Coding Round" path="/coding-round" isOpen={isSidebarOpen} />
                                <SidebarItem icon={Mic} label="AI Interview" path="/technical-interview" isOpen={isSidebarOpen} />
                            </div>
                        </div>

                        {/* Management */}
                        <div>
                            {isSidebarOpen && (
                                <h3 className="text-[12px] font-black text-[#5d8c2c]/80 uppercase tracking-[0.2em] mb-7 px-4 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-[#5d8c2c]/60" /> Management
                                </h3>
                            )}
                            <div className="space-y-2">
                                <SidebarItem icon={Users} label="All Candidates" path="/candidates" isOpen={isSidebarOpen} />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Main Content */}
                <main className="flex-1 h-full overflow-y-auto bg-gray-50/50 p-3 md:p-5 relative scroll-smooth w-full">
                    <div className="w-full pb-20">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};


export default DashboardLayout;
