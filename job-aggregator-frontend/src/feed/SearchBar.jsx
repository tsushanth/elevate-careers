import React, { useState } from 'react';
import PlaceTypeahead from './PlaceTypeahead';

export default function SearchBar({ apiBase, q, place, onSearch }) {
  const [text, setText] = useState(q);
  const [pendingPlace, setPendingPlace] = useState(place);
  React.useEffect(() => { setPendingPlace(place); }, [place]);
  return (
    <form className="feed-search" role="search" onSubmit={(e) => { e.preventDefault(); onSearch(text.trim(), pendingPlace); }}>
      <input type="search" aria-label="Job title, skill or company" placeholder="Title, skill or company"
        value={text} onChange={(e) => setText(e.target.value)} />
      <PlaceTypeahead apiBase={apiBase} place={pendingPlace} onChange={(p) => { setPendingPlace(p); onSearch(text.trim(), p); }} />
      <button type="submit" className="feed-search-btn">Search</button>
    </form>
  );
}
