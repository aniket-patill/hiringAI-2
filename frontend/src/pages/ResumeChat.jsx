import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Send, Bot, User, Loader2, Sparkles, AlertCircle,
    RotateCcw, Search, ChevronRight, FileText, Star,
    MessageSquare, Zap, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import API_URL from '../apiConfig';

// ─── Persistence Key ────────────────────────────────────────────────────────
const CHAT_KEY = 'rag_chat_history_v2';

function loadMessages() {
    try {
        const raw = sessionStorage.getItem(CHAT_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return null;
}

function saveMessages(msgs) {
    try {
        sessionStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
    } catch { /* ignore */ }
}

// ─── Welcome Message ─────────────────────────────────────────────────────────
const WELCOME = {
    id: 'welcome',
    role: 'assistant',
    content: "Hi! I'm your **AI Hiring Assistant**. Ask me anything about your screened candidates — their skills, experience, scores, or how they compare against your job requirements.",
    timestamp: Date.now(),
    sources_count: 0,
    source_candidate_names: [],
};

// ─── Suggestion Chips ────────────────────────────────────────────────────────
const SUGGESTIONS = [
    { icon: '🔍', text: 'Find candidates with React and TypeScript' },
    { icon: '⭐', text: 'Who has 5+ years of backend experience?' },
    { icon: '🏆', text: 'Top scored candidates this batch' },
    { icon: '⚠️', text: 'Candidates missing Python skills' },
    { icon: '🌐', text: 'Show me full stack engineers' },
    { icon: '☁️', text: 'Any candidates with AWS experience?' },
];

// ─── Markdown Renderer ───────────────────────────────────────────────────────
function renderMarkdown(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const result = [];
    let inList = false;
    let listItems = [];

    const flushList = () => {
        if (listItems.length) {
            result.push(
                <ul key={`ul-${result.length}`} className="space-y-1.5 my-2 ml-1">
                    {listItems.map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#5d8c2c] flex-shrink-0" />
                            <span>{parseInline(item)}</span>
                        </li>
                    ))}
                </ul>
            );
            listItems = [];
            inList = false;
        }
    };

    lines.forEach((line, idx) => {
        const trimmed = line.trim();

        // Heading ##
        if (trimmed.startsWith('## ')) {
            flushList();
            result.push(
                <h3 key={idx} className="font-bold text-sm text-gray-900 mt-3 mb-1 border-b border-gray-100 pb-1">
                    {trimmed.slice(3)}
                </h3>
            );
            return;
        }

        // Bullet
        if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
            inList = true;
            listItems.push(trimmed.slice(2));
            return;
        }

        // Non-bullet line
        if (inList && trimmed === '') {
            flushList();
            return;
        }
        if (inList && !trimmed.startsWith('* ') && !trimmed.startsWith('- ')) {
            flushList();
        }

        if (trimmed === '') {
            result.push(<div key={idx} className="h-2" />);
        } else {
            result.push(
                <p key={idx} className="leading-relaxed">
                    {parseInline(trimmed)}
                </p>
            );
        }
    });

    flushList();
    return result;
}

function parseInline(text) {
    // **bold** parsing
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) =>
        i % 2 === 1
            ? <strong key={i} className="font-semibold text-gray-900">{part}</strong>
            : part
    );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────
