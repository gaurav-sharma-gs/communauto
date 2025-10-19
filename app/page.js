'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

const defaultLocation = { lat: 43.6532, lng: -79.3832 };
const radiusSequence = [500, 1000, 3000, 5000, 8000, 10000, 15000];
const MIN_FETCH_RADIUS_METERS = radiusSequence[0];
const LOCATION_EPSILON = 0.0001;
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
const REFRESH_INTERVAL_OPTIONS = [
  { value: '1', label: 'Every 1 minute' },
  { value: '3', label: 'Every 3 minutes' },
  { value: '5', label: 'Every 5 minutes' },
  { value: '10', label: 'Every 10 minutes' },
  { value: 'custom', label: 'Custom…' },
];

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

function metersToLatDegrees(meters) {
  return meters / 111320;
}

function metersToLngDegrees(meters, latitude) {
  return meters / (111320 * Math.cos(toRadians(latitude) || 1));
}

function carKey(car) {
  return `${car.plate}-${car.lat.toFixed(5)}-${car.lng.toFixed(5)}`;
}

function normalizePlate(plate) {
  return plate ? plate.trim().toLowerCase() : '';
}

export default function Home() {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const infoWindowRef = useRef(null);
  const userMarkerRef = useRef(null);
  const carMarkersRef = useRef(new Map());
  const myLocationControlRef = useRef(null);
  const pollingRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const programmaticMoveRef = useRef(false);
  const loadCarsRef = useRef(null);
  const userLocationRef = useRef(null);
  const searchCenterRef = useRef(defaultLocation);
  const autoAlertEnabledRef = useRef(false);
  const sendNotificationsEnabledRef = useRef(false);
  const lastRadiusRef = useRef(radiusSequence[0]);

  const [city, setCity] = useState('toronto');
  const [cars, setCars] = useState([]);
  const [statusMessage, setStatusMessage] = useState('Choose a location to begin searching.');
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [autoAlertEnabled, setAutoAlertEnabled] = useState(false);
  const [loadingCars, setLoadingCars] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [refreshMode, setRefreshMode] = useState('1');
  const [refreshMinutes, setRefreshMinutes] = useState(1);
  const [sendNotificationsEnabled, setSendNotificationsEnabled] = useState(false);
  const [ntfySettings, setNtfySettings] = useState({
    enabled: false,
    server: 'https://ntfy.sh',
    topic: '',
    token: '',
    priority: 'default',
  });
  const [ntfyStatus, setNtfyStatus] = useState('');
  const lastNoCarNotificationRef = useRef(Date.now());
  const refreshIntervalSeconds = Math.max(15, refreshMinutes * 60);

  const persistNtfySettings = updater => {
    setNtfySettings(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (typeof window !== 'undefined') {
        localStorage.setItem(NTFY_SETTINGS_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const handleNtfyToggle = event => {
    const enabled = event.target.checked;
    setNtfyStatus('');
    persistNtfySettings(prev => ({ ...prev, enabled }));
  };

  const handleNtfyInputChange = field => event => {
    const value = event.target.value;
    setNtfyStatus('');
    persistNtfySettings(prev => ({ ...prev, [field]: value }));
  };

  const handleNtfySave = () => {
    if (ntfySettings.enabled) {
      if (!ntfySettings.topic) {
        setNtfyStatus('Enter an ntfy topic to enable alerts.');
        return;
      }
    }
    setNtfyStatus(ntfySettings.enabled ? 'ntfy alerts enabled.' : 'ntfy alerts disabled.');
  };

  const handleRefreshOptionChange = event => {
    const value = event.target.value;
    setRefreshMode(value);
    if (value !== 'custom') {
      setRefreshMinutes(Number(value));
    }
  };

  const handleRefreshMinutesChange = event => {
    const value = Number(event.target.value);
    setRefreshMode('custom');
    setRefreshMinutes(value > 0 ? value : 1);
  };

  const handleAutoRefreshToggle = event => {
    if (!autoAlertEnabled) return;
    const enabled = event.target.checked;
    setAutoRefreshEnabled(enabled);
    setStatusMessage(
      enabled
        ? `Auto refresh enabled. Refreshing every ${describeInterval(refreshIntervalSeconds)}.`
        : 'Auto refresh disabled.'
    );
  };

  const handleSendNotificationsToggle = event => {
    if (!autoAlertEnabled) return;
    const enabled = event.target.checked;
    setSendNotificationsEnabled(enabled);
    lastNoCarNotificationRef.current = Date.now();
    setStatusMessage(
      enabled
        ? `Live monitoring notifications enabled. Checking every ${describeInterval(refreshIntervalSeconds)}.`
        : 'Live monitoring enabled without notifications.'
    );
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const ntfyStored = localStorage.getItem(NTFY_SETTINGS_KEY);
      if (ntfyStored) {
        const parsed = JSON.parse(ntfyStored);
        setNtfySettings(prev => ({ ...prev, ...parsed }));
      }
    } catch (err) {
      console.warn('Failed to parse ntfy settings', err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const shouldNotifyOnUnload =
      autoAlertEnabled &&
      sendNotificationsEnabled &&
      ntfySettings.enabled &&
      ntfySettings.topic &&
      ntfySettings.server;
    if (!shouldNotifyOnUnload) return;

    const handleBeforeUnload = () => {
      sendNtfyNotification(
        'Live monitor stopped',
        'Monitoring ended because the browser window closed.',
        { useBeacon: true },
      );
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [autoAlertEnabled, sendNotificationsEnabled, ntfySettings.enabled, ntfySettings.server, ntfySettings.topic, ntfySettings.token, ntfySettings.priority]);

  useEffect(() => {
    autoAlertEnabledRef.current = autoAlertEnabled;
  }, [autoAlertEnabled]);

  useEffect(() => {
    sendNotificationsEnabledRef.current = autoAlertEnabled && sendNotificationsEnabled;
  }, [autoAlertEnabled, sendNotificationsEnabled]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!autoAlertEnabled || !autoRefreshEnabled) {
      return;
    }

    const intervalMs = refreshIntervalSeconds * 1000;

    refreshTimerRef.current = setInterval(() => {
      const loadFn = loadCarsRef.current;
      if (loadFn) {
        loadFn({
          notifyOnArrival: sendNotificationsEnabledRef.current,
          origin: searchCenterRef.current,
          radiusOverride: getVisibleRadiusMeters(),
          filterByViewport: true,
        }).catch(err => console.error('Auto refresh failed', err));
      }
    }, intervalMs);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [autoAlertEnabled, autoRefreshEnabled, refreshMinutes]);

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
    const cars = Array.isArray(data.cars) ? data.cars : [];
    return cars;
  };

  const refreshCarMarkers = carsToRender => {
    if (!window.google || !window.google.maps) return;
    const map = mapRef.current;
    if (!map) return;

    carMarkersRef.current.forEach(({ marker }) => marker.setMap(null));
    carMarkersRef.current.clear();

    carsToRender.forEach(car => {
      const position = { lat: car.lat, lng: car.lng };
      const marker = new window.google.maps.Marker({
        position,
        map,
        title: `${car.brand} ${car.model}`,
      });

      marker.addListener('click', () => focusCarOnMap(car));
      carMarkersRef.current.set(carKey(car), { marker, car });
    });
  };

  const loadCars = async ({
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

    try {
      const userLocation = userLocationRef.current;
      const decoratedCars = chosenCars
        .map(car => {
          const distanceFromUser = userLocation
            ? distanceBetweenMeters(userLocation, { lat: car.lat, lng: car.lng })
            : car.distance;
          return {
            ...car,
            distanceFromUser,
          };
        })
        .sort((a, b) => (a.distanceFromUser ?? a.distance) - (b.distanceFromUser ?? b.distance));

      const visibleDecoratedCars = filterByViewport ? filterCarsToVisibleArea(decoratedCars) : decoratedCars;

      setCars(visibleDecoratedCars);
      if (selectedCarId && !visibleDecoratedCars.some(item => carKey(item) === selectedCarId)) {
        setSelectedCarId(null);
      }
      refreshCarMarkers(visibleDecoratedCars);

      const totalCars = visibleDecoratedCars.length;

      if (totalCars) {
        const radiusLabel = chosenRadius < 1000 ? `${chosenRadius} m` : `${(chosenRadius / 1000).toFixed(1)} km`;
        setStatusMessage(`Showing ${totalCars} car${totalCars === 1 ? '' : 's'} within ${radiusLabel}.`);
      } else {
        setStatusMessage('No cars within the current map area. Try panning, zooming, or refreshing later.');
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
    } finally {
      if (withSpinner) {
        setLoadingCars(false);
      }
    }
  };

  loadCarsRef.current = loadCars;

  const detectCarsWithinRadius = (carsToCheck, radius) => {
    const userLocation = userLocationRef.current;
    if (!userLocation) return;

    const radiusMeters = radius * 1000;
    const candidates = carsToCheck
      .map(car => ({
        ...car,
        distanceFromUser: distanceBetweenMeters(userLocation, { lat: car.lat, lng: car.lng }),
      }))
      .filter(car => car.distanceFromUser <= radiusMeters)
      .sort((a, b) => a.distanceFromUser - b.distanceFromUser);

    if (!candidates.length) return;
    triggerNotification(candidates[0]);
  };

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
        const ok = navigator.sendBeacon(url.toString(), blob);
        if (!ok) {
          console.warn('Failed to queue ntfy beacon');
        }
      } catch (err) {
        console.error('ntfy beacon failed', err);
      }
      return;
    }

    try {
      const response = await fetch('/api/notify/ntfy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error('Failed to send ntfy notification', data);
      }
    } catch (err) {
      console.error('ntfy notification request failed', err);
    }
  };

  const triggerNotification = car => {
    if (!sendNotificationsEnabledRef.current) return;
    const distanceLabel = formatDistance(car.distanceFromUser ?? car.distance);
    setStatusMessage(`Live monitoring: ${car.brand} ${car.model} spotted ${distanceLabel} away.`);

    console.log('[CommuneAuto] triggerNotification', {
      car,
      distanceLabel,
    });

    sendNtfyNotification('Car nearby!', `${car.brand} ${car.model} is ${distanceLabel} from you.`);
  };

  const triggerNoCarNotification = () => {
    if (!sendNotificationsEnabledRef.current) return;
    const body = 'Still searching for available cars near your location...';
    console.log('[CommuneAuto] triggerNoCarNotification');
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

  const refreshAlertsWithUserLocation = async () => {
    if (!autoAlertEnabledRef.current || !sendNotificationsEnabledRef.current) return;
    const origin = userLocationRef.current;
    if (!origin) return;

    try {
      const radiusMeters = Math.max(MIN_FETCH_RADIUS_METERS, radiusKm * 1000);
      const carsInRadius = await fetchCarsForRadius({ origin, radius: radiusMeters });
      detectCarsWithinRadius(carsInRadius, radiusKm);
    } catch (err) {
      console.error('Failed to refresh alert radius cars', err);
    }
  };

  const fitMapToRadius = (origin, radius) => {
    if (!window.google || !window.google.maps || !mapRef.current) return;
    const latDelta = metersToLatDegrees(radius);
    const lngDelta = metersToLngDegrees(radius, origin.lat);
    const bounds = new window.google.maps.LatLngBounds(
      new window.google.maps.LatLng(origin.lat - latDelta, origin.lng - lngDelta),
      new window.google.maps.LatLng(origin.lat + latDelta, origin.lng + lngDelta)
    );
    programmaticMoveRef.current = true;
    mapRef.current.fitBounds(bounds);
  };

  const showUserMarker = ({ lat, lng }) => {
    if (!window.google || !window.google.maps || !mapRef.current) return;
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
    userMarkerRef.current.setPosition({ lat, lng });
  };

  const handleOriginChange = async (coords, { source, fitMap = true, useViewportRadius = false } = {}) => {
    const origin = { lat: coords.lat, lng: coords.lng };

    if (source === 'geolocation') {
      userLocationRef.current = origin;
      showUserMarker(origin);
    }

    if (mapRef.current) {
      programmaticMoveRef.current = true;
      mapRef.current.panTo(origin);
    }

    try {
      const viewportRadius = getVisibleRadiusMeters();
      const { radiusUsed, totalCars } = await loadCars({
        notifyOnArrival: sendNotificationsEnabledRef.current,
        origin,
        withSpinner: true,
        filterByViewport: useViewportRadius,
        radiusOverride: useViewportRadius ? viewportRadius : undefined,
      });
      if (fitMap && !useViewportRadius) {
        const viewRadius = totalCars && radiusUsed ? Math.max(radiusUsed, 1000) : 1000;
        fitMapToRadius(origin, viewRadius);
      }
    } catch (err) {
      console.error('Failed to load cars for new origin', err);
      setStatusMessage('Unable to load cars right now. Please try again.');
    }
  };

  const requestUserLocation = async () => {
    if (!navigator.geolocation) {
      setStatusMessage('Geolocation not supported by your browser.');
      return;
    }

    setStatusMessage('Locating...');
    navigator.geolocation.getCurrentPosition(
      async position => {
        const { latitude, longitude } = position.coords;
        await handleOriginChange(
          { lat: latitude, lng: longitude },
          { source: 'geolocation', fitMap: false, useViewportRadius: true }
        );
        setStatusMessage('Using your current location.');
      },
      () => setStatusMessage('Unable to retrieve your location.'),
      { timeout: 12000 }
    );
  };

  const handleMapIdle = () => {
    if (!mapRef.current) return;
    if (programmaticMoveRef.current) {
      programmaticMoveRef.current = false;
      return;
    }

    const center = mapRef.current.getCenter();
    if (!center) return;
    const newPosition = { lat: center.lat(), lng: center.lng() };
    const previous = searchCenterRef.current;

    if (
      previous &&
      Math.abs(previous.lat - newPosition.lat) < LOCATION_EPSILON &&
      Math.abs(previous.lng - newPosition.lng) < LOCATION_EPSILON
    ) {
      return;
    }

    const loadFn = loadCarsRef.current;
    if (loadFn) {
      loadFn({
        notifyOnArrival: sendNotificationsEnabledRef.current,
        origin: newPosition,
        radiusOverride: getVisibleRadiusMeters(),
        filterByViewport: true,
      }).catch(err => console.error('Map idle refresh failed', err));
    }
  };

  const focusCarOnMap = car => {
    if (!window.google || !mapRef.current) return;
    const entry = carMarkersRef.current.get(carKey(car));
    if (!entry) return;

    const { marker } = entry;
    const position = marker.getPosition();
    if (position) {
      programmaticMoveRef.current = true;
      mapRef.current.panTo(position);
    }

    const infoWindow = infoWindowRef.current || new window.google.maps.InfoWindow();
    infoWindowRef.current = infoWindow;
    const distanceLabel = formatDistance(car.distanceFromUser ?? car.distance);
    const distanceContext = userLocationRef.current ? 'from you' : 'from map center';
    infoWindow.setContent(`
      <strong>${car.brand} ${car.model}</strong><br />
      Plate: ${car.plate}<br />
      ${distanceLabel} ${distanceContext}
    `);
    infoWindow.open({ map: mapRef.current, anchor: marker });

    marker.setAnimation(window.google.maps.Animation.BOUNCE);
    window.setTimeout(() => marker.setAnimation(null), 1400);
  };

  const handleCarClick = async car => {
    setSelectedCarId(carKey(car));
    try {
      const { matchedCar } = await loadCars({
        notifyOnArrival: sendNotificationsEnabledRef.current,
        origin: searchCenterRef.current,
        radiusOverride: getVisibleRadiusMeters(),
        plate: car.plate,
        withSpinner: true,
        filterByViewport: true,
      });

      const target = matchedCar || carMarkersRef.current.get(carKey(car))?.car;
      if (target) {
        focusCarOnMap(target);
        setStatusMessage(`${target.brand} ${target.model} confirmed nearby.`);
      } else {
        setStatusMessage('This car is no longer available. List updated.');
      }
    } catch (err) {
      console.error('Failed to confirm car', err);
      setStatusMessage('Unable to confirm that car right now. Please try again.');
    }
  };

  const setupAutocomplete = () => {
    const input = document.getElementById('location-search');
    if (!input || !window.google || !window.google.maps?.places) return;

    const autocomplete = new window.google.maps.places.Autocomplete(input, {
      fields: ['geometry'],
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place.geometry?.location) {
        setStatusMessage('Unable to determine that location.');
        return;
      }
      handleOriginChange({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() }, {
        source: 'search',
        fitMap: true,
      });
    });
  };

  const initializeMap = () => {
    if (!mapElementRef.current) return;
    if (!window.google || !window.google.maps) return;

    mapRef.current = new window.google.maps.Map(mapElementRef.current, {
      center: defaultLocation,
      zoom: 14,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: true,
      zoomControlOptions: {
        position: window.google.maps.ControlPosition.RIGHT_TOP,
      },
      gestureHandling: 'greedy',
    });

    if (!myLocationControlRef.current) {
      const controlButton = document.createElement('button');
      controlButton.className = 'my-location-control';
      controlButton.title = 'Center map on my location';
      controlButton.setAttribute('aria-label', 'Center map on my location');
      controlButton.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <g fill="none" stroke="#5f6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v3" />
            <path d="M12 18v3" />
            <path d="M3 12h3" />
            <path d="M18 12h3" />
          </g>
        </svg>
      `;
      controlButton.addEventListener('click', () => {
        if (userLocationRef.current) {
          handleOriginChange(userLocationRef.current, {
            source: 'geolocation',
            fitMap: false,
            useViewportRadius: true,
          });
        } else {
          requestUserLocation();
        }
      });

      myLocationControlRef.current = controlButton;
      mapRef.current.controls[window.google.maps.ControlPosition.RIGHT_BOTTOM].push(controlButton);
    }

    infoWindowRef.current = new window.google.maps.InfoWindow();
    mapRef.current.addListener('idle', handleMapIdle);

    setupAutocomplete();

    handleOriginChange(defaultLocation, { source: 'default', fitMap: true }).catch(err => {
      console.error('Initial load failed', err);
    });
  };

  const handleCityChange = event => {
    const newCity = event.target.value;
    setCity(newCity);
    const loadFn = loadCarsRef.current;
    if (loadFn) {
      loadFn({
        notifyOnArrival: sendNotificationsEnabledRef.current,
        origin: searchCenterRef.current,
        radiusOverride: getVisibleRadiusMeters(),
        withSpinner: true,
        filterByViewport: true,
      }).catch(err => {
        console.error('City change refresh failed', err);
        setStatusMessage('Unable to refresh cars for the selected city. Try again shortly.');
      });
    }
    if (sendNotificationsEnabledRef.current) {
      refreshAlertsWithUserLocation();
    }
  };

  const toggleAutoAlert = enabled => {
    setAutoAlertEnabled(enabled);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (!enabled) {
      setAutoRefreshEnabled(false);
      setSendNotificationsEnabled(false);
      setStatusMessage('Live monitoring paused.');
      lastNoCarNotificationRef.current = Date.now();
      return;
    }

    lastNoCarNotificationRef.current = Date.now();
    setStatusMessage('Live monitoring enabled. Choose options below to auto refresh or send notifications.');
    if (sendNotificationsEnabledRef.current) {
      refreshAlertsWithUserLocation();
    }
  };

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (!autoAlertEnabled || !sendNotificationsEnabled) {
      return;
    }

    lastNoCarNotificationRef.current = Date.now();
    refreshAlertsWithUserLocation();

    pollingRef.current = setInterval(() => {
      refreshAlertsWithUserLocation();
    }, refreshIntervalSeconds * 1000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [autoAlertEnabled, sendNotificationsEnabled, refreshIntervalSeconds]);

  return (
    <>
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}&libraries=places`}
        strategy="afterInteractive"
        onLoad={() => {
          if (!mapRef.current) {
            initializeMap();
          }
        }}
        onError={() => setStatusMessage('Failed to load Google Maps. Check your API key.')}
      />
      <header>
        <div className="header-inner">
          <h1>CommuneAuto Finder</h1>
          <p>
            Discover Communauto vehicles near you, confirm live availability, and keep an eye out for upcoming notification features.
          </p>
        </div>
      </header>
      <main>
        <section className="reminder live-monitoring">
          <div className="live-monitor-header">
            <h2>Live monitoring</h2>
            <button
              className="button-primary"
              onClick={() => toggleAutoAlert(!autoAlertEnabled)}
            >
              {autoAlertEnabled ? 'Disable live monitoring' : 'Enable live monitoring'}
            </button>
          </div>
          <div className="live-monitor-options">
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={handleAutoRefreshToggle}
                disabled={!autoAlertEnabled}
              />
              <span>Enable auto refresh</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={sendNotificationsEnabled}
                onChange={handleSendNotificationsToggle}
                disabled={!autoAlertEnabled}
              />
              <span>Send notifications</span>
            </label>
          </div>
          <p className="hint">
            {autoAlertEnabled
              ? sendNotificationsEnabled
                ? `Notifications are sent every ${describeInterval(refreshIntervalSeconds)} for cars within ${radiusKm} km.`
                : 'Notifications are off. Enable "Send notifications" to receive ntfy alerts.'
              : 'Enable live monitoring to unlock auto refresh and notification options.'}
          </p>
        </section>

        <section className="controls">
          <div className="control-buttons">
            <button className="button-primary" onClick={requestUserLocation} disabled={!mapRef.current}>
              Use my location
            </button>
            <button
              className="button-primary"
              onClick={() => {
                const loadFn = loadCarsRef.current;
                if (loadFn) {
                  loadFn({
                    notifyOnArrival: sendNotificationsEnabledRef.current,
                    origin: searchCenterRef.current,
                    radiusOverride: getVisibleRadiusMeters(),
                    withSpinner: true,
                    filterByViewport: true,
                  }).catch(err => {
                    console.error('Manual refresh failed', err);
                    setStatusMessage('Unable to refresh cars right now. Try again shortly.');
                  });
                }
              }}
              disabled={loadingCars}
            >
              {loadingCars ? 'Refreshing...' : 'Refresh cars'}
            </button>
          </div>

          <div className="refresh-controls control-grid">
            <div className="field">
              <label htmlFor="refresh-interval">Auto refresh interval</label>
              <select
                id="refresh-interval"
                value={refreshMode}
                onChange={handleRefreshOptionChange}
                disabled={!autoAlertEnabled || !autoRefreshEnabled}
              >
                {REFRESH_INTERVAL_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {refreshMode === 'custom' && (
                <input
                  id="refresh-minutes"
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={refreshMinutes}
                  onChange={handleRefreshMinutesChange}
                  disabled={!autoAlertEnabled || !autoRefreshEnabled}
                />
              )}
            </div>
            <div className="field">
              <label htmlFor="radius">Search radius (km)</label>
              <input
                id="radius"
                type="number"
                min="0.1"
                step="0.1"
                value={radiusKm}
                onChange={event => setRadiusKm(Number(event.target.value))}
              />
            </div>
          </div>

          <p className="status-message" role="status">{statusMessage}</p>
        </section>

        <section className="search-location">
          <label htmlFor="location-search">Search location</label>
          <input id="location-search" type="search" placeholder="Search for an address or landmark" />
        </section>

        <section id="map">
          <div className="map-container" ref={mapElementRef} aria-label="Communauto map" />
        </section>

        <section className="results" aria-live="polite">
          <div className="section-heading">
            <h2>Available cars</h2>
            <span className="hint">Tap a car to confirm availability</span>
          </div>
          <ul>
            {cars.length === 0 ? (
              <li>No cars found within the visible map area.</li>
            ) : (
              cars.map(car => {
                const distanceFromUser = car.distanceFromUser ?? car.distance;
                const distanceContext = userLocationRef.current ? 'from you' : 'from map center';
                const id = carKey(car);
                const selected = selectedCarId === id;
                return (
                  <li
                    key={id}
                    className={selected ? 'selected' : ''}
                    onClick={() => handleCarClick(car)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleCarClick(car);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected}
                  >
                    <strong>{car.brand} {car.model}</strong>
                    <span className="meta">Plate {car.plate}</span>
                    <span className="meta">{formatDistance(distanceFromUser)} {distanceContext}</span>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <section className="ntfy">
          <div className="section-heading">
            <h2>ntfy alerts</h2>
            <span className="hint">Push to any ntfy topic (optionally self-hosted).</span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={ntfySettings.enabled}
              onChange={handleNtfyToggle}
            />
            <span>Enable ntfy alerts</span>
          </label>
          <div className="field">
            <label htmlFor="ntfy-server">ntfy server</label>
            <input
              id="ntfy-server"
              type="url"
              placeholder="https://ntfy.sh"
              value={ntfySettings.server}
              onChange={handleNtfyInputChange('server')}
              disabled={!ntfySettings.enabled}
            />
          </div>
          <div className="field">
            <label htmlFor="ntfy-topic">Topic</label>
            <input
              id="ntfy-topic"
              type="text"
              placeholder="communeauto-notify"
              value={ntfySettings.topic}
              onChange={handleNtfyInputChange('topic')}
              disabled={!ntfySettings.enabled}
            />
          </div>
          <div className="field">
            <label htmlFor="ntfy-priority">Priority</label>
            <select
              id="ntfy-priority"
              value={ntfySettings.priority}
              onChange={handleNtfyInputChange('priority')}
              disabled={!ntfySettings.enabled}
            >
              <option value="default">Default</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ntfy-token">Access token (optional)</label>
            <input
              id="ntfy-token"
              type="password"
              placeholder="Bearer token"
              value={ntfySettings.token}
              onChange={handleNtfyInputChange('token')}
              disabled={!ntfySettings.enabled}
            />
          </div>
          <button className="button-primary" onClick={handleNtfySave}>
            Save ntfy settings
          </button>
          {ntfyStatus && <p className="status-message">{ntfyStatus}</p>}
        </section>

        <section className="city-selector">
          <label htmlFor="city-select">City</label>
          <select id="city-select" value={city} onChange={handleCityChange}>
            <option value="toronto">Toronto</option>
            <option value="montreal">Montreal</option>
          </select>
        </section>

      </main>
      <footer>
        <small>CommuneAuto Finder &copy; {new Date().getFullYear()}. Data provided by Communauto. Map &copy; Google.</small>
      </footer>
    </>
  );
}

function formatDistance(distance) {
  if (distance < 1000) {
    return `${Math.round(distance)} m`;
  }
  return `${(distance / 1000).toFixed(1)} km`;
}
