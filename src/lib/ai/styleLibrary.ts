/**
 * Style directions Claude chooses style frames from (docs/STORYBOARD.md).
 * A menu, not a limit: Claude combines entries and goes beyond them when
 * another look fits the brief better. Each recipe names concrete choices that
 * render in Motion Studio (HTML / CSS / SVG / canvas / three.js / GSAP) and
 * stay a pure function of time. Written for this project; no third-party text.
 */

export interface StyleDirection {
  name: string;
  group: string;
  recipe: string;
}

const groups: Record<string, [name: string, recipe: string][]> = {
  "Commercial and product": [
    ["Keynote reveal", "hero product on pure black, rim light and floor reflection, huge clean sans headline, slow push-in, one accent colour"],
    ["Product UI", "real-looking interface cards and screens, numbers counting up, charts drawing in, a cursor moving, one accent on light or dark"],
    ["Soft gradient glass", "drifting blurred gradient blobs, frosted cards (backdrop-filter blur, 1px white border at 20%), radius 24, gentle floats"],
    ["Luxury dark", "black with warm gold (#c9a96e), wide-tracked serif capitals, slow fades and light sweeps, thin gold rules, lots of space"],
    ["Editorial minimal", "off-white paper, serif display with small sans captions, thin rules, wide margins, slow clip-path reveals"],
    ["Bold kinetic type", "huge condensed sans, two colours on black, words slam in with easeOutExpo through masks, hard cuts on the beat"],
    ["Cinematic", "letterbox bars, film grain, slow push-in, centred title cards with letter-spacing, teal shadows and warm highlights"],
    ["Sports energy", "diagonal slashes, motion-blur streaks, italic heavy type, high-contrast team colours, quick zooms and shakes on hits"],
    ["Cozy food", "warm browns and cream, soft steam, rounded serif, close-up food illustration or photo, gentle bokeh, slow drifts"],
    ["Fashion editorial", "full-bleed photo or colour field, oversized thin serif overlapping the subject, fast elegant wipes, black and one tone"],
    ["Clean corporate", "white and one brand blue, simple icons, rounded cards, grid layout, calm easeInOut transitions, friendly sans"],
    ["Startup launch", "dark navy with a vivid gradient accent, glowing pill buttons, floating UI fragments, smooth parallax"],
    ["Social captions", "9:16, bold word-by-word captions with highlight boxes, emoji-like stickers, quick punch-ins, high saturation"],
    ["Documentary explainer", "torn paper, halftone photos, bold condensed headlines, highlighter marks, motion on twos (Math.floor(t * 12) / 12)"],
    ["Real estate elegant", "architectural photo or line drawing, thin sans, beige and charcoal, slow Ken Burns pans, measured fades"],
  ],
  "Hand-drawn": [
    ["Whiteboard marker", "white board, slightly streaky marker strokes drawing on (stroke-dashoffset from time), wobbly boxes and arrows"],
    ["Chalkboard", "green-grey slate, grainy chalk lines and lettering, eraser smears, wooden frame edge"],
    ["Napkin sketch", "black felt-pen lines bleeding into soft tissue texture, a coffee ring, quick diagram arrows"],
    ["Ballpoint notebook", "ruled paper with a red margin, blue ballpoint hatching, margin doodles, handwriting-like captions"],
    ["Graphite sketchbook", "light construction lines, pencil hatching on paper tooth, smudges, the final line darker"],
    ["Engineering blueprint", "white drafting lines on cyan-blue paper, dimension arrows, a title block, faint fold marks"],
    ["Doodle marker", "thick colourful marker doodles, stars and squiggles, slight wobble, cream background"],
    ["Crayon kids", "waxy crayon strokes with paper texture showing through, primary colours, naive shapes"],
  ],
  Painterly: [
    ["Watercolour wash", "transparent layered washes with darker pooled edges, blooms, a faint pencil underdrawing, white paper showing"],
    ["Ink wash", "grey ink washes fading into mist, dry-brush strokes, a small red seal stamp, generous empty space"],
    ["Impasto oil", "thick swirling brush strokes with lit ridges, deep blues and yellows, slow swirling motion"],
    ["Gouache poster", "a few flat matte colours in receding layers, soft dry-brush edges, vintage travel-poster type"],
    ["Pointillism", "dots of pure colour that blend at a distance, canvas texture between them, dots appearing in waves"],
    ["Stained glass", "jewel-coloured glass panes with dark lead lines, light rays falling through, a dim interior"],
    ["Pastel chalk", "soft powdery pastel strokes on toned paper, blended edges, dreamy light"],
  ],
  Print: [
    ["Halftone pop comic", "Ben-Day dots, thick black outlines, primary colours, speech bubbles, comic panel borders"],
    ["Risograph", "two or three fluorescent ink layers (pink, blue, yellow) slightly misregistered, grain, overprint colours"],
    ["Linocut", "carved black shapes with white gouge marks, one red layer, off-white paper"],
    ["Wood type letterpress", "mixed wooden display letters, uneven ink coverage, letters pressed into paper"],
    ["Vintage newspaper", "1950s front page, blackletter masthead, columns, coarse halftone photo, yellowed paper"],
    ["Silkscreen repeat", "the same image repeated in a grid, garish flat colours, plates slightly off register"],
    ["Cyanotype", "white silhouettes on Prussian blue, sun-print texture, soft uneven edges"],
  ],
  "Paper and craft": [
    ["Shadow puppets", "black cut-out silhouettes with lace details on rods in front of a glowing amber screen"],
    ["Claymation", "plasticine shapes with thumbprints, waxy soft shading, shallow depth of field, slightly jerky motion on twos"],
    ["Cut-paper diorama", "layered cardstock sheets with drop shadows between them, torn white edges, parallax depth"],
    ["Origami", "faceted folded paper with crisp creases, soft studio shadows, pieces folding into place"],
    ["Punk zine", "photocopied scraps, ransom-note letters, fluorescent overprint, staples and tape"],
    ["Torn paper collage", "torn coloured paper edges, cut-out photos, tape strips, slight paper shadows"],
    ["Felt patchwork", "felt shapes with stitched edges, quilted squares, buttons, soft fabric texture"],
    ["Cross-stitch", "everything built from little X stitches on aida cloth inside a wooden hoop"],
    ["Papercraft model", "low-poly printed cardstock with fold lines and glue tabs on a cutting mat"],
  ],
  Illustration: [
    ["Flat vector explainer", "outline-free gradient shapes, friendly round characters, space or science scenes, soft navy-violet backgrounds"],
    ["Children's book", "soft textured illustrations, rounded characters, warm pastel palette, storybook serif"],
    ["Kawaii pastel", "chibi characters, pastel pink and mint, soft plum outlines, polka dots and sparkles"],
    ["Manga page", "black and white panels, speed lines, screentone shading, bold sound effects lettering"],
    ["Art nouveau card", "flowing ornamental outlines, muted lithograph colours, gold accents, arched frames"],
    ["Botanical engraving", "fine engraved hatching tinted with watercolour, Latin-style captions, cream plate"],
    ["Mosaic", "small tiles following the contours of the image, grout lines, gold tiles catching light"],
    ["Sticky-note wall", "coloured sticky notes, push pins and red string on cork, handwritten labels"],
    ["Patent drawing", "1930s black line art, precise hatching, numbered callouts, figure captions"],
    ["Illuminated manuscript", "vellum, a decorated gold initial, red headings, small marginal drawings"],
    ["Persian miniature", "flat perspective, rich lapis, turquoise and vermilion, gold borders, floral margins, delicate figures"],
  ],
  "Art and design movements": [
    ["Ukiyo-e woodblock", "Prussian-blue gradients, bold keyblock outlines, stylised waves and clouds, a red seal"],
    ["Art deco", "black lacquer and gold, sunbursts, stepped shapes, geometric elegant display type"],
    ["Constructivist", "red, black and cream, strong diagonals, photomontage, bold sans in angled blocks"],
    ["Memphis", "pastels with primaries, black outlines, squiggles, terrazzo dots, playful geometric shapes"],
    ["Bauhaus", "primary colours on cream, circles, squares and triangles, geometric type, shapes snapping together"],
    ["Swiss grid", "strict 12-column grid, huge flush-left grotesk, red, black and white, blocks sliding along the grid"],
    ["Pop art", "flat saturated colours, thick outlines, dots, repeated icons, playful zooms"],
    ["Brutalist", "raw black and white, oversized system type, hard edges, visible grid lines, abrupt cuts"],
    ["Functional minimal", "light grey, one orange accent, tiny precise labels, generous space, calm mechanical motion"],
    ["Persian geometry", "girih and star tile patterns in SVG, turquoise, lapis and gold, symmetric reveals from the centre"],
  ],
  "Retro digital": [
    ["Oscilloscope", "one green glowing vector line with bloom on a black scope graticule"],
    ["16-bit pixel", "pixel art with dithered skies, parallax layers, a game dialog box, crisp image-rendering: pixelated"],
    ["Green terminal", "phosphor green monospace text typing out, scanlines, slight barrel curve, a dark bezel"],
    ["Handheld monochrome", "four shades of green, visible LCD pixel grid, slight ghosting"],
    ["Vector arcade", "thin glowing lines on black, wireframe shapes, stroke font, 1980 arcade feel"],
    ["ASCII art", "images built from characters, monospace grid, plasma colours, scrolling text"],
    ["1-bit Mac", "black and white dithering, fill patterns, striped title bars, classic window frames"],
    ["Teletext", "40-column block grid, eight flat colours, chunky mosaic graphics"],
  ],
  "Retro UI and neon": [
    ["Synthwave", "neon grid floor, striped sunset sun, chrome title, pink script, purple sky"],
    ["Win95 desktop", "teal wallpaper, bevelled grey windows, dialog boxes stacking, pixel fonts"],
    ["Vaporwave", "pastel neon, marble statue, grid floor, katakana accents, VHS distortion"],
    ["Y2K chrome", "liquid chrome blobs, bubble letters, iridescent ice blue and lilac, sparkles"],
    ["Paint doodle", "crude aliased lines, leaking flood fills, spray dots, an old paint program window"],
    ["Neon night", "near-black, cyan and magenta glow (layered text-shadow), steady pulses, wet reflections"],
    ["VHS tape", "scan lines, colour bleed, tracking noise bars at the bottom, timestamp overlay"],
  ],
  Dimensional: [
    ["3D depth", "<Three3D> lit objects, slow camera dolly or orbit, soft key light, 2D titles above the 3D layer"],
    ["Isometric pastel", "30-degree isometric blocks, three-tone faces, pastels with one coral accent"],
    ["Voxel diorama", "a floating island of cubes, warm toy palette, soft ambient shading"],
    ["Low-poly", "flat-shaded triangle landscapes, fog, a dawn sky"],
    ["Soft 3D clay", "puffy pastel matte icons, rim light, soft contact shadows, bouncy pops"],
    ["Wireframe terrain", "cyan wire landscape on navy, hidden lines removed, HUD labels"],
    ["Paper 3D", "paper sheets with real thickness and shadows folding and stacking in space"],
  ],
  "Light and imaging": [
    ["Film noir", "black and white, venetian-blind light, smoke, heavy grain and scratches"],
    ["Deep sea glow", "black water, glowing jellyfish-like shapes, drifting particles, cyan bioluminescence"],
    ["Neon sign", "glass neon tubes on dark brick, halos, flicker-free hum glow, wet reflections"],
    ["Holographic foil", "rainbow foil sheen moving across shapes, embossed edges, glints"],
    ["Thermal camera", "heat-map colours from black through red to white, sensor noise, camera HUD"],
    ["Light painting", "long-exposure light trails in darkness, bokeh dots, trails drawing paths"],
    ["X-ray", "blue-white radiograph film on a lightbox, markers and grease-pencil notes"],
    ["Golden hour", "low warm sun, long shadows, lens flare, soft haze, slow drifting camera"],
    ["City bokeh", "night city lights blurred into circles, a sharp subject in front, cool and warm mix"],
  ],
  "Data and information": [
    ["Editorial chart", "salmon-pink page, serif headline, one claret data series, annotations drawn on"],
    ["Transit map", "metro lines at 0, 45 and 90 degrees, interchange circles, a legend, lines drawing in"],
    ["Pictogram statistics", "rows of identical pictograms as units, three muted inks, counts building up"],
    ["Topographic", "contour lines, hillshade, a dashed trail, map collar with coordinates"],
    ["Ridgeline", "stacked white signal lines on black, peaks rising in the middle"],
    ["Flow field", "thousands of hairline streamlines curving around a hidden shape, additive colour"],
    ["Dashboard", "dark panels with live-looking KPIs, sparklines, progress rings, numbers ticking"],
    ["Flat infographic", "bright flat icons, big numbers, simple bar and donut charts, step-by-step layout"],
  ],
  "Generative and type": [
    ["Paper marbling", "combed and raked floating pigment patterns, tulip drops, swirling colours"],
    ["Kinetic type", "cropped condensed words, outlines and strobe echoes, two colours, rhythmic cuts"],
    ["Op art", "black and ivory checkerboards bulging into spheres, optical vibration"],
    ["String art", "thread lines stretched between pins on dark wood, curves made of straight lines"],
    ["Guilloché", "banknote-like rosettes of fine curves, iris-coloured inks, microtext"],
    ["Truchet tiles", "quarter-circle tile maze in two inks, a word surfacing in a third"],
    ["Typographic poster", "one giant word filling the frame, tight kerning, layered sizes, bold colour blocks"],
    ["Persian calligraphy", "flowing Persian lettering drawn on stroke by stroke, gold on deep blue or ink on cream, right to left"],
  ],
  "Cosmic and psychedelic": [
    ["Psychedelic poster", "60s concert poster, vibrating complementary colours, melting wavy lettering"],
    ["Star chart", "deep navy nebulae, a ringed planet, engraved gold orbit lines and labels"],
    ["Aurora", "flowing green and violet light curtains over a dark horizon, slow shimmer"],
  ],
};

export const STYLE_LIBRARY: StyleDirection[] = Object.entries(groups).flatMap(([group, entries]) =>
  entries.map(([name, recipe]) => ({ name, group, recipe })),
);

/** Names only, one line per group (for the contract, where space matters). */
export function styleLibraryNames(): string {
  return Object.entries(groups)
    .map(([group, entries]) => `- ${group}: ${entries.map(([name]) => name).join(", ")}.`)
    .join("\n");
}

/** The full library with recipes (style-step briefs, `get_style_library`, `motion-bridge styles`). */
export function styleLibraryMarkdown(): string {
  const parts = ["# Style library", "", "A menu of directions with recipes. Combine them, adapt them to the brand, or go beyond them.", ""];
  for (const [group, entries] of Object.entries(groups)) {
    parts.push(`## ${group}`, "");
    for (const [name, recipe] of entries) parts.push(`- **${name}**: ${recipe}.`);
    parts.push("");
  }
  return parts.join("\n");
}
