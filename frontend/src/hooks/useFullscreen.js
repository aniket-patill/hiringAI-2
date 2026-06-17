import { useEffect, useRef } from 'react';

/**
 * useFullscreen — forces fullscreen while the test is active.
 *
 * @param {object} options
 * @param {boolean}  options.enabled        - Only enforces when true (disable after submit)
 * @param {Function} options.onExit         - Called ONCE each time the user leaves fullscreen
 */
const useFullscreen = ({ enabled = true, onExit }) => {
    const onExitRef = useRef(onExit);
    useEffect(() => { onExitRef.current = onExit; }, [onExit]);

    // Enter fullscreen as soon as the test page mounts (the user gesture came from
    // the "Start Assessment" button click that triggered the navigation).
    useEffect(() => {
        if (!enabled) return;

        const enterFullscreen = async () => {
            try {
                if (!document.fullscreenElement) {
                    await document.documentElement.requestFullscreen();
                }
            } catch (err) {
                // Browser refused (e.g. no user-gesture context) — ignore silently
                console.warn('[Fullscreen] Could not enter fullscreen:', err.message);
            }
        };

        enterFullscreen();
    }, [enabled]);

    // Listen for the user pressing ESC / any other exit
    useEffect(() => {
        if (!enabled) return;

        const handleChange = () => {
            if (!document.fullscreenElement) {
                // User exited — notify caller so a violation can be raised
                if (onExitRef.current) onExitRef.current();
            }
        };

        document.addEventListener('fullscreenchange', handleChange);
        return () => document.removeEventListener('fullscreenchange', handleChange);
    }, [enabled]);

    // Re-enter fullscreen helper (caller can call this to pull the user back in)
    const reEnter = async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            }
        } catch (err) {
            console.warn('[Fullscreen] Re-enter failed:', err.message);
        }
    };

    return { reEnter };
};

export default useFullscreen;
