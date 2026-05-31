const DEFAULT_CITY = 'Kolkata';
const RECENT_SEARCHES_KEY = 'oxygen-weather-recent-searches';

const state = {
    unit: 'metric',
    weather: null,
    recentSearches: loadRecentSearches(),
    lastRequest: {
        params: { city: DEFAULT_CITY },
        label: DEFAULT_CITY,
    },
};

const dom = {
    weatherForm: document.getElementById('weatherForm'),
    cityInput: document.getElementById('cityInput'),
    searchBtn: document.getElementById('searchBtn'),
    locationBtn: document.getElementById('locationBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    homeBtn: document.getElementById('homeBtn'),
    feedbackBtn: document.getElementById('feedbackBtn'),
    contactPanel: document.getElementById('contactPanel'),
    statusMessage: document.getElementById('statusMessage'),
    loading: document.getElementById('loading'),
    weatherDashboard: document.getElementById('weatherDashboard'),
    recentSearches: document.getElementById('recentSearches'),
    cityName: document.getElementById('cityName'),
    conditionText: document.getElementById('conditionText'),
    temperature: document.getElementById('temperature'),
    feelsLike: document.getElementById('feelsLike'),
    weatherIcon: document.getElementById('weatherIcon'),
    lastUpdated: document.getElementById('lastUpdated'),
    metricsGrid: document.getElementById('metricsGrid'),
    forecastSource: document.getElementById('forecastSource'),
    forecastGrid: document.getElementById('forecastGrid'),
    airSection: document.getElementById('airSection'),
    aqiValue: document.getElementById('aqiValue'),
    aqiLabel: document.getElementById('aqiLabel'),
    airComponents: document.getElementById('airComponents'),
    unitButtons: Array.from(document.querySelectorAll('.unit-button')),
};

document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    renderRecentSearches();
    renderIcons();
    loadWeather({ city: DEFAULT_CITY }, { label: DEFAULT_CITY, saveRecent: false });
});

function wireEvents() {
    dom.weatherForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const city = dom.cityInput.value.trim().replace(/\s+/g, ' ');
        if (!city) {
            showStatus('Please enter a city name.');
            return;
        }
        loadWeather({ city }, { label: city, saveRecent: true });
    });

    dom.locationBtn.addEventListener('click', () => {
        useCurrentLocation();
    });

    dom.refreshBtn.addEventListener('click', () => {
        loadWeather(state.lastRequest.params, {
            label: state.lastRequest.label,
            saveRecent: false,
        });
    });

    dom.homeBtn.addEventListener('click', () => {
        dom.cityInput.value = '';
        loadWeather({ city: DEFAULT_CITY }, { label: DEFAULT_CITY, saveRecent: false });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    dom.feedbackBtn.addEventListener('click', () => {
        const nextOpen = dom.contactPanel.hidden;
        dom.contactPanel.hidden = !nextOpen;
        dom.feedbackBtn.setAttribute('aria-expanded', String(nextOpen));
    });

    document.addEventListener('click', (event) => {
        if (
            !dom.contactPanel.hidden &&
            !dom.feedbackBtn.contains(event.target) &&
            !dom.contactPanel.contains(event.target)
        ) {
            dom.contactPanel.hidden = true;
            dom.feedbackBtn.setAttribute('aria-expanded', 'false');
        }
    });

    dom.unitButtons.forEach((button) => {
        button.addEventListener('click', () => {
            state.unit = button.dataset.unit;
            updateUnitButtons();
            if (state.weather) {
                renderWeather(state.weather);
            }
        });
    });
}

async function loadWeather(params, options = {}) {
    const query = new URLSearchParams(params);
    setBusy(true);
    hideStatus();

    try {
        const response = await fetch(`/weather?${query.toString()}`);
        const data = await response.json().catch(() => ({
            error: 'The server returned an unexpected response.',
        }));

        if (!response.ok) {
            throw new Error(data.error || 'Weather data could not be loaded.');
        }

        state.weather = data;
        state.lastRequest = {
            params,
            label: options.label || formatLocation(data.location),
        };

        renderWeather(data);

        if (options.saveRecent) {
            saveRecentSearch(formatLocation(data.location));
        }
    } catch (error) {
        showStatus(error.message || 'Weather data could not be loaded.');
    } finally {
        setBusy(false);
    }
}

function useCurrentLocation() {
    if (!navigator.geolocation) {
        showStatus('Location is not available in this browser.');
        return;
    }

    setBusy(true);
    showStatus('Waiting for location permission.', 'success');

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            loadWeather(
                {
                    lat: latitude.toFixed(4),
                    lon: longitude.toFixed(4),
                },
                {
                    label: 'Current location',
                    saveRecent: false,
                }
            );
        },
        () => {
            setBusy(false);
            showStatus('Location permission was not granted.');
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 10 * 60 * 1000,
        }
    );
}

