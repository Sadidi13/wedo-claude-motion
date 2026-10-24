/**
 * The storyboard process for new videos (docs/STORYBOARD.md), as guidance for
 * Claude. Served after the authoring contract by /api/bridge/contract, so the
 * Code sessions, the chat connector and the autopilot read it; the API path's
 * cached system prompt (`SYSTEM_PROMPT`) stays unchanged because it never
 * makes boards. The full style library (recipes) goes into the style-step
 * briefs instead, where it is needed.
 */
import { styleLibraryNames } from "./styleLibrary";

export { STYLE_LIBRARY, styleLibraryMarkdown, type StyleDirection } from "./styleLibrary";

export const STORYBOARD_GUIDE = `# 9. Storyboard first: every new video

A new video is never built in one go. It goes through steps the designer sees and decides in the editor's storyboard view:

1. **Style frames.** Propose 3 clearly different directions (4 at most). Each one is a complete entry file, written like a new scene, that shows ONE key moment of the video (usually the hero frame: the main title or product with the main visual) at the second given by \`time\`. Use the real copy from the brief, the video's canvas size and a finished look: typography, palette, composition, texture. A little motion is fine, but the frame at \`time\` must look done. Keep each frame under about 150 lines. Give each a 1-3 word name and one sentence on why it fits the brief.
2. **The designer picks one** in the editor (or tells you in the chat; then record the choice) and may add a note. "Try other styles" means new directions, not variations of the ones they passed on.
3. **Storyboard** in the chosen style: 4-8 shots that cover the whole duration in order. Each shot has its start and end in seconds, what we see and how it moves, the exact on-screen text, and the sound cue (music mood, sound effects by name, see section 5). Add a still sketch (\`code\` + \`time\`, a complete entry file in the chosen style) to the 2-4 key shots; start from the chosen style frame's code, because the sketches become the video's layers later. Use \`notes\` for music, pacing and transitions. Keep the copy the designer approved in the style frame.
4. **Build** only after the designer approves the storyboard (in the editor, or in the chat: then record the approval first). Write the full scene in the chosen style, shot by shot at the storyboard's times (each shot one or more named Sprites), add the sound cues as \`<Audio>\` layers, then run the quality check and fix what it reports.

Skip the storyboard only when the user explicitly asks for that ("no storyboard", "skip the storyboard", «بدون استوری‌بورد»). Changes to a project that is already open are edits, not new videos: they need no storyboard.

Write names, descriptions, shot texts and notes in the user's language (Persian for Persian briefs).

## Choosing the directions

- Choose for THIS brief: the product or subject, the audience, the platform and format (a 9:16 social reel is not a 16:9 keynote), the mood, and the brand colours, logo or product images the designer gave. A style that suits the material beats a fashionable one.
- Show a real range, for example one close to the brand, one bold, one unexpected; vary type, colour, composition and technique (flat, textured, 3D, hand-made). Never three variations of one idea.
- The style library below is a menu: combine entries, adapt them, or use any other style you know that fits better. The style step's brief lists the recipes (also \`get_style_library\` in the chat, \`node scripts/motion-bridge.mjs styles\` in a Code session).
- References: when the designer attached a reference (an image, or a contact sheet of a video's frames), look at it before anything else. Make the first style frame a close match of its look (palette, type, composition, texture, and the motion feel you can read from the frames) and say in its description what you took from it; make the others develop it or offer a clear alternative. Never copy a reference's logos, characters or text: match the style, not the content.

## Style library (names; recipes in the style step's brief)

${styleLibraryNames()}
`;
