'use client';

import { useEffect, useRef } from 'react';

export default function ControlPanel({
    onLocationSelect,
    onSettingsClick,
    notificationsEnabled,
    refreshMinutes,
    onToggleNotifications,
    alertLocation,
    onClearAlertLocation
}) {
    const inputRef = useRef(null);

    useEffect(() => {
        if (!window.google || !window.google.maps?.places || !inputRef.current) return;

        const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
            fields: ['geometry', 'name'],
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (place.geometry?.location) {
                onLocationSelect({
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                });
            }
        });
    }, [onLocationSelect]);

    return (
        <div className="control-panel">
            <div className="search-box">
                <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search location..."
                />
            </div>

            {alertLocation && (
                <button
                    onClick={onClearAlertLocation}
                    className="icon-btn"
                    title="Clear Alert Location"
                    style={{ color: '#ef4444' }}
                >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}

            <button
                onClick={onSettingsClick}
                className="icon-btn"
                title="Settings"
            >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>

            <button
                onClick={onToggleNotifications}
                className={`icon-btn ${notificationsEnabled ? 'active' : ''}`}
                style={{
                    width: 'auto',
                    padding: '6px 12px',
                    height: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor: notificationsEnabled ? '#f0fdf4' : '#ffffff',
                    color: notificationsEnabled ? '#166534' : '#4b5563',
                    borderColor: notificationsEnabled ? '#bbf7d0' : 'transparent',
                    borderWidth: notificationsEnabled ? '1px' : '0px',
                    borderStyle: notificationsEnabled ? 'solid' : 'none',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                }}
                title={notificationsEnabled ? 'Click to disable alerts' : 'Click to enable alerts'}
            >
                {notificationsEnabled ? (
                    <>
                        <span style={{ position: 'relative', display: 'flex', height: '10px', width: '10px', flexShrink: 0 }}>
                            <span style={{ position: 'absolute', display: 'inline-flex', height: '100%', width: '100%', borderRadius: '9999px', backgroundColor: '#4ade80', opacity: 0.75, animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite' }}></span>
                            <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '9999px', height: '10px', width: '10px', backgroundColor: '#22c55e' }}></span>
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1 }}>
                            <span style={{ fontSize: '12px', fontWeight: 700 }}>Alerts On</span>
                            <span style={{ fontSize: '10px', opacity: 0.75, fontWeight: 500, marginTop: '2px' }}>Every {refreshMinutes}m</span>
                        </div>
                    </>
                ) : (
                    <>
                        <svg style={{ width: '20px', height: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>Alerts Off</span>
                    </>
                )}
            </button>
        </div>
    );
}
