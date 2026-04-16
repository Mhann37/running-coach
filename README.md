# Running Coach - Treadmill BLE Prototype

A real-time running coach web app that connects to your Black Lord treadmill via Bluetooth Low Energy (BLE) and provides live coaching feedback.

## 🚀 Quick Start

### Option 1: Test Locally (Immediate)

1. **Download the file:**
   - Download `index.html` from this repo
   - Transfer it to your Android phone

2. **Open in Chrome:**
   - Open the `index.html` file in **Chrome browser** on your Android phone
   - Make sure your treadmill is turned on and Bluetooth is enabled

3. **Connect:**
   - Tap "Connect to Treadmill"
   - Select your treadmill (FS-4FF13D) from the Bluetooth dialog
   - Start running!

### Option 2: Deploy to GitHub Pages (Recommended)

1. **Enable GitHub Pages:**
   - Go to your repo Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` → `/root`
   - Save

2. **Access your app:**
   - Wait 1-2 minutes for deployment
   - Visit: `https://mhann37.github.io/running-coach/`
   - Open this URL in Chrome on your Android phone

3. **Connect and run:**
   - Tap "Connect to Treadmill"
   - Select FS-4FF13D from the list
   - Start your workout!

## 📱 Requirements

- **Android phone** with Chrome browser
- **Bluetooth** enabled
- **Black Lord treadmill** (FS-4FF13D) turned on
- **HTTPS** (required for Web Bluetooth API)
  - Local file:// works
  - GitHub Pages works (auto HTTPS)

## ✨ Features (Current Prototype)

### Real-time Metrics Display
- **Pace** (min/km) - calculated from speed
- **Speed** (km/h) - raw treadmill data
- **Distance** (km) - cumulative distance
- **Time** - elapsed workout time
- **Incline** (%) - current incline percentage
- **Calories** - energy expenditure

### Basic Coaching Feedback (every 15 seconds)
- **Warm-up guidance** (< 5 km/h)
- **Easy pace** (5-8 km/h) - aerobic base building
- **Tempo pace** (8-11 km/h) - controlled effort
- **Speed work** (> 11 km/h) - high intensity
- **Incline feedback** - when incline > 2%
- **Distance milestones** - every 1km

### Debug Panel
- View raw BLE connection logs
- Monitor data parsing
- Troubleshoot connection issues

## 🔧 Technical Details

### BLE Protocol
- **Service:** FTMS (Fitness Machine Service) - UUID `0x1826`
- **Characteristic:** Treadmill Data - UUID `0x2ACD`
- **Update Rate:** ~1-2 seconds (automatic notifications)

### Data Parsed
- Instantaneous Speed
- Total Distance
- Incline/Ramp Angle
- Expended Energy
- Elapsed Time
- Heart Rate (if external monitor connected)

## 🐛 Troubleshooting

### "Web Bluetooth not supported"
- **Solution:** Use Chrome browser on Android (not Safari, Firefox, or Samsung Internet)

### Can't find treadmill in Bluetooth dialog
- **Check:** Treadmill is powered on
- **Check:** Bluetooth enabled on phone
- **Check:** Treadmill not already connected to another device (Fit Show app)
- **Try:** Restart treadmill Bluetooth

### Metrics show 0.0 or --:--
- **Check:** Treadmill is actually running (belt moving)
- **Check:** Look at Debug panel for parsing errors
- **Note:** Some metrics only appear when treadmill is in motion

### Connection drops frequently
- **Check:** Phone stays close to treadmill (BLE range ~10m)
- **Check:** Phone screen doesn't lock (keeps BLE connection alive)
- **Tip:** Set screen timeout to "Never" during workouts

## 🎯 Next Steps / Roadmap

### Phase 2 - Enhanced Coaching
- [ ] AI-powered coaching via Gemini/Claude API
- [ ] Personalized feedback based on training zones
- [ ] Workout plan integration (intervals, tempo runs)
- [ ] Voice coaching (text-to-speech)

### Phase 3 - Data & History
- [ ] Save workout history (Firebase/Supabase)
- [ ] Analyze trends and progress
- [ ] Export to Strava/Garmin

### Phase 4 - Advanced Features
- [ ] Control treadmill speed/incline programmatically
- [ ] Pre-programmed workouts
- [ ] External heart rate monitor support (Whoop, Polar, etc.)
- [ ] Multi-user profiles

## 📊 What Data Can We Access?

Based on your nRF Connect scan, your treadmill supports:

✅ **Currently Used:**
- Instantaneous Speed
- Total Distance
- Incline
- Elapsed Time
- Calories

✅ **Available (Not Yet Used):**
- Resistance Level
- Step Count
- Power Measurement
- Elevation Gain
- Heart Rate (from external sensors)

✅ **Control Capabilities:**
- Speed target setting
- Incline target setting
- Resistance target setting
- Power target setting

## 🏗️ Tech Stack

- **Frontend:** Pure HTML/CSS/JavaScript (no framework)
- **BLE API:** Web Bluetooth API
- **Deployment:** GitHub Pages (static hosting)
- **Future:** React/Next.js, Firebase, Gemini API

## 📝 License

MIT

## 🤝 Contributing

This is currently a prototype. Feel free to:
- Test and report issues
- Suggest features
- Submit PRs

---

**Built by Matt** | [GitHub](https://github.com/Mhann37/running-coach)