const TypingIndicator = () => (
    <div className="flex items-center gap-1 px-3 py-2">
        {[0, 1, 2].map(i => (
            <motion.div
                key={i}
                className="w-2 h-2 bg-[#5d8c2c]/50 rounded-full"
                animate={{ y: [0, -5, 0], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
            />
        ))}
    </div>
);

// ─── Score Badge ──────────────────────────────────────────────────────────────
const ScoreBadge = ({ score }) => {
    const color = score >= 75 ? 'bg-green-100 text-green-700' :
        score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600';
    return (
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${color}`}>
            {score}
        </span>
    );
};

// ─── Chat Message ─────────────────────────────────────────────────────────────
const ChatMessage = ({ message }) => {
    const isUser = message.role === 'user';
    const isError = message.isError;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-5`}
        >
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
                isUser
                    ? 'bg-gradient-to-br from-[#5d8c2c] to-[#3d6b15] text-white'
                    : 'bg-white border border-gray-200 text-[#5d8c2c]'
            }`}>
                {isUser ? <User size={14} /> : <Sparkles size={14} />}
            </div>

            {/* Bubble */}
            <div className={`flex flex-col gap-1.5 max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
                <div className={`px-4 py-3 rounded-2xl text-sm break-words shadow-sm ${
                    isUser
                        ? 'bg-gradient-to-br from-[#5d8c2c] to-[#4a7a1f] text-white rounded-tr-sm'
                        : isError
                            ? 'bg-red-50 border border-red-200 text-red-800 rounded-tl-sm'
                            : 'bg-white border border-gray-200/80 text-gray-800 rounded-tl-sm'
                }`}>
                    {isUser
                        ? <span className="leading-relaxed">{message.content}</span>
                        : <div className="text-sm leading-relaxed space-y-0.5">
                            {renderMarkdown(message.content)}
                        </div>
                    }
                </div>

                {/* Footer */}
                <div className={`flex items-center gap-2 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                    <span className="text-[10px] text-gray-400">
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {!isUser && message.source_candidate_names?.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                            <FileText size={10} className="text-[#5d8c2c]" />
                            <span className="text-[10px] text-[#5d8c2c] font-medium">
                                {message.source_candidate_names.join(', ')}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

// ─── Candidate Sidebar Item ────────────────────────────────────────────────────
const CandidateItem = ({ candidate, onQuery, isActive }) => (
    <button
        onClick={() => onQuery(`Tell me about ${candidate.name}`)}
        className={`w-full text-left px-3 py-2.5 rounded-xl transition-all group ${
            isActive
                ? 'bg-[#5d8c2c]/10 border border-[#5d8c2c]/20'
                : 'hover:bg-gray-50 border border-transparent'
        }`}
    >
        <div className="flex items-center gap-2 mb-0.5">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#5d8c2c]/20 to-[#5d8c2c]/10 flex items-center justify-center flex-shrink-0">
                <User size={11} className="text-[#5d8c2c]" />
            </div>
            <span className="text-xs font-semibold text-gray-800 truncate group-hover:text-[#5d8c2c] transition-colors flex-1">
                {candidate.name}
            </span>
            {candidate.score !== undefined && candidate.score !== null && (
                <ScoreBadge score={candidate.score} />
            )}
        </div>
        {candidate.job_role && (
            <p className="text-[10px] text-gray-400 ml-8 truncate">{candidate.job_role}</p>
        )}
    </button>
);

// ─── Main Component ────────────────────────────────────────────────────────────
export default function ResumeChat() {
    const [messages, setMessages] = useState(() => loadMessages() || [WELCOME]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [indexStatus, setIndexStatus] = useState(null);
    const [indexedCandidates, setIndexedCandidates] = useState([]);
    const [candidatesLoading, setCandidatesLoading] = useState(true);
    const [sidebarSearch, setSidebarSearch] = useState('');
    const [activeCandidate, setActiveCandidate] = useState(null);

    const bottomRef = useRef(null);
    const inputRef = useRef(null);
    const token = localStorage.getItem('token');

    // Persist messages to sessionStorage on every change
    useEffect(() => { saveMessages(messages); }, [messages]);

    // Auto-scroll
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    // Fetch RAG status + indexed candidates on mount
    useEffect(() => {
        const headers = { Authorization: `Bearer ${token}` };

        fetch(`${API_URL}/api/rag/status`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => data && setIndexStatus(data))
            .catch(() => {});

        setCandidatesLoading(true);
        fetch(`${API_URL}/api/rag/indexed-candidates`, { headers })
            .then(r => r.ok ? r.json() : { candidates: [] })
            .then(data => setIndexedCandidates(data.candidates || []))
            .catch(() => {})
            .finally(() => setCandidatesLoading(false));
    }, [token]);

    const sendMessage = useCallback(async (text) => {
        const query = (text || input).trim();
        if (!query || isTyping) return;
        setInput('');
        setActiveCandidate(null);

        const userMsg = {
            id: `u-${Date.now()}`,
            role: 'user',
            content: query,
            timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMsg]);
        setIsTyping(true);

        try {
            const history = messages
                .filter(m => m.id !== 'welcome')
                .slice(-8)
                .map(m => ({ role: m.role, content: m.content }));

            const res = await fetch(`${API_URL}/api/rag/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ query, conversation_history: history }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            const data = await res.json();

            setMessages(prev => [...prev, {
                id: `a-${Date.now()}`,
                role: 'assistant',
                content: data.answer,
                timestamp: Date.now(),
                sources_count: data.sources_count || 0,
                source_candidate_ids: data.source_candidate_ids || [],
                source_candidate_names: data.source_candidate_names || [],
            }]);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: `e-${Date.now()}`,
                role: 'assistant',
                content: `Sorry, I couldn't process that query. ${err.message || 'Please check that the backend and Qdrant are running.'}`,
                timestamp: Date.now(),
                sources_count: 0,
                source_candidate_names: [],
                isError: true,
            }]);
        } finally {
            setIsTyping(false);
            inputRef.current?.focus();
        }
    }, [input, isTyping, messages, token]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const resetChat = () => {
        setMessages([WELCOME]);
        sessionStorage.removeItem(CHAT_KEY);
        inputRef.current?.focus();
    };

    const handleCandidateClick = (candidate) => {
        setActiveCandidate(candidate.id);
        sendMessage(`Tell me about ${candidate.name} — their skills, experience, and score`);
    };

    const filteredCandidates = indexedCandidates.filter(c =>
        c.name.toLowerCase().includes(sidebarSearch.toLowerCase()) ||
        (c.job_role || '').toLowerCase().includes(sidebarSearch.toLowerCase())
    );

    const showSuggestions = messages.length <= 1;

    return (
        <div className="resume-chat-container flex gap-0 overflow-hidden rounded-xl border border-gray-200 shadow-sm bg-white h-full">
            <style>{`
                /* Prevent parent container from scrolling on the RAG Chat page */
                main:has(.resume-chat-container) {
                    overflow: hidden !important;
                }
                main:has(.resume-chat-container) > div {
                    padding-bottom: 0 !important;
                    height: 100% !important;
                }
            `}</style>

            {/* ── LEFT SIDEBAR: Indexed Candidates ─────────────────────────── */}
            <div className="w-64 flex-shrink-0 flex flex-col bg-white border-r border-gray-200/80 overflow-hidden">
                {/* Sidebar header */}
                <div className="px-4 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 rounded-lg bg-[#5d8c2c]/10 flex items-center justify-center">
                            <FileText size={14} className="text-[#5d8c2c]" />
                        </div>
                        <div>
                            <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Indexed Resumes</h2>
                            <p className="text-[10px] text-gray-400">{indexedCandidates.length} candidate{indexedCandidates.length !== 1 ? 's' : ''}</p>
                        </div>
                    </div>
                    {/* Search within sidebar */}
                    <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={sidebarSearch}
                            onChange={e => setSidebarSearch(e.target.value)}
                            placeholder="Search candidates..."
                            className="w-full pl-7 pr-2 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-[#5d8c2c] focus:ring-1 focus:ring-[#5d8c2c]/20"
                        />
                    </div>
                </div>

                {/* Candidate list */}
                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    {candidatesLoading ? (
                        <div className="flex flex-col items-center justify-center h-32 gap-2">
                            <Loader2 size={20} className="animate-spin text-[#5d8c2c]/50" />
                            <p className="text-xs text-gray-400">Loading...</p>
                        </div>
                    ) : filteredCandidates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 gap-2 px-3 text-center">
                            <FileText size={24} className="text-gray-300" />
                            <p className="text-xs text-gray-400">
                                {indexedCandidates.length === 0
                                    ? 'No resumes indexed yet. Screen some candidates first.'
                                    : 'No matches found.'}
                            </p>
                        </div>
                    ) : (
                        filteredCandidates.map(c => (
                            <CandidateItem
                                key={c.id}
                                candidate={c}
                                onQuery={text => { setActiveCandidate(c.id); sendMessage(text); }}
                                isActive={activeCandidate === c.id}
                            />
                        ))
                    )}
                </div>

                {/* Qdrant status pill */}
                <div className="px-3 py-2.5 border-t border-gray-100">
                    {indexStatus ? (
                        <div className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full ${
                            indexStatus.has_resume_index
                                ? 'bg-green-50 text-green-700'
                                : 'bg-amber-50 text-amber-600'
                        }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${
                                indexStatus.has_resume_index ? 'bg-green-500 animate-pulse' : 'bg-amber-400'
                            }`} />
                            {indexStatus.has_resume_index
                                ? `Index ready · ${indexStatus.indexed_vectors ?? '?'} vectors`
                                : 'No index — screen resumes first'}
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                            <Loader2 size={10} className="animate-spin" /> Checking status...
                        </div>
                    )}
                </div>
            </div>

            {/* ── MAIN CHAT PANEL ───────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50">

                {/* Chat header */}
                <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-gray-200/80 flex-shrink-0">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#5d8c2c] to-[#3d6b15] flex items-center justify-center shadow-md">
                        <Sparkles className="text-white" size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-base font-bold text-gray-900 leading-tight">AI Resume Search</h1>
                        <p className="text-xs text-gray-500 truncate">Query your screened candidate pool with natural language</p>
                    </div>

                    {/* No index warning — inline */}
                    {indexStatus && !indexStatus.has_resume_index && (
                        <div className="hidden sm:flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg flex-shrink-0">
                            <AlertCircle size={13} />
                            Screen resumes to enable search
                        </div>
                    )}

                    {/* Reset button */}
                    <button
                        onClick={resetChat}
                        title="Reset chat"
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-all flex-shrink-0"
                    >
                        <RotateCcw size={13} />
                        <span className="hidden sm:inline">Reset Chat</span>
                    </button>
                </div>

                {/* Message list */}
                <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
                    {/* Suggestion chips — only on fresh chat */}
                    {showSuggestions && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-6"
                        >
                            <p className="text-xs text-gray-400 font-medium mb-3 flex items-center gap-1.5">
                                <Zap size={11} className="text-[#5d8c2c]" /> Try asking
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {SUGGESTIONS.map(s => (
                                    <button
                                        key={s.text}
                                        onClick={() => sendMessage(s.text)}
                                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-white border border-gray-200 rounded-full text-gray-600 hover:border-[#5d8c2c] hover:text-[#5d8c2c] hover:bg-[#5d8c2c]/5 transition-all shadow-sm"
                                    >
                                        <span>{s.icon}</span> {s.text}
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {messages.map(msg => (
                        <ChatMessage key={msg.id} message={msg} />
                    ))}

                    {/* Typing indicator */}
                    <AnimatePresence>
                        {isTyping && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                className="flex items-center gap-3 mb-4"
                            >
                                <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 shadow-sm">
                                    <Sparkles size={14} className="text-[#5d8c2c]" />
                                </div>
                                <div className="bg-white border border-gray-200/80 rounded-2xl rounded-tl-sm shadow-sm">
                                    <TypingIndicator />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div ref={bottomRef} />
                </div>

                {/* Input bar */}
                <div className="px-6 py-4 bg-white border-t border-gray-200/80 flex-shrink-0">
                    <div className="flex gap-2 items-center bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 focus-within:border-[#5d8c2c] focus-within:ring-2 focus-within:ring-[#5d8c2c]/10 transition-all shadow-sm">
                        <MessageSquare size={16} className="text-gray-400 flex-shrink-0" />
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask about candidates, skills, experience… (Enter to send)"
                            rows={1}
                            className="flex-1 bg-transparent text-sm text-gray-900 resize-none focus:outline-none placeholder:text-gray-400 py-1.5"
                            style={{ maxHeight: '120px', overflowY: 'auto' }}
                        />
                        <button
                            onClick={() => sendMessage()}
                            disabled={!input.trim() || isTyping}
                            className="w-8 h-8 flex-shrink-0 flex items-center justify-center bg-[#5d8c2c] text-white rounded-xl hover:bg-[#4a7a1f] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md hover:scale-105 active:scale-95"
                        >
                            {isTyping
                                ? <Loader2 size={15} className="animate-spin" />
                                : <Send size={15} />
                            }
                        </button>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1.5 ml-1">
                        Shift+Enter for new line · Click any candidate in the sidebar to query them
                    </p>
                </div>
            </div>
        </div>
    );
}
