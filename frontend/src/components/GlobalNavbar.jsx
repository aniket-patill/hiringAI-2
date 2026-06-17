
import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Users, Shield, LogOut, Bell, UserCircle, FileSearch, UserCheck, SlidersHorizontal, Sparkles } from 'lucide-react';
import CandidateLoginModal from './CandidateLoginModal';
import { UserButton } from '@clerk/clerk-react';
import API_URL from '../apiConfig';

const GlobalNavbar = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const handleNotificationClick = async (notification) => {
        // 1. Mark as Read
        await markOneRead(notification.id);

        // 2. Navigate based on Action/Content
        // We use heuristic matching on 'action' or 'details' string from ActivityLog
        const action = notification.action.toLowerCase();
        const target = notification.target;

        if (action.includes('screened')) {
            navigate('/candidates'); // Or specific filter if possible
        } else if (action.includes('submitted')) {
            if (notification.details && notification.details.includes('Aptitude')) {
                navigate('/rounds/aptitude');
            } else if (notification.details && notification.details.includes('Coding')) {
                navigate('/rounds/coding');
            } else {
                navigate('/candidates');
            }
        } else if (action.includes('promoted')) {
            // Move to the new stage page?
            // For now, simpler to go to candidates or board
            navigate('/dashboard');
        } else {
            navigate('/dashboard');
        }

        setShowNotifications(false);
    };
    const [showLoginModal, setShowLoginModal] = useState(false);



    // Notification Logic
    const [notifications, setNotifications] = useState([]);
    const [showNotifications, setShowNotifications] = useState(false);

    // Derived unread count
    const unreadCount = notifications.length;

    const fetchNotifications = async () => {
        try {
            // Fetch only unread notifications from backend
            const res = await fetch(`${API_URL}/api/dashboard/notifications/`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                setNotifications(data);
            }
        } catch (error) {
            console.error("Failed to fetch notifications", error);
        }
    };

    React.useEffect(() => {
        fetchNotifications();
        const interval = setInterval(fetchNotifications, 30000);
        return () => clearInterval(interval);
    }, []);

    const markAllAsRead = async () => {
        // Optimistic UI update
        const currentNotes = [...notifications];
        setNotifications([]);

        // Loop and mark all (parallel) - simplistic approach for now
        // Ideally backend has a 'mark_all_read' endpoint, but user asked for "Clicking notification..."
        // We will just clear UI for "Mark all" and let background sync handle it or loop calls.
        try {
            await Promise.all(currentNotes.map(n =>
                fetch(`${API_URL}/api/dashboard/notifications/${n.id}/read`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                })
            ));
        } catch (e) {
            console.error(e);
        }
    };

    const markOneRead = async (id) => {
        // Optimistic update
        setNotifications(prev => prev.filter(n => n.id !== id));
        try {
            await fetch(`${API_URL}/api/dashboard/notifications/${id}/read`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
        } catch (e) {
            console.error(e);
        }
    };

    const isActive = (path) => location.pathname === path;

    const getNotificationMessage = (n) => {
        const action = (n.action || '').toLowerCase();
        const target = n.target || 'Candidate';
        const details = n.details || '';

        if (action.includes('submitted')) {
            return <p className="text-sm text-gray-800"><span className="font-bold text-gray-900">{target}</span> submitted <span className="font-medium text-blue-600">{details || 'assignment'}</span></p>;
        }
        if (action.includes('promoted')) {
            return <p className="text-sm text-gray-800"><span className="font-bold text-gray-900">{target}</span> promoted to <span className="font-medium text-purple-600">{details || 'Next Round'}</span></p>;
        }
        return <p className="text-sm text-gray-800"><span className="font-bold">{n.user_name || 'System'}</span> {n.action} <span className="font-medium">{n.target}</span></p>;
    };

    const navItems = [
        { path: '/resume-screening', label: 'Resume Screening', icon: FileSearch },
        { path: '/screened-candidates', label: 'Screened Candidates', icon: UserCheck },
        { path: '/resume-chat', label: 'AI Search', icon: Sparkles },
        { path: '/settings', label: 'Settings', icon: SlidersHorizontal },
    ];

    return (
        <>
            <nav className="h-16 bg-white/95 backdrop-blur-md border-b border-gray-200/80 fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                {/* Logo Section */}
                <div className="flex items-center gap-5">
                    <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-8 w-auto object-contain" />
                    <div className="hidden sm:block w-[1.5px] h-8 bg-gray-300" />
                    <span className="text-xl font-bold text-[#5d8c2c] tracking-tight mt-3.5">HiringAI</span>
                </div>

                {/* Center Navigation — Premium Pill Tabs */}
                <div className="hidden md:flex items-center bg-gray-100/80 rounded-xl p-1 gap-0.5">
                    {navItems.map(({ path, label, icon: Icon }) => {
                        const active = isActive(path);
                        return (
                            <Link
                                key={path}
                                to={path}
                                className={`relative flex items-center gap-2 text-sm font-semibold px-5 py-2 rounded-lg transition-all duration-300 ${
                                    active
                                        ? 'bg-gradient-to-r from-[#5d8c2c] to-[#4a7a1f] text-white shadow-md shadow-green-200/50'
                                        : 'text-gray-600 hover:text-gray-900 hover:bg-white/70'
                                }`}
                            >
                                <Icon size={16} className={active ? 'text-white/90' : 'text-gray-400'} />
                                {label}
                            </Link>
                        );
                    })}
                </div>

                {/* Right Section: Profile & Actions */}
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <button
                            onClick={() => {
                                setShowNotifications(!showNotifications);
                                // User asked: "When HR opens... notifications visible, count remains until explictly marked read"
                                // So we DO NOT mark as read on open. Only on clicking "Mark all" or individual item.
                            }}
                            className="text-gray-500 hover:text-gray-700 transition-colors relative focus:outline-none"
                        >
                            <Bell className="w-5 h-5" />
                            {unreadCount > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-600 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white shadow-sm">
                                    {unreadCount}
                                </span>
                            )}
                        </button>

                        {showNotifications && (
                            <div className="absolute right-0 mt-3 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                                <div className="p-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                                    <h3 className="font-bold text-gray-900 text-sm">Recent Activity</h3>
                                    {unreadCount > 0 && (
                                        <span onClick={markAllAsRead} className="text-xs text-blue-600 font-semibold cursor-pointer hover:underline">Mark all read</span>
                                    )}
                                </div>
                                <div className="max-h-[300px] overflow-y-auto">
                                    {notifications.length === 0 ? (
                                        <div className="p-6 text-center text-gray-400 text-sm">No new notifications</div>
                                    ) : (
                                        notifications.map((n, i) => (
                                            <div
                                                key={n.id || i}
                                                onClick={() => handleNotificationClick(n)}
                                                className="p-3 border-b border-gray-50 hover:bg-blue-50/50 transition-colors flex gap-3 items-start cursor-pointer"
                                            >
                                                <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                                                <div>
                                                    {getNotificationMessage(n)}
                                                    <p className="text-xs text-gray-400 mt-1">{new Date(n.timestamp).toLocaleTimeString()}</p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="p-2 border-t border-gray-100 bg-gray-50 text-center">
                                    <Link to="/dashboard" className="text-xs font-bold text-blue-600 hover:text-blue-700">View Dashboard</Link>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="h-8 w-px bg-gray-200 mx-2" />

                    {/* Clerk User Button */}
                    <UserButton
                        appearance={{
                            elements: {
                                avatarBox: "w-9 h-9",
                                userButtonPopoverCard: "shadow-xl"
                            }
                        }}
                        afterSignOutUrl="/"
                    />
                </div>
            </nav>

            {/* Candidate Login Modal */}
            <CandidateLoginModal
                isOpen={showLoginModal}
                onClose={() => setShowLoginModal(false)}
            />
        </>
    );
};

export default GlobalNavbar;
