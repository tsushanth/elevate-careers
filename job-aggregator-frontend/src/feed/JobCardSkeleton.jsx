import React from 'react';

export default function JobCardSkeleton({ count = 8 }) {
  return (
    <div className="feed-skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="feed-card feed-card-skel" key={i}>
          <span className="skel skel-title" /><span className="skel skel-line" /><span className="skel skel-line short" />
        </div>
      ))}
    </div>
  );
}
