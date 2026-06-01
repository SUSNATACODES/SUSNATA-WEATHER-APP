const DEFAULT_CITY = 'Jalpaiguri';
const RECENT_SEARCHES_KEY = 'oxygen-weather-recent-searches';
const LOGIN_EMAIL_KEY = 'oxygen-weather-login-email';
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const PARTICLE_COUNT = 28;

const state = {
    unit: 'metric',
    weather: null,
    recentSearches: loadRecentSearches(),
    loginEmail: localStorage.getItem(LOGIN_EMAIL_KEY) || '',
    clockTimer: null,
    autoRefreshTimer: null,
    countdownTimer: null,
    nextRefreshAt: 0,
    selectedHourlyIndex: 0,
    didBoot: false,
    lastRequest: {
        params: { city: DEFAULT_CITY },
        label: DEFAULT_CITY,
    },
    mailLocation: null,
};

const dom = {
    weatherForm: document.getElementById('weatherForm'),
    cityInput: document.getElementById('cityInput'),
    searchBtn: document.getElementById('searchBtn'),
    locationBtn: document.getElementById('locationBtn'),
    loginOpenBtn: document.getElementById('loginOpenBtn'),
    loginBackdrop: document.getElementById('loginBackdrop'),
    loginPanel: document.getElementById('loginPanel'),
    loginForm: document.getElementById('loginForm'),
    loginEmail: document.getElementById('loginEmail'),
    loginCloseBtn: document.getElementById('loginCloseBtn'),
    loginStatus: document.getElementById('loginStatus'),
    refreshBtn: document.getElementById('refreshBtn'),
    homeBtn: document.getElementById('homeBtn'),
    feedbackBtn: document.getElementById('feedbackBtn'),
    contactPanel: document.getElementById('contactPanel'),
    weatherEffects: document.querySelector('.weather-effects'),
    statusMessage: document.getElementById('statusMessage'),
    loading: document.getElementById('loading'),
    mailAlertsPanel: document.getElementById('mailAlertsPanel'),
    mailAlertsForm: document.getElementById('mailAlertsForm'),
    alertEmail: document.getElementById('alertEmail'),
    alertCity: document.getElementById('alertCity'),
    useCurrentWeatherForMail: document.getElementById('useCurrentWeatherForMail'),
    mailAlertsSubmit: document.getElementById('mailAlertsSubmit'),
    mailAlertsStatus: document.getElementById('mailAlertsStatus'),
    earthquakeOverlay: document.getElementById('earthquakeOverlay'),
    earthquakeFrame: document.getElementById('earthquakeFrame'),
    earthquakeCloseBtn: document.getElementById('earthquakeCloseBtn'),
    headerLocalTime: document.getElementById('headerLocalTime'),
    headerWeatherMood: document.getElementById('headerWeatherMood'),
    weatherDashboard: document.getElementById('weatherDashboard'),
    recentSearches: document.getElementById('recentSearches'),
    cityName: document.getElementById('cityName'),
    conditionText: document.getElementById('conditionText'),
    temperature: document.getElementById('temperature'),
    feelsLike: document.getElementById('feelsLike'),
    weatherIcon: document.getElementById('weatherIcon'),
    lastUpdated: document.getElementById('lastUpdated'),
    localClock: document.getElementById('localClock'),
    weatherEnergy: document.getElementById('weatherEnergy'),
    insightsGrid: document.getElementById('insightsGrid'),
    metricsGrid: document.getElementById('metricsGrid'),
    hourlySection: document.getElementById('hourlySection'),
    hourlyGrid: document.getElementById('hourlyGrid'),
    hourlySignal: document.getElementById('hourlySignal'),
    smartBriefPanel: null,
    smartBriefGrid: null,
    autoRefreshLabel: null,
    hourlyDetail: null,
    particlesLayer: null,
    forecastSource: document.getElementById('forecastSource'),
    forecastGrid: document.getElementById('forecastGrid'),
    airSection: document.getElementById('airSection'),
    aqiValue: document.getElementById('aqiValue'),
    aqiLabel: document.getElementById('aqiLabel'),
    airComponents: document.getElementById('airComponents'),
    unitButtons: Array.from(document.querySelectorAll('.unit-button')),
    menuActionButtons: Array.from(document.querySelectorAll('[data-menu-action]')),
};

function bootApp() {
    if (state.didBoot) return;
    state.didBoot = true;
    ensureDynamicPanels();
    wireEvents();
    renderRecentSearches();
    renderIcons();
    initializeWeather();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp, { once: true });
} else {
    bootApp();
}

async function initializeWeather() {
    const detectedLocation = await tryAutoLocationWeather();

    if (!detectedLocation) {
        loadWeather({ city: DEFAULT_CITY }, { label: DEFAULT_CITY, saveRecent: false });
    }
}

