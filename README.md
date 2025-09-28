# Weather Map App 🌦️

A simple weather app built with:
- HTML, CSS, JavaScript (frontend)
- Node.js + Express (backend)
- OpenWeather API for live data

## 🚀 How to Run Locally
1. Clone this repo
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
└── README.md
```

## 📝 License

MIT License