function renderWeather(data) {
    const current = data.current;
    const locationLabel = formatLocation(data.location);
    const weatherIcon = getWeatherIconUrl(current.condition.icon);

    dom.weatherDashboard.hidden = false;
    dom.cityName.textContent = locationLabel;
    dom.conditionText.textContent = current.condition.description;
    dom.temperature.textContent = formatTemperature(current.temperature);
    dom.feelsLike.textContent = `Feels like ${formatTemperature(current.feelsLike)}`;
    dom.lastUpdated.textContent = getUpdatedLabel(data);
    dom.forecastSource.textContent = data.meta?.source || 'Weather provider';

    if (weatherIcon) {
        dom.weatherIcon.src = weatherIcon;
        dom.weatherIcon.alt = current.condition.description;
    }

    renderMetrics(data);
    renderForecast(data.forecast || []);
    renderAirQuality(data.airQuality);
    updateUnitButtons();
    renderIcons();
}

function renderMetrics(data) {
    const current = data.current;
    const offset = data.location.timezoneOffset || 0;
    const precipitation = Number(current.rainVolume || 0) + Number(current.snowVolume || 0);
    const forecastRainChance = data.forecast?.[0]?.precipitationProbability;

    const metrics = [
        {
            icon: 'thermometer',
            label: 'High / Low',
            value: `${formatTemperature(current.tempMax)} / ${formatTemperature(current.tempMin)}`,
            note: 'Current range',
        },
        {
            icon: 'droplets',
            label: 'Humidity',
            value: formatPercent(current.humidity),
            note: getHumidityLabel(current.humidity),
        },
        {
            icon: 'wind',
            label: 'Wind',
            value: formatWind(current.windSpeed),
            note: formatWindDirection(current.windDirection),
        },
        {
            icon: 'gauge',
            label: 'Pressure',
            value: formatPressure(current.pressure),
            note: getPressureLabel(current.pressure),
        },
        {
            icon: 'eye',
            label: 'Visibility',
            value: formatVisibility(current.visibility),
            note: 'Reported distance',
        },
        {
            icon: 'cloud-rain',
            label: 'Rain Chance',
            value: formatPercent(forecastRainChance),
            note: `${formatVolume(precipitation)} observed`,
        },
        {
            icon: 'sunrise',
            label: 'Sunrise',
            value: formatLocalTime(current.sunrise, offset),
            note: 'Local time',
        },
        {
            icon: 'sunset',
            label: 'Sunset',
            value: formatLocalTime(current.sunset, offset),
            note: 'Local time',
        },
        {
            icon: 'cloud',
            label: 'Cloud Cover',
            value: formatPercent(current.clouds),
            note: current.condition.main,
        },
    ];

    dom.metricsGrid.innerHTML = metrics
        .map((metric) => {
            return `
                <article class="metric-card">
                    <div class="metric-label">
                        <span>${escapeHtml(metric.label)}</span>
                        <i data-lucide="${escapeHtml(metric.icon)}" aria-hidden="true"></i>
                    </div>
                    <div>
                        <div class="metric-value">${escapeHtml(metric.value)}</div>
                        <div class="metric-note">${escapeHtml(metric.note)}</div>
                    </div>
                </article>
            `;
        })
        .join('');
}

function renderForecast(forecast) {
    dom.forecastGrid.innerHTML = forecast
        .map((day) => {
            const iconUrl = getWeatherIconUrl(day.condition.icon);
            return `
                <article class="forecast-card">
                    <div>
                        <div class="forecast-day">${escapeHtml(formatForecastDate(day.date))}</div>
                        ${iconUrl ? `<img src="${iconUrl}" alt="${escapeHtml(day.condition.description)}">` : ''}
                        <p class="forecast-description">${escapeHtml(day.condition.description)}</p>
                    </div>
                    <div>
                        <div class="forecast-temps">
                            <span class="forecast-high">${escapeHtml(formatTemperature(day.tempMax))}</span>
                            <span class="forecast-low">${escapeHtml(formatTemperature(day.tempMin))}</span>
                        </div>
                        <p class="forecast-pop">${escapeHtml(formatPercent(day.precipitationProbability))} rain chance</p>
                    </div>
                </article>
            `;
        })
        .join('');
}

function renderAirQuality(airQuality) {
    if (!airQuality) {
        dom.airSection.hidden = true;
        return;
    }

    dom.airSection.hidden = false;
    dom.aqiValue.textContent = `${airQuality.aqi}/5`;
    dom.aqiLabel.textContent = airQuality.label;

    const components = [
        ['PM2.5', airQuality.components.pm2_5],
        ['PM10', airQuality.components.pm10],
        ['O3', airQuality.components.o3],
        ['NO2', airQuality.components.no2],
        ['CO', airQuality.components.co],
    ];

    dom.airComponents.innerHTML = components
        .map(([label, value]) => {
            return `
                <div class="air-chip">
                    <span>${escapeHtml(label)}</span>
                    <span>${escapeHtml(formatAirComponent(value))}</span>
                </div>
            `;
        })
        .join('');
}

