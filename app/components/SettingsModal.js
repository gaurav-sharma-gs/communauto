'use client';

export default function SettingsModal({
    isOpen,
    onClose,
    refreshMinutes,
    onRefreshMinutesChange,
    autoRefreshEnabled,
    onAutoRefreshToggle,
    ntfySettings,
    onNtfyChange,
    onNtfySave,
    ntfyStatus,
    sendNotificationsEnabled,
    onSendNotificationsToggle
}) {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2>Settings</h2>
                    <button onClick={onClose} className="close-btn">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="modal-body">
                    <section className="settings-section">
                        <h3>Alert Configuration</h3>

                        <div className="settings-group">
                            <div className="ntfy-config">
                                <div className="input-group">
                                    <label>Notification Topic (Required)</label>
                                    <input
                                        type="text"
                                        value={ntfySettings.topic}
                                        onChange={(e) => onNtfyChange('topic', e.target.value)}
                                        placeholder="e.g. my-secret-car-alert"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Receive alerts via <a href="https://ntfy.sh" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">ntfy.sh</a> app.
                                    </p>
                                </div>

                                <div className="input-group" style={{ marginTop: '1rem' }}>
                                    <label>Check Frequency</label>
                                    <div className="refresh-options">
                                        {[1, 3, 5, 10].map(min => (
                                            <button
                                                key={min}
                                                onClick={() => onRefreshMinutesChange(min)}
                                                className={`option-btn ${refreshMinutes === min ? 'active' : ''}`}
                                            >
                                                Every {min}m
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="input-group" style={{ marginTop: '1rem' }}>
                                    <label>Server (Optional)</label>
                                    <input
                                        type="text"
                                        value={ntfySettings.server}
                                        onChange={(e) => onNtfyChange('server', e.target.value)}
                                        placeholder="https://ntfy.sh"
                                    />
                                </div>

                                <button onClick={onNtfySave} className="save-btn" style={{ marginTop: '1.5rem' }}>
                                    Save Configuration
                                </button>

                                <button
                                    onClick={() => {
                                        if (!ntfySettings.topic) {
                                            alert('Please set a topic first.');
                                            return;
                                        }
                                        const server = ntfySettings.server || 'https://ntfy.sh';
                                        fetch(`${server}/${ntfySettings.topic}`, {
                                            method: 'POST',
                                            body: 'This is a test notification from CommunAuto Finder.',
                                            headers: { 'Title': 'Test Notification', 'Priority': 'high' }
                                        })
                                            .then(res => {
                                                if (res.ok) alert('Test notification sent! Check your device.');
                                                else alert('Failed to send test notification.');
                                            })
                                            .catch(err => alert('Error sending test notification: ' + err.message));
                                    }}
                                    className="save-btn"
                                    style={{ marginTop: '0.75rem', backgroundColor: '#4b5563' }}
                                >
                                    Send Test Notification
                                </button>

                                {ntfyStatus && (
                                    <p className="status-msg">
                                        {ntfyStatus}
                                    </p>
                                )}
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