function wireEvents() {
    if (state.loginEmail) {
        dom.loginEmail.value = state.loginEmail;
        dom.alertEmail.value = state.loginEmail;
    }

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

    dom.loginOpenBtn.addEventListener('click', () => {
        openLoginPanel();
    });

    dom.loginCloseBtn.addEventListener('click', () => {
        closeLoginPanel();
    });

    dom.loginBackdrop.addEventListener('click', () => {
        closeLoginPanel();
    });

    dom.loginForm.addEventListener('submit', (event) => {
        event.preventDefault();
        saveLoginEmail();
    });

    dom.mailAlertsForm.addEventListener('submit', (event) => {
        event.preventDefault();
        subscribeMailAlerts();
    });

    dom.useCurrentWeatherForMail.addEventListener('click', () => {
        fillMailLocationFromCurrentWeather();
    });

    dom.alertCity.addEventListener('input', () => {
        state.mailLocation = null;
    });

    dom.earthquakeCloseBtn.addEventListener('click', () => {
        closeEarthquakeMonitor();
    });

    dom.refreshBtn.addEventListener('click', () => {
        refreshWeather();
    });

    dom.homeBtn.addEventListener('click', () => {
        goHome();
    });

    dom.feedbackBtn.addEventListener('click', () => {
        const nextOpen = dom.contactPanel.hidden;
        dom.contactPanel.hidden = !nextOpen;
        dom.feedbackBtn.setAttribute('aria-expanded', String(nextOpen));
        dom.feedbackBtn.classList.toggle('is-open', nextOpen);
    });

    document.addEventListener('click', (event) => {
        if (
            !dom.contactPanel.hidden &&
            !dom.feedbackBtn.contains(event.target) &&
            !dom.contactPanel.contains(event.target)
        ) {
            closeMenu();
        }
    });

    dom.menuActionButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.dataset.menuAction;
            closeMenu();

            if (action === 'home') {
                goHome();
            }

            if (action === 'location') {
                useCurrentLocation();
            }

            if (action === 'refresh') {
                refreshWeather();
            }

            if (action === 'login') {
                openLoginPanel();
            }

            if (action === 'mail') {
                focusMailAlerts();
            }

            if (action === 'earthquake') {
                openEarthquakeMonitor();
            }
        });
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

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !dom.loginPanel.hidden) {
            closeLoginPanel();
            return;
        }

        if (event.key === 'Escape' && !dom.earthquakeOverlay.hidden) {
            closeEarthquakeMonitor();
        }

        if (event.key === '/' && !isTypingTarget(event.target)) {
            event.preventDefault();
            dom.cityInput.focus();
        }

        if (event.key.toLowerCase() === 'r' && !isTypingTarget(event.target)) {
            refreshWeather();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state.nextRefreshAt && Date.now() >= state.nextRefreshAt) {
            refreshWeather();
        }
    });
}

function ensureDynamicPanels() {
    if (!dom.smartBriefPanel) {
        const panel = document.createElement('section');
        panel.className = 'smart-brief-panel';
        panel.id = 'smartBriefPanel';
        panel.hidden = true;
        panel.innerHTML = `
            <div class="section-heading">
                <div>
                    <p class="eyebrow">Live Intelligence</p>
                    <h2>Weather Command Feed</h2>
                </div>
                <span id="autoRefreshLabel">Auto refresh ready</span>
            </div>
            <div class="smart-brief-grid" id="smartBriefGrid"></div>
        `;
        dom.mailAlertsPanel.before(panel);
        dom.smartBriefPanel = panel;
        dom.smartBriefGrid = panel.querySelector('#smartBriefGrid');
        dom.autoRefreshLabel = panel.querySelector('#autoRefreshLabel');
    }

    if (!dom.hourlyDetail) {
        const detail = document.createElement('div');
        detail.className = 'hourly-detail';
        detail.id = 'hourlyDetail';
        detail.hidden = true;
        dom.hourlySection.append(detail);
        dom.hourlyDetail = detail;
    }

    if (!dom.particlesLayer && dom.weatherEffects) {
        const particlesLayer = document.createElement('div');
        particlesLayer.className = 'js-weather-particles';
        particlesLayer.setAttribute('aria-hidden', 'true');
        dom.weatherEffects.append(particlesLayer);
        dom.particlesLayer = particlesLayer;
    }
}

function isTypingTarget(target) {
    const tagName = target?.tagName?.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;
}

