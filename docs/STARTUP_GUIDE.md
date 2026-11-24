# Startup Guide

## 1. Get the code
```bash
git clone https://github.com/rohitgautamm/VineReviewAssistant.git
```

## 2. Install the extension
**Desktop (Chrome / Edge / Brave / Yandex)**
1. Open `chrome://extensions` (Yandex: `browser://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** and select the cloned folder.

**Phone (Yandex / Kiwi)**
1. Copy the folder to the phone.
2. Open the extensions page, enable Developer mode, load the folder (or zip, if the browser supports it).
3. After updating files, reload the extension.

## 3. Add an AI key (needed for translation)
Open the Studio, click **AI Settings**, pick Gemini / OpenAI / Claude and paste your key.

## 4. Your first review
1. Open the Studio and enter or fetch the product details.
2. Choose a dictation language and tap **Dictate Experience**. Speak; it stops after 15 s of silence.
3. Add photos from gallery or **Take Photo with Camera**.
4. Tap **Fix Speech-to-Text** (keeps your words) or **Generate** (your tone). Non-English input is translated to English.
5. Check the guideline scanner, then **Prefill on Amazon**.

## 5. Optional: phone photo bridge
Requires Node.js. Double-click `start-phone-bridge.bat` (or `node phone-bridge/server.js`), click **Upload from Phone (QR Bridge)** and scan the QR code on the same Wi-Fi.