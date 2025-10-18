export const dynamic = 'force-dynamic';
export const revalidate = 0;

const branchIds = {
  montreal: 1,
  toronto: 2,
};

const earthRadiusKm = 6371;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const city = (searchParams.get('city') || 'toronto').toLowerCase();
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));
  const radiusParam = Number(searchParams.get('radius'));
  const radiusMeters = Number.isFinite(radiusParam) && radiusParam > 0 ? radiusParam : 1000;
  const plate = searchParams.get('plate');

  if (!branchIds[city]) {
    return Response.json({ error: `City ${city} not supported` }, { status: 400 });
  }

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return Response.json({ error: 'lat and lng query parameters are required' }, { status: 400 });
  }

  try {
    const cars = await getCars(branchIds[city], lat, lng, radiusMeters, plate);
    return Response.json({ cars });
  } catch (error) {
    console.error('Failed to fetch Communauto cars', error);
    return Response.json({ error: 'Failed to fetch cars from upstream service' }, { status: 502 });
  }
}

async function getCars(branchId, lat, lng, radiusMeters, plate) {
  const url = `https://www.reservauto.net/WCF/LSI/LSIBookingServiceV3.svc/GetAvailableVehicles?BranchID=${branchId}&LanguageID=2`;
  const response = await retry(() => fetch(url));
  if (!response.ok) {
    throw new Error(`Communauto returned status ${response.status}`);
  }
  const json = await response.json();
  const vehicles = json?.d?.Vehicles || [];
  const normalizedPlate = plate ? plate.trim().toLowerCase() : null;

  return vehicles
    .map(vehicle => {
      const distance = calculateDistance(lat, lng, vehicle.Latitude, vehicle.Longitude) * 1000;
      return {
        brand: vehicle.CarBrand,
        model: vehicle.CarModel,
        plate: vehicle.CarPlate,
        color: vehicle.CarColor,
        lat: vehicle.Latitude,
        lng: vehicle.Longitude,
        distance,
      };
    })
    .filter(car => car.distance <= radiusMeters + 1)
    .filter(car => {
      if (!normalizedPlate) return true;
      return car.plate.trim().toLowerCase() === normalizedPlate;
    });
}

function calculateDistance(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

async function retry(fn, attempts = 3, delayMs = 1000) {
  try {
    return await fn();
  } catch (error) {
    if (attempts <= 1) {
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return retry(fn, attempts - 1, delayMs);
  }
}
