# Susnata Weather App 🌤️

A simple weather app that shows the **current weather** for any city.  
Built with **HTML, CSS, JavaScript (frontend)** and **Node.js + Express (backend)**, using the **OpenWeather API** for live data.  
This project can also be deployed easily on **Render.com** using `render.yaml`.

---

## 🚀 How to Run Locally

1. **Clone this repository:**
   ```bash
   git clone https://github.com/susnatacodes/susnata-weather-app.git

2. Go to `WeatherServer/`
3. Run `npm install`
4. Create a `.env` file in `WeatherServer/`:

    ```
    OPENWEATHER_API_KEY=your_api_key_here
    PORT=3000
    ```

5. Start the server:
    ```
    npm start
    ```

6. Open your browser and go to `http://localhost:3000`

## How to Deploy on Render.com

Ensure you have render.yaml in your project root. Example content:
services:
  - type: web
    name: susnata-weather-app
    env: node
    buildCommand: npm install
    startCommand: node WeatherServer/index.js
    plan: free
    autoDeploy: true

Push your code to GitHub.
Connect your repository to Render.com.
Render will automatically detect render.yaml and deploy your app.
Your live app URL will be similar to:
https://susnata-weather-app.onrender.com

## 📦 Project Structure

```
Weather Map/
├── WeatherServer/
│   ├── index.js
│   ├── package.json
│   └── .env
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── render.yaml
└── README.md
```

## 📝 License

MIT License

## Features

Search for current weather by city name
Displays temperature, weather condition, humidity, and wind speed
Clean and responsive UI
Live data powered by OpenWeather API
Easy deployment via Render.com

## 👩‍💻 About Me

Hi! I’m Susnata Biswas, an Electronics & Telecommunication Engineering student.
I love coding, building projects, and exploring technology.
Check out my blog for more projects: susnatacodes.blogspot.com