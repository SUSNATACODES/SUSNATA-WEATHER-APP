# Oxygen Weather Project Presentation

This is a slide-style presentation script for explaining Oxygen Weather as a complete professional web project.

## Slide 1: Title

**Oxygen Weather**

Professional weather intelligence by Susnata Biswas and Susnata Codes.

Live site: [https://oxygen-weather.blogspot.com/](https://oxygen-weather.blogspot.com/)

Desktop screenshot:

![Oxygen Weather desktop dashboard](screenshots/oxygen-weather-desktop.png)

## Slide 2: Project Vision

The goal was to turn a simple weather app into a complete weather product.

Oxygen Weather is designed to feel modern, animated, accurate, useful, and reliable. It is not only a search box and temperature card. It includes location detection, live weather intelligence, email reports, contact support, backup behavior, Google login, and Blogger publishing.

## Slide 3: Main Problem

Most small weather apps have four problems:

- They expose API keys if everything runs in the browser.
- They stop working when the backend sleeps.
- They look basic on desktop and weak on mobile.
- They do not help users with important alerts or daily reports.

Oxygen Weather solves these problems with a Blogger frontend, Render backend, backup APIs, and email logic.

## Slide 4: Final Solution

The final project has two main parts:

- Blogger frontend at `oxygen-weather.blogspot.com`
- Render backend at `susnata-weather-app.onrender.com`

Blogger keeps the public page available. Render protects private server work such as OpenWeather API requests, Brevo email delivery, saved subscriptions, urgent alerts, and daily reports.

## Slide 5: Desktop Interface

The desktop UI includes:

- Permanent professional header
- Animated radar hero
- City search
- Use Location button
- Live weather command feed
- Current weather panel
- Comfort, rain, wind, air quality, forecast, planner, and smart brief sections
- Gmail reminder section
- Contact section
- Professional Susnata Codes footer

## Slide 6: Weather Data Flow

```text
User opens Blogger
  |
  v
Frontend requests weather
  |
  v
Render /weather endpoint
  |
  v
OpenWeather API
  |
  v
Normalized weather payload
  |
  v
Dashboard renders live UI
```

The OpenWeather API key stays private on Render.

## Slide 7: Backup Weather Flow

If Render is asleep or unreachable:

```text
Blogger frontend
  |
  v
Open-Meteo backup request
  |
  v
Browser renders backup weather
```

If both online sources fail, the app can reuse the last successful weather data from local storage.

## Slide 8: Location Logic

The location behavior is designed to be respectful:

- If browser location permission is already granted, the app loads local weather automatically.
- If permission is not granted, the app loads Jalpaiguri/default weather.
- The user can press "Use Location" to request permission.
- If permission is denied, city search still works.

## Slide 9: Google Login

The app includes a professional login interface:

- Sign in and sign up modes
- Google account chooser
- Remembered profile
- Local session behavior
- Profile details after login

Google OAuth requires the correct authorized origins in Google Cloud.

## Slide 10: Mail Alerts

The Gmail reminder section supports:

- Important alerts
- Emergency-only behavior
- Daily history report
- After-midnight outlook
- Send Test button
- Unsubscribe links
- Custom report time

The backend stores subscriptions and sends reports only when they are due.

## Slide 11: Email Delivery

Render Free can block SMTP ports, so the recommended free email method is Brevo HTTPS API.

Contact and report email flow:

```text
Frontend form
  |
  v
Render endpoint
  |
  v
Brevo HTTPS API
  |
  v
Recipient inbox
```

If Render contact fails, the app opens a Gmail/mail draft fallback.

## Slide 12: Blogger Publishing

The app can be published as a full Blogger XML theme.

Generation command:

```bash
node scripts/generate-blogger-theme.js
```

Output:

```text
blogger/oxygen-weather-blogger-theme.xml
```

This XML contains the app markup, CSS, and JavaScript for Blogger.

## Slide 13: Render Deployment

Render hosts the secure backend.

Render settings:

```text
rootDir: WeatherServer
buildCommand: npm install
startCommand: npm start
```

Important environment variables:

```text
API_KEY
PUBLIC_APP_URL
BREVO_API_KEY
BREVO_SENDER_EMAIL
CONTACT_EMAIL
GOOGLE_CLIENT_ID
KEEP_ALIVE_ENABLED
KEEP_ALIVE_URL
MAIL_CRON_SECRET
```

## Slide 14: Reliability Plan

Reliability is handled in layers:

- Blogger does not sleep.
- Render serves secure backend features.
- Keep-alive can ping `/health`.
- External cron can ping `/mail-alerts/cron`.
- Open-Meteo handles backup weather.
- Gmail/mailto handles backup contact.
- Local storage keeps the last weather result.

## Slide 15: Security Plan

Secrets stay on Render:

- OpenWeather API key
- Brevo API key
- Email sender values
- Cron secret

The frontend only stores public values such as the Google OAuth Client ID and normal UI state.

## Slide 16: What Makes It Professional

The app is professional because it has:

- Strong visual identity
- Real data architecture
- Secure backend
- Backup behavior
- Email communication
- Login/profile behavior
- Responsive UI
- Clear deployment plan
- Documentation and screenshot

## Slide 17: Final Result

Oxygen Weather became a complete deployable weather platform:

- Public frontend on Blogger
- Backend API on Render
- Weather data through OpenWeather
- Backup data through Open-Meteo
- Email through Brevo
- Login through Google OAuth
- Contact fallback through Gmail/mail drafts
- Documentation through README and this presentation

## Slide 18: Closing

Oxygen Weather shows how a simple idea can become a full product when design, backend, reliability, deployment, and documentation are built together.

Author: Susnata Biswas

Brand: Susnata Codes
