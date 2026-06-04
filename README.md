# Susnata Weather App

Oxygen Weather is a responsive weather dashboard built with HTML, CSS, JavaScript, Node.js, and Express. The server keeps the OpenWeather API key private, normalizes city searches, and returns current conditions, forecast data, air quality, and comfort metrics to the frontend.

## Features

- Professional responsive dashboard UI
- Redesigned command-center interface with smart insights, hourly outlook, live clock, and weather-reactive animation
- Cinematic animated radar hero with glass UI, stronger motion, and real-time atmosphere styling
- JavaScript live intelligence feed, clickable hourly details, auto-refresh countdown, weather particles, and dynamic page title
- High-refresh canvas weather background for smoother animation and reduced DOM/CSS animation load
- Automatic local weather detection when browser location access is enabled
- Jalpaiguri default weather when location permission has not already been granted
- City search with normalized OpenWeather geocoding
- Browser location weather lookup
- Current weather, feels-like temperature, humidity, pressure, visibility, wind, sunrise, sunset, cloud cover, and precipitation
- 5-day forecast cards
- Air quality panel when provider data is available
- Celsius/Fahrenheit unit switching without extra API calls
- Recent searches stored in the browser
- Professional remembered login/profile panel with sign-in, sign-up, 7-day session expiry, and optional Google Sign-In
- Gmail/SMTP weather reminders with important alerts, hourly history tracking, one 12:00 AM full-day report, after-midnight outlook, test emails, and unsubscribe links
- In-app live earthquake monitor using USGS feeds and the same dark full-screen map visual
- Server-side caching, request timeouts, and cleaner API errors
- Blogger XML full-code theme for publishing the app on oxygen-weather.blogspot.com
- Render deployment support

## Local Setup

1. Clone the repository.
2. Install server dependencies:

```bash
cd WeatherServer
npm install
```

3. Create a `.env` file from the example:

```bash
cp .env.example .env
```

4. Add your OpenWeather API key:

```env
API_KEY=your_openweather_api_key_here
PORT=3000
PUBLIC_APP_URL=http://localhost:3000
```

Optional free email delivery for contact and mail alerts:

```env
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=verified_sender_email@gmail.com
BREVO_SENDER_NAME=Oxygen Weather
CONTACT_EMAIL=your_contact_destination@gmail.com
```

Render Free blocks outbound SMTP ports, so Gmail SMTP is not reliable on the free plan.
Use Brevo's HTTPS email API for free delivery. The contact form sends to `CONTACT_EMAIL`.
For exact midnight delivery, use an always-on Render service or an external uptime/cron ping; free sleeping services can only run the scheduler while the server is awake.

Optional Google Sign-In:

```env
GOOGLE_CLIENT_ID=567409969604-qr980ja0p5l2b52huv7kgelgncnndkuf.apps.googleusercontent.com
```

Create a Google OAuth web client and add the Blogger site plus local test URL as authorized origins before enabling this.

5. Start the server:

```bash
npm start
```

6. Open `http://localhost:3000`.

## Render Deployment

The repository includes `render.yaml`. In Render, keep `rootDir` set to `WeatherServer`, then add the environment variables:

```env
API_KEY=your_openweather_api_key_here
PUBLIC_APP_URL=https://oxygen-weather.blogspot.com
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=verified_sender_email@gmail.com
BREVO_SENDER_NAME=Oxygen Weather
CONTACT_EMAIL=your_contact_destination@gmail.com
MAIL_CRON_SECRET=optional_private_scheduler_secret
GOOGLE_CLIENT_ID=567409969604-qr980ja0p5l2b52huv7kgelgncnndkuf.apps.googleusercontent.com
```

Render will run:

```bash
npm install
npm start
```

### Google Login Setup

Google login uses the public OAuth Client ID already embedded in the Blogger/static app. Render can also expose the same value from `/auth/config` with `GOOGLE_CLIENT_ID`.
The Google OAuth **Web application** client must include these authorized JavaScript origins:

```text
https://oxygen-weather.blogspot.com
http://127.0.0.1:5179
```

Also add these authorized redirect URIs:

```text
https://oxygen-weather.blogspot.com/
http://127.0.0.1:5179/
```

After the Blogger XML is published, reload the website. The Google button will open the full `accounts.google.com` account chooser and return to Oxygen Weather after login.

### Free Contact And Report Email Setup

Contact form email, Send Test, important alerts, and 12:00 AM reports all use the same email sender. On Render Free, use Brevo's HTTPS API because SMTP ports are blocked.

Create a Brevo account, verify a sender email, create an SMTP/API key, then add:

```env
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=verified_sender_email@gmail.com
BREVO_SENDER_NAME=Oxygen Weather
CONTACT_EMAIL=where_contact_messages_should_arrive@gmail.com
```

Gmail SMTP variables are still supported as a fallback for paid/non-blocked hosts, but they are not the recommended free Render setup.

### Midnight Report Reliability

The server has a scheduler, but Render free services can sleep. For more reliable 12:00 AM delivery, create an external cron/uptime job that calls:

```text
https://susnata-weather-app.onrender.com/mail-alerts/cron
```

If `MAIL_CRON_SECRET` is set, call:

```text
https://susnata-weather-app.onrender.com/mail-alerts/cron?secret=YOUR_SECRET
```

Ping it every 10-15 minutes. The backend only sends due reports/alerts, so repeated pings should not spam users.

## Blogger Deployment

Use `blogger/oxygen-weather-blogger-theme.xml` for oxygen-weather.blogspot.com.

1. In Blogger, open Theme.
2. Back up the current theme.
3. Open Edit HTML.
4. Replace the current XML with `blogger/oxygen-weather-blogger-theme.xml`.
5. Save/publish the theme.

The Blogger XML contains the Oxygen Weather markup, CSS, and JavaScript directly inside the Blogger theme. It still calls the Render backend for private server work such as OpenWeather requests, Gmail reminders, Google config, and alert scheduling.
The public home is `https://oxygen-weather.blogspot.com/`. Render remains only the backend API host, and direct visits to the Render root redirect to the Blogger home when `PUBLIC_APP_URL` is configured.

If the main app UI changes, regenerate the Blogger XML with:

```bash
node scripts/generate-blogger-theme.js
```

## Project Structure

```text
SUSNATA-WEATHER-APP/
  blogger/
    oxygen-weather-blogger-theme.xml
  WeatherServer/
    server.js
    package.json
    package-lock.json
    .env.example
  public/
    index.html
    script.js
    style.css
  render.yaml
  README.md
```

## Author

Developed by Susnata Biswas.
