import { useEffect, useRef, useCallback, useState } from 'react';
import API_URL from '../apiConfig';

/**
 * useFaceProctoring
 * Silent background proctoring using YOLOv11n (via FastAPI backend).
 *
 * Detects every 3 seconds:
 * - No person in frame (after 3 consecutive checks = 9s) → violation
 * - Multiple persons in frame                             → immediate violation
 * - Mobile phone detected                                 → immediate violation
 * - Laptop / electronic device detected                  → immediate violation
 * - Book / reference material detected                   → immediate violation
 *
 * @param {Function} onViolation - Called with (reason: string) on each violation
 * @param {boolean}  enabled     - Toggle detection on/off
 */
const useFaceProctoring = ({ onViolation, onDetection, onDetections, enabled = true }) => {
    const streamRef      = useRef(null);
    const videoRef       = useRef(null);
    const canvasRef      = useRef(null);
    const intervalRef    = useRef(null);
    const noPersonCountRef       = useRef(0);
    const isRunningRef           = useRef(false);
    const lastViolationTimeRef   = useRef({});
    const [cameraStream, setCameraStream] = useState(null);

    const detectionStatusRef     = useRef('idle');
    const [suspectLabel, setSuspectLabel] = useState(null);
    const suspectTimerRef        = useRef(null);
    const onDetectionsRef        = useRef(onDetections); // Always keep latest callback
    const onDetectionRef         = useRef(onDetection);
    const onViolationRef         = useRef(onViolation);

    // Keep refs current on every render (avoids stale closure in setInterval)
    useEffect(() => { onDetectionsRef.current = onDetections; }, [onDetections]);
    useEffect(() => { onDetectionRef.current  = onDetection;  }, [onDetection]);
    useEffect(() => { onViolationRef.current   = onViolation;  }, [onViolation]);


    const CHECK_INTERVAL_MS  = 3000;  // Analyze frame every 3 seconds
    const NO_PERSON_THRESHOLD = 3;    // 3 consecutive no-person checks (~9s) before warning
    const VIOLATION_COOLDOWN_MS = 10000; // Min 10s between same violation type

    // ── Violation trigger with per-type cooldown ──────────────────────────────
    const triggerViolation = useCallback((reason) => {
        const cb = onViolationRef.current;
        if (!cb) return;
        const now = Date.now();
        const last = lastViolationTimeRef.current[reason] || 0;
        if (now - last < VIOLATION_COOLDOWN_MS) return;
        lastViolationTimeRef.current[reason] = now;
        cb(reason);
    }, []);

    // ── Camera setup ──────────────────────────────────────────────────────────
    const startCamera = async () => {
        // Clean up any existing camera resources first
        if (streamRef.current) {
            try {
                streamRef.current.getTracks().forEach(t => t.stop());
            } catch (e) {}
            streamRef.current = null;
        }
        if (videoRef.current) {
            try {
                videoRef.current.srcObject = null;
                if (videoRef.current.parentNode) videoRef.current.remove();
            } catch (e) {}
            videoRef.current = null;
        }
        if (canvasRef.current) {
            try {
                if (canvasRef.current.parentNode) canvasRef.current.remove();
            } catch (e) {}
            canvasRef.current = null;
        }

        const tryGetUserMedia = async (retries = 3, delayMs = 800) => {
            // First: try to reuse stream already opened on start page
            const existing = window.__activeProctorStream;
            if (existing && existing.getVideoTracks().some(t => t.readyState === 'live')) {
                window.__activeProctorStream = null; // Claim it
                return existing;
            }

            // Otherwise: request fresh stream with retry
            for (let i = 0; i < retries; i++) {
                try {
                    return await navigator.mediaDevices.getUserMedia({
                        video: { width: 320, height: 240, facingMode: 'user' },
                        audio: false
                    });
                } catch (err) {
                    if (err.name === 'NotAllowedError') throw err;
                    if (i < retries - 1) {
                        await new Promise(r => setTimeout(r, delayMs));
                    } else {
                        throw err;
                    }
                }
            }
        };

        try {
            const stream = await tryGetUserMedia();
            streamRef.current = stream;

            // Invisible video element — off-screen, no pixels shown to user
            const video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            video.width = 320;
            video.height = 240;
            video.style.cssText =
                'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
            document.body.appendChild(video);
            videoRef.current = video;

            // Also attach stream to the corner preview element if provided
            setCameraStream(stream);

            // Hidden canvas for frame capture
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            canvas.style.cssText =
                'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
            document.body.appendChild(canvas);
            canvasRef.current = canvas;

            // Wait for video metadata to load
            await new Promise((resolve) => {
                video.onloadedmetadata = resolve;
                setTimeout(resolve, 2000);
            });

            return stream;
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                console.warn('[FaceProctoring] Camera permission denied.');
            } else {
                console.error('[FaceProctoring] Camera error:', err);
            }
            return null;
        }
    };

    const stopCamera = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (streamRef.current) {
            try {
                streamRef.current.getTracks().forEach(t => t.stop());
            } catch (e) {
                console.error("[FaceProctoring] Error stopping track:", e);
            }
            streamRef.current = null;
        }
        setCameraStream(null);
        try {
            if (videoRef.current) {
                videoRef.current.srcObject = null;
                if (videoRef.current.parentNode) {
                    videoRef.current.remove();
                }
                videoRef.current = null;
            }
        } catch (e) {
            console.error("[FaceProctoring] Error removing video element:", e);
        }
        try {
            if (canvasRef.current) {
                if (canvasRef.current.parentNode) {
                    canvasRef.current.remove();
                }
                canvasRef.current = null;
            }
        } catch (e) {
            console.error("[FaceProctoring] Error removing canvas element:", e);
        }
        isRunningRef.current = false;
    };

    // ── Frame capture + backend call ─────────────────────────────────────────
    const analyzeFrame = async () => {
        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) return;

        try {
            // Draw current frame onto hidden canvas
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Export as JPEG (lower quality = smaller payload = faster)
            const base64Image = canvas.toDataURL('image/jpeg', 0.6);

            const response = await fetch(`${API_URL}/api/proctor/analyze-frame`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image })
            });

            if (!response.ok) return;

            const data = await response.json();
            const violations = data.violations || [];
            const personCount = data.person_count ?? 1;
            const suspect = data.suspect_label || null;
            const detections = data.detections || [];
            const faceBoxes  = data.face_boxes  || [];

            // Send detections + face boxes to UI for drawing
            if (onDetectionsRef.current) onDetectionsRef.current(detections, faceBoxes);

            // Update suspect label with auto-clear after 6s
            if (suspect) {
                setSuspectLabel(suspect);
                if (suspectTimerRef.current) clearTimeout(suspectTimerRef.current);
                suspectTimerRef.current = setTimeout(() => setSuspectLabel(null), 6000);
            } else if (!violations.includes('no_person')) {
                setSuspectLabel(null);
            }

            // ── No person tracking (needs consecutive checks) ──
            if (violations.includes('no_person')) {
                noPersonCountRef.current += 1;
                detectionStatusRef.current = 'not_detected';
                if (onDetectionRef.current) onDetectionRef.current('not_detected');
                if (noPersonCountRef.current >= NO_PERSON_THRESHOLD) {
                    noPersonCountRef.current = 0;
                    triggerViolation('Face not visible in camera');
                }
            } else {
                noPersonCountRef.current = 0; // Reset on person found
                detectionStatusRef.current = 'detected';
                if (onDetectionRef.current) onDetectionRef.current('detected');
            }

            // ── Immediate violations ───────────────────────────
            if (violations.includes('multiple_persons')) {
                triggerViolation('Multiple persons detected in camera');
            }
            if (violations.includes('phone_detected')) {
                triggerViolation('Mobile phone detected in camera');
            }
            if (violations.includes('device_detected')) {
                triggerViolation('Electronic device detected in camera');
            }
            if (violations.includes('notes_detected')) {
                triggerViolation('Reference material detected in camera');
            }

        } catch (err) {
            // Silently ignore — network errors or server restart shouldn't crash proctoring
        }
    };

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;

        const init = async () => {
            if (!enabled) {
                stopCamera();
                return;
            }
            if (isRunningRef.current) return;

            const stream = await startCamera();
            if (!stream || cancelled) {
                if (stream) {
                    try {
                        stream.getTracks().forEach(t => t.stop());
                    } catch (e) {
                        console.error("[FaceProctoring] Error stopping orphaned stream track:", e);
                    }
                }
                try {
                    if (videoRef.current) {
                        videoRef.current.srcObject = null;
                        if (videoRef.current.parentNode) videoRef.current.remove();
                        videoRef.current = null;
                    }
                } catch (e) {}
                try {
                    if (canvasRef.current) {
                        if (canvasRef.current.parentNode) canvasRef.current.remove();
                        canvasRef.current = null;
                    }
                } catch (e) {}
                if (cancelled) {
                    stopCamera();
                }
                return;
            }

            streamRef.current = stream;
            setCameraStream(stream);
            isRunningRef.current = true;

            // Start detection loop
            intervalRef.current = setInterval(() => {
                if (!cancelled) analyzeFrame();
            }, CHECK_INTERVAL_MS);
        };

        init();

        return () => {
            cancelled = true;
            stopCamera();
        };
    }, [enabled]);

    return { cameraStream, streamRef, detectionStatusRef, suspectLabel };
};

export default useFaceProctoring;
