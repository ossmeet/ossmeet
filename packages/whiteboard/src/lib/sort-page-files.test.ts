import { describe, expect, it } from "vitest";
import { sortPageFiles } from "./sort-page-files";

describe("sortPageFiles", () => {
  it("sorts rendered PDF pages numerically", () => {
    expect(
      sortPageFiles([
        "page-10.png",
        "page-2.png",
        "page-1.png",
        "page-11.png",
      ])
    ).toEqual([
      "page-1.png",
      "page-2.png",
      "page-10.png",
      "page-11.png",
    ]);
  });

  it("keeps non-page files after numbered page images", () => {
    expect(
      sortPageFiles([
        "notes.txt",
        "page-2.png",
        "page-1.png",
        "preview.png",
      ])
    ).toEqual([
      "page-1.png",
      "page-2.png",
      "notes.txt",
      "preview.png",
    ]);
  });
});
