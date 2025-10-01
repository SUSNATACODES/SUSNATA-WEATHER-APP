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

const homeBtn = document.getElementById('homeBtn');
const instagramBtn = document.getElementById('instagramBtn');
const whatsappBtn = document.getElementById('whatsappBtn');
const feedbackBtn = document.getElementById('feedbackBtn');

const cloudGameBtn = document.getElementById('weatherGameBtn');
const cloudPopup = document.getElementById('cloudPopup');
const closePopupBtn = document.getElementById('closePopup');

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

    // Show Weather Game button in same row after successful weather fetch
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

        // Only increment for user searches (not initial load)
        if (city.toLowerCase() !== 'kolkata') {
            searchCount++;
        }

        // Show the button after 5 successful searches
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
    cloudGameBtn.style.display = 'none'; // Hide on initial load
});

if (homeBtn) {
    homeBtn.addEventListener('click', () => {
        cityInput.value = '';
        weatherInfo.style.display = 'none';
        subtitleElem.textContent = 'Welcome to Oxygen Weather';

        // Hide Weather Game button on home
        if (cloudGameBtn) cloudGameBtn.classList.remove('show');

        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// =========================
// FEEDBACK BUTTON
// =========================
if (feedbackBtn) {
    feedbackBtn.addEventListener('click', () => {
        socialVisible = !socialVisible;
        if (socialVisible) {
            instagramBtn.classList.add('show');
            whatsappBtn.classList.add('show');
        } else {
            instagramBtn.classList.remove('show');
            whatsappBtn.classList.remove('show');
        }
    });
}

// =========================
// SOCIAL BUTTONS
// =========================
if (whatsappBtn) {
    whatsappBtn.addEventListener('click', () => {
        window.open('https://wa.me/918392045833', '_blank');
    });
}

if (instagramBtn) {
    instagramBtn.addEventListener('click', () => {
        window.open('https://instagram.com/capture_withsusnata', '_blank');
    });
}

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