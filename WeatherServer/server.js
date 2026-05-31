const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '../public');
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org';
const API_KEY = process.env.API_KEY || process.env.OPENWEATHER_API_KEY;
const CACHE_TTL_MS = 10 * 60 * 1000;
const weatherCache = new Map();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/weather', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: 'Weather API key is not configured on the server.',
    });
  }

  const request = parseWeatherRequest(req.query);
  if (!request.ok) {
    return res.status(400).json({ error: request.error });
  }

  const cacheKey = request.cacheKey;
  const cached = getCachedWeather(cacheKey);
  if (cached) {
    return res.json({
      ...cached,
      meta: {
        ...cached.meta,
        fromCache: true,
      },
    });
  }

  try {
    const coordinates =
      request.type === 'coordinates'
        ? request.coordinates
        : await resolveCityToCoordinates(request.city);

    const [current, forecast, airQuality] = await Promise.all([
      openWeather('/data/2.5/weather', {
        lat: coordinates.lat,
        lon: coordinates.lon,
        units: 'metric',
      }),
      openWeather('/data/2.5/forecast', {
        lat: coordinates.lat,
        lon: coordinates.lon,
        units: 'metric',
      }),
      openWeather('/data/2.5/air_pollution', {
        lat: coordinates.lat,
        lon: coordinates.lon,
      }).catch(() => null),
    ]);

    const payload = buildWeatherPayload({
      current: current.data,
      forecast: forecast.data,
      airQuality: airQuality ? airQuality.data : null,
      resolvedLocation: coordinates,
    });

    weatherCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });

    res.json(payload);
  } catch (error) {
    sendWeatherError(res, error);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Oxygen Weather server running at http://localhost:${PORT}`);
});

function parseWeatherRequest(query) {
  const rawCity = typeof query.city === 'string' ? query.city : '';
  const city = rawCity.trim().replace(/\s+/g, ' ');
  const lat = Number.parseFloat(query.lat);
  const lon = Number.parseFloat(query.lon);

  if (Number.isFinite(lat) || Number.isFinite(lon)) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { ok: false, error: 'Both latitude and longitude are required.' };
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { ok: false, error: 'Coordinates are outside valid ranges.' };
    }

    return {
      ok: true,
      type: 'coordinates',
      coordinates: {
        lat,
        lon,
        name: 'Current location',
      },
      cacheKey: `coordinates:${lat.toFixed(3)}:${lon.toFixed(3)}`,
    };
  }

  if (!city) {
    return { ok: false, error: 'Enter a city name or allow location access.' };
  }

  if (city.length > 80) {
    return { ok: false, error: 'City name is too long.' };
  }

  return {
    ok: true,
    type: 'city',
    city,
    cacheKey: `city:${city.toLowerCase()}`,
  };
}

function getCachedWeather(cacheKey) {
  const cached = weatherCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    weatherCache.delete(cacheKey);
    return null;
  }

  return cached.payload;
}

async function resolveCityToCoordinates(city) {
  const response = await openWeather('/geo/1.0/direct', {
    q: city,
    limit: 1,
  });

  const [match] = response.data;
  if (!match) {
    const notFound = new Error('City was not found.');
    notFound.status = 404;
    throw notFound;
  }

  return {
    lat: match.lat,
    lon: match.lon,
    name: match.name,
    state: match.state,
    country: match.country,
  };
}

function openWeather(endpoint, params) {
  return axios.get(`${OPENWEATHER_BASE_URL}${endpoint}`, {
    params: {
      ...params,
      appid: API_KEY,
    },
    timeout: 8000,
  });
}

function buildWeatherPayload({ current, forecast, airQuality, resolvedLocation }) {
  const weather = current.weather?.[0] || {};
  const timezoneOffset = Number(current.timezone || 0);
  const dailyForecast = buildDailyForecast(forecast.list || [], timezoneOffset);

  return {
    location: {
      name: current.name || resolvedLocation.name,
      state: resolvedLocation.state,
      country: current.sys?.country || resolvedLocation.country,
      coordinates: {
        lat: current.coord?.lat ?? resolvedLocation.lat,
        lon: current.coord?.lon ?? resolvedLocation.lon,
      },
      timezoneOffset,
    },
    current: {
      condition: {
        id: weather.id,
        main: weather.main || 'Weather',
        description: toTitleCase(weather.description || 'Current conditions'),
        icon: weather.icon,
      },
      temperature: round(current.main?.temp),
      feelsLike: round(current.main?.feels_like),
      tempMin: round(current.main?.temp_min),
      tempMax: round(current.main?.temp_max),
      humidity: current.main?.humidity,
      pressure: current.main?.pressure,
      windSpeed: round(current.wind?.speed),
      windGust: round(current.wind?.gust),
      windDirection: current.wind?.deg,
      clouds: current.clouds?.all,
      visibility: current.visibility,
      sunrise: current.sys?.sunrise,
      sunset: current.sys?.sunset,
      observedAt: current.dt,
      rainVolume: current.rain?.['1h'] || current.rain?.['3h'] || 0,
      snowVolume: current.snow?.['1h'] || current.snow?.['3h'] || 0,
    },
    forecast: dailyForecast,
    airQuality: buildAirQuality(airQuality),
    meta: {
      source: 'OpenWeather',
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    },
  };
}

