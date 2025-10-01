// =========================
// 🌐 VARIABLES
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
// ⏳ UTILITY FUNCTIONS
// =========================
const showLoading = () => { 
    loadingElem.style.display = 'flex'; 
    weatherInfo.style.display = 'none'; 
};
const hideLoading = () => { 
    loadingElem.style.display = 'none'; 
};

function updateWeather(data) {
    if (!data || !data.weather || !data.main) return;

    cityNameElem.textContent = data.name || 'Unknown City';
    temperatureElem.textContent = `${(data.main.temp - 273.15).toFixed(1)} °C`;
    weatherMainElem.textContent = data.weather[0].main || '--';
    humidityElem.textContent = `${data.main.humidity} %`;
    windSpeedElem.textContent = `${data.wind.speed} m/s`;
    pressureElem.textContent = `${data.main.pressure} hPa`;

    const iconCode = data.weather[0].icon;
    weatherIconElem.src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
    weatherIconElem.alt = data.weather[0].description;

    weatherInfo.style.display = 'flex';
    weatherInfo.classList.remove('animate__fadeInUp');
    void weatherInfo.offsetWidth; // reset animation
    weatherInfo.classList.add('animate__fadeInUp');

    subtitleElem.textContent = `Live weather updates for ${data.name}`;

    if (cloudGameBtn) cloudGameBtn.style.display = (searchCount >= 5) ? 'inline-block' : 'none';
}

// =========================
// 🌤️ GET WEATHER
// =========================
async function getWeather(cityOrCoords) {
    showLoading();
    try {
        const url = (typeof cityOrCoords === 'string') 
            ? `https://api.openweathermap.org/data/2.5/weather?q=${cityOrCoords}&appid=YOUR_API_KEY` 
            : `https://api.openweathermap.org/data/2.5/weather?lat=${cityOrCoords.lat}&lon=${cityOrCoords.lon}&appid=YOUR_API_KEY`;

        const res = await fetch(url);
        if (!res.ok) throw new Error('City not found');
        const data = await res.json();
        updateWeather(data);

        if (typeof cityOrCoords === 'string' && cityOrCoords.toLowerCase() !== 'kolkata') searchCount++;
    } catch (err) {
        console.error(err);
        weatherInfo.style.display = 'none';
        subtitleElem.textContent = 'City not found. Please try again.';
        if (cloudGameBtn) cloudGameBtn.style.display = 'none';
    } finally {
        hideLoading();
    }
}

// =========================
// 📍 AUTO DETECT MAIN CITY WEATHER
// =========================
async function detectMainCityWeatherOnce() {
    if (locationDetected) return;
    locationDetected = true;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
                await getWeather(coords);
            }, 
            () => getWeather('Kolkata') // fallback
        );
    } else getWeather('Kolkata');
}

// =========================
// 🔎 SEARCH WEATHER EVENTS
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
// ☁️ CLOUD GAME POPUP
// =========================
if (cloudGameBtn) {
    cloudGameBtn.addEventListener('click', () => {
        cloudPopup.style.display = 'flex';
        cloudPopup.querySelector('.emoji').style.animation = 'bounce 1s infinite';
    });
}

if (closePopupBtn) closePopupBtn.addEventListener('click', () => {
    cloudPopup.style.display = 'none';
});

// =========================
// ⚙️ ADMIN PANEL
// =========================
if (adminBtn) {
    adminBtn.addEventListener('click', () => {
        adminPanel.style.display = 'flex';
        instagramBtn.style.display = 'flex';
        githubBtn.style.display = 'flex';
        if (cloudGameBtn) cloudGameBtn.style.display = 'inline-block';

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
// 🏠 HOME BUTTON
// =========================
if (homeBtn) {
    homeBtn.addEventListener('click', () => {
        cityInput.value = '';
        weatherInfo.style.display = 'none';
        subtitleElem.textContent = 'Welcome to Oxygen Weather';
        if (cloudGameBtn) cloudGameBtn.style.display = 'none';
        if (adminPanel) adminPanel.style.display = 'none';
        if (instagramBtn) instagramBtn.style.display = 'none';
        if (githubBtn) githubBtn.style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// =========================
// 🔄 ON PAGE LOAD
// =========================
window.addEventListener('load', () => {
    detectMainCityWeatherOnce();
    if (cloudGameBtn) cloudGameBtn.style.display = 'none';
    if (instagramBtn) instagramBtn.style.display = 'none';
    if (githubBtn) githubBtn.style.display = 'none';
});
