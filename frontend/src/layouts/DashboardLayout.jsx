import React, { useState, useCallback, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    /* LayoutDashboard, */ FileText, /* Code2, */ Users,
    /* Mic, */ ChevronLeft, ChevronRight, /* LogOut, Settings, */
    BrainCircuit, /* UserCheck, Layers, BarChart3 */
} from 'lucide-react';
import GlobalNavbar from '../components/GlobalNavbar';

/* SIDEBAR ITEM COMPONENT — kept for future re-enabling
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
*/

const DashboardLayout = () => {
    return (
        <div className="h-screen bg-white flex flex-col overflow-hidden font-sans antialiased text-black selection:bg-green-100 selection:text-green-900">
            {/* 1. Global Navbar (Fixed Height) */}
            <div className="flex-none z-50 relative">
                <GlobalNavbar />
            </div>

            {/* 2. Main Content (Full Width - No Sidebar) */}
            <div className="flex-1 overflow-hidden pt-16">

                {/* SIDEBAR COMMENTED OUT — navigation moved to top navbar */}

                {/* Main Content - Full Width */}
                <main className="h-full overflow-y-auto bg-slate-100/70 p-3 md:p-6 relative scroll-smooth w-full">
                    <div className="w-full max-w-[1400px] mx-auto pb-20">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};


export default DashboardLayout;
