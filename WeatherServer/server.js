const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '../public');
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org';
const API_KEY = process.env.API_KEY || process.env.OPENWEATHER_API_KEY;
const APP_VERSION = process.env.RENDER_GIT_COMMIT || 'local';
const UI_BUILD = 'cinematic-redesign-20260601';
const CACHE_TTL_MS = 10 * 60 * 1000;
const SUBSCRIPTIONS_DIR = path.join(__dirname, 'data');
const SUBSCRIPTIONS_FILE = path.join(SUBSCRIPTIONS_DIR, 'weather-mail-subscriptions.json');
const MAIL_CHECK_INTERVAL_MS = 60 * 1000;
const URGENT_ALERT_INTERVAL_MS = 30 * 60 * 1000;
const URGENT_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const weatherCache = new Map();
let mailTransporter;
let schedulerRunning = false;

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Oxygen-Weather-Version', APP_VERSION.slice(0, 12));
  res.setHeader('X-Oxygen-Weather-UI', UI_BUILD);
  next();
});

app.use(express.json({ limit: '16kb' }));

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    index: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION.slice(0, 12),
    ui: UI_BUILD,
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
    const payload = await fetchWeatherPayload(request);

    weatherCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });

    res.json(payload);
  } catch (error) {
    sendWeatherError(res, error);
  }
});

app.post('/mail-alerts/subscribe', async (req, res) => {
  const parsed = parseMailSubscriptionRequest(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  if (!API_KEY) {
    return res.status(500).json({
      error: 'Weather API key is required before mail alerts can be enabled.',
    });
  }

  try {
    const payload = await fetchWeatherPayload(parsed.weatherRequest);
    const subscriptions = await loadMailSubscriptions();
    const now = new Date().toISOString();
    const locationKey = getSubscriptionLocationKeyFromRequest(parsed.weatherRequest);
    const existingIndex = subscriptions.findIndex((subscription) => {
      return (
        subscription.active &&
        subscription.email.toLowerCase() === parsed.email.toLowerCase() &&
        getSubscriptionLocationKey(subscription) === locationKey
      );
    });
    const existing = existingIndex >= 0 ? subscriptions[existingIndex] : null;
    const subscription = {
      id: existing?.id || crypto.randomUUID(),
      token: existing?.token || crypto.randomBytes(24).toString('hex'),
      email: parsed.email,
      active: true,
      location: buildSubscriptionLocation(parsed.weatherRequest, payload.location),
      options: {
        dailyReports: true,
        urgentAlerts: true,
        dailyReportTime: '00:00',
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastDailyReportDate: existing?.lastDailyReportDate || null,
      lastImportantCheckAt: existing?.lastImportantCheckAt || null,
      lastUrgentSignature: existing?.lastUrgentSignature || null,
      lastUrgentSentAt: existing?.lastUrgentSentAt || null,
    };

    if (existingIndex >= 0) {
      subscriptions[existingIndex] = subscription;
    } else {
      subscriptions.push(subscription);
    }

    await saveMailSubscriptions(subscriptions);

    const unsubscribeUrl = buildUnsubscribeUrl(req, subscription.token);
    const confirmationSent = await sendEmail({
      to: subscription.email,
      subject: `Oxygen Weather mail alerts for ${subscription.location.label}`,
      ...buildConfirmationEmail(subscription, payload, unsubscribeUrl),
    });

    res.status(201).json({
      ok: true,
      mailConfigured: isMailConfigured(),
      confirmationSent,
      message: confirmationSent
        ? 'Mail alerts are enabled. Check your inbox for confirmation.'
        : 'Mail alert settings are saved. Add Gmail SMTP environment variables on the server to start delivery.',
    });
  } catch (error) {
    sendWeatherError(res, error);
  }
});

app.get('/mail-alerts/unsubscribe', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!token) {
    return res.status(400).send('Missing unsubscribe token.');
  }

  const subscriptions = await loadMailSubscriptions();
  const subscription = subscriptions.find((item) => item.token === token && item.active);

  if (!subscription) {
    return res.status(404).send('This mail alert subscription was not found or is already inactive.');
  }

  subscription.active = false;
  subscription.unsubscribedAt = new Date().toISOString();
  await saveMailSubscriptions(subscriptions);

  res.send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Oxygen Weather Unsubscribed</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f8fb; color: #17212f; }
          main { width: min(520px, calc(100% - 32px)); padding: 28px; background: white; border: 1px solid #d8e0e8; border-radius: 8px; box-shadow: 0 18px 42px rgba(23,33,47,.12); }
          h1 { margin-top: 0; }
          a { color: #0f766e; font-weight: 700; }
        </style>
      </head>
      <body>
        <main>
          <h1>Mail alerts turned off</h1>
          <p>Oxygen Weather will no longer send reports to ${escapeHtml(subscription.email)} for ${escapeHtml(subscription.location.label)}.</p>
          <p><a href="/">Return to Oxygen Weather</a></p>
        </main>
      </body>
    </html>
  `);
});

app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Oxygen Weather server running at http://localhost:${PORT}`);
});

startMailScheduler();

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

async function fetchWeatherPayload(request) {
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

  return buildWeatherPayload({
    current: current.data,
    forecast: forecast.data,
    airQuality: airQuality ? airQuality.data : null,
    resolvedLocation: coordinates,
  });
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
  const hourlyForecast = buildHourlyForecast(forecast.list || [], timezoneOffset);

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
    hourly: hourlyForecast,
    airQuality: buildAirQuality(airQuality),
    meta: {
      source: 'OpenWeather',
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    },
  };
}

