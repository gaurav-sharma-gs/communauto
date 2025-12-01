'use client';

function formatDistance(meters) {
    if (meters === undefined || meters === null) return '';
    if (meters < 1000) return `${Math.round(meters)}m`;
    return `${(meters / 1000).toFixed(1)}km`;
}

export default function CarList({ cars, selectedCarId, onCarClick }) {
    if (cars.length === 0) {
        return (
            <div className="car-list-empty">
                <p>No cars found in this area.</p>
                <p className="hint">Try moving the map or increasing the search radius.</p>
            </div>
        );
    }

    return (
        <ul className="car-list">
            {cars.map(car => {
                const key = `${car.plate}-${car.lat.toFixed(5)}-${car.lng.toFixed(5)}`;
                const isSelected = selectedCarId === key;

                return (
                    <li
                        key={key}
                        onClick={() => onCarClick(car)}
                        className={`car-item ${isSelected ? 'selected' : ''}`}
                    >
                        <div className="car-info">
                            <h3>{car.brand} {car.model}</h3>
                            <p className="plate">{car.plate}</p>
                        </div>
                        <div className="car-meta">
                            <span className="distance-badge">
                                {formatDistance(car.distanceFromUser ?? car.distance)}
                            </span>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
