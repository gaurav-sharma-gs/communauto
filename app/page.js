'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Map from './components/Map';
import CarList from './components/CarList';
import ControlPanel from './components/ControlPanel';
import SettingsModal from './components/SettingsModal';

const defaultLocation = { lat: 43.6532, lng: -79.3832 };
const radiusSequence = [500, 1000, 3000, 5000, 8000, 10000, 15000];
const MIN_FETCH_RADIUS_METERS = radiusSequence[0];
const NTFY_SETTINGS_KEY = 'communeauto-ntfy-settings';
const NO_CAR_NOTIFICATION_MINUTES = 3;

const describeInterval = seconds => {
  const rounded = Math.round(seconds);
  if (rounded >= 60) {
    const minutes = rounded / 60;
    const fixed = Number.isInteger(minutes) ? minutes : minutes.toFixed(2);
    return `${fixed} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${rounded} seconds`;
};

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

function distanceBetweenMeters(pointA, pointB) {
  const { lat: lat1, lng: lng1 } = pointA;
  const { lat: lat2, lng: lng2 } = pointB;
  const earthRadiusKm = 6371;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c * 1000;
}

function normalizePlate(plate) {
  return plate ? plate.trim().toLowerCase() : '';
}

function carKey(car) {
  return `${car.plate}-${car.lat.toFixed(5)}-${car.lng.toFixed(5)}`;
}

export default function Home() {
  // Refs
  const mapRef = useRef(null);
  const loadCarsRef = useRef(null);
  const userLocationRef = useRef(null);
  const alertLocationRef = useRef(null);
  const [alertLocation, setAlertLocation] = useState(null); // State for rendering marker
  const [isCenterMarkerHovered, setIsCenterMarkerHovered] = useState(false);
  const searchCenterRef = useRef(defaultLocation);
  const autoAlertEnabledRef = useRef(false);
  const sendNotificationsEnabledRef = useRef(false);
  const lastRadiusRef = useRef(radiusSequence[0]);
  const lastNoCarNotificationRef = useRef(Date.now());
  const pollingRef = useRef(null);
  const refreshTimerRef = useRef(null);

  // State
  const [city, setCity] = useState('toronto');
  const [cars, setCars] = useState([]);
  const [statusMessage, setStatusMessage] = useState('Choose a location to begin searching.');
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [autoAlertEnabled, setAutoAlertEnabled] = useState(false);
  const [loadingCars, setLoadingCars] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true); // Default ON
  const [refreshMinutes, setRefreshMinutes] = useState(5); // Default 5 mins
  const [sendNotificationsEnabled, setSendNotificationsEnabled] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [mapCenter, setMapCenter] = useState(defaultLocation);
  const [isLocating, setIsLocating] = useState(false);
  const [refreshTimerResetKey, setRefreshTimerResetKey] = useState(0);

  const [ntfySettings, setNtfySettings] = useState({
    enabled: false,
    server: 'https://ntfy.sh',
    topic: '',
    token: '',
    priority: 'default',
  });
  const [ntfyStatus, setNtfyStatus] = useState('');

  const refreshIntervalSeconds = Math.max(15, refreshMinutes * 60);

  // --- Ntfy Logic ---
  const persistNtfySettings = updater => {
    setNtfySettings(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (typeof window !== 'undefined') {
        localStorage.setItem(NTFY_SETTINGS_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const handleNtfyChange = (field, value) => {
    setNtfyStatus('');
    if (field === 'enabled' && value === true) {
      // Force auto-refresh ON when notifications are enabled
      setAutoRefreshEnabled(true);
    }
    persistNtfySettings(prev => ({ ...prev, [field]: value }));
  };

  const handleNtfySave = () => {
    if (ntfySettings.topic) {
      setSendNotificationsEnabled(true);
      setAutoAlertEnabled(true);
      setAutoRefreshEnabled(true);
      setNtfyStatus('Topic saved and alerts enabled!');
      persistNtfySettings(prev => ({ ...prev, enabled: true }));
    } else {
      setNtfyStatus('Please enter a topic to enable alerts.');
      setSendNotificationsEnabled(false);
      setAutoAlertEnabled(false);
      persistNtfySettings(prev => ({ ...prev, enabled: false }));
    }
  };

  // ... (sendNtfyNotification remains same)

  // ...



  const sendNtfyNotification = async (title, message, { useBeacon = false } = {}) => {
    if (!ntfySettings.enabled) return;
    if (!ntfySettings.topic || !ntfySettings.server) return;

    const payload = {
      server: ntfySettings.server,
      topic: ntfySettings.topic,
      token: ntfySettings.token || undefined,
      priority: ntfySettings.priority && ntfySettings.priority !== 'default' ? ntfySettings.priority : undefined,
      title,
      message,
    };

    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        const endpoint = `${payload.server.replace(/\/$/, '')}/${encodeURIComponent(payload.topic)}`;
        const url = new URL(endpoint);
        if (payload.title) url.searchParams.set('title', payload.title);
        if (payload.priority) url.searchParams.set('priority', payload.priority);
        if (payload.token) url.searchParams.set('auth', payload.token);
        const blob = new Blob([payload.message], { type: 'text/plain' });
        navigator.sendBeacon(url.toString(), blob);
      } catch (err) {
        console.error('ntfy beacon failed', err);
      }
      return;
    }

    try {
      await fetch('/api/notify/ntfy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('ntfy notification request failed', err);
    }
  };

  // --- Notification Logic ---
  const triggerNotification = car => {
    if (!sendNotificationsEnabledRef.current) return;
    const distanceLabel = car.distanceFromUser < 1000
      ? `${Math.round(car.distanceFromUser)}m`
      : `${(car.distanceFromUser / 1000).toFixed(1)}km`;

    setStatusMessage(`Live monitoring: ${car.brand} ${car.model} spotted ${distanceLabel} away.`);



    sendNtfyNotification('Car nearby!', `${car.brand} ${car.model} is ${distanceLabel} from you.`);
  };

  const triggerNoCarNotification = () => {
    if (!sendNotificationsEnabledRef.current) return;
    const body = 'Still searching for available cars near your location...';

    sendNtfyNotification('Still searching', body);
  };

  const handleNoCarNotification = totalCars => {
    if (!sendNotificationsEnabledRef.current) {
      lastNoCarNotificationRef.current = Date.now();
      return;
    }
    if (totalCars > 0) {
      lastNoCarNotificationRef.current = Date.now();
      return;
    }
    const intervalMs = Math.max(1, NO_CAR_NOTIFICATION_MINUTES) * 60 * 1000;
    const now = Date.now();
    if (now - lastNoCarNotificationRef.current >= intervalMs) {
      triggerNoCarNotification();
      lastNoCarNotificationRef.current = now;
    }
  };

  const detectCarsWithinRadius = (carsToCheck, radius) => {
    // Safety check: Don't proceed if notifications are disabled
    if (!sendNotificationsEnabledRef.current) return;

    // If alert location is set, use it. Otherwise, use the current map center.
    const alertOrigin = alertLocationRef.current || searchCenterRef.current;
    if (!alertOrigin) return;

    const radiusMeters = radius * 1000;
    const candidates = carsToCheck
      .map(car => ({
        ...car,
        distanceFromUser: distanceBetweenMeters(alertOrigin, { lat: car.lat, lng: car.lng }),
      }))
      .filter(car => car.distanceFromUser <= radiusMeters)
      .sort((a, b) => a.distanceFromUser - b.distanceFromUser);

    if (!candidates.length) return;
    triggerNotification(candidates[0]);
  };

  const refreshAlertsWithUserLocation = async () => {
    if (!autoAlertEnabledRef.current || !sendNotificationsEnabledRef.current) return;
    // If alert location is set, use it. Otherwise, use the current map center.
    const origin = alertLocationRef.current || searchCenterRef.current;
    if (!origin) return;

    try {
      const radiusMeters = Math.max(MIN_FETCH_RADIUS_METERS, radiusKm * 1000);
      const carsInRadius = await fetchCarsForRadius({ origin, radius: radiusMeters });
      detectCarsWithinRadius(carsInRadius, radiusKm);
    } catch (err) {
      console.error('Failed to refresh alert radius cars', err);
    }
  };

  // --- Car Fetching Logic ---
  const fetchCarsForRadius = async ({ origin, radius, plate }) => {
    const params = new URLSearchParams({
      city,
      lat: String(origin.lat),
      lng: String(origin.lng),
      radius: String(Math.round(radius)),
    });
    if (plate) {
      params.set('plate', plate);
    }

    const response = await fetch(`/api/cars?${params.toString()}`);
    if (!response.ok) {
      throw new Error('Failed to fetch cars');
    }
    const data = await response.json();
    return Array.isArray(data.cars) ? data.cars : [];
  };

  const getVisibleRadiusMeters = () => {
    if (!mapRef.current || !window.google || !window.google.maps) {
      return Math.max(MIN_FETCH_RADIUS_METERS, lastRadiusRef.current || MIN_FETCH_RADIUS_METERS);
    }
    const bounds = mapRef.current.getBounds();
    const center = bounds?.getCenter();
    const ne = bounds?.getNorthEast();
    if (!bounds || !center || !ne) {
      return Math.max(MIN_FETCH_RADIUS_METERS, lastRadiusRef.current || MIN_FETCH_RADIUS_METERS);
    }
    const radius = distanceBetweenMeters(
      { lat: center.lat(), lng: center.lng() },
      { lat: ne.lat(), lng: ne.lng() }
    );
    return Math.max(MIN_FETCH_RADIUS_METERS, radius);
  };

  const filterCarsToVisibleArea = cars => {
    if (!mapRef.current || !window.google || !window.google.maps) return cars;
    const bounds = mapRef.current.getBounds();
    if (!bounds) return cars;
    return cars.filter(car => bounds.contains(new window.google.maps.LatLng(car.lat, car.lng)));
  };

  const loadCars = useCallback(async ({
    notifyOnArrival = false,
    origin,
    plate,
    radiusOverride,
    withSpinner = false,
    filterByViewport = true,
  } = {}) => {
    const targetOrigin = origin || searchCenterRef.current || defaultLocation;
    searchCenterRef.current = targetOrigin;

    let chosenCars = [];
    let chosenRadius = radiusOverride ? Math.max(MIN_FETCH_RADIUS_METERS, radiusOverride) : MIN_FETCH_RADIUS_METERS;
    let matchedPlateKey = null;
    let firstNonEmpty = null;

    if (withSpinner) {
      setLoadingCars(true);
    }

    try {
      if (filterByViewport) {
        chosenRadius = radiusOverride
          ? Math.max(MIN_FETCH_RADIUS_METERS, radiusOverride)
          : getVisibleRadiusMeters();
        chosenCars = await fetchCarsForRadius({ origin: targetOrigin, radius: chosenRadius, plate });
        if (plate) {
          const match = chosenCars.find(c => normalizePlate(c.plate) === normalizePlate(plate));
          if (match) {
            matchedPlateKey = carKey(match);
          }
        }
      } else {
        // Fallback radius search logic
        const radiiToTry = radiusOverride
          ? [Math.max(MIN_FETCH_RADIUS_METERS, radiusOverride)]
          : radiusSequence;

        for (const radius of radiiToTry) {
          const carsForRadius = await fetchCarsForRadius({ origin: targetOrigin, radius, plate });
          if (!plate && !firstNonEmpty && carsForRadius.length) {
            firstNonEmpty = { cars: carsForRadius, radius };
          }

          if (plate) {
            chosenCars = carsForRadius;
            chosenRadius = radius;
            const match = carsForRadius.find(c => normalizePlate(c.plate) === normalizePlate(plate));
            if (match) {
              matchedPlateKey = carKey(match);
              break;
            }
            continue;
          }

          if (carsForRadius.length) {
            chosenCars = carsForRadius;
            chosenRadius = radius;
            break;
          }

          chosenCars = carsForRadius;
          chosenRadius = radius;
        }

        if (!plate && firstNonEmpty && !chosenCars.length) {
          chosenCars = firstNonEmpty.cars;
          chosenRadius = firstNonEmpty.radius;
        }
      }

      lastRadiusRef.current = chosenRadius;

      const userLoc = userLocationRef.current;
      const decoratedCars = chosenCars
        .map(car => {
          const distanceFromUser = userLoc
            ? distanceBetweenMeters(userLoc, { lat: car.lat, lng: car.lng })
            : car.distance;
          return {
            ...car,
            distanceFromUser,
          };
        })
        .sort((a, b) => (a.distanceFromUser ?? a.distance) - (b.distanceFromUser ?? b.distance));

      const visibleDecoratedCars = filterByViewport ? filterCarsToVisibleArea(decoratedCars) : decoratedCars;

      setCars(visibleDecoratedCars);

      const totalCars = visibleDecoratedCars.length;
      if (totalCars) {
        const radiusLabel = chosenRadius < 1000 ? `${Math.round(chosenRadius)} m` : `${(chosenRadius / 1000).toFixed(1)} km`;
        setStatusMessage(`Found ${totalCars} car${totalCars === 1 ? '' : 's'} within ${radiusLabel}.`);
      } else {
        setStatusMessage('No cars found in this area.');
      }

      handleNoCarNotification(totalCars);

      if (notifyOnArrival) {
        detectCarsWithinRadius(chosenCars, radiusKm);
        const userOrigin = userLocationRef.current;
        if (userOrigin) {
          const separation = distanceBetweenMeters(userOrigin, targetOrigin);
          if (separation > chosenRadius) {
            await refreshAlertsWithUserLocation();
          }
        }
      }

      const matchedCar = matchedPlateKey
        ? visibleDecoratedCars.find(item => carKey(item) === matchedPlateKey)
        : undefined;

      return { matchedCar, radiusUsed: chosenRadius, totalCars };
    } catch (err) {
      console.error('Error loading cars:', err);
      setStatusMessage('Failed to load cars.');
      return { totalCars: 0 };
    } finally {
      if (withSpinner) {
        setLoadingCars(false);
      }
    }
  }, [city, radiusKm]);

  loadCarsRef.current = loadCars;

  // --- Effects ---

  // Init Ntfy
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const ntfyStored = localStorage.getItem(NTFY_SETTINGS_KEY);
      if (ntfyStored) {
        const parsed = JSON.parse(ntfyStored);
        setNtfySettings(prev => ({ ...prev, ...parsed }));
        if (parsed.enabled) {
          setSendNotificationsEnabled(true);
          setAutoAlertEnabled(true);
          setAutoRefreshEnabled(true);
        }
      }
    } catch (err) {
      console.warn('Failed to parse ntfy settings', err);
    }
  }, []);

  // Update refs
  useEffect(() => {
    autoAlertEnabledRef.current = autoAlertEnabled;
  }, [autoAlertEnabled]);

  useEffect(() => {
    sendNotificationsEnabledRef.current = autoAlertEnabled && sendNotificationsEnabled;
  }, [autoAlertEnabled, sendNotificationsEnabled]);

  const refreshAlertsRef = useRef(null);
  refreshAlertsRef.current = refreshAlertsWithUserLocation;

  // Auto Refresh
  useEffect(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!autoRefreshEnabled) return;

    const intervalMs = refreshIntervalSeconds * 1000;
    refreshTimerRef.current = setInterval(() => {
      // 1. Update UI (Map View) - Don't trigger alerts from here to avoid duplicates/misses
      const loadFn = loadCarsRef.current;
      if (loadFn) {
        loadFn({
          notifyOnArrival: false,
          origin: searchCenterRef.current,
          radiusOverride: getVisibleRadiusMeters(),
          filterByViewport: true,
        }).catch(err => console.error('Auto refresh UI failed', err));
      }

      // 2. Check Alerts (Background) - Always check the active alert location
      const refreshAlertsFn = refreshAlertsRef.current;
      if (refreshAlertsFn) {
        refreshAlertsFn().catch(err => console.error('Auto refresh Alerts failed', err));
      }
    }, intervalMs);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [autoRefreshEnabled, refreshIntervalSeconds, refreshTimerResetKey]);

  // --- Handlers ---

  const handleMapIdle = useCallback((map) => {
    mapRef.current = map;
    const center = map.getCenter();
    if (!center) return;

    const newPosition = { lat: center.lat(), lng: center.lng() };
    searchCenterRef.current = newPosition;

    // Trigger search on idle
    if (loadCarsRef.current) {
      loadCarsRef.current({
        notifyOnArrival: false, // Don't notify on map pan, only on interval or explicit set
        origin: newPosition,
        radiusOverride: getVisibleRadiusMeters(),
        filterByViewport: true,
      });
    }

    // Reset periodic timer if we are using Map Center for alerts (i.e., no specific alert location set)
    // This ensures we wait X mins AFTER the user stops moving the map before sending an alert.
    if (!alertLocationRef.current) {
      setRefreshTimerResetKey(prev => prev + 1);
    }
  }, [loadCars]);

  const handleLocationSelect = async (location) => {
    setMapCenter(location);
    searchCenterRef.current = location;

    // Wait for map to move then search (handled by idle)
    // But we can also force a search with spinner
    await loadCars({
      notifyOnArrival: sendNotificationsEnabledRef.current,
      origin: location,
      withSpinner: true,
      filterByViewport: true,
    });
  };

  const handleMyLocationClick = () => {
    if (!navigator.geolocation) {
      setStatusMessage('Geolocation not supported.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude } = position.coords;
        const loc = { lat: latitude, lng: longitude };
        setUserLocation(loc);
        userLocationRef.current = loc;
        setMapCenter(loc);
        setIsLocating(false);
      },
      () => {
        setStatusMessage('Unable to retrieve location.');
        setIsLocating(false);
      },
      { timeout: 10000 }
    );
  };

  const handleCarClick = (car) => {
    setSelectedCarId(carKey(car));
    setMapCenter({ lat: car.lat, lng: car.lng });
  };

  const handleSendNotificationsToggle = (enabled) => {
    if (enabled && !ntfySettings.topic) {
      setNtfyStatus('Please set a topic first.');
      return;
    }
    setSendNotificationsEnabled(enabled);
    setAutoAlertEnabled(enabled);
    if (enabled) {
      setAutoRefreshEnabled(true);
    }
    persistNtfySettings(prev => ({ ...prev, enabled }));
  };

  const handleClearAlertLocation = () => {
    setAlertLocation(null);
    alertLocationRef.current = null;
    setStatusMessage('Alert location cleared. Using map center.');
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-content">
          <div className="p-4 pt-0">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Communauto Finder</h1>
            <p className="text-sm text-gray-500 mb-4">{statusMessage}</p>
          </div>
          <CarList
            cars={cars}
            selectedCarId={selectedCarId}
            onCarClick={handleCarClick}
          />
        </div>
      </div>

      <div className="map-wrapper">
        <ControlPanel
          onLocationSelect={handleLocationSelect}
          onSettingsClick={() => {
            setNtfyStatus('');
            setIsSettingsOpen(true);
          }}
          notificationsEnabled={sendNotificationsEnabled}
          refreshMinutes={refreshMinutes}
          onToggleNotifications={() => {
            if (sendNotificationsEnabled) {
              handleSendNotificationsToggle(false);
            } else {
              if (!ntfySettings.topic) {
                // Open settings if topic is missing
                setIsSettingsOpen(true);
                setNtfyStatus('Please set a topic first to enable alerts.');
                return;
              }
              handleSendNotificationsToggle(true);
            }
          }}
          alertLocation={alertLocation}
          onClearAlertLocation={handleClearAlertLocation}
        />

        {/* My Location Button - Moved to Bottom Right, above Zoom Controls */}
        <button
          onClick={handleMyLocationClick}
          disabled={isLocating}
          title="Use my location"
          style={{
            position: 'absolute',
            bottom: '110px', // Adjusted to be above Google Maps zoom controls
            right: '10px',   // Aligned with zoom controls
            zIndex: 50,
            backgroundColor: 'white',
            border: 'none',
            borderRadius: '2px', // Match Google Maps style
            boxShadow: 'rgba(0, 0, 0, 0.3) 0px 1px 4px -1px',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#666'
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill={isLocating ? '#3b82f6' : 'currentColor'}>
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
          </svg>
        </button>


        <Map
          cars={cars}
          center={mapCenter}
          userLocation={userLocation}
          selectedCarId={selectedCarId}
          onMapIdle={handleMapIdle}
          onCarClick={handleCarClick}
          onLoad={(map) => { mapRef.current = map; }}
          notificationsEnabled={sendNotificationsEnabled}
          alertLocation={alertLocation}
        />

        {/* Center Marker for Alert Setting */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -100%)', // Pin tip at center
            zIndex: 40,
            pointerEvents: 'auto',
            cursor: 'pointer',
            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}
          onMouseEnter={() => setIsCenterMarkerHovered(true)}
          onMouseLeave={() => setIsCenterMarkerHovered(false)}
          onDoubleClick={() => {
            if (!mapRef.current) return;
            const center = mapRef.current.getCenter();
            if (!center) return;

            const newLoc = { lat: center.lat(), lng: center.lng() };
            alertLocationRef.current = newLoc;
            setAlertLocation(newLoc);

            // If alerts not enabled, enable them (if topic exists)
            if (!sendNotificationsEnabled) {
              if (ntfySettings.topic) {
                handleSendNotificationsToggle(true);
                setStatusMessage('Alert location updated to map center.');
              } else {
                setIsSettingsOpen(true);
                setNtfyStatus('Please set a topic to enable alerts from this location.');
              }
            } else {
              setStatusMessage('Alert location updated to map center.');
              // Trigger immediate refresh
              loadCars({
                notifyOnArrival: true,
                origin: newLoc,
                radiusOverride: getVisibleRadiusMeters(),
                filterByViewport: true,
              });
            }
          }}
          title="Double-click to set alert location here"
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="#1f2937" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3" fill="#ffffff"></circle>
          </svg>
          <button
            style={{
              marginTop: '8px',
              backgroundColor: '#1f2937',
              color: 'white',
              fontSize: '11px',
              fontWeight: '600',
              padding: '6px 12px',
              borderRadius: '20px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
              border: 'none',
              whiteSpace: 'nowrap',
              opacity: isCenterMarkerHovered ? 1 : 0,
              transform: isCenterMarkerHovered ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              pointerEvents: isCenterMarkerHovered ? 'auto' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            onClick={(e) => {
              e.stopPropagation(); // Prevent double-click trigger
              if (!mapRef.current) return;
              const center = mapRef.current.getCenter();
              if (!center) return;

              const newLoc = { lat: center.lat(), lng: center.lng() };
              alertLocationRef.current = newLoc;
              setAlertLocation(newLoc);

              if (!sendNotificationsEnabled) {
                if (ntfySettings.topic) {
                  handleSendNotificationsToggle(true);
                  setStatusMessage('Alert location updated.');
                } else {
                  setIsSettingsOpen(true);
                  setNtfyStatus('Set topic to enable alerts.');
                }
              } else {
                setStatusMessage('Alert location updated.');
                loadCars({
                  notifyOnArrival: true,
                  origin: newLoc,
                  radiusOverride: getVisibleRadiusMeters(),
                  filterByViewport: true,
                });
              }
            }}
          >
            <span>Set Alert Location</span>
          </button>
        </div>
      </div>


      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        refreshMinutes={refreshMinutes}
        onRefreshMinutesChange={setRefreshMinutes}
        autoRefreshEnabled={autoRefreshEnabled}
        onAutoRefreshToggle={(e) => setAutoRefreshEnabled(e.target.checked)}
        ntfySettings={ntfySettings}
        onNtfyChange={handleNtfyChange}
        onNtfySave={handleNtfySave}
        ntfyStatus={ntfyStatus}
        sendNotificationsEnabled={sendNotificationsEnabled}
        onSendNotificationsToggle={(e) => handleSendNotificationsToggle(e.target.checked)}
      />
    </div >
  );
}
