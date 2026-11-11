# Footage handoff — Good company

The current local photos are interim assets. Alex's event shoot will replace them.

- **Hero:** `data-media-slot="hero"` in index.html, currently `/landing/hero.jpg`. Use a people-first moment, medium/wide shot with faces and interaction; both portrait 4:5 and landscape originals help. Keep the key subject near the centre so mobile cropping works.
- **Community:** `data-media-slot="community"`, currently the licensed Canggu image. A candid check-in, conversation, dinner or workshop moment fits here. Target 4:3.
- **Product footage:** capture the real event page, registration, QR pass and host check-in on a phone and MacBook. Include clean screen recordings as well as filmed devices. These will replace the interim illustrations after selection, without changing the page's five-section structure.
- **Video:** supply clean clips without baked-in text/music, ideally 5–10 seconds per action. Use a poster photo, muted inline playback and a visible pause control if we add autoplay. Respect reduced motion and preserve a still-image fallback.
- Export web photos as WebP/AVIF around 1600 px wide, keep original masters separately. Do not place raw camera footage in public/.

## BaliSquad gallery on `/about`

The room photo and five silent clips from the meetup are in the gallery. The clips use Apple's VideoToolbox super-resolution. The MP4s and their WebP posters live in `meetup/`.

Only the clip closest to the center loops. The gallery advances every 15 seconds and returns to the start at the end. Playback and auto-advance pause when the gallery leaves view, the tab is hidden, or the user prefers reduced motion.

The posters load first. The first clip starts buffering near the gallery, and a playing clip warms only the next one. Video switches once horizontal scrolling settles.

MP4 names end in the first 12 characters of the file's SHA-256 digest. When replacing a clip, give it the new digest in its filename and update `data-src` in `index.html` so browsers can cache each version independently.

| Clip | Source in the media pack | Cut within the source |
| --- | --- | --- |
| Speaker, close-up | `02_New_Video_Pitch/01_Speaker_Explaining.mp4` | 0.20–2.75 s |
| Meetup with laptop | `01_New_Video_Landing/02_Meetup_Scene_With_App.mp4` | 0.00–5.60 s |
| Discussion | `01_New_Video_Landing/05_Audience_Interaction.mp4` | 1.10–6.30 s |
| Two people talking at the table | `06_Previous_Selections/09_Organizer_conversation.mp4` | 3.90–5.87 s |
| QR pass handoff | `02_New_Video_Pitch/04_Real_QR_CheckIn.mp4` | 3.00–7.80 s |

Still missing: a portrait phone clip of registration and the QR pass, and a landscape laptop clip of the guest list and check-in. Add them to the end of the gallery when they exist.

The existing slogan remains: “Events people actually show up to.”
