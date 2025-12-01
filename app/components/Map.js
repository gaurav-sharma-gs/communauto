'use client';

import { useEffect, useRef, useState } from 'react';

const defaultLocation = { lat: 43.6532, lng: -79.3832 };

function carKey(car) {
    return `${car.plate}-${car.lat.toFixed(5)}-${car.lng.toFixed(5)}`;
}

export default function MapComponent(props) {
    const {
        cars = [],
        center = defaultLocation,
        userLocation,
        selectedCarId,
        onMapIdle,
        onCarClick,
        onLoad,
        alertLocation,
        notificationsEnabled
    } = props || {};
    const mapElementRef = useRef(null);
    const mapRef = useRef(null);
    const carMarkersRef = useRef(new Map());
    const userMarkerRef = useRef(null);
    const infoWindowRef = useRef(null);
    const programmaticMoveRef = useRef(false);
    const [isMapsLoaded, setIsMapsLoaded] = useState(false);

    // Wait for Google Maps to be available
    useEffect(() => {
        const checkGoogleMaps = () => {
            if (window.google && window.google.maps) {
                setIsMapsLoaded(true);
                return true;
            }
            return false;
        };

        if (checkGoogleMaps()) return;

        const interval = setInterval(() => {
            if (checkGoogleMaps()) {
                clearInterval(interval);
            }
        }, 100);

        return () => clearInterval(interval);
    }, []);

    // Initialize Map
    useEffect(() => {
        if (!isMapsLoaded || !mapElementRef.current || mapRef.current) return;

        mapRef.current = new window.google.maps.Map(mapElementRef.current, {
            center,
            zoom: 14,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControl: true,
            zoomControlOptions: {
                position: window.google.maps.ControlPosition.RIGHT_TOP,
            },
            gestureHandling: 'greedy',
            styles: [
                {
                    featureType: 'poi',
                    elementType: 'labels',
                    stylers: [{ visibility: 'off' }],
                },
            ],
        });

        mapRef.current.addListener('idle', () => {
            if (programmaticMoveRef.current) {
                programmaticMoveRef.current = false;
                return;
            }
            if (onMapIdle) {
                onMapIdle(mapRef.current);
            }
        });

        if (onLoad) {
            onLoad(mapRef.current);
        }
    }, [isMapsLoaded, onLoad, onMapIdle]);

    // Update Center
    useEffect(() => {
        if (mapRef.current && center) {
            const currentCenter = mapRef.current.getCenter();
            if (
                !currentCenter ||
                Math.abs(currentCenter.lat() - center.lat) > 0.0001 ||
                Math.abs(currentCenter.lng() - center.lng) > 0.0001
            ) {
                programmaticMoveRef.current = true;
                mapRef.current.panTo(center);
            }
        }
    }, [center]);

    // Update User Marker
    useEffect(() => {
        if (!mapRef.current || !window.google) return;

        if (userLocation) {
            if (!userMarkerRef.current) {
                userMarkerRef.current = new window.google.maps.Marker({
                    map: mapRef.current,
                    icon: {
                        path: window.google.maps.SymbolPath.CIRCLE,
                        scale: 9,
                        fillColor: '#4285f4',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                    },
                    zIndex: 999,
                });
            }
            userMarkerRef.current.setPosition(userLocation);
        } else if (userMarkerRef.current) {
            userMarkerRef.current.setMap(null);
            userMarkerRef.current = null;
        }
    }, [userLocation, isMapsLoaded]);

    // Update Alert Location Marker
    const alertMarkerRef = useRef(null);
    useEffect(() => {
        if (!mapRef.current || !window.google) return;

        if (alertLocation && notificationsEnabled) {
            if (!alertMarkerRef.current) {
                alertMarkerRef.current = new window.google.maps.Marker({
                    map: mapRef.current,
                    icon: {
                        path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
                        fillColor: '#22c55e', // Green-500
                        fillOpacity: 1,
                        strokeColor: '#15803d', // Green-700
                        strokeWeight: 2,
                        scale: 1.5,
                        anchor: new window.google.maps.Point(12, 22),
                    },
                    zIndex: 998,
                    title: 'Alert Active Location'
                });
            }
            alertMarkerRef.current.setPosition(alertLocation);
            alertMarkerRef.current.setMap(mapRef.current);

            // Add a circle to show radius? Maybe later.
        } else if (alertMarkerRef.current) {
            alertMarkerRef.current.setMap(null);
            alertMarkerRef.current = null;
        }
    }, [alertLocation, notificationsEnabled, isMapsLoaded]);

    // Update Car Markers
    useEffect(() => {
        if (!mapRef.current || !window.google) return;

        // Remove old markers
        const newKeys = new Set(cars.map(carKey));
        for (const [key, { marker }] of carMarkersRef.current.entries()) {
            if (!newKeys.has(key)) {
                marker.setMap(null);
                carMarkersRef.current.delete(key);
            }
        }

        // Add/Update markers
        cars.forEach(car => {
            const key = carKey(car);
            if (!carMarkersRef.current.has(key)) {
                const marker = new window.google.maps.Marker({
                    position: { lat: car.lat, lng: car.lng },
                    map: mapRef.current,
                    title: `${car.brand} ${car.model}`,
                    // Reverted to default marker (no icon property)
                });

                marker.addListener('click', () => {
                    if (onCarClick) onCarClick(car);
                });

                carMarkersRef.current.set(key, { marker, car });
            }
        });
    }, [cars, onCarClick, isMapsLoaded]);

    // Handle Selection (Bounce & InfoWindow)
    useEffect(() => {
        if (!mapRef.current || !window.google) return;

        const infoWindow = infoWindowRef.current || new window.google.maps.InfoWindow();
        infoWindowRef.current = infoWindow;
        infoWindow.close();

        if (selectedCarId) {
            const entry = carMarkersRef.current.get(selectedCarId);
            if (entry) {
                const { marker, car } = entry;

                // Bounce animation
                marker.setAnimation(window.google.maps.Animation.BOUNCE);
                setTimeout(() => marker.setAnimation(null), 1400);

                // InfoWindow
                const distanceLabel = car.distanceFromUser
                    ? `${(car.distanceFromUser / 1000).toFixed(2)} km from you`
                    : '';

                infoWindow.setContent(`
          <div class="map-infowindow">
            <strong>${car.brand} ${car.model}</strong><br />
            <span>${car.plate}</span><br />
            <span class="distance">${distanceLabel}</span>
          </div>
        `);
                infoWindow.open({ map: mapRef.current, anchor: marker });

                // Pan to car if needed
                programmaticMoveRef.current = true;
                mapRef.current.panTo(marker.getPosition());
            }
        }
    }, [selectedCarId]);

    console.log('MapComponent render:', { notificationsEnabled: props.notificationsEnabled });
    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={mapElementRef} id="map" className="map-view" style={{ width: '100%', height: '100%' }} />
        </div>
    );
}
