# ✨ VinePilot AI — Smart Amazon Vine Review & Phone Photo Studio

**VinePilot AI** is a next-generation Chrome & Mobile Browser Extension inspired by SmartViner's review workflow and upgraded with **Personal Voice DNA Cloning**, a **Multi-Layer Amazon Community Guideline Rejection Shield**, **Voice-to-Bullet-Points Dictation**, **Instant QR Phone-to-Laptop Photo Upload**, and **1-Click All-Files-Together Amazon Review Prefill**.

---

## 🚀 Key Features

### 1. 🧬 Personal Voice DNA & Human Tone Engine (`js/voice-dna.js`)
- **Sounds Like a Real Human Who Used the Product**: Writes grounded, first-person reviews from your bullet points and usage context.
- **Voice DNA Sample Cloning**: Paste 1–3 of your own past approved reviews in **🧬 My Voice DNA**. VinePilot analyzes your average sentence length, paragraph rhythm, contraction rate, and punctuation habits so the AI mirrors your exact style.
- **Anti-AI Cliché Scrubber**: Automatically strips dead-giveaway LLM words (*"delve", "testament to", "game-changer", "elevate", "unparalleled", "moreover", "exceeded my expectations"*) and converts em-dashes (`—`) to standard hyphens (`-`).
- **6 Nuanced Tone Modes**: *Balanced & Honest*, *Casual Lived-In Storyteller*, *Hands-On Gear / Detail Tester*, *Warm & Enthusiastic*, *Direct & Critical*, and *Short & Punchy*.

### 2. 🛡️ 100% Amazon Community Guidelines & Rejection Shield (`js/guidelines-engine.js`)
Real-time scanner + 1-click Auto-Fix that prevents the top causes of Amazon Vine review rejections:
- **🚫 Medical, Therapeutic & FDA Claims**: Flags medical/disease trigger words (*cured, heals, inflammation, insomnia, arthritis, carpal tunnel, eczema, acne, chronic pain, FDA-approved*) and replaces them with safe subjective comfort phrasing.
- **📦 Shipping, Packaging & Seller Mentions**: Flags references to delivery speed, Prime drivers, bubble mailers, crushed outer shipping boxes, or third-party sellers.
- **🏷️ Vine / Free Product / ETV Mentions**: Flags redundant mentions of getting the product free or ETV inside the review text (since Amazon adds the Vine badge automatically).
- **🏪 Competing Stores, Counterfeit Accusations & Links**: Flags external retailer names (*Walmart, Temu, AliExpress, Target, eBay*), URLs, emails, and *"counterfeit/scam"* keywords.
- **📊 Amazon "Insightfulness" Predictor**: Estimates Amazon's 4-tier Insightfulness bar (*Needs Detail → Good → Strong → Excellent*) and checks Amazon's live **"Ideas"** topic checklist (`[data-hook="ryp-aspects-gallery-wrapper"]`) with a 1-click **"✨ Weave Missing Ideas"** button right on Amazon's review page.

### 3. 📱 Direct Phone-to-Laptop Photo & Voice Bridge (`phone-bridge/`)
Eliminates the grind of emailing, AirDropping, or transferring product photos via USB cable from your phone to your laptop:
- **Instant QR Code Pairing**: Click **📱 Upload from Phone (QR Bridge)** inside the Review Studio.
- **Mobile Camera & Multi-Photo Batch Picker (`phone-bridge/mobile.html`)**: Scan the QR code with your phone to take photos directly with your phone camera or select multiple photos from your phone gallery at once.
- **On-Device Compression & EXIF GPS Scrubbing**: Photos are automatically converted to clean, EXIF-scrubbed JPEGs and beamed directly into your laptop's Review Studio photo grid in <1 second over local Wi-Fi!
- **Phone Voice Dictation & Quick Rating**: While holding the physical product, you can also tap the star rating and dictate your pros/cons on your phone screen, syncing straight to your laptop.

### 4. ⚡ Upload All Photos Together + 1-Click Amazon Prefill (`js/amazon-review-prefill.js`)
- **All-Files-Together Attachment**: Converts HEIC/HEIC/WebP/PNG to JPEG, lets you drag-to-reorder, rotate 90°, or flip horizontally, and attaches **all photos together** into Amazon's `<input type="file" id="media">` when you click **🚀 Prefill on Amazon**.
- **Headline Protection (`keepTitle`)**: Prevents Amazon's auto-generated headline from overwriting your custom review headline after the review body is filled.
- **External AI Handoff + Contact Sheet**: Prefer using your own ChatGPT/Claude/Gemini web chat? Click **📋 Copy Prompt** and **🖼️ Copy Photos Sheet** (combines up to 9 product photos into a single numbered PNG contact sheet on your clipboard) and paste the reply back!

---

## 🛠️ Installation & Usage

### Step 1: Load the Extension in Chrome / Edge / Brave (or Mobile Kiwi Browser)
1. Open `chrome://extensions/` in your browser.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder: `the cloned folder`.

### Step 2: Start the Local Wi-Fi Phone Photo Bridge (Optional, for Instant Phone Uploads)
Double-click [`start-phone-bridge.bat`](file:///c:/Users/rohit/VineReviewAssistant/start-phone-bridge.bat) or run in terminal:
```bash
node phone-bridge/server.js
```
Then click **📱 Upload from Phone (QR Bridge)** inside the VinePilot Studio and scan the QR code with your phone camera!
*(Note: If you aren't running the local server, you can also toggle **☁️ Cloud Relay Mode** right inside the QR drawer!)*


---
## New: multilingual dictation, camera capture
Dictate in English, Hindi, Marathi, Punjabi, Malayalam, Kannada, Telugu or Tamil (auto-translated to English in your style), 15 s silence timeout, and direct camera capture.

📖 See [Startup Guide](docs/STARTUP_GUIDE.md) and [Documentation](docs/DOCUMENTATION.md).
