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

const homeBtn = document.querySelector('.btn-nav[href="/"]'); // Updated for navbar
const instagramBtn = document.getElementById('instagramBtn');
const whatsappBtn = document.getElementById('whatsappBtn');

const cloudGameBtn = document.getElementById('weatherGameBtn');
const cloudPopup = document.getElementById('cloudPopup');
const closePopupBtn = document.getElementById('closePopup');

const autoWeatherBtn = document.getElementById('autoWeatherBtn');

let socialVisible = false;
let searchCount = 0;

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

// =========================
// UPDATE WEATHER CARD
// =========================
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

    if (cloudGameBtn) cloudGameBtn.classList.add('show');
}

// =========================
// FETCH WEATHER
// =========================
async function getWeather(city) {
    showLoading();
    try {
        const res = await fetch(`/weather?city=${city}`);
        if (!res.ok) throw new Error('Network response was not ok');
        const data = await res.json();
        updateWeather(data);

        if (city.toLowerCase() !== 'kolkata') searchCount++;

        if (searchCount >= 5) {
            cloudGameBtn.style.display = 'inline-block';
        } else {
            cloudGameBtn.style.display = 'none';
        }
    } catch (err) {
        alert('Failed to fetch weather. Try again!');
        console.error(err);
        weatherInfo.style.display = 'none';
        cloudGameBtn.style.display = 'none';
    } finally {
        hideLoading();
    }
}

// =========================
// AUTO-DETECT WEATHER
// =========================
if (autoWeatherBtn) {
    autoWeatherBtn.addEventListener('click', () => {
        if (navigator.geolocation) {
            showLoading();
            navigator.geolocation.getCurrentPosition(async (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                try {
                    const res = await fetch(`/weather?city=${lat},${lon}`);
                    if (!res.ok) throw new Error('Network response was not ok');
                    const data = await res.json();
                    updateWeather(data);
                } catch (err) {
                    alert('Failed to fetch weather for your location.');
                    console.error(err);
                } finally {
                    hideLoading();
                }
            }, () => {
                alert('Permission denied. Please allow location access.');
            });
        } else {
            alert('Geolocation is not supported by this browser.');
        }
    });
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

window.addEventListener('load', () => {
    getWeather('Kolkata');
    if (cloudGameBtn) cloudGameBtn.style.display = 'none';
});

// =========================
// CLOUD GAME POPUP
// =========================
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
