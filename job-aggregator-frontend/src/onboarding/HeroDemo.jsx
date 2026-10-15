import React from 'react';
import AutofillDemo from './AutofillDemo';
import HeroVideo from './HeroVideo';
import { HERO_MEDIA, hasHeroVideo } from './heroMedia';
import { previewRows, SAMPLE_PROFILE } from './profileFields';

const ROWS = previewRows(SAMPLE_PROFILE);
const RESUME_LINES = [
  'Alex Morgan',
  'alex.morgan@example.com',
  '(555) 010-0142  |  Austin, Texas',
  'linkedin.com/in/alex-morgan-sample',
  'B.S. Computer Science, State University',
  'Software Engineer, 6 years',
];

// Loaded lazily by ValueHero. `media` swaps in a real recording (see heroMedia.js).
export default function HeroDemo({ media = HERO_MEDIA }) {
  if (hasHeroVideo(media)) return <HeroVideo media={media} />;
  return (
    <AutofillDemo
      rows={ROWS}
      sourceTitle="Sample resume"
      sourceLines={RESUME_LINES}
      label="Demo with sample data"
      ariaLabel="Demo with sample data: details from a sample resume are filled into a job application form automatically."
    />
  );
}