function goHome() {
    dom.cityInput.value = '';
    loadWeather({ city: DEFAULT_CITY }, { label: DEFAULT_CITY, saveRecent: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function refreshWeather() {
    loadWeather(state.lastRequest.params, {
        label: state.lastRequest.label,
        saveRecent: false,
    });
}

function closeMenu() {
    dom.contactPanel.hidden = true;
    dom.feedbackBtn.setAttribute('aria-expanded', 'false');
    dom.feedbackBtn.classList.remove('is-open');
}

function openLoginPanel() {
    dom.loginBackdrop.hidden = false;
    dom.loginPanel.hidden = false;
    dom.loginPanel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-login-panel');

    window.requestAnimationFrame(() => {
        dom.loginPanel.classList.add('is-open');
        dom.loginBackdrop.classList.add('is-open');
    });

    window.setTimeout(() => {
        dom.loginEmail.focus({ preventScroll: true });
    }, 220);
}

function closeLoginPanel() {
    dom.loginPanel.classList.remove('is-open');
    dom.loginBackdrop.classList.remove('is-open');
    document.body.classList.remove('has-login-panel');
    dom.loginPanel.setAttribute('aria-hidden', 'true');

    window.setTimeout(() => {
        if (!dom.loginPanel.classList.contains('is-open')) {
            dom.loginPanel.hidden = true;
            dom.loginBackdrop.hidden = true;
        }
    }, 220);

    dom.loginOpenBtn.focus({ preventScroll: true });
}

function saveLoginEmail() {
    const email = dom.loginEmail.value.trim().toLowerCase();

    if (!email || !dom.loginEmail.checkValidity()) {
        showLoginStatus('Enter a valid email address.');
        dom.loginEmail.focus();
        return;
    }

    state.loginEmail = email;
    localStorage.setItem(LOGIN_EMAIL_KEY, email);
    dom.alertEmail.value = email;
    showLoginStatus('Login saved. Gmail alert email is ready.');

    window.setTimeout(() => {
        closeLoginPanel();
    }, 900);
}

function showLoginStatus(message) {
    dom.loginStatus.textContent = message;
    dom.loginStatus.hidden = false;
}

function openEarthquakeMonitor() {
    if (!dom.earthquakeFrame.src) {
        dom.earthquakeFrame.src = dom.earthquakeFrame.dataset.src;
    }

    dom.earthquakeOverlay.hidden = false;
    dom.earthquakeOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-earthquake-overlay');
    dom.earthquakeCloseBtn.focus({ preventScroll: true });
}

function closeEarthquakeMonitor() {
    dom.earthquakeOverlay.hidden = true;
    dom.earthquakeOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('has-earthquake-overlay');
    dom.feedbackBtn.focus({ preventScroll: true });
}

function focusMailAlerts() {
    dom.mailAlertsPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
        dom.alertEmail.focus({ preventScroll: true });
    }, 320);
}

function fillMailLocationFromCurrentWeather() {
    if (!state.weather) {
        showMailAlertsStatus('Load weather first, then choose the alert location.', 'error');
        return;
    }

    const locationLabel = formatLocation(state.weather.location);
    state.mailLocation = {
        label: locationLabel,
        params: {
            ...state.lastRequest.params,
        },
    };
    dom.alertCity.value = locationLabel;
    showMailAlertsStatus(`Mail location set to ${locationLabel}.`, 'success');
}

async function subscribeMailAlerts() {
    const email = dom.alertEmail.value.trim();
    const locationRequest = getMailAlertLocationRequest();

    if (!email || !dom.alertEmail.checkValidity()) {
        showMailAlertsStatus('Enter a valid email address.', 'error');
        dom.alertEmail.focus();
        return;
    }

    setMailAlertsBusy(true);
    showMailAlertsStatus('Saving mail alerts.', 'info');

    try {
        const response = await fetch('/mail-alerts/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email,
                ...locationRequest.params,
            }),
        });
        const data = await response.json().catch(() => ({
            error: 'The server returned an unexpected mail response.',
        }));

        if (!response.ok) {
            throw new Error(data.error || 'Mail alerts could not be enabled.');
        }

        const tone = data.mailConfigured ? 'success' : 'info';
        showMailAlertsStatus(data.message || `Mail alerts enabled for ${locationRequest.label}.`, tone);
    } catch (error) {
        showMailAlertsStatus(error.message || 'Mail alerts could not be enabled.', 'error');
    } finally {
        setMailAlertsBusy(false);
    }
}

function getMailAlertLocationRequest() {
    const city = dom.alertCity.value.trim().replace(/\s+/g, ' ');

    if (
        state.mailLocation &&
        city &&
        city.toLowerCase() === state.mailLocation.label.toLowerCase()
    ) {
        return {
            label: state.mailLocation.label,
            params: state.mailLocation.params,
        };
    }

    if (city) {
        return {
            label: city,
            params: { city },
        };
    }

    if (state.weather?.location?.coordinates) {
        const coordinates = state.weather.location.coordinates;
        return {
            label: formatLocation(state.weather.location),
            params: {
                lat: coordinates.lat,
                lon: coordinates.lon,
            },
        };
    }

    return {
        label: DEFAULT_CITY,
        params: { city: DEFAULT_CITY },
    };
}

