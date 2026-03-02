# Plan: News Feed Clustering & De-duplication

Implement semantic clustering to group similar news stories from different sources and provide a "Related Sources" UI to reduce feed clutter.

## 1. Settings & API Key Management
- **UI Update:** Add a new input field in the Settings section of `index.html` for "Gemini API Key".
- **Security:** Use `type="password"` for the input and ensure it's saved to `localStorage` (via `params.gemini_api_key`).
- **Backend Bridge:** Update `handleEmbedding` in `handlers.ts` to check for an `x-goog-api-key` header passed from the frontend if the user has provided their own key.

## 2. Embedding Logic
- **Trigger:** Hook into the feed loading lifecycle in `index.js`. Once items are post-processed, initiate the embedding process.
- **Optimization:** 
    - Use `localStorage` to cache embeddings keyed by `item.link` to avoid redundant API calls.
    - Implement basic rate-limiting/throttling for embedding requests.
- **Input:** Use a concatenation of `item.title` and `item.description` for the embedding input.

## 3. Clustering Engine
- **Algorithm:** Use the existing `hclust` utility with `cosine` distance.
- **Thresholding:** 
    - Experiment with a similarity threshold (target: ~85% similarity or 0.15 cosine distance).
    - Items within the same cluster will be grouped.
- **Primary vs. Secondary:** The first item (earliest published) in a cluster becomes the "Primary". Others are marked as "Secondary".

## 4. UI Implementation
- **Related Sources:**
    - On "Primary" items, add a "Related Sources" section below the description.
    - Show a list of small favicons + source names (or truncated titles) for all "Secondary" items in that cluster.
- **De-duplication:**
    - Hide "Secondary" items from the main feed view to reduce noise.
    - Ensure clicking a related source link opens the original article.

## 5. Verification & Testing
- Use a sample set of news (e.g., multiple reports on the same geopolitical event) to verify cluster accuracy.
- Ensure the UI remains responsive during the embedding/clustering phase (run as a background task).
