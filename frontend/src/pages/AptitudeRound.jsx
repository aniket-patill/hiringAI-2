import React, { useState, useEffect } from 'react';
import API_URL from '../apiConfig';
import { BrainCircuit } from 'lucide-react';
import CandidateTable from '../components/CandidateTable';
import ConfirmationModal from '../components/ConfirmationModal';

const AptitudeRound = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: null });

    const fetchCandidates = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/api/resume/candidates/`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (response.ok) {
                const data = await response.json();
                setCandidates(data.filter(c => c.stage === 'Aptitude Round'));
            }
        } catch (error) {
            console.error("Failed to fetch", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCandidates();
    }, []);

    const handlePromote = async (candidateIds, stage) => {
        if (!candidateIds || candidateIds.length === 0) return;

        // Check eligibility
        const selected = candidates.filter(c => candidateIds.includes(c.id));
        const ineligible = selected.filter(c => {
            const status = c.status || '';
            const isCompleted = status === 'Completed' || status.startsWith('Submitted');
            return !isCompleted || (c.score || 0) < 60;
        });

        let message = `Are you sure you want to promote ${candidateIds.length} candidate(s) to ${stage === 'NEXT' ? 'the NEXT stage' : stage}?`;
        if (ineligible.length > 0) {
            message = `WARNING: ${ineligible.length} candidate(s) are not eligible (Low Score or Incomplete).\n\n` + message;
        }

        setConfirmation({
            isOpen: true,
            title: 'Confirm Promotion',
            message: message,
            type: ineligible.length > 0 ? 'warning' : 'info',
            confirmText: 'Promote Candidates',
            onConfirm: () => executePromote(candidateIds, stage)
        });
    };

    const executePromote = async (candidateIds, stage) => {
        try {
            const res = await fetch(`${API_URL}/api/resume/candidates/bulk-update/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    candidate_ids: candidateIds,
                    stage: stage || 'NEXT'
                })
            });

            if (res.ok) {
                alert('Candidates promoted successfully!');
                fetchCandidates();
            } else {
                const errorData = await res.json();
                alert(`Failed to promote: ${errorData.detail || 'Unknown error'}`);
            }
        } catch (error) {
            console.error("Promotion failed:", error);
            alert('An error occurred during promotion.');
        }
    };

    const handleDelete = async (candidateIds) => {
        if (!candidateIds || candidateIds.length === 0) return;
        if (!window.confirm(`Permanently delete ${candidateIds.length} selected candidate(s)? This cannot be undone.`)) return;

        try {
            setLoading(true);
            await Promise.all(candidateIds.map(id =>
                fetch(`${API_URL}/api/resume/candidates/${id}/`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                })
            ));
            alert('Candidates deleted successfully');
            fetchCandidates();
        } catch (err) {
            console.error("Deletion failed", err);
            alert("Failed to delete candidates");
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            <div className="w-full space-y-6">
                {/* Header Section */}
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
                    <div className="flex justify-between items-start">
                        <div className="flex-1">
                            <h1 className="text-3xl font-semibold text-[#5d8c2c] tracking-tight flex items-center gap-3">
                                <div className="p-2.5 bg-white rounded-xl border border-gray-200">
                                    <BrainCircuit className="text-green-600" size={28} />
                                </div>
                                Aptitude Assessment
                            </h1>
                            <p className="text-black text-sm mt-2 max-w-2xl font-medium">
                                Cognitive and logical reasoning test results. Review candidate performance and promote qualified individuals to the next stage.
                            </p>
                        </div>
                        <div className="bg-white text-[#5d8c2c] px-5 py-3 rounded-xl text-sm font-bold border border-gray-200 flex items-center gap-2 shadow-sm">
                            <BrainCircuit size={18} className="text-green-600" />
                            <div className="flex flex-col items-start">
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Total</span>
                                <span className="text-2xl font-semibold text-[#5d8c2c]">{candidates.length}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <CandidateTable
                    candidates={candidates}
                    currentStage="Aptitude Round"
                    onRefresh={fetchCandidates}
                    showRoleColumn={true}
                    onPromote={handlePromote}
                    onDelete={handleDelete}
                />

                <ConfirmationModal
                    isOpen={confirmation.isOpen}
                    onClose={() => setConfirmation({ ...confirmation, isOpen: false })}
                    onConfirm={confirmation.onConfirm}
                    title={confirmation.title}
                    message={confirmation.message}
                    type={confirmation.type}
                    confirmText={confirmation.confirmText}
                />
            </div>
        </div>
    );
};

export default AptitudeRound;
