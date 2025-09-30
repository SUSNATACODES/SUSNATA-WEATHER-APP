// server.js
const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();
const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, '../public'))); // serve frontend files

// Weather API endpoint
app.get('/weather', async (req, res) => {
    const { city, lat, lon } = req.query;

    if (!city && (!lat || !lon)) {
        return res.status(400).json({ error: 'City or latitude/longitude is required' });
    }

    try {
        const apiKey = process.env.API_KEY;
        let url;

        if (city) {
            // Search by city name
            url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;
        } else {
            // Search by coordinates
            url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
        }

        const response = await axios.get(url);
        res.json(response.data);
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: 'Failed to fetch weather' });
    }
});

// Fallback: serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
