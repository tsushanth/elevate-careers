// Slot for a real screen recording of the extension. Leave every value empty to show the
// built-in animation. To switch over, put the files in job-aggregator-frontend/public/demo/
// and set (paths are served from the site root):
//   export const HERO_MEDIA = {
//     mp4: '/demo/autofill.mp4',
//     webm: '/demo/autofill.webm',   // optional
//     poster: '/demo/autofill.jpg',  // shown before playback and with reduced motion
//     width: 1280, height: 720,      // intrinsic size, reserves the space (no layout shift)
//   };
// Keep the recording muted, ~20 s, under ~3 MB. The "Demo with sample data" label stays.
export const HERO_MEDIA = { mp4: '', webm: '', poster: '', width: 1280, height: 720 };

export const hasHeroVideo = (m = HERO_MEDIA) => !!(m && (m.mp4 || m.webm));