function renderRecentSearches() {
    if (!state.recentSearches.length) {
        dom.recentSearches.hidden = true;
        dom.recentSearches.innerHTML = '';
        return;
    }

    dom.recentSearches.hidden = false;
    dom.recentSearches.innerHTML = state.recentSearches
        .map((city) => {
            return `<button class="recent-chip" type="button" data-city="${escapeHtml(city)}">${escapeHtml(city)}</button>`;
        })
        .join('');

    Array.from(dom.recentSearches.querySelectorAll('.recent-chip')).forEach((button) => {
        button.addEventListener('click', () => {
            const city = button.dataset.city;
            dom.cityInput.value = city;
            loadWeather({ city }, { label: city, saveRecent: true });
        });
    });
}

function saveRecentSearch(city) {
    const cleaned = city.trim().replace(/\s+/g, ' ');
    if (!cleaned) return;

    state.recentSearches = [
        cleaned,
        ...state.recentSearches.filter(
            (item) => item.toLowerCase() !== cleaned.toLowerCase()
        ),
    ].slice(0, 5);

    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(state.recentSearches));
    renderRecentSearches();
}

function loadRecentSearches() {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === 'string').slice(0, 5)
            : [];
    } catch {
        return [];
    }
}

function setBusy(isBusy) {
    dom.loading.hidden = !isBusy;
    dom.weatherForm.classList.toggle('is-busy', isBusy);
    [dom.searchBtn, dom.locationBtn, dom.refreshBtn].forEach((button) => {
        button.disabled = isBusy;
    });
}

function showStatus(message, tone = 'error') {
    dom.statusMessage.textContent = message;
    dom.statusMessage.classList.toggle('is-success', tone === 'success');
    dom.statusMessage.hidden = false;
}

function hideStatus() {
    dom.statusMessage.hidden = true;
    dom.statusMessage.textContent = '';
    dom.statusMessage.classList.remove('is-success');
}

function updateUnitButtons() {
    dom.unitButtons.forEach((button) => {
        button.classList.toggle('is-active', button.dataset.unit === state.unit);
    });
}

function getUpdatedLabel(data) {
    const observed = formatLocalTime(
        data.current.observedAt,
        data.location.timezoneOffset || 0
    );
    const cacheLabel = data.meta?.fromCache ? 'Cached' : 'Observed';
    return `${cacheLabel} ${observed} local`;
}

function formatLocation(location) {
    return [location.name, location.state, location.country].filter(Boolean).join(', ');
}

function formatTemperature(value) {
    if (!Number.isFinite(value)) return '--';
    const temperature =
        state.unit === 'imperial' ? value * (9 / 5) + 32 : value;
    const unit = state.unit === 'imperial' ? 'F' : 'C';
    return `${Math.round(temperature)}\u00b0${unit}`;
}

function formatWind(value) {
    if (!Number.isFinite(value)) return '--';
    if (state.unit === 'imperial') {
        return `${Math.round(value * 2.23694)} mph`;
    }
    return `${Math.round(value * 3.6)} km/h`;
}

function formatVisibility(value) {
    if (!Number.isFinite(value)) return '--';
    if (state.unit === 'imperial') {
        return `${(value / 1609.344).toFixed(1)} mi`;
    }
    const kilometers = value / 1000;
    return `${kilometers >= 10 ? Math.round(kilometers) : kilometers.toFixed(1)} km`;
}

function formatVolume(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return state.unit === 'imperial' ? '0 in' : '0 mm';
    }
    if (state.unit === 'imperial') {
        return `${(value / 25.4).toFixed(2)} in`;
    }
    return `${value.toFixed(1)} mm`;
}

function formatPressure(value) {
    if (!Number.isFinite(value)) return '--';
    return `${value} hPa`;
}

function formatPercent(value) {
    if (!Number.isFinite(value)) return '--';
    return `${Math.round(value)}%`;
}

function formatAirComponent(value) {
    if (!Number.isFinite(value)) return '--';
    return `${value} ug/m3`;
}

function formatWindDirection(degrees) {
    if (!Number.isFinite(degrees)) return 'Direction unavailable';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % directions.length;
    return `${directions[index]} ${Math.round(degrees)} deg`;
}

function formatLocalTime(timestampSeconds, timezoneOffset) {
    if (!Number.isFinite(timestampSeconds)) return '--';
    const localDate = new Date((timestampSeconds + timezoneOffset) * 1000);
    return new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
    }).format(localDate);
}

function formatForecastDate(dateKey) {
    const date = new Date(`${dateKey}T12:00:00Z`);
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    }).format(date);
}

function getHumidityLabel(value) {
    if (!Number.isFinite(value)) return 'Unavailable';
    if (value < 35) return 'Dry air';
    if (value <= 65) return 'Comfort range';
    return 'Very humid';
}

function getPressureLabel(value) {
    if (!Number.isFinite(value)) return 'Unavailable';
    if (value < 1000) return 'Low pressure';
    if (value > 1020) return 'High pressure';
    return 'Stable pressure';
}

function getWeatherIconUrl(code) {
    if (!code) return '';
    return `https://openweathermap.org/img/wn/${encodeURIComponent(code)}@2x.png`;
}

function renderIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
