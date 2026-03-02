[x] https://github.com/jinglescode/textual-similarity-universal-sentence-encoder/tree/master
[x] https://www.jsdelivr.com/package/npm/@tensorflow-models/universal-sentence-encoder
[x] https://github.com/huggingface/transformers.js-examples?tab=readme-ov-file
[ ] https://clientvectorsearch.com/
[ ] https://ai.google.dev/edge/mediapipe/solutions/text/text_embedder/web_js
[ ] https://medium.com/@robert.lukoshko/the-ultimate-guide-to-embeddings-in-frontend-development-e4211a06bb13
[ ] https://dev.to/saunved/isfastnet-a-tiny-script-to-find-out-if-your-user-s-internet-is-fast-or-slow-4h84

https://www.reddit.com/r/worldnews+news/.rss,
https://www.reddit.com/r/askreddit+technology+youshouldknow+explainlikeimfive+todayilearned/.rss,
https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml,
https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en,
https://www.theguardian.com/uk/rss,
https://feeds.content.dowjones.io/public/rss/RSSWorldNews,
https://rss.dw.com/rdf/rss-en-all,
https://www.theverge.com/rss/index.xml,
https://techcrunch.com/feed/,
https://www.forbes.com/innovation/feed2,
https://news.ycombinator.com/rss,
https://www.producthunt.com/feed,
https://news.google.com/rss/search?q=ai+cloud&hl=en-US&gl=US&ceid=US:en,
https://www.bing.com/news/search?q=ai&format=rss
https://feeds.bbci.co.uk/vietnamese/rss.xml,
https://www.rfa.org/vietnamese/rss2.xml,
https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi,
https://vnexpress.net/rss/tin-moi-nhat.rss,
https://tuoitre.vn/rss/tin-moi-nhat.rss,
https://thanhnien.vn/rss/home.rss,
https://voz.vn/f/diem-bao.33/index.rss,
https://voz.vn/f/chuyen-tro-linh-tinh.17/index.rss,
https://rsshub.app/twitter/user/lopp,
https://rsshub.app/twitter/user/adam3us,
https://rsshub.app/twitter/user/tom_doerr



Of course. I've reviewed the loadFeedsWithContent function in frontend/index.js, specifically the
  logic for checking for stale feeds. Here's a summary of how it works and a few observations.

  How It Works

  The stale feed check is located inside the fetchReceiveJSON inner function. For each feed fetched
  from the server, it performs the following steps:

   1. It determines the most recent publication date (last_published) from the feed's items.
   2. It checks if this last_published date is more than 8 hours old.
   3. If the feed is considered stale, it displays a toast notification: "Stale detected, refresh
      up-to-date feeds".
   4. It then waits for 10 seconds.
   5. After the delay, it re-fetches the feed from the server.
   6. To prevent an infinite loop, it will only try to re-fetch a specific feed a few times.

  Observations and Potential Issues

   1. Single Stale Check: The logic is currently designed to only detect and refresh the first stale
      feed it encounters. Due to the this.skipCheckOldPublished = true; line in the finally block,
      after one stale feed triggers a refresh, all subsequent feeds in the same loading cycle will
      skip the staleness check. This could result in other stale feeds not being updated.
   2. Long Delay: The 10-second delay before the refresh is initiated is quite long and might confuse
      the user, even with the toast notification.
   3. Global Loading State: The refresh logic sets a global this.loading = true flag. This means the
      entire application will appear to be in a loading state, even though only a single feed is being
      refreshed in the background.
   4. Complexity: The recursive calls to fetchReceiveJSON with a tryCount add a layer of complexity to
      the function.

  An improved version of this logic exists in the loadFeedsWithContentV2 function within the same
  file. It addresses these points by using a shorter delay, avoiding the global loading state, and
  correctly checking every feed for staleness independently.

> carefully review the loadFeedsWithContentV2() make sure the login is indentical, nothing break when
  migrate to V2

✦ You're right to be cautious. I've carefully reviewed and compared loadFeedsWithContentV2() against
  the original loadFeedsWithContent().

  The V2 function is a significant improvement and I can confirm it fixes a critical bug where feed
  metadata (like custom tags) would be lost on every refresh. The network requests are also more
  efficient, and the stale-feed-check logic is more robust.

  However, for the migration to be completely seamless, you should be aware of two specific
  behavioral changes. The logic is not identical, and these differences could be considered
  breaking depending on how you use the application.

  1. Initialization from URL (params.u) is Removed

   * V1 (Current): The function can initialize the list of feeds from a URL parameter ?u=..., which
     contains a comma-separated list of feed URLs.
   * V2 (Proposed): This capability has been removed. The function no longer checks for this.params.u
     and will ignore it if present in the URL.

  Impact: If you rely on constructing URLs with the u parameter to share or link to specific sets
  of RSS feeds, that functionality will no longer work after switching to V2.

  2. Automatic "Fill-Up" Fetch is Removed

   * V1 (Current): If many articles are hidden because they have already been viewed, the function
     recursively calls itself to fetch more articles to try and fill the screen up to the desired
     limit.
   * V2 (Proposed): This recursive fetch has been removed. The function will fetch a batch of
     articles once. If most of them are filtered out because they've been viewed, the page will
     simply display fewer articles.

  Impact: This simplifies the loading logic and makes it more predictable, but it may result in
  pages with very few articles if the user has read most of the recent content. The V1 behavior,
  while more complex, ensures there's more content to see.

  Conclusion

  loadFeedsWithContentV2 is safer and more correct, especially regarding the preservation of
  user-added task metadata.

  If the loss of initializing feeds from the u URL parameter and the change in how viewed articles
  affect the page layout are acceptable, then migrating to V2 is highly recommended. Otherwise,
  these two pieces of logic would need to be ported from V1 into V2 before you make the switch.

Using: 1 GEMINI.md file