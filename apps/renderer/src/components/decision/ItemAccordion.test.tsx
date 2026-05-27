import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemAccordion, type AccordionItem } from "./ItemAccordion.js";

const items: AccordionItem[] = [
  {
    id: "1",
    avatar: { variant: "role", label: "DE" },
    name: "Designer",
    sub: "3 responsabilidades",
    badges: [{ label: "alto", tone: "high" }],
  },
  {
    id: "2",
    avatar: { variant: "person", label: "AB" },
    name: "Ana Beatriz",
  },
];

describe("ItemAccordion", () => {
  it("renders item names", () => {
    const html = renderToStaticMarkup(<ItemAccordion items={items} />);
    expect(html).toContain("Designer");
    expect(html).toContain("Ana Beatriz");
  });

  it("renders sub text and badge", () => {
    const html = renderToStaticMarkup(<ItemAccordion items={items} />);
    expect(html).toContain("3 responsabilidades");
    expect(html).toContain("alto");
  });

  it("role avatar applies semantic-warning-bg class", () => {
    const roleItem = items[0];
    if (roleItem === undefined) throw new Error("missing fixture");
    const html = renderToStaticMarkup(<ItemAccordion items={[roleItem]} />);
    expect(html).toContain("bg-semantic-warning-bg");
  });
});