function buildHourlyForecast(list, timezoneOffset) {
  return list
    .filter((item) => Number.isFinite(item.dt))
    .slice(0, 8)
    .map((item) => {
      const weather = item.weather?.[0] || {};

      return {
        timestamp: item.dt,
        localHour: getLocalHour(item.dt, timezoneOffset),
        date: getLocalDateKey(item.dt, timezoneOffset),
        condition: {
          main: weather.main || 'Weather',
          description: toTitleCase(weather.description || 'Forecast'),
          icon: weather.icon,
        },
        temperature: round(item.main?.temp),
        feelsLike: round(item.main?.feels_like),
        humidity: item.main?.humidity,
        windSpeed: round(item.wind?.speed),
        precipitationProbability: Math.round(Number(item.pop || 0) * 100),
        rainVolume: round(item.rain?.['3h'] || 0),
        snowVolume: round(item.snow?.['3h'] || 0),
      };
    });
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

function getLocalMinutesSinceMidnight(timestampSeconds, timezoneOffset) {
  const localDate = new Date((timestampSeconds + timezoneOffset) * 1000);
  return localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
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

function parseMailSubscriptionRequest(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const city = typeof body?.city === 'string' ? body.city.trim().replace(/\s+/g, ' ') : '';

  if (!isValidEmail(email)) {
    return { ok: false, error: 'Enter a valid email address for weather mail alerts.' };
  }

  if (email.length > 120) {
    return { ok: false, error: 'Email address is too long.' };
  }

  const weatherRequest = city
    ? parseWeatherRequest({ city })
    : parseWeatherRequest({ lat: body?.lat, lon: body?.lon });

  if (!weatherRequest.ok) {
    return { ok: false, error: 'Choose a city or use your current weather location.' };
  }

  return {
    ok: true,
    email,
    weatherRequest,
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildSubscriptionLocation(request, location) {
  if (request.type === 'city') {
    return {
      type: 'city',
      city: request.city,
      label: formatLocationLabel(location),
      timezoneOffset: location.timezoneOffset || 0,
      coordinates: location.coordinates,
    };
  }

  return {
    type: 'coordinates',
    city: null,
    label: formatLocationLabel(location),
    timezoneOffset: location.timezoneOffset || 0,
    coordinates: {
      lat: request.coordinates.lat,
      lon: request.coordinates.lon,
    },
  };
}

function getSubscriptionLocationKey(subscription) {
  if (subscription.location.type === 'city') {
    return `city:${subscription.location.city.toLowerCase()}`;
  }

  return `coordinates:${Number(subscription.location.coordinates.lat).toFixed(3)}:${Number(subscription.location.coordinates.lon).toFixed(3)}`;
}

function getSubscriptionLocationKeyFromRequest(request) {
  if (request.type === 'city') {
    return `city:${request.city.toLowerCase()}`;
  }

  return `coordinates:${request.coordinates.lat.toFixed(3)}:${request.coordinates.lon.toFixed(3)}`;
}

function getWeatherRequestFromSubscription(subscription) {
  if (subscription.location.type === 'city') {
    return parseWeatherRequest({ city: subscription.location.city });
  }

  return parseWeatherRequest({
    lat: subscription.location.coordinates.lat,
    lon: subscription.location.coordinates.lon,
  });
}

async function loadMailSubscriptions() {
  try {
    const contents = await fs.readFile(SUBSCRIPTIONS_FILE, 'utf8');
    const subscriptions = JSON.parse(contents);
    return Array.isArray(subscriptions) ? subscriptions : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    console.error('Failed to load mail subscriptions:', error.message);
    return [];
  }
}

async function saveMailSubscriptions(subscriptions) {
  await fs.mkdir(SUBSCRIPTIONS_DIR, { recursive: true });
  const temporaryFile = `${SUBSCRIPTIONS_FILE}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(subscriptions, null, 2));
  await fs.rename(temporaryFile, SUBSCRIPTIONS_FILE);
}

function isMailConfigured() {
  return Boolean(getMailUser() && getMailPassword());
}

function getMailUser() {
  return process.env.MAIL_USER || process.env.GMAIL_USER || process.env.SMTP_USER;
}

function getMailPassword() {
  return process.env.MAIL_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;
}

function getMailFrom() {
  return process.env.MAIL_FROM || `Oxygen Weather <${getMailUser()}>`;
}

function getMailTransporter() {
  if (!isMailConfigured()) {
    return null;
  }

  if (!mailTransporter) {
    const port = Number(process.env.MAIL_PORT || process.env.SMTP_PORT || 465);
    mailTransporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: {
        user: getMailUser(),
        pass: getMailPassword(),
      },
    });
  }

  return mailTransporter;
}

async function sendEmail({ to, subject, html, text }) {
  const transporter = getMailTransporter();
  if (!transporter) {
    return false;
  }

  try {
    await transporter.sendMail({
      from: getMailFrom(),
      to,
      subject,
      html,
      text,
    });
    return true;
  } catch (error) {
    console.error('Failed to send weather mail:', error.message);
    return false;
  }
}

function startMailScheduler() {
  if (schedulerRunning) {
    return;
  }

  schedulerRunning = true;
  const interval = setInterval(runMailScheduler, MAIL_CHECK_INTERVAL_MS);
  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  setTimeout(runMailScheduler, 15 * 1000).unref?.();
}

async function runMailScheduler() {
  if (!API_KEY || !isMailConfigured()) {
    return;
  }

  const subscriptions = await loadMailSubscriptions();
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.active);
  if (!activeSubscriptions.length) {
    return;
  }

  let changed = false;
  const now = Date.now();

  for (const subscription of activeSubscriptions) {
    const dailyDue = subscription.options?.dailyReports && isDailyReportDue(subscription, now);
    const urgentDue = subscription.options?.urgentAlerts && isUrgentCheckDue(subscription, now);

    if (!dailyDue && !urgentDue) {
      continue;
    }

    const request = getWeatherRequestFromSubscription(subscription);
    if (!request.ok) {
      continue;
    }

    try {
      const payload = await fetchWeatherPayload(request);
      subscription.location.label = formatLocationLabel(payload.location);
      subscription.location.timezoneOffset = payload.location.timezoneOffset || subscription.location.timezoneOffset || 0;
      subscription.location.coordinates = payload.location.coordinates || subscription.location.coordinates;

      if (dailyDue) {
        const unsubscribeUrl = buildUnsubscribeUrl(null, subscription.token);
        const sent = await sendEmail({
          to: subscription.email,
          subject: `Daily weather report for ${subscription.location.label}`,
          ...buildDailyReportEmail(subscription, payload, unsubscribeUrl),
        });

        if (sent) {
          subscription.lastDailyReportDate = getLocalDateKey(now / 1000, subscription.location.timezoneOffset || 0);
          changed = true;
        }
      }

      if (urgentDue) {
        subscription.lastImportantCheckAt = new Date(now).toISOString();
        const alerts = buildImportantAlerts(payload);
        const signature = getAlertSignature(alerts);
        const sentRecently =
          subscription.lastUrgentSentAt &&
          now - Date.parse(subscription.lastUrgentSentAt) < URGENT_ALERT_COOLDOWN_MS;

        if (alerts.length && signature !== subscription.lastUrgentSignature && !sentRecently) {
          const unsubscribeUrl = buildUnsubscribeUrl(null, subscription.token);
          const sent = await sendEmail({
            to: subscription.email,
            subject: `Important weather alert for ${subscription.location.label}`,
            ...buildUrgentAlertEmail(subscription, payload, alerts, unsubscribeUrl),
          });

          if (sent) {
            subscription.lastUrgentSignature = signature;
            subscription.lastUrgentSentAt = new Date(now).toISOString();
          }
        }

        changed = true;
      }
    } catch (error) {
      console.error(`Mail scheduler failed for ${subscription.email}:`, error.message);
    }
  }

  if (changed) {
    await saveMailSubscriptions(subscriptions);
  }
}

function isDailyReportDue(subscription, now) {
  const offset = subscription.location.timezoneOffset || 0;
  const localDateKey = getLocalDateKey(now / 1000, offset);
  const createdAtMs = Date.parse(subscription.createdAt);
  const localMinutes = getLocalMinutesSinceMidnight(now / 1000, offset);
  const [targetHour, targetMinute] = (subscription.options?.dailyReportTime || '00:00')
    .split(':')
    .map((part) => Number.parseInt(part, 10));
  const targetMinutes = (Number.isFinite(targetHour) ? targetHour : 0) * 60 + (Number.isFinite(targetMinute) ? targetMinute : 0);

  if (
    !subscription.lastDailyReportDate &&
    Number.isFinite(createdAtMs) &&
    getLocalDateKey(createdAtMs / 1000, offset) === localDateKey
  ) {
    return false;
  }

  return localMinutes >= targetMinutes && subscription.lastDailyReportDate !== localDateKey;
}

function isUrgentCheckDue(subscription, now) {
  if (!subscription.lastImportantCheckAt) {
    return true;
  }

  return now - Date.parse(subscription.lastImportantCheckAt) >= URGENT_ALERT_INTERVAL_MS;
}

function buildImportantAlerts(payload) {
  const alerts = [];
  const current = payload.current;
  const today = payload.forecast?.[0];
  const conditionId = Number(current.condition.id || 0);
  const conditionMain = String(current.condition.main || '').toLowerCase();

  if (conditionId >= 200 && conditionId < 300) {
    alerts.push({
      code: 'thunderstorm',
      title: 'Thunderstorm risk',
      detail: current.condition.description,
    });
  }

  if (conditionMain.includes('rain') && Number(current.rainVolume || 0) >= 10) {
    alerts.push({
      code: 'heavy-rain-now',
      title: 'Heavy rain nearby',
      detail: `${current.rainVolume} mm reported recently`,
    });
  }

  if (today && today.precipitationProbability >= 80 && Number(today.rainVolume || 0) >= 8) {
    alerts.push({
      code: 'heavy-rain-forecast',
      title: 'High rain chance',
      detail: `${today.precipitationProbability}% chance with ${today.rainVolume} mm forecast`,
    });
  }

  if (Number(current.windSpeed || 0) >= 13.9 || Number(current.windGust || 0) >= 20) {
    alerts.push({
      code: 'strong-wind',
      title: 'Strong wind',
      detail: `Wind ${formatMetric(current.windSpeed, 'm/s')}, gust ${formatMetric(current.windGust, 'm/s')}`,
    });
  }

  if (Number(current.visibility || 0) > 0 && Number(current.visibility) <= 1000) {
    alerts.push({
      code: 'low-visibility',
      title: 'Low visibility',
      detail: `${Math.round(current.visibility)} meters reported`,
    });
  }

  if (Number(current.temperature) >= 40) {
    alerts.push({
      code: 'extreme-heat',
      title: 'Extreme heat',
      detail: `${current.temperature} C, feels like ${current.feelsLike} C`,
    });
  }

  if (Number(current.temperature) <= 4) {
    alerts.push({
      code: 'cold-risk',
      title: 'Very cold conditions',
      detail: `${current.temperature} C, feels like ${current.feelsLike} C`,
    });
  }

  if (payload.airQuality?.aqi >= 4) {
    alerts.push({
      code: 'poor-air-quality',
      title: 'Poor air quality',
      detail: `AQI ${payload.airQuality.aqi}/5 (${payload.airQuality.label})`,
    });
  }

  return alerts;
}

function getAlertSignature(alerts) {
  if (!alerts.length) {
    return null;
  }

  return crypto
    .createHash('sha256')
    .update(alerts.map((alert) => `${alert.code}:${alert.detail}`).join('|'))
    .digest('hex')
    .slice(0, 20);
}

function buildConfirmationEmail(subscription, payload, unsubscribeUrl) {
  const location = escapeHtml(subscription.location.label);
  const current = payload.current;
  const text = [
    `Oxygen Weather mail alerts are enabled for ${subscription.location.label}.`,
    `Current weather: ${current.condition.description}, ${current.temperature} C.`,
    'You will receive important weather alerts only when notable conditions are detected.',
    'A daily report with the full day and upcoming forecast will be sent around 12:00 AM local time.',
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');

  return {
    text,
    html: baseEmailTemplate({
      title: 'Mail alerts enabled',
      preheader: `Oxygen Weather alerts for ${location}`,
      body: `
        <p>Mail alerts are now enabled for <strong>${location}</strong>.</p>
        <p>Current weather: <strong>${escapeHtml(current.condition.description)}</strong>, ${escapeHtml(current.temperature)} C.</p>
        <ul>
          <li>Important weather alerts only when notable conditions are detected.</li>
          <li>One daily report around <strong>12:00 AM</strong> local time.</li>
          <li>No repeated spam messages.</li>
        </ul>
        <p class="note">For dangerous conditions, always follow official local weather and emergency guidance.</p>
        <p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from these alerts</a></p>
      `,
    }),
  };
}

function buildDailyReportEmail(subscription, payload, unsubscribeUrl) {
  const current = payload.current;
  const forecastRows = (payload.forecast || [])
    .map((day) => {
      return `<tr>
        <td>${escapeHtml(day.date)}</td>
        <td>${escapeHtml(day.condition.description)}</td>
        <td>${escapeHtml(day.tempMax)} C / ${escapeHtml(day.tempMin)} C</td>
        <td>${escapeHtml(day.precipitationProbability)}%</td>
      </tr>`;
    })
    .join('');
  const textForecast = (payload.forecast || [])
    .map((day) => `${day.date}: ${day.condition.description}, ${day.tempMax} C / ${day.tempMin} C, rain chance ${day.precipitationProbability}%`)
    .join('\n');

  return {
    text: [
      `Daily weather report for ${subscription.location.label}`,
      `Now: ${current.condition.description}, ${current.temperature} C, feels like ${current.feelsLike} C.`,
      `Humidity: ${current.humidity}%. Wind: ${current.windSpeed} m/s. Pressure: ${current.pressure} hPa.`,
      '',
      'Upcoming forecast:',
      textForecast,
      '',
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join('\n'),
    html: baseEmailTemplate({
      title: `Daily report: ${escapeHtml(subscription.location.label)}`,
      preheader: `Current and upcoming weather for ${escapeHtml(subscription.location.label)}`,
      body: `
        <p><strong>Now:</strong> ${escapeHtml(current.condition.description)}, ${escapeHtml(current.temperature)} C, feels like ${escapeHtml(current.feelsLike)} C.</p>
        <p><strong>Humidity:</strong> ${escapeHtml(current.humidity)}% &nbsp; <strong>Wind:</strong> ${escapeHtml(current.windSpeed)} m/s &nbsp; <strong>Pressure:</strong> ${escapeHtml(current.pressure)} hPa</p>
        <h2>Upcoming forecast</h2>
        <table>
          <thead><tr><th>Date</th><th>Condition</th><th>Temp</th><th>Rain chance</th></tr></thead>
          <tbody>${forecastRows}</tbody>
        </table>
        <p class="note">You are receiving one daily report around 12:00 AM local time.</p>
        <p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from these alerts</a></p>
      `,
    }),
  };
}

function buildUrgentAlertEmail(subscription, payload, alerts, unsubscribeUrl) {
  const alertItems = alerts
    .map((alert) => `<li><strong>${escapeHtml(alert.title)}:</strong> ${escapeHtml(alert.detail)}</li>`)
    .join('');
  const textAlerts = alerts.map((alert) => `${alert.title}: ${alert.detail}`).join('\n');

  return {
    text: [
      `Important weather alert for ${subscription.location.label}`,
      textAlerts,
      '',
      `Current condition: ${payload.current.condition.description}, ${payload.current.temperature} C.`,
      'Please follow official local weather and emergency guidance if conditions become dangerous.',
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join('\n'),
    html: baseEmailTemplate({
      title: `Important alert: ${escapeHtml(subscription.location.label)}`,
      preheader: `Important weather behavior detected for ${escapeHtml(subscription.location.label)}`,
      body: `
        <p>Oxygen Weather detected important weather behavior for <strong>${escapeHtml(subscription.location.label)}</strong>.</p>
        <ul>${alertItems}</ul>
        <p><strong>Current condition:</strong> ${escapeHtml(payload.current.condition.description)}, ${escapeHtml(payload.current.temperature)} C.</p>
        <p class="note">Please follow official local weather and emergency guidance if conditions become dangerous.</p>
        <p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from these alerts</a></p>
      `,
    }),
  };
}

function baseEmailTemplate({ title, preheader, body }) {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title}</title>
        <style>
          body { margin: 0; padding: 0; background: #f5f8fb; color: #17212f; font-family: Arial, sans-serif; }
          .wrap { max-width: 680px; margin: 0 auto; padding: 28px 16px; }
          .card { background: #ffffff; border: 1px solid #d8e0e8; border-radius: 8px; padding: 24px; }
          h1 { margin: 0 0 16px; font-size: 26px; }
          h2 { font-size: 18px; margin-top: 22px; }
          p, li, td, th { font-size: 15px; line-height: 1.5; }
          a { color: #0f766e; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border-bottom: 1px solid #d8e0e8; padding: 10px 6px; text-align: left; }
          .note { color: #667085; font-size: 13px; }
          .preheader { display: none; visibility: hidden; opacity: 0; height: 0; width: 0; overflow: hidden; }
        </style>
      </head>
      <body>
        <span class="preheader">${preheader}</span>
        <div class="wrap">
          <div class="card">
            <h1>${title}</h1>
            ${body}
          </div>
        </div>
      </body>
    </html>`;
}

function buildUnsubscribeUrl(req, token) {
  const configuredBaseUrl = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  const baseUrl = configuredBaseUrl
    ? configuredBaseUrl.replace(/\/$/, '')
    : req
      ? `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`
      : '';

  return `${baseUrl}/mail-alerts/unsubscribe?token=${encodeURIComponent(token)}`;
}

function formatLocationLabel(location) {
  return [location.name, location.state, location.country].filter(Boolean).join(', ');
}

function formatMetric(value, unit) {
  return Number.isFinite(Number(value)) ? `${value} ${unit}` : `-- ${unit}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
