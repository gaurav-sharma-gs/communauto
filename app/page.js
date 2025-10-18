'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

const defaultLocation = { lat: 43.6532, lng: -79.3832 };
const pollIntervalMs = 45000;
const radiusSequence = [500, 1000, 3000, 5000, 8000, 10000, 15000];
const MIN_FETCH_RADIUS_METERS = radiusSequence[0];
const LOCATION_EPSILON = 0.0001;

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
  const lastRadiusRef = useRef(radiusSequence[0]);

  const [city, setCity] = useState('toronto');
  const [cars, setCars] = useState([]);
  const [statusMessage, setStatusMessage] = useState('Choose a location to begin searching.');
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [autoAlertEnabled, setAutoAlertEnabled] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState('default');
  const [hasHydrated, setHasHydrated] = useState(false);
  const [loadingCars, setLoadingCars] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshMinutes, setRefreshMinutes] = useState(1);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(err => console.error('Service worker registration failed', err));
    }
  }, []);

  useEffect(() => {
    setHasHydrated(true);
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    autoAlertEnabledRef.current = autoAlertEnabled;
  }, [autoAlertEnabled]);

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

    if (!autoRefreshEnabled) {
      return;
    }

    const minutes = Number.isFinite(refreshMinutes) && refreshMinutes > 0 ? refreshMinutes : 1;
    const intervalMs = Math.max(15, minutes * 60) * 1000;

    refreshTimerRef.current = setInterval(() => {
      const loadFn = loadCarsRef.current;
      if (loadFn) {
        loadFn({
          notifyOnArrival: autoAlertEnabledRef.current,
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
  }, [autoRefreshEnabled, refreshMinutes]);

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

  const triggerNotification = car => {
    const distanceLabel = formatDistance(car.distanceFromUser ?? car.distance);
    setStatusMessage(`Live monitoring: ${car.brand} ${car.model} spotted ${distanceLabel} away.`);

    // Ensure the browser supports notifications
    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.warn('This browser does not support desktop notification');
      return;
    }

    const showBrowserNotification = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification('Car nearby!', {
          body: `${car.brand} ${car.model} is ${distanceLabel} from you.`,
        });
        new Notification('Car nearby!', {
          body: `${car.brand} ${car.model} is ${distanceLabel} from you.`,
        });
      } catch (err) {
        console.error('Failed to show service worker notification', err);
        new Notification('Car nearby!', {
          body: `${car.brand} ${car.model} is ${distanceLabel} from you.`,
        });
      }
    };

    if (Notification.permission === 'granted') {
      showBrowserNotification();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        setNotificationPermission(permission);
        if (permission === 'granted') {
          showBrowserNotification();
        }
      });
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
    if (!autoAlertEnabledRef.current) return;
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
        notifyOnArrival: autoAlertEnabledRef.current,
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
        notifyOnArrival: autoAlertEnabledRef.current,
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
        notifyOnArrival: autoAlertEnabledRef.current,
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

  const requestNotificationAccess = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setStatusMessage('Notifications not supported by this browser.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== 'granted') {
        setStatusMessage('Notification permission denied. Alerts will stay in-app.');
      } else {
        setStatusMessage('Browser notifications enabled.');
      }
    } catch (err) {
      console.error('Failed to request notification permission', err);
    }
  };

  const notificationLabel = hasHydrated && notificationPermission === 'granted'
    ? 'Notifications enabled'
    : 'Enable notifications';

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

    // Inside the initializeMap function...

  if (!myLocationControlRef.current) {
    const controlButton = document.createElement('button');
    controlButton.className = 'my-location-button'; // The class name for CSS
    controlButton.title = 'Center map on my location';
    controlButton.setAttribute('aria-label', 'Center map on my location');

    // Use a reliable inline SVG for the icon
    controlButton.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 8C9.79 8 8 9.79 8 12C8 14.21 9.79 16 12 16C14.21 16 16 14.21 16 12C16 9.79 14.21 8 12 8Z" fill="#5f6368"></path>
        <path d="M19.43 11L22.5 11C22.21 6.13 17.87 2.79 13 2.5V5.57C16.48 5.89 19.11 8.52 19.43 12L19.43 11ZM12 19.43C8.52 19.11 5.89 16.48 5.57 13H2.5C2.79 17.87 7.13 21.21 12 21.5V19.43L12 19.43Z" fill="#5f6368"></path>
        <path d="M4.57 13H1.5C1.79 17.87 6.13 21.21 11 21.5V18.43C7.52 18.11 4.89 15.48 4.57 12L4.57 13Z" fill="#5f6368"></path>
        <path d="M11 2.5V5.57C7.52 5.89 4.89 8.52 4.57 12H1.5C1.79 7.13 6.13 3.79 11 3.5V2.5Z" fill="#5f6368"></path>
      </svg>
    `;

    // The rest of the function remains the same...
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
    mapRef.current.controls[window.google.maps.ControlPosition.TOP_RIGHT].push(controlButton);
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
        notifyOnArrival: autoAlertEnabledRef.current,
        origin: searchCenterRef.current,
        radiusOverride: getVisibleRadiusMeters(),
        withSpinner: true,
        filterByViewport: true,
      }).catch(err => {
        console.error('City change refresh failed', err);
        setStatusMessage('Unable to refresh cars for the selected city. Try again shortly.');
      });
    }
    if (autoAlertEnabledRef.current) {
      refreshAlertsWithUserLocation();
    }
  };

  const toggleAutoAlert = enabled => {
    setAutoAlertEnabled(enabled);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (enabled) {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        requestNotificationAccess();
      }
      setStatusMessage(`Live monitoring enabled. Checking every ${Math.round(pollIntervalMs / 1000)} seconds.`);
      refreshAlertsWithUserLocation();
      pollingRef.current = setInterval(() => {
        refreshAlertsWithUserLocation();
      }, pollIntervalMs);
    } else {
      setStatusMessage('Live monitoring paused.');
    }
  };

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
        <section className="controls">
          <div className="control-grid">
            <div>
              <label htmlFor="city-select">City</label>
              <select id="city-select" value={city} onChange={handleCityChange}>
                <option value="toronto">Toronto</option>
                <option value="montreal">Montreal</option>
              </select>
            </div>
            <div>
              <label htmlFor="location-search">Search location</label>
              <input id="location-search" type="search" placeholder="Search for an address or landmark" />
            </div>
          </div>

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
                    notifyOnArrival: autoAlertEnabledRef.current,
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
            <button
              className="button-secondary"
              onClick={requestNotificationAccess}
              disabled={notificationPermission === 'granted'}
            >
              {notificationLabel}
            </button>
          </div>

          <div className="refresh-controls">
            <label htmlFor="refresh-minutes">Auto refresh (minutes)</label>
            <input
              id="refresh-minutes"
              type="number"
              min="0.25"
              step="0.25"
              value={refreshMinutes}
              onChange={event => setRefreshMinutes(Number(event.target.value))}
            />
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={event => setAutoRefreshEnabled(event.target.checked)}
              />
              <span>Enabled</span>
            </label>
          </div>

          <p className="status-message" role="status">{statusMessage}</p>
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

        <section className="reminder">
          <h2>Radius alerts</h2>
          <div className="field">
            <label htmlFor="radius">Alert radius (km)</label>
            <input
              id="radius"
              type="number"
              min="0.1"
              step="0.1"
              value={radiusKm}
              onChange={event => setRadiusKm(Number(event.target.value))}
            />
          </div>
          <button className="button-primary" onClick={() => toggleAutoAlert(!autoAlertEnabled)}>
            {autoAlertEnabled ? 'Disable live monitoring' : 'Enable live monitoring'}
          </button>
          <p className="status-message">
            {autoAlertEnabled
              ? `Monitoring every ${Math.round(pollIntervalMs / 1000)} seconds for cars within ${radiusKm} km of your location.`
              : 'Activate live monitoring to receive notifications when cars enter your radius.'}
          </p>
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
