import assert from "node:assert/strict";
import test from "node:test";
import { buildDraftIntelligenceOutput } from "../draft";

test("draft heuristic prefers scenic Explore places over Instagram boilerplate", () => {
  const output = buildDraftIntelligenceOutput({
    mode: "deep",
    metadata: {
      sourceUrl: "https://www.instagram.com/p/C-xouRYyyEY/",
      canonicalUrl: "https://www.instagram.com/p/C-xouRYyyEY/",
      platform: "instagram",
      title: "Amit Dhiman on Instagram: &quot;Follow &#064;amit_dhiman___ for such videos",
      description:
        "Nandi Hills is a set of breathtaking hillocks which is a complete nature retreat. From catching the stunning views of the rising and setting sun to camping and trekking, people come here to indulge in a wide variety of activities. The best part of visiting the top of the hill is that you will get to enjoy the view of low lying clouds floating around you. #bangalore #nandihills #sunrise #naturelovers #roadtrip",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
    },
    transcript: null,
    ocr: null,
    source: "https://www.instagram.com/p/C-xouRYyyEY/",
    platform: "instagram",
    canonicalUrl: "https://www.instagram.com/p/C-xouRYyyEY/",
    combinedTextRaw: "",
    combinedTextClean: "",
  });

  assert.equal(output.structuredEntities.length, 1);
  assert.equal(output.structuredEntities[0].name, "Nandi Hills");
  assert.equal(output.structuredEntities[0].category, "see");
});