function setMailAlertsBusy(isBusy) {
    dom.mailAlertsForm.classList.toggle('is-busy', isBusy);
    [dom.alertEmail, dom.alertCity, dom.useCurrentWeatherForMail, dom.mailAlertsSubmit].forEach((element) => {
        element.disabled = isBusy;
    });
}

function showMailAlertsStatus(message, tone = 'info') {
    dom.mailAlertsStatus.textContent = message;
    dom.mailAlertsStatus.classList.toggle('is-success', tone === 'success');
    dom.mailAlertsStatus.classList.toggle('is-error', tone === 'error');
    dom.mailAlertsStatus.classList.toggle('is-info', tone === 'info');
    dom.mailAlertsStatus.hidden = false;
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

        if (options.successMessage) {
            showTemporaryStatus(options.successMessage, 'success');
        }

        return true;
    } catch (error) {
        showStatus(error.message || 'Weather data could not be loaded.');
        return false;
    } finally {
        setBusy(false);
    }
}

async function tryAutoLocationWeather() {
    if (!navigator.geolocation) {
        return false;
    }

    const permissionState = await getLocationPermissionState();
    if (permissionState !== 'granted') {
        return false;
    }

    setBusy(true);
    showStatus('Detecting your location automatically.', 'success');

    try {
        const position = await getBrowserPosition({
            enableHighAccuracy: true,
            timeout: 8000,
            maximumAge: 10 * 60 * 1000,
        });

        return await loadWeather(getPositionParams(position), {
            label: 'Current location',
            saveRecent: false,
            successMessage: 'Showing weather for your current location.',
        });
    } catch {
        hideStatus();
        return false;
    } finally {
        setBusy(false);
    }
}

