# Documentation

## Architecture
| File | Role |
|---|---|
| `manifest.json` | MV3 manifest, permissions |
| `background.js` | Service worker: AI calls (Gemini/OpenAI/Claude), Hindi/regional-language translation retry, PDP fetch, handoff |
| `studio.html/js/css` | Review Studio UI: dictation, photos, tone, generate |
| `js/voice-dna.js` | Prompt builder + offline synthesizer (includes translation rule) |
| `js/guidelines-engine.js` | Amazon guideline scanner / auto-fix |
| `js/amazon-review-prefill.js` | Fills Amazon review form and attaches photos |
| `js/media-processor.js` | HEIC/WebP to JPEG, EXIF strip |
| `phone-bridge/` | Local Node server + mobile page for phone-to-PC photos |

## Voice dictation
- Pick the language in the dropdown beside **Dictate Experience**: English, Hindi, Marathi, Punjabi, Malayalam, Kannada, Telugu, Tamil. Choice is remembered.
- Dictation stops after **15 seconds of silence** (or when you tap the button). Each phrase is committed once to avoid the duplicate-text bug seen on mobile browsers.
- Translation to English happens when you tap **Fix Speech-to-Text** / **Generate**. It needs an AI API key; the offline mode shows an error for non-English input. The output is checked and retried up to 2 times if it still contains Hindi/Hinglish.

## Photos
- Drop zone: click to pick from gallery, drag-drop or paste.
- **Take Photo with Camera** opens the rear camera directly.

## AI settings
Open **AI Settings** in the Studio, choose a provider and paste a key. Keys are stored in the browser's extension storage only and are never part of this repository.

## Troubleshooting
| Problem | Fix |
|---|---|
| Changes not visible | Reload the extension (`chrome://extensions` > reload). A phone has its own copy: re-import the folder. |
| Hindi pasted untranslated | Add an API key in AI Settings, then tap Generate again. |
| Language not recognised | Install that language's voice pack in Android Settings > Google > Voice. |
| Dictation unsupported | Browser lacks Web Speech API; use the keyboard mic. |
| Camera button opens gallery | Browser ignores `capture`; allow camera permission for the site. |