import React, { useState } from 'react';
import PlaceTypeahead from './PlaceTypeahead';

export default function SearchBar({ apiBase, q, place, onSearch }) {
  const [text, setText] = useState(q);
  const [pendingPlace, setPendingPlace] = useState(place);
  const typeahead = React.useRef(null);
  React.useEffect(() => { setPendingPlace(place); }, [place]);
  const submit = (e) => {
    e.preventDefault();
    // typed place text that was never chosen: pick the first suggestion (which searches) or reset the box
    if (typeahead.current && typeahead.current.resolve()) return;
    onSearch(text.trim(), pendingPlace, false);
  };
  return (
    <form className="feed-search" role="search" onSubmit={submit}>
      <input type="search" aria-label="Job title, skill or company" placeholder="Title, skill or company"
        value={text} onChange={(e) => setText(e.target.value)} />
      <PlaceTypeahead ref={typeahead} apiBase={apiBase} place={pendingPlace} onChange={(p) => { setPendingPlace(p); onSearch(text.trim(), p, true); }} />
      {/* Keep focus in the place box on mousedown: otherwise the box blurs, its suggestions clear ~120 ms later, and a
          slow click on Search finds no suggestion to pick (the typed city would be discarded). */}
      <button type="submit" className="feed-search-btn" onMouseDown={(e) => e.preventDefault()}>Search</button>
    </form>
  );
}