async function useCurrentLocation() {
    if (!navigator.geolocation) {
        showStatus('Location is not available in this browser.');
        return;
    }

    setBusy(true);
    showStatus('Waiting for location permission.', 'success');

    try {
        const position = await getBrowserPosition({
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 10 * 60 * 1000,
        });

        await loadWeather(getPositionParams(position), {
            label: 'Current location',
            saveRecent: false,
            successMessage: 'Showing weather for your current location.',
        });
    } catch (error) {
        setBusy(false);
        showStatus(getLocationErrorMessage(error));
    }
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
    if (!dom.alertCity.value.trim()) {
        dom.alertCity.placeholder = `Alert city (${locationLabel})`;
    }
    updateWeatherAtmosphere(data);
    startLocalClock(data.location.timezoneOffset || 0);
    startAutoRefreshCountdown();
    updateBrowserTitle(data);

    if (weatherIcon) {
        dom.weatherIcon.src = weatherIcon;
        dom.weatherIcon.alt = current.condition.description;
    }

    renderSmartBrief(data);
    renderSmartInsights(data);
    renderMetrics(data);
    renderHourly(data.hourly || [], data.location.timezoneOffset || 0);
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

function renderSmartBrief(data) {
    const items = buildCommandFeed(data);

    if (!items.length) {
        dom.smartBriefPanel.hidden = true;
        dom.smartBriefGrid.innerHTML = '';
        return;
    }

    dom.smartBriefPanel.hidden = false;
    dom.smartBriefGrid.innerHTML = items
        .map((item) => {
            return `
                <article class="smart-brief-card is-${escapeHtml(item.tone)}">
                    <div class="smart-brief-icon"><i data-lucide="${escapeHtml(item.icon)}" aria-hidden="true"></i></div>
                    <div>
                        <span>${escapeHtml(item.label)}</span>
                        <strong>${escapeHtml(item.value)}</strong>
                        <p>${escapeHtml(item.note)}</p>
                    </div>
                </article>
            `;
        })
        .join('');
}

function buildCommandFeed(data) {
    const current = data.current;
    const forecast = data.forecast || [];
    const today = forecast[0] || {};
    const rainChance = Number(today.precipitationProbability || 0);
    const windSpeed = Number(current.windSpeed || 0);
    const humidity = Number(current.humidity || 0);
    const visibilityKm = Number.isFinite(current.visibility) ? current.visibility / 1000 : null;
    const comfortScore = getComfortScore(current, data.airQuality);
    const condition = String(current.condition?.main || '').toLowerCase();
    const trend = getForecastTrend(forecast);
    const alert = getPrimaryWeatherAlert({ condition, rainChance, windSpeed, visibilityKm, airQuality: data.airQuality });

    return [
        {
            icon: alert.icon,
            label: 'Emergency Scan',
            value: alert.value,
            note: alert.note,
            tone: alert.tone,
        },
        {
            icon: 'route',
            label: 'Best Action',
            value: getBestActionLabel({ rainChance, windSpeed, humidity, comfortScore }),
            note: getBestActionNote({ rainChance, windSpeed, humidity, comfortScore }),
            tone: rainChance >= 65 || windSpeed >= 10 ? 'watch' : 'good',
        },
        {
            icon: trend.icon,
            label: 'Forecast Trend',
            value: trend.value,
            note: trend.note,
            tone: trend.tone,
        },
        {
            icon: 'refresh-cw',
            label: 'Live Refresh',
            value: 'Auto sync',
            note: dom.autoRefreshLabel?.textContent || 'Refresh timer starting',
            tone: 'good',
        },
    ];
}

function getPrimaryWeatherAlert({ condition, rainChance, windSpeed, visibilityKm, airQuality }) {
    if (condition.includes('thunder')) {
        return {
            icon: 'cloud-lightning',
            value: 'Storm watch',
            note: 'Stay indoors and avoid open areas if lightning starts.',
            tone: 'alert',
        };
    }

    if (rainChance >= 80) {
        return {
            icon: 'cloud-rain',
            value: 'Heavy rain risk',
            note: 'Roads may get wet fast. Keep umbrella and backup travel time.',
            tone: 'alert',
        };
    }

    if (windSpeed >= 13.9) {
        return {
            icon: 'wind',
            value: 'Strong wind',
            note: 'Secure loose items and be careful near trees or open roads.',
            tone: 'alert',
        };
    }

    if (airQuality?.aqi >= 4) {
        return {
            icon: 'shield-alert',
            value: 'Air caution',
            note: 'Limit long outdoor exposure if breathing feels uncomfortable.',
            tone: 'watch',
        };
    }

    if (visibilityKm !== null && visibilityKm < 2) {
        return {
            icon: 'eye-off',
            value: 'Low visibility',
            note: 'Move slower outside and use lights during travel.',
            tone: 'watch',
        };
    }

    return {
        icon: 'shield-check',
        value: 'No major alert',
        note: 'Weather looks manageable from the latest live scan.',
        tone: 'good',
    };
}

function getBestActionLabel({ rainChance, windSpeed, humidity, comfortScore }) {
    if (rainChance >= 70) return 'Umbrella mode';
    if (windSpeed >= 10) return 'Wind ready';
    if (humidity >= 82) return 'Hydrate more';
    if (comfortScore >= 80) return 'Outdoor window';
    return 'Stay aware';
}

function getBestActionNote({ rainChance, windSpeed, humidity, comfortScore }) {
    if (rainChance >= 70) return 'Rain signal is high, so keep rain protection close.';
    if (windSpeed >= 10) return 'Wind is moving quickly. Travel light and secure things.';
    if (humidity >= 82) return 'Humidity is heavy. Drink water and avoid overexertion.';
    if (comfortScore >= 80) return 'Conditions are comfortable for short outdoor plans.';
    return 'Conditions are okay, but keep checking live updates.';
}

function getForecastTrend(forecast) {
    if (forecast.length < 2) {
        return {
            icon: 'activity',
            value: 'Collecting',
            note: 'More forecast slots needed for a trend.',
            tone: 'watch',
        };
    }

    const first = Number(forecast[0].tempMax);
    const last = Number(forecast[Math.min(forecast.length - 1, 4)].tempMax);
    const rainAverage = forecast.reduce((sum, day) => sum + Number(day.precipitationProbability || 0), 0) / forecast.length;

    if (Number.isFinite(first) && Number.isFinite(last) && last - first >= 2) {
        return {
            icon: 'trending-up',
            value: 'Warming up',
            note: `About ${Math.round(last - first)} degrees warmer across the outlook.`,
            tone: 'watch',
        };
    }

    if (Number.isFinite(first) && Number.isFinite(last) && first - last >= 2) {
        return {
            icon: 'trending-down',
            value: 'Cooling down',
            note: `About ${Math.round(first - last)} degrees cooler ahead.`,
            tone: 'good',
        };
    }

    if (rainAverage >= 60) {
        return {
            icon: 'cloud-rain',
            value: 'Wet pattern',
            note: `${formatPercent(rainAverage)} average rain chance in the outlook.`,
            tone: 'watch',
        };
    }

    return {
        icon: 'waves',
        value: 'Steady pattern',
        note: 'No sharp temperature swing detected in the outlook.',
        tone: 'good',
    };
}

function renderSmartInsights(data) {
    const current = data.current;
    const today = data.forecast?.[0] || {};
    const airQuality = data.airQuality;
    const comfortScore = getComfortScore(current, airQuality);
    const rainChance = Number(today.precipitationProbability || 0);
    const windKmh = Number.isFinite(current.windSpeed) ? Math.round(current.windSpeed * 3.6) : null;
    const visibilityKm = Number.isFinite(current.visibility) ? current.visibility / 1000 : null;
    const insights = [
        {
            icon: 'activity',
            label: 'Comfort Index',
            value: `${comfortScore}/100`,
            note: getComfortLabel(comfortScore),
            tone: comfortScore >= 75 ? 'good' : comfortScore >= 50 ? 'watch' : 'alert',
        },
        {
            icon: 'cloud-rain',
            label: 'Rain Signal',
            value: formatPercent(rainChance),
            note: getRainSignal(rainChance, today.rainVolume),
            tone: rainChance >= 75 ? 'alert' : rainChance >= 45 ? 'watch' : 'good',
        },
        {
            icon: 'wind',
            label: 'Wind Flow',
            value: windKmh === null ? '--' : `${windKmh} km/h`,
            note: getWindSignal(current.windSpeed),
            tone: Number(current.windSpeed || 0) >= 10 ? 'watch' : 'good',
        },
        {
            icon: airQuality?.aqi >= 4 ? 'shield-alert' : 'sparkles',
            label: 'Air & View',
            value: airQuality ? airQuality.label : formatVisibility(current.visibility),
            note: visibilityKm !== null ? `${visibilityKm.toFixed(visibilityKm >= 10 ? 0 : 1)} km visibility` : 'Visibility unavailable',
            tone: airQuality?.aqi >= 4 || (visibilityKm !== null && visibilityKm < 2) ? 'alert' : 'good',
        },
    ];

    dom.insightsGrid.innerHTML = insights
        .map((insight) => {
            return `
                <article class="insight-card is-${escapeHtml(insight.tone)}">
                    <div class="insight-icon"><i data-lucide="${escapeHtml(insight.icon)}" aria-hidden="true"></i></div>
                    <div>
                        <span>${escapeHtml(insight.label)}</span>
                        <strong>${escapeHtml(insight.value)}</strong>
                        <p>${escapeHtml(insight.note)}</p>
                    </div>
                </article>
            `;
        })
        .join('');
}

function renderHourly(hourly, timezoneOffset) {
    if (!hourly.length) {
        dom.hourlySection.hidden = true;
        dom.hourlyGrid.innerHTML = '';
        dom.hourlyDetail.hidden = true;
        return;
    }

    dom.hourlySection.hidden = false;
    state.selectedHourlyIndex = Math.min(state.selectedHourlyIndex, hourly.length - 1);
    dom.hourlySignal.textContent = `${hourly.length} live slots`;
    dom.hourlyGrid.innerHTML = hourly
        .map((slot, index) => {
            const iconUrl = getWeatherIconUrl(slot.condition.icon);
            return `
                <button class="hourly-card${index === state.selectedHourlyIndex ? ' is-selected' : ''}" type="button" data-hourly-index="${index}" aria-pressed="${index === state.selectedHourlyIndex}" style="--delay:${index * 70}ms">
                    <span>${escapeHtml(formatLocalTime(slot.timestamp, timezoneOffset))}</span>
                    ${iconUrl ? `<img src="${iconUrl}" alt="${escapeHtml(slot.condition.description)}">` : ''}
                    <strong>${escapeHtml(formatTemperature(slot.temperature))}</strong>
                    <p>${escapeHtml(formatPercent(slot.precipitationProbability))} rain</p>
                </button>
            `;
        })
        .join('');

    Array.from(dom.hourlyGrid.querySelectorAll('.hourly-card')).forEach((button) => {
        button.addEventListener('click', () => {
            const index = Number(button.dataset.hourlyIndex);
            if (!Number.isInteger(index)) return;
            state.selectedHourlyIndex = index;
            renderHourlyDetail(hourly[index], timezoneOffset);
            updateHourlySelection();
        });
    });

    renderHourlyDetail(hourly[state.selectedHourlyIndex], timezoneOffset);
}

function updateHourlySelection() {
    Array.from(dom.hourlyGrid.querySelectorAll('.hourly-card')).forEach((button) => {
        const isSelected = Number(button.dataset.hourlyIndex) === state.selectedHourlyIndex;
        button.classList.toggle('is-selected', isSelected);
        button.setAttribute('aria-pressed', String(isSelected));
    });
}

function renderHourlyDetail(slot, timezoneOffset) {
    if (!slot) {
        dom.hourlyDetail.hidden = true;
        dom.hourlyDetail.innerHTML = '';
        return;
    }

    dom.hourlyDetail.hidden = false;
    const rainVolume = Number(slot.rainVolume || 0) + Number(slot.snowVolume || 0);
    const feelsLike = formatTemperature(slot.feelsLike);
    const wind = formatWind(slot.windSpeed);
    const humidity = formatPercent(slot.humidity);
    const rainChance = formatPercent(slot.precipitationProbability);
    const condition = slot.condition?.description || 'Forecast';

    dom.hourlyDetail.innerHTML = `
        <div>
            <p class="eyebrow">${escapeHtml(formatLocalTime(slot.timestamp, timezoneOffset))} Detail</p>
            <h3>${escapeHtml(condition)}</h3>
        </div>
        <div class="hourly-detail-grid">
            <span><strong>${escapeHtml(feelsLike)}</strong><small>Feels like</small></span>
            <span><strong>${escapeHtml(wind)}</strong><small>Wind</small></span>
            <span><strong>${escapeHtml(humidity)}</strong><small>Humidity</small></span>
            <span><strong>${escapeHtml(rainChance)}</strong><small>Rain chance</small></span>
            <span><strong>${escapeHtml(formatVolume(rainVolume))}</strong><small>Rain volume</small></span>
        </div>
    `;
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

function showTemporaryStatus(message, tone = 'success') {
    showStatus(message, tone);
    window.setTimeout(() => {
        if (dom.statusMessage.textContent === message) {
            hideStatus();
        }
    }, 3500);
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

function startLocalClock(timezoneOffset) {
    if (state.clockTimer) {
        window.clearInterval(state.clockTimer);
    }

    const updateClock = () => {
        const nowSeconds = Date.now() / 1000;
        const label = formatLocalTime(nowSeconds, timezoneOffset);
        dom.localClock.textContent = `Local ${label}`;
        dom.headerLocalTime.textContent = label;
    };

    updateClock();
    state.clockTimer = window.setInterval(updateClock, 30 * 1000);
}

function startAutoRefreshCountdown() {
    state.nextRefreshAt = Date.now() + AUTO_REFRESH_MS;

    if (state.autoRefreshTimer) {
        window.clearTimeout(state.autoRefreshTimer);
    }

    if (state.countdownTimer) {
        window.clearInterval(state.countdownTimer);
    }

    updateAutoRefreshLabel();
    state.countdownTimer = window.setInterval(updateAutoRefreshLabel, 1000);
    state.autoRefreshTimer = window.setTimeout(() => {
        if (document.visibilityState === 'hidden') {
            updateAutoRefreshLabel('Paused in background');
            return;
        }

        loadWeather(state.lastRequest.params, {
            label: state.lastRequest.label,
            saveRecent: false,
            successMessage: 'Weather auto-refreshed.',
        });
    }, AUTO_REFRESH_MS);
}

function updateAutoRefreshLabel(forcedLabel) {
    if (!dom.autoRefreshLabel) return;

    const remainingMs = Math.max(0, state.nextRefreshAt - Date.now());
    const label = forcedLabel || `Next sync in ${formatCountdown(remainingMs)}`;
    dom.autoRefreshLabel.textContent = label;

    const autoRefreshNote = dom.smartBriefGrid?.querySelector('.smart-brief-card:last-child p');
    if (autoRefreshNote) {
        autoRefreshNote.textContent = label;
    }
}

function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function updateWeatherAtmosphere(data) {
    const current = data.current;
    const mood = getWeatherMood(current.condition.main);
    const accent = getWeatherAccent(mood);
    const energy = getWeatherEnergy(data);

    document.body.dataset.weather = mood;
    document.body.style.setProperty('--weather-accent', accent.accent);
    document.body.style.setProperty('--weather-accent-2', accent.secondary);
    document.body.style.setProperty('--weather-glow', accent.glow);
    document.body.style.setProperty('--weather-panel', accent.panel);
    dom.weatherEnergy.textContent = energy;
    dom.headerWeatherMood.textContent = getWeatherMoodLabel(mood);
    syncWeatherParticles(mood);
}

function syncWeatherParticles(mood) {
    if (!dom.particlesLayer) return;

    dom.particlesLayer.className = `js-weather-particles is-${mood}`;
    dom.particlesLayer.innerHTML = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
        const x = Math.round(Math.random() * 100);
        const delay = (Math.random() * -12).toFixed(2);
        const duration = (5 + Math.random() * 9).toFixed(2);
        const size = (2 + Math.random() * 5).toFixed(1);
        const drift = Math.round(-18 + Math.random() * 36);
        const opacity = (0.24 + Math.random() * 0.52).toFixed(2);

        return `<span style="--x:${x};--delay:${delay}s;--duration:${duration}s;--size:${size}px;--drift:${drift}px;--opacity:${opacity};--i:${index}"></span>`;
    }).join('');
}

function getWeatherAccent(mood) {
    const accents = {
        clear: {
            accent: '#d97706',
            secondary: '#0f766e',
            glow: 'rgba(217, 119, 6, 0.28)',
            panel: 'rgba(255, 247, 237, 0.9)',
        },
        rain: {
            accent: '#2563eb',
            secondary: '#0f766e',
            glow: 'rgba(37, 99, 235, 0.28)',
            panel: 'rgba(239, 246, 255, 0.92)',
        },
        storm: {
            accent: '#7c3aed',
            secondary: '#dc4a36',
            glow: 'rgba(124, 58, 237, 0.3)',
            panel: 'rgba(245, 243, 255, 0.92)',
        },
        snow: {
            accent: '#0891b2',
            secondary: '#2563eb',
            glow: 'rgba(8, 145, 178, 0.25)',
            panel: 'rgba(236, 254, 255, 0.92)',
        },
        mist: {
            accent: '#64748b',
            secondary: '#0f766e',
            glow: 'rgba(100, 116, 139, 0.22)',
            panel: 'rgba(248, 250, 252, 0.92)',
        },
        clouds: {
            accent: '#0f766e',
            secondary: '#2563eb',
            glow: 'rgba(15, 118, 110, 0.24)',
            panel: 'rgba(240, 253, 250, 0.92)',
        },
    };

    return accents[mood] || accents.clouds;
}

function getWeatherMoodLabel(mood) {
    const labels = {
        clear: 'Clear mode',
        rain: 'Rain watch',
        storm: 'Storm watch',
        snow: 'Snow mode',
        mist: 'Low visibility',
        clouds: 'Cloud sync',
    };

    return labels[mood] || 'Sky sync';
}

function getWeatherEnergy(data) {
    const current = data.current;
    const rainChance = Number(data.forecast?.[0]?.precipitationProbability || 0);
    const windSpeed = Number(current.windSpeed || 0);
    const condition = String(current.condition.main || '').toLowerCase();

    if (condition.includes('thunder')) return 'High energy storm field';
    if (rainChance >= 75) return 'Rain system building';
    if (windSpeed >= 10) return 'Fast wind movement';
    if (condition.includes('clear')) return 'Calm clear sky';
    if (condition.includes('mist') || condition.includes('fog') || condition.includes('haze')) return 'Visibility watch active';
    return 'Atmosphere stable';
}

function getComfortScore(current, airQuality) {
    let score = 100;
    const temp = Number(current.temperature);
    const humidity = Number(current.humidity);
    const windSpeed = Number(current.windSpeed);

    if (Number.isFinite(temp)) {
        score -= Math.min(28, Math.abs(temp - 24) * 2.2);
    }

    if (Number.isFinite(humidity)) {
        score -= Math.min(18, Math.abs(humidity - 55) * 0.35);
    }

    if (Number.isFinite(windSpeed) && windSpeed > 8) {
        score -= Math.min(16, (windSpeed - 8) * 2);
    }

    if (airQuality?.aqi >= 4) {
        score -= airQuality.aqi === 5 ? 24 : 16;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

function getComfortLabel(score) {
    if (score >= 82) return 'Excellent outdoor feel';
    if (score >= 65) return 'Comfortable conditions';
    if (score >= 45) return 'Manageable, stay aware';
    return 'Use caution outside';
}

function getRainSignal(probability, volume) {
    const rainVolume = Number(volume || 0);
    if (probability >= 80 && rainVolume >= 8) return 'Heavy rain possible';
    if (probability >= 60) return 'Carry an umbrella';
    if (probability >= 35) return 'Scattered rain chance';
    return 'Low rain signal';
}

function getWindSignal(speed) {
    const value = Number(speed || 0);
    if (value >= 13.9) return 'Strong wind alert';
    if (value >= 8) return 'Breezy movement';
    return 'Smooth airflow';
}

function updateBrowserTitle(data) {
    const location = data.location?.name || 'Live Weather';
    const temperature = formatTemperature(data.current?.temperature);
    const condition = data.current?.condition?.description || 'Weather';
    document.title = `${temperature} ${location} - ${condition} | Oxygen Weather`;
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

async function getLocationPermissionState() {
    if (!navigator.permissions?.query) {
        return 'prompt';
    }

    try {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        return permission.state;
    } catch {
        return 'prompt';
    }
}

function getBrowserPosition(options) {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
}

function getPositionParams(position) {
    const { latitude, longitude } = position.coords;

    return {
        lat: latitude.toFixed(4),
        lon: longitude.toFixed(4),
    };
}

function getLocationErrorMessage(error) {
    if (error?.code === 1) {
        return 'Location permission was not granted. Enable location access in your browser to use automatic local weather.';
    }

    if (error?.code === 2) {
        return 'Your location could not be detected right now. Please search by city.';
    }

    if (error?.code === 3) {
        return 'Location detection timed out. Please try again or search by city.';
    }

    return 'Location could not be detected. Please search by city.';
}

function getWeatherMood(condition) {
    const value = String(condition || '').toLowerCase();

    if (value.includes('thunder')) return 'storm';
    if (value.includes('rain') || value.includes('drizzle')) return 'rain';
    if (value.includes('snow')) return 'snow';
    if (value.includes('clear')) return 'clear';
    if (value.includes('mist') || value.includes('haze') || value.includes('fog')) return 'mist';
    return 'clouds';
}

function renderIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

window.renderIcons = renderIcons;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
