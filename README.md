# Susnata Weather App

Oxygen Weather is a responsive weather dashboard built with HTML, CSS, JavaScript, Node.js, and Express. The server keeps the OpenWeather API key private, normalizes city searches, and returns current conditions, forecast data, air quality, and comfort metrics to the frontend.

## Features

- Professional responsive dashboard UI
- Automatic local weather detection when browser location access is enabled
- Jalpaiguri default weather when location permission has not already been granted
- City search with normalized OpenWeather geocoding
- Browser location weather lookup
- Current weather, feels-like temperature, humidity, pressure, visibility, wind, sunrise, sunset, cloud cover, and precipitation
- 5-day forecast cards
- Air quality panel when provider data is available
- Celsius/Fahrenheit unit switching without extra API calls
- Recent searches stored in the browser
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
```

5. Start the server:

```bash
npm start
```

6. Open `http://localhost:3000`.

## Render Deployment

The repository includes `render.yaml`. In Render, keep `rootDir` set to `WeatherServer`, then add the environment variable:

```env
API_KEY=your_openweather_api_key_here
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
