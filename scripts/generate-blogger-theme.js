const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const API_BASE_URL = 'https://susnata-weather-app.onrender.com';
const PUBLIC_APP_URL = 'https://oxygen-weather.blogspot.com';
const GOOGLE_CLIENT_ID = '567409969604-qr980ja0p5l2b52huv7kgelgncnndkuf.apps.googleusercontent.com';
const OUTPUT_FILE = path.join(ROOT_DIR, 'blogger', 'oxygen-weather-blogger-theme.xml');

const html = readText('public/index.html');
const css = readText('public/style.css');
const script = readText('public/script.js');
const earthquakeHtml = readText('public/earthquakes.html');
const earthquakeCss = readText('public/earthquake-style.css');
const earthquakeScript = readText('public/earthquake-script.js');
const earthquakeSrcdoc = buildEarthquakeSrcdoc();
const bodyMarkup = extractBodyMarkup(html)
  .replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(
    /<iframe id="earthquakeFrame" title="Live Earthquake Monitor" data-src="\/earthquakes\.html"><\/iframe>/,
    `<iframe id="earthquakeFrame" title="Live Earthquake Monitor" src="about:blank" srcdoc="${escapeAttribute(earthquakeSrcdoc)}" data-src="about:blank"></iframe>`
  )
  .trim();
const bloggerBootScript = buildBloggerBootScript(bodyMarkup, script);

const bloggerSkin = `
html,
body {
  margin: 0;
  min-height: 100%;
}

.navbar,
.blogger-clickTrap,
.blogger-system,
.widget-content {
  display: none !important;
}

#oxygenWeatherBloggerRoot {
  min-height: 100vh;
}
`;

const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html b:version='2'
      class='v2 oxygen-weather-blogger'
      expr:dir='data:blog.languageDirection'
      xmlns='http://www.w3.org/1999/xhtml'
      xmlns:b='http://www.google.com/2005/gml/b'
      xmlns:data='http://www.google.com/2005/gml/data'
      xmlns:expr='http://www.google.com/2005/gml/expr'>
<head>
  <meta content='text/html; charset=UTF-8' http-equiv='Content-Type'/>
  <meta content='width=device-width, initial-scale=1.0, viewport-fit=cover' name='viewport'/>
  <meta content='Oxygen Weather by Susnata Codes - live weather, forecast, profile login, Gmail reminders, and emergency weather alerts.' name='description'/>
  <link expr:href='data:blog.canonicalUrl' rel='canonical'/>
  <meta content='no-referrer-when-downgrade' name='referrer'/>
  <b:include data='blog' name='all-head-content'/>
  <title><data:blog.pageTitle/></title>
  <link href='https://fonts.googleapis.com' rel='preconnect'/>
  <link crossorigin='anonymous' href='https://fonts.gstatic.com' rel='preconnect'/>
  <link href='https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&amp;display=swap' rel='stylesheet'/>
  <b:skin><![CDATA[
${cdata(bloggerSkin)}
${cdata(css)}
  ]]></b:skin>
</head>
<body>
  <div id='oxygenWeatherBloggerRoot'></div>
  <script type='text/javascript'>
${bloggerBootScript}
  </script>
  <script defer='defer' onload='window.renderIcons &amp;&amp; window.renderIcons()' src='https://unpkg.com/lucide@latest'></script>
  <b:section class='blogger-system' id='blogger-system' maxwidgets='1' showaddelement='false'/>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, xml, 'utf8');
console.log(`Generated ${path.relative(ROOT_DIR, OUTPUT_FILE)}`);

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function extractBodyMarkup(source) {
  const match = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) {
    throw new Error('Could not find <body> markup in public/index.html');
  }
  return match[1];
}

function buildEarthquakeSrcdoc() {
  const body = extractBodyMarkup(earthquakeHtml)
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .trim();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Earthquake Monitor | Susnata Codes</title>
  <style>${earthquakeCss}</style>
</head>
<body>
${body}
<script src="https://d3js.org/d3.v7.min.js"></script>
<script src="https://d3js.org/topojson.v3.min.js"></script>
<script>${earthquakeScript.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
}

function buildBloggerBootScript(markup, appScript) {
  return `(function () {
    var oxygenMarkup = ${safeJsString(markup)};
    var oxygenAppScript = ${safeJsString(`${appScript}\n//# sourceURL=oxygen-weather-embedded.js`)};
    window.OXYGEN_WEATHER_API_BASE = ${safeJsString(API_BASE_URL)};
    window.OXYGEN_WEATHER_PUBLIC_URL = ${safeJsString(PUBLIC_APP_URL)};
    window.OXYGEN_GOOGLE_CLIENT_ID = ${safeJsString(GOOGLE_CLIENT_ID)};
    var oxygenRoot = document.getElementById('oxygenWeatherBloggerRoot');
    if (oxygenRoot) {
      oxygenRoot.innerHTML = oxygenMarkup;
    }
    var oxygenScriptNode = document.createElement('script');
    oxygenScriptNode.type = 'text/javascript';
    oxygenScriptNode.text = oxygenAppScript;
    document.body.appendChild(oxygenScriptNode);
  }());`;
}

function cdata(value) {
  return String(value).replace(/]]>/g, ']]]]><![CDATA[>');
}

function safeJsString(value) {
  return JSON.stringify(String(value))
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
