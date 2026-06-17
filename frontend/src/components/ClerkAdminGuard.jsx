import React, { useEffect, useState } from 'react';
import { SignedIn, SignedOut, RedirectToSignIn, useUser } from '@clerk/clerk-react';
import API_URL from '../apiConfig';

function ClerkSyncWrapper({ children }) {
    const { user, isLoaded } = useUser();
    const [synced, setSynced] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!isLoaded || !user) return;

        const syncWithBackend = async () => {
            try {
                const emailAddress = user.primaryEmailAddress?.emailAddress;
                if (!emailAddress) {
                    throw new Error("No primary email found in Clerk user profile.");
                }

                const response = await fetch(`${API_URL}/api/auth/clerk-sync/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email: emailAddress }),
                });

                if (!response.ok) {
                    throw new Error(`Sync failed with status: ${response.status}`);
                }

                const data = await response.json();
                if (data.access) {
                    localStorage.setItem('token', data.access);
                    setSynced(true);
                } else {
                    throw new Error("No token returned from backend sync.");
                }
            } catch (err) {
                console.error("Backend sync error:", err);
                setError(err.message);
            }
        };

        syncWithBackend();
    }, [user, isLoaded]);

    if (!isLoaded || (!synced && !error)) {
        return (
            <div className="h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-green-500 mb-4"></div>
                <p className="text-gray-400 text-sm font-semibold tracking-wide">Synchronizing your session...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white p-6">
                <div className="bg-red-900/20 border border-red-500/50 p-8 rounded-xl max-w-md text-center shadow-2xl backdrop-blur-md">
                    <h2 className="text-red-500 font-bold text-lg mb-3">Sync Connection Error</h2>
                    <p className="text-gray-300 text-sm mb-6 leading-relaxed">{error}</p>
                    <button 
                        onClick={() => window.location.reload()} 
                        className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-semibold shadow-md"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return children;
}

export default function ClerkAdminGuard({ children }) {
    return (
        <>
            <SignedIn>
                <ClerkSyncWrapper>
                    {children}
                </ClerkSyncWrapper>
            </SignedIn>
            <SignedOut>
                <RedirectToSignIn redirectUrl="/" />
            </SignedOut>
        </>
    );
}
