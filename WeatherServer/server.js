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
const UI_BUILD = 'mail-diagnostics-20260603';
const CACHE_TTL_MS = 10 * 60 * 1000;
const SUBSCRIPTIONS_DIR = path.join(__dirname, 'data');
const SUBSCRIPTIONS_FILE = path.join(SUBSCRIPTIONS_DIR, 'weather-mail-subscriptions.json');
const HISTORY_FILE = path.join(SUBSCRIPTIONS_DIR, 'weather-mail-history.json');
const MAIL_CHECK_INTERVAL_MS = 60 * 1000;
const MAIL_CONNECTION_TIMEOUT_MS = Number(process.env.MAIL_CONNECTION_TIMEOUT_MS || 10 * 1000);
const MAIL_SOCKET_TIMEOUT_MS = Number(process.env.MAIL_SOCKET_TIMEOUT_MS || 15 * 1000);
const WEATHER_HISTORY_SAMPLE_INTERVAL_MS = 60 * 60 * 1000;
const WEATHER_HISTORY_MAX_DAYS = 5;
const URGENT_ALERT_INTERVAL_MS = 30 * 60 * 1000;
const URGENT_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const CONTACT_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const CONTACT_RATE_LIMIT_MAX = 4;
const DEFAULT_CORS_ORIGINS = [
  'https://oxygen-weather.blogspot.com',
  'https://www.oxygen-weather.blogspot.com',
  'https://susnata-weather-app.onrender.com',
  'https://susnata-weather-app-oeqt.onrender.com',
  'http://127.0.0.1:5179',
  'http://localhost:5179',
  'null',
];
const CORS_ALLOWED_ORIGINS = new Set([
  ...DEFAULT_CORS_ORIGINS,
  ...String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || 'https://oxygen-weather.blogspot.com').replace(/\/$/, '');
const weatherCache = new Map();
const contactRateBuckets = new Map();
let mailTransporter;
let schedulerRunning = false;
let schedulerInFlight = false;
let lastSchedulerRunAt = null;
let lastSchedulerRunSummary = null;

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Oxygen-Weather-Version', APP_VERSION.slice(0, 12));
  res.setHeader('X-Oxygen-Weather-UI', UI_BUILD);

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

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

app.get('/', (req, res, next) => {
  if (!PUBLIC_APP_URL || req.hostname === 'localhost' || req.hostname === '127.0.0.1') {
    return next();
  }

  return res.redirect(302, PUBLIC_APP_URL);
});

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

app.get('/auth/config', (req, res) => {
  res.json({
    ok: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
  });
});

app.post('/contact', async (req, res) => {
  const parsed = parseContactMessageRequest(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  const rateLimit = getContactRateLimit(req);
  if (rateLimit.limited) {
    return res.status(429).json({
      error: `Please wait ${rateLimit.retryAfterMinutes} minute before sending another message.`,
    });
  }

  if (!isMailConfigured()) {
    return res.status(503).json({
      error: 'Contact mail is not connected on the server yet. Add MAIL_USER and MAIL_PASS on Render first.',
    });
  }

  const recipient = getContactRecipient();
  if (!recipient) {
    return res.status(503).json({
      error: 'Contact destination is not configured yet. Add CONTACT_EMAIL or MAIL_USER on Render.',
    });
  }

  const sent = await sendEmail({
    to: recipient,
    replyTo: parsed.email,
    subject: `Oxygen Weather contact from ${parsed.name}`,
    ...buildContactEmail(parsed, req),
  });

  if (!sent) {
    return res.status(502).json({
      error: 'The mail server could not send the contact message. On Render Free, SMTP ports are blocked; use a paid Render instance or an HTTP email provider.',
    });
  }

  res.json({
    ok: true,
    message: 'Message sent. Susnata Codes will receive it by email.',
  });
});

app.get('/mail-alerts/status', async (req, res) => {
  const subscriptions = await loadMailSubscriptions();
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.active);

  res.json({
    ok: true,
    mailConfigured: isMailConfigured(),
    mailUserConfigured: Boolean(getMailUser()),
    contactRecipientConfigured: Boolean(getContactRecipient()),
    schedulerRunning,
    schedulerInFlight,
    lastSchedulerRunAt,
    lastSchedulerRunSummary,
    activeSubscriptions: activeSubscriptions.length,
    defaultDailyReportTime: '00:00',
    historySampleMinutes: Math.round(WEATHER_HISTORY_SAMPLE_INTERVAL_MS / 60000),
    cronEndpoint: `${getRequestBaseUrl(req)}/mail-alerts/cron`,
    message: isMailConfigured()
      ? 'Gmail SMTP is connected. Automatic reports can be delivered.'
      : 'Gmail SMTP is not connected yet. Add MAIL_USER and MAIL_PASS on Render to send automatic emails.',
  });
});

app.get('/mail-alerts/cron', async (req, res) => {
  const secret = process.env.MAIL_CRON_SECRET || process.env.CRON_SECRET || '';
  const providedSecret = String(req.query.secret || req.headers['x-cron-secret'] || '');

  if (secret && providedSecret !== secret) {
    return res.status(401).json({
      ok: false,
      error: 'Scheduler secret is required.',
    });
  }

  const summary = await runMailScheduler({ source: 'cron-endpoint' });
  res.json({
    ok: true,
    ...summary,
  });
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
    const history = await loadWeatherHistory();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
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
      options: parsed.options,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      lastDailyReportDate: existing?.lastDailyReportDate || null,
      lastImportantCheckAt: existing?.lastImportantCheckAt || null,
      lastUrgentSignature: existing?.lastUrgentSignature || null,
      lastUrgentSentAt: existing?.lastUrgentSentAt || null,
      lastHistorySampleAt: existing?.lastHistorySampleAt || null,
    };

    recordWeatherHistory(history, subscription, payload, now);
    subscription.lastHistorySampleAt = nowIso;

    if (existingIndex >= 0) {
      subscriptions[existingIndex] = subscription;
    } else {
      subscriptions.push(subscription);
    }

    await saveMailSubscriptions(subscriptions);
    await saveWeatherHistory(history);

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
      nextDailyReport: parsed.options.dailyReports
        ? `Daily history report is scheduled around ${parsed.options.dailyReportTime} local time.`
        : 'Daily report is turned off for this subscription.',
      message: confirmationSent
        ? 'Mail alerts are enabled. Check your inbox for confirmation and use Send test if you want to verify again.'
        : 'Mail alert settings are saved, but Gmail SMTP is not connected on Render yet. Add MAIL_USER and MAIL_PASS to start automatic delivery.',
    });
  } catch (error) {
    sendWeatherError(res, error);
  }
});

