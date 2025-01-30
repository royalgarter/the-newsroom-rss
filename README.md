 # RSS Feed Reader
 A simple RSS Feed Reader using Deno, Alpine.js and TailwindCSS.

 ## Features
 - Loads RSS feeds from configured json/yaml file
 - Frontend uses AlpineJS and Tailwind
 - No Database

## How to run
1. Clone the repository.
2. Run `deno run --allow-net --allow-read --allow-env backend/server.ts`
3. Open http://localhost:8000 on your browser

http://localhost:8000/?urls=https://rss.nytimes.com/services/xml/rss/nyt/World.xml,https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml,https://feeds.content.dowjones.io/public/rss/RSSWorldNews,https://rss.dw.com/rdf/rss-en-all,https://www.reutersagency.com/feed/?taxonomy=best-sectors%26post_type=best,https://www.rfa.org/vietnamese/rss2.xml,https://www.youtube.com/feeds/videos.xml?channel_id=UC4QZ_LsYcvcq7qOsOhpAX4A,https://feeds.bbci.co.uk/vietnamese/rss.xml,https://www.reddit.com/r/askreddit+technology+youshouldknow+worldnews+news+vietnam+vietnamnation/.rss

https://rss-render.deno.dev/?urls=https://rss.nytimes.com/services/xml/rss/nyt/World.xml,https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml,https://feeds.content.dowjones.io/public/rss/RSSWorldNews,https://rss.dw.com/rdf/rss-en-all,https://www.reutersagency.com/feed/?taxonomy=best-sectors%26post_type=best,https://www.rfa.org/vietnamese/rss2.xml,https://www.youtube.com/feeds/videos.xml?channel_id=UC4QZ_LsYcvcq7qOsOhpAX4A,https://feeds.bbci.co.uk/vietnamese/rss.xml,https://www.reddit.com/r/askreddit+technology+youshouldknow+worldnews+news+vietnam+vietnamnation/.rss