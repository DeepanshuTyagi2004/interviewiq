# InterviewIQ brand identity (October 2026)

Replaces the earlier monochrome ink-on-paper look. Source of truth for the mark, colour, type,
materials and motion. Tokens live in `app/globals.css`; the mark in `components/layout/Logo.tsx`
and `app/icon.svg`.

## Idea: the interviewer, lit

An interview is a conversation with someone who is paying attention. The brand shows that
someone as a glass orb. It appears in the logo (the dot of the "i"), on the hero, in empty states
and as the avatar, and it is the only place the full colour range is used.

## Mark

- A lowercase **i** on a midnight-indigo squircle (`#2A2C5C` to `#0C0C1C`).
- The stem is frosted glass; the dot is the interviewer orb, lit from the top left, with a soft
  indigo halo behind it.
- Use the squircle at 16px and up. Below that, use the favicon as drawn (`app/icon.svg`).
  `app/apple-icon.png` is the same drawing full-bleed for iOS.
- Do not recolour the tile, add outlines, rotate the "i" or place the orb elsewhere.

## Wordmark

`Interview` in ink, `IQ` in the brand gradient, Plus Jakarta Sans semibold, tracking -0.035em.
One capital I at the start and the capital IQ are the whole name: "InterviewIQ".

## Colour

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Brand | `#4F5BFF` (4.9:1 with white text) | `#7B86FF` | Primary action, focus ring, selection, the "IQ", one phrase in a headline |
| Brand 2 | `#7C4DFF` | `#A582FF` | Only as the second stop of the brand gradient |
| Ink | `#1D1D1F` | `#F5F5F7` | Text, secondary actions |
| Canvas | white with soft indigo, violet and peach pools | near-black with deeper pools | Behind glass |
| Orb hues | azure, violet, rose, amber, emerald, cyan, fuchsia | same | Orbs only |

Rules: brand colour is for one or two primary actions per view, status and focus, never a
background wash on content. Tiles and monograms are graphite glass (`components/ds/palette.ts`),
not multicolour. Colour never carries meaning alone.

## Type

- **Display:** Plus Jakarta Sans (500 to 800) for `h1`, `h2`, `h3`, wordmark and numerals.
- **Text and UI:** Inter.
- **Data and code:** Geist Mono.
- Headlines are bold with tight tracking (-0.03 to -0.04em); body is 15 to 21px; nothing
  informational under 12px.

## Materials: liquid glass

| Class | Where |
| --- | --- |
| `.iq-glass` / `.iq-glass-thick` | Bars, sidebar, menus, popovers, dialogs, sheets, toasts (the functional layer) |
| `.iq-glass-card` / `.iq-card` | Cards that float over colour: dashboard, marketing cards, auth sheet |
| `.iq-stage` | Large panels that hold a product shot or orb |
| `.iq-brand-glass` | The primary button: a lit indigo pill |
| `.iq-glass-btn` | Secondary buttons and fields |

Every glass class falls back to an opaque fill under Reduce Transparency and Increase Contrast.
Glass sits over the fixed colour canvas (`body::before`); keep text on glass at 4.5:1 against the
worst-case backdrop.

## Motion

Short, springy-but-not-bouncy easing (`cubic-bezier(.25,1,.5,1)`). The orb breathes, the hero
cards float; all of it stops under Reduce Motion.

## Voice

Plain and specific: name the company, the round, the thing that happened. No badges, no
"certified", no implied company endorsement (see the root `CLAUDE.md`).
