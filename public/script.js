// =========================
// VARIABLES
// =========================
const searchBtn = document.getElementById('searchBtn');
const cityInput = document.getElementById('cityInput');
const weatherInfo = document.getElementById('weatherInfo');
const cityNameElem = document.getElementById('cityName');
const temperatureElem = document.getElementById('temperature');
const weatherMainElem = document.getElementById('weatherMain');
const humidityElem = document.getElementById('humidity');
const windSpeedElem = document.getElementById('windSpeed');
const pressureElem = document.getElementById('pressure');
const weatherIconElem = document.getElementById('weatherIcon');
const loadingElem = document.getElementById('loading');
const subtitleElem = document.getElementById('subtitle');

const homeBtn = document.querySelector('.btn-nav[href="/"]');
const cloudGameBtn = document.getElementById('weatherGameBtn');
const cloudPopup = document.getElementById('cloudPopup');
const closePopupBtn = document.getElementById('closePopup');

const adminBtn = document.getElementById('adminBtn');
const adminPanel = document.getElementById('adminPanel');
const instagramBtn = document.querySelector('.instagramBtn');
const githubBtn = document.querySelector('.githubBtn');

let searchCount = 0;
let locationDetected = false;

// =========================
// UTILITY FUNCTIONS
// =========================
const showLoading = () => { loadingElem.style.display = 'flex'; weatherInfo.style.display = 'none'; };
const hideLoading = () => { loadingElem.style.display = 'none'; };

function updateWeather(data) {
    cityNameElem.textContent = data.name || 'Unknown City';
    temperatureElem.textContent = (data.main.temp - 273.15).toFixed(1) + ' °C';
    weatherMainElem.textContent = data.weather[0].main || '--';
    humidityElem.textContent = data.main.humidity + ' %';
    windSpeedElem.textContent = data.wind.speed + ' m/s';
    pressureElem.textContent = data.main.pressure + ' hPa';

    const iconCode = data.weather[0].icon;
    weatherIconElem.src = `http://openweathermap.org/img/wn/${iconCode}@2x.png`;
    weatherIconElem.alt = data.weather[0].description;

    weatherInfo.style.display = 'flex';
    weatherInfo.classList.remove('animate__fadeInUp');
    void weatherInfo.offsetWidth;
    weatherInfo.classList.add('animate__fadeInUp');

    subtitleElem.textContent = `Live weather updates for ${data.name}`;

    if (cloudGameBtn) cloudGameBtn.style.display = (searchCount >= 5) ? 'inline-block' : 'none';
}

async function getWeather(city) {
    showLoading();
    try {
        const res = await fetch(`/weather?city=${city}`);
        if (!res.ok) throw new Error('Network response was not ok');
        const data = await res.json();
        updateWeather(data);

        if (city.toLowerCase() !== 'kolkata') searchCount++;
    } catch (err) {
        console.error(err);
        weatherInfo.style.display = 'none';
        if (cloudGameBtn) cloudGameBtn.style.display = 'none';
    } finally {
        hideLoading();
    }
}

// =========================
// AUTO DETECT MAIN CITY WEATHER ONCE
// =========================
async function detectMainCityWeatherOnce() {
    if (locationDetected) return;
    locationDetected = true;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            try {
                const res = await fetch(`/weather?city=${lat},${lon}`);
                const data = await res.json();
                if (data.name) updateWeather(data);
                else getWeather('Kolkata');
            } catch {
                getWeather('Kolkata');
            }
        }, () => getWeather('Kolkata'));
    } else getWeather('Kolkata');
}

// =========================
// SEARCH WEATHER
// =========================
searchBtn.addEventListener('click', () => {
    const city = cityInput.value.trim();
    if (city) getWeather(city);
});

cityInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const city = cityInput.value.trim();
        if (city) getWeather(city);
    }
});

// =========================
// CLOUD GAME POPUP
// =========================
if (cloudGameBtn) {
    cloudGameBtn.addEventListener('click', () => {
        cloudPopup.style.display = 'flex';
        cloudPopup.querySelector('.emoji').style.animation = 'bounce 1s infinite';
    });
}
if (closePopupBtn) closePopupBtn.addEventListener('click', () => cloudPopup.style.display = 'none');

// =========================
// ADMIN PANEL
// =========================
if (adminBtn) {
    adminBtn.addEventListener('click', () => {
        adminPanel.style.display = 'flex';
        instagramBtn.style.display = 'flex';
        githubBtn.style.display = 'flex';
        if (cloudGameBtn) cloudGameBtn.style.display = 'inline-block';
        adminPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

        setTimeout(() => {
            adminPanel.style.display = 'none';
            instagramBtn.style.display = 'none';
            githubBtn.style.display = 'none';
            if (cloudGameBtn) cloudGameBtn.style.display = 'none';
        }, 5000);
    });

    window.addEventListener('click', (e) => {
        if (!adminPanel.contains(e.target) && !adminBtn.contains(e.target)) {
            adminPanel.style.display = 'none';
            instagramBtn.style.display = 'none';
            githubBtn.style.display = 'none';
            if (cloudGameBtn) cloudGameBtn.style.display = 'none';
        }
    });
}

// =========================
// HOME BUTTON
// =========================
if (homeBtn) {
    homeBtn.addEventListener('click', () => {
        cityInput.value = '';
        weatherInfo.style.display = 'none';
        subtitleElem.textContent = 'Welcome to Oxygen Weather';
        if (cloudGameBtn) cloudGameBtn.classList.remove('show');
        if (adminPanel) adminPanel.style.display = 'none';
        if (instagramBtn) instagramBtn.style.display = 'none';
        if (githubBtn) githubBtn.style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// =========================
// ON PAGE LOAD
// =========================
window.addEventListener('load', () => {
    detectMainCityWeatherOnce();
    if (cloudGameBtn) cloudGameBtn.style.display = 'none';
    if (instagramBtn) instagramBtn.style.display = 'none';
    if (githubBtn) githubBtn.style.display = 'none';
});