function buildDailyForecast(list, timezoneOffset) {
  const todayKey = getLocalDateKey(Date.now() / 1000, timezoneOffset);
  const groups = new Map();

  list.forEach((item) => {
    const dateKey = getLocalDateKey(item.dt, timezoneOffset);
    if (dateKey < todayKey) return;

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey).push(item);
  });

  return Array.from(groups.entries())
    .slice(0, 5)
    .map(([date, entries]) => {
      const representative = getRepresentativeForecast(entries, timezoneOffset);
      const weather = representative.weather?.[0] || {};
      const precipitationProbability = Math.max(
        ...entries.map((entry) => Number(entry.pop || 0))
      );

      return {
        date,
        condition: {
          main: weather.main || 'Weather',
          description: toTitleCase(weather.description || 'Forecast'),
          icon: weather.icon,
        },
        tempMin: round(Math.min(...entries.map((entry) => entry.main.temp_min))),
        tempMax: round(Math.max(...entries.map((entry) => entry.main.temp_max))),
        humidity: Math.round(
          average(entries.map((entry) => entry.main.humidity).filter(Number.isFinite))
        ),
        windSpeed: round(Math.max(...entries.map((entry) => entry.wind.speed || 0))),
        precipitationProbability: Math.round(precipitationProbability * 100),
        rainVolume: round(sum(entries.map((entry) => entry.rain?.['3h'] || 0))),
        snowVolume: round(sum(entries.map((entry) => entry.snow?.['3h'] || 0))),
      };
    });
}

function getRepresentativeForecast(entries, timezoneOffset) {
  return entries.reduce((closest, item) => {
    const closestHour = getLocalHour(closest.dt, timezoneOffset);
    const itemHour = getLocalHour(item.dt, timezoneOffset);
    return Math.abs(itemHour - 12) < Math.abs(closestHour - 12) ? item : closest;
  }, entries[0]);
}

function getLocalDateKey(timestampSeconds, timezoneOffset) {
  return new Date((timestampSeconds + timezoneOffset) * 1000)
    .toISOString()
    .slice(0, 10);
}

function getLocalHour(timestampSeconds, timezoneOffset) {
  return new Date((timestampSeconds + timezoneOffset) * 1000).getUTCHours();
}

function buildAirQuality(airQuality) {
  const air = airQuality?.list?.[0];
  if (!air) {
    return null;
  }

  const labels = {
    1: 'Good',
    2: 'Fair',
    3: 'Moderate',
    4: 'Poor',
    5: 'Very Poor',
  };

  return {
    aqi: air.main?.aqi,
    label: labels[air.main?.aqi] || 'Unavailable',
    components: {
      pm2_5: round(air.components?.pm2_5),
      pm10: round(air.components?.pm10),
      o3: round(air.components?.o3),
      no2: round(air.components?.no2),
      co: round(air.components?.co),
    },
  };
}

function sendWeatherError(res, error) {
  const providerStatus = error.response?.status || error.status;
  const providerMessage = error.response?.data?.message || error.message;

  if (providerStatus === 404) {
    return res.status(404).json({ error: 'No matching city was found.' });
  }

  if (providerStatus === 401) {
    return res.status(500).json({
      error: 'The server weather API key is invalid or inactive.',
    });
  }

  if (providerStatus === 429) {
    return res.status(429).json({
      error: 'Weather provider limit reached. Please try again shortly.',
    });
  }

  console.error('Weather request failed:', providerMessage);
  return res.status(502).json({
    error: 'Weather data is temporarily unavailable. Please try again.',
  });
}

function toTitleCase(value) {
  return value.replace(/\w\S*/g, (word) => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function round(value, places = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function average(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}
