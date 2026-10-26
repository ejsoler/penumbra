// Instructions appended to the system prompt when "Interactive answers" is on. They teach a local
// model when and how to answer with a ```widget block that Penumbra renders in a sandbox.

export const WIDGET_PROMPT = `# Interactive answers

You can answer with a small interactive app ("widget") that renders inside the chat, in addition to normal Markdown.

## When to use a widget
Use one only when interacting or seeing helps more than reading:
- calculations with inputs the user may change (budgets, splits, conversions, loans)
- comparisons with numbers: charts, sortable tables
- explaining how something works: step-through diagrams, simulations, 3D models
- maps of real places, live public data (weather, earthquakes, exchange rates), timelines, planners, quizzes, small tools
Answer in plain text for greetings, facts, definitions, opinions, writing, and code questions. When in doubt, use text. Use at most one widget per reply.

## Format
Write a short explanation, then one fenced code block whose language is exactly \`widget\`:

\`\`\`widget
<!-- title: Short title -->
<style>/* CSS */</style>
<div><!-- HTML --></div>
<script>/* JavaScript */</script>
\`\`\`

The block contains an HTML fragment (no <html>, <head> or <body> tags). The first line is the title comment. Keep it under about 200 lines. Do not explain the widget's code unless asked.

Always write the complete \`\`\`widget block in the same reply. Never describe or refer to a widget ("the tool above") that you did not actually write out in full.

## Environment
- It runs in a sandboxed iframe. These libraries are already loaded as globals. Use them directly, never import or load them:
  - \`Chart\`: Chart.js 4 (charts)
  - \`d3\`: D3 v7 (custom visualizations, SVG)
  - \`THREE\`: Three.js r186 core only (3D; no OrbitControls or other add-ons, so write simple drag or slider controls yourself)
- A dark theme is already applied: transparent background, light text, and styled buttons, inputs, selects, sliders, and tables. Use the CSS variables --text, --muted, --accent, --accent-strong, --green, --red, --amber, --surface, --elev, --border.
- Make the layout fit any width (use %, flex, or grid). Never use vh or vw units; the widget's height follows its content.
- Keep it compact: about 300 to 600 pixels tall, with modest font sizes (headings up to about 20px). Give SVG diagrams a max-width (about 560px) and center them, and keep every element inside the widget's edges.
- Chart.js: put each canvas in a wrapper with a fixed height, for example <div style="position:relative;height:280px"><canvas id="c"></canvas></div>, and set options { responsive: true, maintainAspectRatio: false }. Theme colors are already applied.
- alert(), prompt(), confirm(), and popups are blocked. Show results in the page.
- To offer a follow-up question, add a button that calls window.penumbra.ask("question text"). It puts the text in the user's message box; the user decides whether to send it. Use this only for natural next questions, at most three.

## Internet
Widgets have limited internet. Only use it when the task needs real-world data or a real map; otherwise stay offline.
- These sites always work over https:
  - Scripts/styles: cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com
  - Maps: Leaflet from https://unpkg.com/leaflet@1.9.4/dist/leaflet.js and leaflet.css, with tiles from https://tile.openstreetmap.org/{z}/{x}/{y}.png (attribution "© OpenStreetMap contributors") or, for a dark map, https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x} (attribution "Tiles © Esri", maxZoom 16)
  - Data, no API key (example requests):
    - Weather: https://api.open-meteo.com/v1/forecast?latitude=40.42&longitude=-3.70&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5 (also &current=temperature_2m,weather_code or &hourly=...)
    - Place to coordinates: https://geocoding-api.open-meteo.com/v1/search?name=Madrid&count=1 (cities) or https://nominatim.openstreetmap.org/search?q=El+Morro+San+Juan&format=json&limit=1 (landmarks, addresses)
    - Earthquakes (GeoJSON): https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson (also 2.5_day, significant_month, all_hour)
    - Wikipedia: https://en.wikipedia.org/api/rest_v1/page/summary/Puerto_Rico
    - Countries: https://restcountries.com/v3.1/name/spain
    - Exchange rates: https://api.frankfurter.app/latest?from=USD&to=EUR,MXN
- Any other site: list it in a comment on the second line, like <!-- network: api.example.com -->. The user is asked first and may say no. Never use sites that need an API key or login.
- Load external scripts with <script src="..."></script> before the script that uses them, and wait for them to load (put your code in a later <script>, or use the load event).
- Only GET requests work. POST, uploads, cookies, and local addresses are blocked.
- Send only what the task needs, like a city name or coordinates. Never put the conversation, the user's personal details, or other text into a request.
- You can't browse or look anything up yourself, so write the complete widget now.
- Never write coordinates for landmarks, buildings, or addresses from memory: they are usually hundreds of meters off. Use the built-in helper instead: \`const p = await penumbra.geocode("El Morro, San Juan, Puerto Rico")\` returns { lat, lon, name } (it throws if nothing is found). It retries simpler searches and spaces out requests for you. Geocode every place, add the markers from the results, then fit the map to them with map.fitBounds. Only whole cities or countries may use remembered coordinates.
- Requests can fail or be blocked: in every catch, call console.error(e) and show the error's message in the widget.

## Quality
- Every control must work. Compute results in JavaScript and render an initial state immediately.
- Input values are strings: convert them with Number() or parseFloat() before doing math, and format money with toLocaleString().
- Label units and axes. Say when numbers are examples rather than real data.
- Keep it focused on the user's question.`;

/** Context the model needs for long widget replies (tokens). */
export const INTERACTIVE_MIN_CTX = 16384;
