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
const autoWeatherBtn = document.getElementById('autoWeatherBtn');

const adminBtn = document.getElementById('adminBtn');
const adminPanel = document.getElementById('adminPanel');
const instagramBtn = document.querySelector('.instagramBtn');
const githubBtn = document.querySelector('.githubBtn');

let searchCount = 0;
let locationDetected = false;

// =========================
// UTILITY FUNCTIONS
// =========================
function showLoading() {
    loadingElem.style.display = 'flex';
    weatherInfo.style.display = 'none';
}

function hideLoading() {
    loadingElem.style.display = 'none';
}

function kelvinToCelsius(kelvin) {
    return (kelvin - 273.15).toFixed(1);
}

// =========================
// UPDATE WEATHER CARD
// =========================
function updateWeather(data) {
    cityNameElem.textContent = data.name || 'Unknown City';
    temperatureElem.textContent = kelvinToCelsius(data.main.temp) + ' °C';
    weatherMainElem.textContent = data.weather[0].main || '--';
    humidityElem.textContent = data.main.humidity + ' %';
    windSpeedElem.textContent = data.wind.speed + ' m/s';
    pressureElem.textContent = data.main.pressure + ' hPa';

    const iconCode = data.weather[0].icon;
    weatherIconElem.src = `http://openweathermap.org/img/wn/${iconCode}@2x.png`;
    weatherIconElem.alt = data.weather[0].description;

    weatherInfo.style.display = 'flex';
    weatherInfo.classList.remove('animate__fadeInUp');
    void weatherInfo.offsetWidth; // restart animation
    weatherInfo.classList.add('animate__fadeInUp');

    subtitleElem.textContent = `Live weather updates for ${data.name}`;

    if (cloudGameBtn) cloudGameBtn.classList.add('show');
}

// =========================
// FETCH WEATHER FROM API
// =========================
async function getWeather(city) {
    showLoading();
    const apiKey = 'YOUR_API_KEY'; // <-- Replace this with your API Key
    let url = '';

    if (typeof city === 'string') {
        url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}`;
    } else if (typeof city === 'object') {
        const { lat, lon } = city;
        url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`;
    }

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('City not found');
        const data = await res.json();
        updateWeather(data);

        if (typeof city === 'string' && city.toLowerCase() !== 'kolkata') searchCount++;

        if (searchCount >= 5 && cloudGameBtn) {
            cloudGameBtn.style.display = 'inline-block';
        } else if (cloudGameBtn) {
            cloudGameBtn.style.display = 'none';
        }
    } catch (err) {
        alert('Failed to fetch weather. Please check city name or your internet connection.');
        console.error(err);
        weatherInfo.style.display = 'none';
        if (cloudGameBtn) cloudGameBtn.style.display = 'none';
    } finally {
        hideLoading();
    }
}

// =========================
// AUTO-DETECT MAIN CITY WEATHER
// =========================
function detectMainCityWeatherOnce() {
    if (locationDetected) return;
    locationDetected = true;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                getWeather({ lat: position.coords.latitude, lon: position.coords.longitude });
            },
            () => {
                getWeather('Kolkata'); // fallback
            }
        );
    } else {
        getWeather('Kolkata'); // fallback
    }
}

// =========================
// EVENT LISTENERS
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

if (cloudGameBtn) {
    cloudGameBtn.addEventListener('click', () => {
        if (cloudPopup) {
            cloudPopup.style.display = 'flex';
            const emoji = cloudPopup.querySelector('.emoji');
            emoji.style.animation = 'bounce 1s infinite';
        }
    });
}

if (closePopupBtn) {
    closePopupBtn.addEventListener('click', () => {
        if (cloudPopup) cloudPopup.style.display = 'none';
    });
}

if (autoWeatherBtn) {
    autoWeatherBtn.addEventListener('click', () => {
        if (navigator.geolocation) {
            showLoading();
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    getWeather({ lat: position.coords.latitude, lon: position.coords.longitude });
                },
                () => {
                    alert('Permission denied. Please allow location access.');
                    hideLoading();
                }
            );
        } else {
            alert('Geolocation is not supported by this browser.');
        }
    });
}

// =========================
// ADMIN PANEL TOGGLE
// =========================
if (adminBtn) {
    adminBtn.addEventListener('click', () => {
        const isVisible = adminPanel.style.display === 'flex';
        if (isVisible) {
            adminPanel.style.display = 'none';
            instagramBtn.style.display = 'none';
            githubBtn.style.display = 'none';
            if (cloudGameBtn) cloudGameBtn.style.display = 'none';
        } else {
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
        }
    });

    document.addEventListener('click', (e) => {
        if (!adminPanel.contains(e.target) && !adminBtn.contains(e.target)) {
            adminPanel.style.display = 'none';
            instagramBtn.style.display = 'none';
            githubBtn.style.display = 'none';
            if (cloudGameBtn) cloudGameBtn.style.display = 'none';
        }
    });
}

// =========================
// NAVBAR HOME BUTTON
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
