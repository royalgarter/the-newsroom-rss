# RSS Render Backend

This is a backend service built with Deno for fetching, parsing, and serving RSS feeds. It also includes a "read later" functionality.

## Features

-   **RSS Feed Fetching and Parsing**: Fetches RSS feeds from provided URLs, parses them, and returns structured data.
-   **Caching**: Implements a caching mechanism to reduce redundant fetching and improve response times.
-   **"Read Later" Functionality**: Allows users to save articles for later reading.
-   **CORS Support**: Enables Cross-Origin Resource Sharing for wider accessibility.

## Technologies Used

-   [Deno](https://deno.land/): A modern runtime for JavaScript and TypeScript.
-   [Deno Standard Modules](https://deno.land/std): For HTTP server, path manipulation, and file system operations.
-   [deno-rss](https://deno.land/x/rss): A Deno module for parsing RSS feeds.
-   [case](https://deno.land/x/case): A Deno module for converting strings to different cases (e.g., title case, upper case).

## Setup

### Prerequisites

-   [Deno](https://deno.land/#installation) installed on your system.

### Installation

1.  Clone the repository:

    ```bash
    git clone <repository-url>
    cd rss-render
    cd backend
    ```

2.  Set up environment variables:

    -   `DENO_KV_URL`: URL for Deno KV database. You can use a local or remote KV store.

    You can set these in your `.env` file or directly in your shell.

### Running the Service

```bash
deno run --allow-net --allow-read --allow-env --allow-write --allow-run server.ts
```

Alternatively, if you are using a Deno configuration file (e.g., `deno.json` or `deno.jsonc`):

```bash
deno run --config deno.json server.ts
```

The server will start on port `17385` by default, or the port specified in the `PORT` environment variable.

## API Endpoints

### `GET /api/feeds` or `POST /api/feeds`

-   Fetches and parses RSS feeds.
-   **Method**: `GET` or `POST`
-   **Query Parameters (GET)**:
    -   `u`: Comma-separated list of RSS feed URLs (URL-encoded).
    -   `l`: Limit the number of items returned per feed (optional, default: 12).
    -   `x`: Hash for KV storage (optional).
    -   `v`: Version of the hash (optional).
-   **Request Body (POST)**:
    ```json
    {
      "keys": [
        {"url": "rss_feed_url_1"},
        {"url": "rss_feed_url_2", "content": "rss_feed_content"}
      ],
      "batch": [
        {"url": "rss_feed_url_1"},
        {"url": "rss_feed_url_2", "content": "rss_feed_content"}
      ],
      "update": true
    }
    ```
-   **Response**:

    ```json
    {
      "feeds": [
        {
          "title": "FEED_TITLE > Feed Title",
          "link": "feed_website_url",
          "rss_url": "rss_feed_url",
          "image": "feed_image_url",
          "order": 0,
          "items": [
            {
              "link": "article_url",
              "title": "Article Title",
              "author": "Author Name",
              "description": "Article Description",
              "published": 1678886400000,
              "updated": 1678886400000,
              "images": ["image_url_1", "image_url_2"],
              "categories": ["Category 1", "Category 2"]
            }
          ]
        }
      ],
      "hash": "unique_hash"
    }
    ```

### `GET /api/readlater`

-   Retrieves saved "read later" items.
-   **Method**: `GET`
-   **Query Parameters**:
    -   `x`: Hash to identify the user or context (optional, default: 'default').
-   **Response**:
    ```json
    [
      {
        "link": "article_url",
        "title": "Article Title",
        "description": "Article Description",
        "image_thumb": "thumbnail_url",
        "addedAt": "timestamp",
        "updatedAt": "timestamp"
      }
    ]
    ```

### `POST /api/readlater`

-   Adds or updates a "read later" item.
-   **Method**: `POST`
-   **Request Body**:
    ```json
    {
      "x": "user_hash",
      "item": {
        "link": "article_url",
        "title": "Article Title",
        "description": "Article Description",
        "image_thumb": "thumbnail_url"
      }
    }
    ```
-   **Response**:
    ```json
    {
      "success": true,
      "items": [
        {
          "link": "article_url",
          "title": "Article Title",
          "description": "Article Description",
          "image_thumb": "thumbnail_url",
          "addedAt": "timestamp",
          "updatedAt": "timestamp"
        }
      ],
      "data": {
        "x": "user_hash",
        "item": {
          "link": "article_url",
          "title": "Article Title",
          "description": "Article Description",
          "image_thumb": "thumbnail_url"
        }
      }
    }
    ```

### `DELETE /api/readlater`

-   Deletes a "read later" item.
-   **Method**: `DELETE`
-   **Request Body**:
    ```json
    {
      "x": "user_hash",
      "link": "article_url"
    }
    ```
-   **Response**:
    ```json
    {
      "success": true,
      "items": [
        {
          "link": "article_url",
          "title": "Article Title",
          "description": "Article Description",
          "image_thumb": "thumbnail_url",
          "addedAt": "timestamp",
          "updatedAt": "timestamp"
        }
      ]
    }
    ```

### `GET /html`

-   Fetches the HTML content of a given URL.
-   **Method**: `GET`
-   **Query Parameters**:
    -   `u`: URL to fetch (URL-encoded).
-   **Response**:
    -   Returns the HTML content of the URL.

## Caching Strategy

The service uses a combination of in-memory caching and Deno KV for storing fetched RSS feeds and HTML content.

-   **In-Memory Cache**: Utilizes a `Map` to store frequently accessed data, with a TTL (time-to-live) of 7 days.
-   **Deno KV**: Used for persistent storage of "read later" items and potentially for longer-term caching of RSS feed data.

## Environment Variables

-   `DENO_KV_URL`: The URL for the Deno KV database.  If not provided, Deno KV will default to a local database.
-   `PORT`: The port on which the server will listen (default: `17385`).

## Notes

-   The service attempts to extract relevant information from RSS feeds, including images, descriptions, and categories.
-   Error handling is implemented to gracefully handle issues such as failed feed fetching or parsing errors.
-   The `handleRequest` function serves as the main request handler, routing requests to the appropriate API endpoints or serving static files from the `frontend` directory.

## Contributing

Feel free to contribute to this project by submitting issues or pull requests.

## License

[MIT](LICENSE)

---

> _"In the Information Age, ignorance is a choice.", "It's not the news, it's how you get the news.", "We just decided to try to do it better." — Will McAvoy, The Newsroom by Aaron Sorkin_