import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { RouteErrorBoundary } from "./RouteErrorBoundary.js";

// Note: React error boundaries do NOT catch during server rendering
// (renderToStaticMarkup), so the catch/fallback path is covered by the standard
// React contract (getDerivedStateFromError) rather than this test. Here we just
// assert the wrapper renders its children transparently on the happy path.
describe("RouteErrorBoundary", () => {
  it("renders children unchanged when nothing throws", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RouteErrorBoundary>
          <p>route content</p>
        </RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(html).toContain("route content");
  });
});
