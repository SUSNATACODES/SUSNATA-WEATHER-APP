# Susnata Weather App

Oxygen Weather is a responsive weather dashboard built with HTML, CSS, JavaScript, Node.js, and Express. The server keeps the OpenWeather API key private, normalizes city searches, and returns current conditions, forecast data, air quality, and comfort metrics to the frontend.

## Features

- Professional responsive dashboard UI
- Redesigned command-center interface with smart insights, hourly outlook, live clock, and weather-reactive animation
- Automatic local weather detection when browser location access is enabled
- Jalpaiguri default weather when location permission has not already been granted
- City search with normalized OpenWeather geocoding
- Browser location weather lookup
- Current weather, feels-like temperature, humidity, pressure, visibility, wind, sunrise, sunset, cloud cover, and precipitation
- 5-day forecast cards
- Air quality panel when provider data is available
- Celsius/Fahrenheit unit switching without extra API calls
- Recent searches stored in the browser
- Animated login/signup popup styled after the Oxygen downloaded form
- Gmail/SMTP weather reminders with important alerts, one 12:00 AM daily report, and unsubscribe links
- In-app live earthquake monitor using USGS feeds and the same dark full-screen map visual
- Server-side caching, request timeouts, and cleaner API errors
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
APP_BASE_URL=http://localhost:3000
```

Optional Gmail delivery for mail alerts:

```env
MAIL_USER=your_gmail_address@gmail.com
MAIL_PASS=your_gmail_app_password
MAIL_FROM="Oxygen Weather <your_gmail_address@gmail.com>"
MAIL_HOST=smtp.gmail.com
MAIL_PORT=465
```

For Gmail, create an app password in your Google account and use that as `MAIL_PASS`.

5. Start the server:

```bash
npm start
```

6. Open `http://localhost:3000`.

## Render Deployment

The repository includes `render.yaml`. In Render, keep `rootDir` set to `WeatherServer`, then add the environment variables:

```env
API_KEY=your_openweather_api_key_here
APP_BASE_URL=https://susnata-weather-app-oeqt.onrender.com
MAIL_USER=your_gmail_address@gmail.com
MAIL_PASS=your_gmail_app_password
MAIL_FROM="Oxygen Weather <your_gmail_address@gmail.com>"
MAIL_HOST=smtp.gmail.com
MAIL_PORT=465
```

Render will run:

```bash
npm install
npm start
```

## Project Structure

```text
SUSNATA-WEATHER-APP/
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