app.post('/mail-alerts/test', async (req, res) => {
  const parsed = parseMailSubscriptionRequest(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  if (!API_KEY) {
    return res.status(500).json({
      error: 'Weather API key is required before a test report can be sent.',
    });
  }

  if (!isMailConfigured()) {
    return res.status(503).json({
      error: 'Gmail SMTP is not connected on the server. Add MAIL_USER and MAIL_PASS on Render first.',
    });
  }

  try {
    const payload = await fetchWeatherPayload(parsed.weatherRequest);
    const temporarySubscription = {
      id: `preview-${crypto.randomUUID()}`,
      token: crypto.randomBytes(24).toString('hex'),
      email: parsed.email,
      active: true,
      location: buildSubscriptionLocation(parsed.weatherRequest, payload.location),
      options: parsed.options,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const unsubscribeUrl = buildUnsubscribeUrl(req, temporarySubscription.token);
    const historySamples = [
      createWeatherHistorySample(temporarySubscription, payload, Date.now() - 2 * 60 * 60 * 1000),
      createWeatherHistorySample(temporarySubscription, payload, Date.now() - 60 * 60 * 1000),
      createWeatherHistorySample(temporarySubscription, payload, Date.now()),
    ];

    const sent = await sendEmail({
      to: temporarySubscription.email,
      subject: `Test daily weather report for ${temporarySubscription.location.label}`,
      ...buildDailyReportEmail(
        temporarySubscription,
        payload,
        unsubscribeUrl,
        historySamples,
        getLocalDateKey(Date.now() / 1000, temporarySubscription.location.timezoneOffset || 0),
        true
      ),
    });

    if (!sent) {
      return res.status(502).json({
        error: 'The mail server could not send the test message. On Render Free, SMTP ports are blocked; use a paid Render instance or an HTTP email provider.',
      });
    }

    res.json({
      ok: true,
      message: 'Test weather report sent. Check the inbox and spam folder once.',
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

function getLocalTimeLabel(timestampSeconds, timezoneOffset) {
  const localDate = new Date((timestampSeconds + timezoneOffset) * 1000);
  return `${String(localDate.getUTCHours()).padStart(2, '0')}:${String(localDate.getUTCMinutes()).padStart(2, '0')}`;
}

function getLocalMinutesSinceMidnight(timestampSeconds, timezoneOffset) {
  const localDate = new Date((timestampSeconds + timezoneOffset) * 1000);
  return localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
}

function getPreviousLocalDateKey(timestampSeconds, timezoneOffset) {
  const localDate = new Date((timestampSeconds + timezoneOffset) * 1000);
  localDate.setUTCDate(localDate.getUTCDate() - 1);
  return localDate.toISOString().slice(0, 10);
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

  const options = parseMailAlertOptions(body?.options || body);

  if (!options.dailyReports && !options.urgentAlerts) {
    return {
      ok: false,
      error: 'Keep at least one mail behavior enabled: daily history or important alerts.',
    };
  }

  return {
    ok: true,
    email,
    weatherRequest,
    options,
  };
}

function parseContactMessageRequest(body) {
  const name = typeof body?.name === 'string'
    ? body.name.trim().replace(/\s+/g, ' ')
    : '';
  const email = typeof body?.email === 'string'
    ? body.email.trim().toLowerCase()
    : '';
  const message = typeof body?.message === 'string'
    ? body.message.replace(/\r\n/g, '\n').trim()
    : '';
  const page = typeof body?.page === 'string'
    ? body.page.trim().slice(0, 240)
    : '';
  const currentWeather = typeof body?.currentWeather === 'string'
    ? body.currentWeather.trim().replace(/\s+/g, ' ').slice(0, 140)
    : '';

  if (name.length < 2) {
    return { ok: false, error: 'Enter your name.' };
  }

  if (name.length > 80) {
    return { ok: false, error: 'Name is too long.' };
  }

  if (!isValidEmail(email)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  if (email.length > 120) {
    return { ok: false, error: 'Email address is too long.' };
  }

  if (message.length < 8) {
    return { ok: false, error: 'Write a message with at least 8 characters.' };
  }

  if (message.length > 900) {
    return { ok: false, error: 'Message is too long. Keep it under 900 characters.' };
  }

  return {
    ok: true,
    name,
    email,
    message,
    page,
    currentWeather,
  };
}

function getContactRateLimit(req) {
  const key = getClientKey(req);
  const now = Date.now();
  const existing = contactRateBuckets.get(key);

  if (!existing || existing.expiresAt <= now) {
    contactRateBuckets.set(key, {
      count: 1,
      expiresAt: now + CONTACT_RATE_LIMIT_WINDOW_MS,
    });
    return { limited: false };
  }

  existing.count += 1;
  contactRateBuckets.set(key, existing);

  if (existing.count <= CONTACT_RATE_LIMIT_MAX) {
    return { limited: false };
  }

  return {
    limited: true,
    retryAfterMinutes: Math.max(1, Math.ceil((existing.expiresAt - now) / 60000)),
  };
}

function getClientKey(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseMailAlertOptions(source = {}) {
  const dailyReports = parseBooleanOption(source.dailyReports, true);
  const urgentAlerts = parseBooleanOption(source.urgentAlerts, true);
  const alertSensitivity =
    source.alertSensitivity === 'emergency-only' ? 'emergency-only' : 'important';

  return {
    dailyReports,
    urgentAlerts,
    dailyReportTime: normalizeDailyReportTime(source.dailyReportTime),
    alertSensitivity,
  };
}

function parseBooleanOption(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }

  return fallback;
}

function normalizeDailyReportTime(value) {
  if (typeof value !== 'string') {
    return '00:00';
  }

  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : '00:00';
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

async function loadWeatherHistory() {
  try {
    const contents = await fs.readFile(HISTORY_FILE, 'utf8');
    const history = JSON.parse(contents);
    return history && typeof history === 'object' && !Array.isArray(history) ? history : {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    console.error('Failed to load weather mail history:', error.message);
    return {};
  }
}

async function saveWeatherHistory(history) {
  await fs.mkdir(SUBSCRIPTIONS_DIR, { recursive: true });
  const temporaryFile = `${HISTORY_FILE}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(history, null, 2));
  await fs.rename(temporaryFile, HISTORY_FILE);
}

function recordWeatherHistory(history, subscription, payload, timestampMs) {
  const offset = subscription.location?.timezoneOffset || payload.location?.timezoneOffset || 0;
  const dateKey = getLocalDateKey(timestampMs / 1000, offset);
  const subscriptionHistory = history[subscription.id] || {};
  const daySamples = Array.isArray(subscriptionHistory[dateKey])
    ? subscriptionHistory[dateKey]
    : [];
  const sample = createWeatherHistorySample(subscription, payload, timestampMs);
  const lastSample = daySamples[daySamples.length - 1];

  if (
    lastSample &&
    Math.abs(Date.parse(sample.timestamp) - Date.parse(lastSample.timestamp)) < 20 * 60 * 1000
  ) {
    daySamples[daySamples.length - 1] = sample;
  } else {
    daySamples.push(sample);
  }

  subscriptionHistory[dateKey] = daySamples.slice(-30);
  history[subscription.id] = pruneWeatherHistory(subscriptionHistory);
}

function createWeatherHistorySample(subscription, payload, timestampMs) {
  const current = payload.current;
  const offset = subscription.location?.timezoneOffset || payload.location?.timezoneOffset || 0;

  return {
    timestamp: new Date(timestampMs).toISOString(),
    localDate: getLocalDateKey(timestampMs / 1000, offset),
    localTime: getLocalTimeLabel(timestampMs / 1000, offset),
    location: subscription.location?.label || formatLocationLabel(payload.location),
    condition: current.condition.description,
    temperature: current.temperature,
    feelsLike: current.feelsLike,
    humidity: current.humidity,
    pressure: current.pressure,
    windSpeed: current.windSpeed,
    windGust: current.windGust,
    rainVolume: round(Number(current.rainVolume || 0)),
    snowVolume: round(Number(current.snowVolume || 0)),
    visibility: current.visibility,
    aqi: payload.airQuality?.aqi || null,
  };
}

function pruneWeatherHistory(subscriptionHistory) {
  const keys = Object.keys(subscriptionHistory).sort();
  const keepKeys = new Set(keys.slice(-WEATHER_HISTORY_MAX_DAYS));

  return keys.reduce((cleaned, key) => {
    if (keepKeys.has(key)) {
      cleaned[key] = subscriptionHistory[key];
    }
    return cleaned;
  }, {});
}

function getHistorySamples(history, subscription, dateKey) {
  return Array.isArray(history?.[subscription.id]?.[dateKey])
    ? history[subscription.id][dateKey]
    : [];
}

function isMailConfigured() {
  return Boolean(getMailUser() && getMailPassword());
}

function getMailUser() {
  return normalizeEnvText(process.env.MAIL_USER || process.env.GMAIL_USER || process.env.SMTP_USER);
}

function getMailPassword() {
  return normalizeMailPassword(process.env.MAIL_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS);
}

function getMailFrom() {
  return normalizeEnvText(process.env.MAIL_FROM) || `Oxygen Weather <${getMailUser()}>`;
}

function getContactRecipient() {
  return normalizeEnvText(process.env.CONTACT_EMAIL || process.env.CONTACT_TO) || getMailUser();
}

function normalizeEnvText(value) {
  return String(value || '').trim();
}

function normalizeMailPassword(value) {
  return normalizeEnvText(value).replace(/\s+/g, '');
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
      connectionTimeout: MAIL_CONNECTION_TIMEOUT_MS,
      greetingTimeout: MAIL_CONNECTION_TIMEOUT_MS,
      socketTimeout: MAIL_SOCKET_TIMEOUT_MS,
    });
  }

  return mailTransporter;
}

async function sendEmail({ to, subject, html, text, replyTo }) {
  const transporter = getMailTransporter();
  if (!transporter) {
    return false;
  }

  try {
    await transporter.sendMail({
      from: getMailFrom(),
      to,
      subject,
      replyTo: replyTo || undefined,
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

async function runMailScheduler({ source = 'interval' } = {}) {
  if (schedulerInFlight) {
    return {
      source,
      skipped: true,
      reason: 'scheduler-already-running',
      lastSchedulerRunAt,
      lastSchedulerRunSummary,
    };
  }

  schedulerInFlight = true;
  const startedAt = new Date().toISOString();
  const summary = {
    source,
    startedAt,
    finishedAt: null,
    mailConfigured: isMailConfigured(),
    activeSubscriptions: 0,
    checkedSubscriptions: 0,
    dueDailyReports: 0,
    sentDailyReports: 0,
    dueImportantChecks: 0,
    sentImportantAlerts: 0,
    savedHistorySamples: 0,
    skippedNoMail: 0,
    failures: 0,
    reason: '',
  };

  try {
    if (!API_KEY) {
      summary.reason = 'missing-weather-api-key';
      return summary;
    }

    const subscriptions = await loadMailSubscriptions();
    const history = await loadWeatherHistory();
    const activeSubscriptions = subscriptions.filter((subscription) => subscription.active);
    summary.activeSubscriptions = activeSubscriptions.length;

    if (!activeSubscriptions.length) {
      summary.reason = 'no-active-subscriptions';
      return summary;
    }

    let changed = false;
    let historyChanged = false;
    const now = Date.now();
    const mailConfigured = isMailConfigured();

    for (const subscription of activeSubscriptions) {
      const options = getSubscriptionOptions(subscription);
      const dailyDue = options.dailyReports && isDailyReportDue(subscription, now);
      const urgentDue = options.urgentAlerts && isUrgentCheckDue(subscription, now);
      const historyDue = isHistorySampleDue(subscription, now);

      if (!dailyDue && !urgentDue && !historyDue) {
        continue;
      }

      summary.checkedSubscriptions += 1;
      if (dailyDue) summary.dueDailyReports += 1;
      if (urgentDue) summary.dueImportantChecks += 1;

      const request = getWeatherRequestFromSubscription(subscription);
      if (!request.ok) {
        summary.failures += 1;
        continue;
      }

      try {
        const payload = await fetchWeatherPayload(request);
        subscription.location.label = formatLocationLabel(payload.location);
        subscription.location.timezoneOffset = payload.location.timezoneOffset || subscription.location.timezoneOffset || 0;
        subscription.location.coordinates = payload.location.coordinates || subscription.location.coordinates;
        subscription.options = options;

        if (historyDue) {
          recordWeatherHistory(history, subscription, payload, now);
          subscription.lastHistorySampleAt = new Date(now).toISOString();
          summary.savedHistorySamples += 1;
          historyChanged = true;
          changed = true;
        }

        if (dailyDue) {
          if (!mailConfigured) {
            summary.skippedNoMail += 1;
          } else {
            const deliveryDateKey = getLocalDateKey(now / 1000, subscription.location.timezoneOffset || 0);
            const historyDateKey = getPreviousLocalDateKey(now / 1000, subscription.location.timezoneOffset || 0);
            const dayHistorySamples = getHistorySamples(history, subscription, historyDateKey);
            const unsubscribeUrl = buildUnsubscribeUrl(null, subscription.token);
            const sent = await sendEmail({
              to: subscription.email,
              subject: `Daily weather report for ${subscription.location.label}`,
              ...buildDailyReportEmail(subscription, payload, unsubscribeUrl, dayHistorySamples, historyDateKey),
            });

            if (sent) {
              subscription.lastDailyReportDate = deliveryDateKey;
              summary.sentDailyReports += 1;
              changed = true;
            } else {
              summary.failures += 1;
            }
          }
        }

        if (urgentDue) {
          subscription.lastImportantCheckAt = new Date(now).toISOString();
          changed = true;

          if (!mailConfigured) {
            summary.skippedNoMail += 1;
          } else {
            const alerts = buildImportantAlerts(payload, options);
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
                summary.sentImportantAlerts += 1;
              } else {
                summary.failures += 1;
              }
            }
          }
        }
      } catch (error) {
        summary.failures += 1;
        console.error(`Mail scheduler failed for ${subscription.email}:`, error.message);
      }
    }

    if (changed) {
      await saveMailSubscriptions(subscriptions);
    }

    if (historyChanged) {
      await saveWeatherHistory(history);
    }

    summary.reason = summary.checkedSubscriptions ? 'completed' : 'nothing-due';
    return summary;
  } finally {
    summary.finishedAt = new Date().toISOString();
    lastSchedulerRunAt = summary.finishedAt;
    lastSchedulerRunSummary = summary;
    schedulerInFlight = false;
  }
}

function getSubscriptionOptions(subscription) {
  return {
    dailyReports: parseBooleanOption(subscription.options?.dailyReports, true),
    urgentAlerts: parseBooleanOption(subscription.options?.urgentAlerts, true),
    dailyReportTime: normalizeDailyReportTime(subscription.options?.dailyReportTime),
    alertSensitivity:
      subscription.options?.alertSensitivity === 'emergency-only' ? 'emergency-only' : 'important',
  };
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

function isHistorySampleDue(subscription, now) {
  if (!subscription.lastHistorySampleAt) {
    return true;
  }

  const lastSampleMs = Date.parse(subscription.lastHistorySampleAt);
  if (!Number.isFinite(lastSampleMs)) {
    return true;
  }

  return now - lastSampleMs >= WEATHER_HISTORY_SAMPLE_INTERVAL_MS;
}

function isUrgentCheckDue(subscription, now) {
  if (!subscription.lastImportantCheckAt) {
    return true;
  }

  return now - Date.parse(subscription.lastImportantCheckAt) >= URGENT_ALERT_INTERVAL_MS;
}

function buildImportantAlerts(payload, options = {}) {
  const alerts = [];
  const current = payload.current;
  const today = payload.forecast?.[0];
  const conditionId = Number(current.condition.id || 0);
  const conditionMain = String(current.condition.main || '').toLowerCase();
  const thresholds = getImportantAlertThresholds(options.alertSensitivity);

  if (conditionId >= 200 && conditionId < 300) {
    alerts.push({
      code: 'thunderstorm',
      title: 'Thunderstorm risk',
      detail: current.condition.description,
    });
  }

  if (conditionMain.includes('rain') && Number(current.rainVolume || 0) >= thresholds.currentRainVolume) {
    alerts.push({
      code: 'heavy-rain-now',
      title: 'Heavy rain nearby',
      detail: `${current.rainVolume} mm reported recently`,
    });
  }

  if (
    today &&
    today.precipitationProbability >= thresholds.rainProbability &&
    Number(today.rainVolume || 0) >= thresholds.forecastRainVolume
  ) {
    alerts.push({
      code: 'heavy-rain-forecast',
      title: 'High rain chance',
      detail: `${today.precipitationProbability}% chance with ${today.rainVolume} mm forecast`,
    });
  }

  if (Number(current.windSpeed || 0) >= thresholds.windSpeed || Number(current.windGust || 0) >= thresholds.windGust) {
    alerts.push({
      code: 'strong-wind',
      title: 'Strong wind',
      detail: `Wind ${formatMetric(current.windSpeed, 'm/s')}, gust ${formatMetric(current.windGust, 'm/s')}`,
    });
  }

  if (Number(current.visibility || 0) > 0 && Number(current.visibility) <= thresholds.visibility) {
    alerts.push({
      code: 'low-visibility',
      title: 'Low visibility',
      detail: `${Math.round(current.visibility)} meters reported`,
    });
  }

  if (Number(current.temperature) >= thresholds.heat) {
    alerts.push({
      code: 'extreme-heat',
      title: 'Extreme heat',
      detail: `${current.temperature} C, feels like ${current.feelsLike} C`,
    });
  }

  if (Number(current.temperature) <= thresholds.cold) {
    alerts.push({
      code: 'cold-risk',
      title: 'Very cold conditions',
      detail: `${current.temperature} C, feels like ${current.feelsLike} C`,
    });
  }

  if (payload.airQuality?.aqi >= thresholds.aqi) {
    alerts.push({
      code: 'poor-air-quality',
      title: 'Poor air quality',
      detail: `AQI ${payload.airQuality.aqi}/5 (${payload.airQuality.label})`,
    });
  }

  return alerts;
}

function getImportantAlertThresholds(alertSensitivity) {
  if (alertSensitivity === 'emergency-only') {
    return {
      currentRainVolume: 18,
      forecastRainVolume: 16,
      rainProbability: 90,
      windSpeed: 18,
      windGust: 25,
      visibility: 600,
      heat: 43,
      cold: 2,
      aqi: 5,
    };
  }

  return {
    currentRainVolume: 10,
    forecastRainVolume: 8,
    rainProbability: 80,
    windSpeed: 13.9,
    windGust: 20,
    visibility: 1000,
    heat: 40,
    cold: 4,
    aqi: 4,
  };
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

function buildContactEmail(contact, req) {
  const sourcePage = contact.page || PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
  const currentWeather = contact.currentWeather || 'Not provided';
  const sentAt = new Date().toISOString();
  const text = [
    'New Oxygen Weather contact message.',
    `Name: ${contact.name}`,
    `Email: ${contact.email}`,
    `Current weather: ${currentWeather}`,
    `Page: ${sourcePage}`,
    `Sent: ${sentAt}`,
    '',
    contact.message,
  ].join('\n');

  return {
    text,
    html: baseEmailTemplate({
      title: 'New contact message',
      preheader: `${escapeHtml(contact.name)} sent a message through Oxygen Weather`,
      body: `
        <p><strong>Name:</strong> ${escapeHtml(contact.name)}</p>
        <p><strong>Email:</strong> <a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></p>
        <p><strong>Current weather:</strong> ${escapeHtml(currentWeather)}</p>
        <p><strong>Page:</strong> <a href="${escapeHtml(sourcePage)}">${escapeHtml(sourcePage)}</a></p>
        <h2>Message</h2>
        <p>${escapeHtml(contact.message).replace(/\n/g, '<br>')}</p>
        <p class="note">Sent from Oxygen Weather contact form at ${escapeHtml(sentAt)}.</p>
      `,
    }),
  };
}

function buildConfirmationEmail(subscription, payload, unsubscribeUrl) {
  const location = escapeHtml(subscription.location.label);
  const current = payload.current;
  const text = [
    `Oxygen Weather mail alerts are enabled for ${subscription.location.label}.`,
    `Current weather: ${current.condition.description}, ${current.temperature} C.`,
    'You will receive important weather alerts only when notable conditions are detected.',
    `A full-day history report with the after-midnight outlook will be sent around ${subscription.options?.dailyReportTime || '00:00'} local time.`,
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
          <li>One full-day history report around <strong>${escapeHtml(subscription.options?.dailyReportTime || '00:00')}</strong> local time.</li>
          <li>After-midnight hourly outlook and upcoming forecast included.</li>
          <li>No repeated spam messages.</li>
        </ul>
        <p class="note">For dangerous conditions, always follow official local weather and emergency guidance.</p>
        <p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from these alerts</a></p>
      `,
    }),
  };
}

function buildDailyReportEmail(
  subscription,
  payload,
  unsubscribeUrl,
  historySamples = [],
  reportDateKey = '',
  isTest = false
) {
  const current = payload.current;
  const historySummary = summarizeWeatherHistory(historySamples);
  const titlePrefix = isTest ? 'Test daily report' : 'Daily report';
  const historyTitle = reportDateKey ? `Full day history: ${reportDateKey}` : 'Full day history';
  const historyRows = historySamples.length
    ? historySamples
      .map((sample) => {
        return `<tr>
          <td>${escapeHtml(sample.localTime || '--')}</td>
          <td>${escapeHtml(sample.condition || 'Weather')}</td>
          <td>${escapeHtml(formatOptionalNumber(sample.temperature, ' C'))}</td>
          <td>${escapeHtml(formatOptionalNumber(sample.humidity, '%'))}</td>
          <td>${escapeHtml(formatOptionalNumber(sample.windSpeed, ' m/s'))}</td>
          <td>${escapeHtml(formatOptionalNumber(sample.rainVolume, ' mm'))}</td>
        </tr>`;
      })
      .join('')
    : `<tr><td colspan="6">History tracking has started. The next midnight report will include the full day samples collected by the server.</td></tr>`;
  const hourlyRows = (payload.hourly || [])
    .slice(0, 8)
    .map((hour) => {
      return `<tr>
        <td>${escapeHtml(hour.localHour)}:00</td>
        <td>${escapeHtml(hour.condition.description)}</td>
        <td>${escapeHtml(formatOptionalNumber(hour.temperature, ' C'))}</td>
        <td>${escapeHtml(hour.precipitationProbability)}%</td>
        <td>${escapeHtml(formatOptionalNumber(hour.windSpeed, ' m/s'))}</td>
      </tr>`;
    })
    .join('');
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
  const textHistory = historySummary
    ? [
      `${historyTitle}`,
      `Samples: ${historySummary.samples}`,
      `Temperature: ${historySummary.minTemp} C to ${historySummary.maxTemp} C, average ${historySummary.avgTemp} C.`,
      `Average humidity: ${historySummary.avgHumidity}%. Peak wind: ${historySummary.peakWind} m/s.`,
      `Rain total: ${historySummary.rainTotal} mm. Main condition: ${historySummary.mainCondition}.`,
    ].join('\n')
    : `${historyTitle}\nHistory tracking has started. The next midnight report will include the full day samples collected by the server.`;
  const textHourly = (payload.hourly || [])
    .slice(0, 8)
    .map((hour) => `${hour.localHour}:00: ${hour.condition.description}, ${hour.temperature} C, rain chance ${hour.precipitationProbability}%, wind ${hour.windSpeed} m/s`)
    .join('\n');
  const textForecast = (payload.forecast || [])
    .map((day) => `${day.date}: ${day.condition.description}, ${day.tempMax} C / ${day.tempMin} C, rain chance ${day.precipitationProbability}%`)
    .join('\n');

  return {
    text: [
      `${titlePrefix} for ${subscription.location.label}`,
      `Now: ${current.condition.description}, ${current.temperature} C, feels like ${current.feelsLike} C.`,
      `Humidity: ${current.humidity}%. Wind: ${current.windSpeed} m/s. Pressure: ${current.pressure} hPa.`,
      '',
      textHistory,
      '',
      'After midnight outlook:',
      textHourly,
      '',
      'Upcoming forecast:',
      textForecast,
      '',
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join('\n'),
    html: baseEmailTemplate({
      title: `${titlePrefix}: ${escapeHtml(subscription.location.label)}`,
      preheader: `Full day history and upcoming weather for ${escapeHtml(subscription.location.label)}`,
      body: `
        <p><strong>Now:</strong> ${escapeHtml(current.condition.description)}, ${escapeHtml(current.temperature)} C, feels like ${escapeHtml(current.feelsLike)} C.</p>
        <p><strong>Humidity:</strong> ${escapeHtml(current.humidity)}% &nbsp; <strong>Wind:</strong> ${escapeHtml(current.windSpeed)} m/s &nbsp; <strong>Pressure:</strong> ${escapeHtml(current.pressure)} hPa</p>
        <h2>${escapeHtml(historyTitle)}</h2>
        ${historySummary
          ? `<p><strong>${escapeHtml(historySummary.samples)} samples:</strong> ${escapeHtml(historySummary.minTemp)} C to ${escapeHtml(historySummary.maxTemp)} C, average ${escapeHtml(historySummary.avgTemp)} C. Average humidity ${escapeHtml(historySummary.avgHumidity)}%, peak wind ${escapeHtml(historySummary.peakWind)} m/s, rain total ${escapeHtml(historySummary.rainTotal)} mm.</p>`
          : '<p>History tracking has started. The next midnight report will include the full day samples collected by the server.</p>'
        }
        <table>
          <thead><tr><th>Time</th><th>Condition</th><th>Temp</th><th>Humidity</th><th>Wind</th><th>Rain</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
        <h2>After midnight outlook</h2>
        <table>
          <thead><tr><th>Time</th><th>Condition</th><th>Temp</th><th>Rain chance</th><th>Wind</th></tr></thead>
          <tbody>${hourlyRows}</tbody>
        </table>
        <h2>Upcoming forecast</h2>
        <table>
          <thead><tr><th>Date</th><th>Condition</th><th>Temp</th><th>Rain chance</th></tr></thead>
          <tbody>${forecastRows}</tbody>
        </table>
        <p class="note">You are receiving one daily report around ${escapeHtml(subscription.options?.dailyReportTime || '00:00')} local time. Important alerts are sent only when notable weather behavior is detected.</p>
        <p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from these alerts</a></p>
      `,
    }),
  };
}

function summarizeWeatherHistory(samples) {
  if (!samples.length) {
    return null;
  }

  const temperatures = getFiniteSampleValues(samples, 'temperature');
  const humidity = getFiniteSampleValues(samples, 'humidity');
  const wind = getFiniteSampleValues(samples, 'windSpeed');
  const rain = getFiniteSampleValues(samples, 'rainVolume');

  return {
    samples: samples.length,
    minTemp: roundOrDash(temperatures.length ? Math.min(...temperatures) : NaN),
    maxTemp: roundOrDash(temperatures.length ? Math.max(...temperatures) : NaN),
    avgTemp: roundOrDash(temperatures.length ? average(temperatures) : NaN),
    avgHumidity: roundOrDash(humidity.length ? average(humidity) : NaN, 0),
    peakWind: roundOrDash(wind.length ? Math.max(...wind) : NaN),
    rainTotal: roundOrDash(sum(rain)),
    mainCondition: getMostCommonCondition(samples),
  };
}

function getFiniteSampleValues(samples, key) {
  return samples
    .map((sample) => Number(sample[key]))
    .filter(Number.isFinite);
}

function getMostCommonCondition(samples) {
  const counts = samples.reduce((map, sample) => {
    const condition = sample.condition || 'Weather';
    map.set(condition, (map.get(condition) || 0) + 1);
    return map;
  }, new Map());
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || 'Weather';
}

function formatOptionalNumber(value, suffix = '') {
  return Number.isFinite(Number(value)) ? `${value}${suffix}` : '--';
}

function roundOrDash(value, places = 1) {
  return Number.isFinite(value) ? round(value, places) : '--';
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
  const publicAppUrl = String(process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (publicAppUrl) {
    return `${publicAppUrl}/?unsubscribe=${encodeURIComponent(token)}`;
  }

  const configuredBaseUrl = process.env.MAIL_ACTION_BASE_URL || process.env.RENDER_EXTERNAL_URL;
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

function getRequestBaseUrl(req) {
  if (!req) {
    return PUBLIC_APP_URL;
  }

  return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
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
