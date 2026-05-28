# A2 Economics MCQ Practice Platform

Offline Cambridge International A Level Economics Paper 1 MCQ practice with one-question-per-image rendering, chapter and past-paper modes, and resumable local progress.

## What It Does

- Practices one cropped question image at a time
- Supports chapter-based and past-paper-based revision
- Saves progress locally with resume, review, and restart flows
- Works offline with a service worker and cached question images
- Includes bookmark and wrong-question review tools

## Project Structure

- [index.html](./index.html): app shell
- [app.js](./app.js): application state, storage, rendering, and navigation
- [style.css](./style.css): UI styling
- [data/questions.js](./data/questions.js): runtime question bundle
- [data/cache-assets.js](./data/cache-assets.js): cached asset list for offline use
- [images/questions](./images/questions): cropped question images used by the app
- [extract_questions.py](./extract_questions.py): question data extraction tool
- [crop_questions.py](./crop_questions.py): crop pipeline for question images

## Run Locally

This project is static and does not require a build step.

1. Serve the folder with any local static server.
2. Open `index.html` through that server.
3. The app stores progress in `localStorage` on your device.

Example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Data Notes

- Question images in `images/questions/` are the runtime source used by the frontend.
- The current explanation panel is intentionally a placeholder while the explanation system is being redesigned.
- Progress, bookmarks, wrong-question review, and completed attempts are stored locally in the browser.

## Release Checklist

- Choose and add a `LICENSE` before publishing publicly.
- Verify the app once through a local static server after cloning.
- Review whether source PDFs should remain in the public repository for your intended release.
