import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCaptionListEntities } from "../captionListAugment";

test("extracts recommendation lines after a top recommendations header", () => {
  const source = {
    metadata: {
      title: 'R E S H U on Instagram: "Farmers market at 6 am @thefreshfactoryindia with live music set by @denoykp @lional_lishoy',
      description:
        'Farmers market at 6 am @thefreshfactoryindia with live music set by @denoykp @lional_lishoy\n\nMy top recommendations /\n@superbrew.in for authentic Japanese ceremonial grade matcha\n@nariandkage for freshly made cheese and spreads\n@sprout.og loved their mornings buns and multigrain cookies',
    },
    transcript: { text: "" },
    ocr: { text: "" },
  } as never;

  const entities = extractCaptionListEntities(source);

  assert.equal(entities.length, 3);
  assert.deepEqual(
    entities.map((entity) => entity.name),
    ["Superbrew", "Nariandkage", "Sprout"],
  );
});

test("extracts cafe list handles after a cafe details header", () => {
  const source = {
    metadata: {
      title: 'The Countless Calories on Instagram: "Cafe details✨💛\n\n@pourover.in\n@aprilbykay\n@lordofthedrinkscp\n@nukkadcafe\n@callchotu_india\n@cafe_diaries\n@the_autumnhouse\n@abovethere_\n@sundayhouseindia\n@thesaltcafedelhi\n@jugmugthela',
      description:
        'Cafe details✨💛\n\n@pourover.in\n@aprilbykay\n@lordofthedrinkscp\n@nukkadcafe\n@callchotu_india\n@cafe_diaries\n@the_autumnhouse\n@abovethere_\n@sundayhouseindia\n@thesaltcafedelhi\n@jugmugthela',
    },
    transcript: { text: "" },
    ocr: { text: "" },
  } as never;

  const entities = extractCaptionListEntities(source);

  assert.equal(entities.length, 11);
  assert.equal(entities[0]?.name, "Pourover");
  assert.equal(entities[9]?.name, "Thesaltcafedelhi");
});
