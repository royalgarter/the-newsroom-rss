# Gemini Guidelines

## Development Workflow

-   **Plan First:** Before implementing, draft a plan in `.chat/<feature_name>.md`.
-   **Iterate:** Implement changes step-by-step. Avoid large, sweeping modifications.
-   **Preserve Code:** When removing code, comment it out with a `DEPRECATED` notice instead of deleting it outright.

## Core Principles

-   **Simplicity & Readability:** Write simple, straightforward, and easy-to-understand code.
-   **Performance:** Consider performance without sacrificing readability.
-   **Maintainability & Testability:** Write code that is easy to update and test.
-   **Reusability:** Create reusable components and functions.
-   **Minimalism:** Less code is less debt. Keep the footprint small.
-   **Clarification & Specificity:** Ask for more details and provide open-ended suggestions if the request is ambiguous.

## Best Practices

-   **Vanilla JavaScript First:** Avoid introducing new frameworks (e.g., React, Vue) or large libraries (e.g., jQuery).
-   **Global Scope Awareness:** All JavaScript is loaded via `<script>` tags; be mindful of the global scope.
-   **Functional Style:** Prefer functional, immutable, and stateless approaches where they improve clarity.
-   **Early Returns:** Use early returns to avoid nested conditions.
-   **Descriptive Naming:** Use clear names for variables and functions (e.g., `handle` prefix for handlers).
-   **Constants:** Use constants instead of functions where possible.
-   **DRY (Don't Repeat Yourself):** Avoid code duplication.
-   **Minimal Changes:** Only modify code relevant to the current task.
-   **TODOs:** Mark issues in existing code with a `TODO:` prefix.
-   **Clean Logic:** Keep core logic clean and push implementation details to the edges.

## Formatting

-   **Indentation:** Use tabs.
-   **Semicolons:** Always use semicolons.
-   **Braces:** Use One True Brace Style (1TBS).

## Naming Conventions

-   **camelCase:** For variables and functions.
-   **UPPER_SNAKE_CASE:** For constants and globals.
-   **\_prefix:** Consider for internal/private functions.