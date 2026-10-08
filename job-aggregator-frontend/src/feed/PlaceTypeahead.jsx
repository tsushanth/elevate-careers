import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { fetchSuggest } from './feedApi';
import { placeFromSuggestion, EMPTY_PLACE } from './place';

// The box must never show text that disagrees with the place in use: Enter (or
// the form's Search button, via ref.resolve()) with typed text picks the first
// suggestion, or resets the text to the current place when there is none.
const PlaceTypeahead = forwardRef(function PlaceTypeahead({ apiBase, place, onChange }, ref) {
  const [text, setText] = useState(place.label || '');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const latest = useRef({});
  latest.current = { text, options };

  useEffect(() => { setText(place.label || ''); }, [place.label]);

  useEffect(() => {
    const term = text.trim();
    if (!open || !term || term === place.label) { setOptions([]); return undefined; }
    const mySeq = ++seq.current;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetchSuggest(apiBase, term, { signal: ctl.signal })
        .then(list => { if (mySeq === seq.current) { setOptions(list); setActive(-1); } })
        .catch(() => {});
    }, 120);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [text, open, apiBase, place.label]);

  const choose = (opt) => { onChange(placeFromSuggestion(opt)); setText(opt.label); setOpen(false); };

  // Returns true when it picked a suggestion (onChange has been called).
  const resolve = () => {
    const { text: typed, options: opts } = latest.current;
    if (typed.trim() === (place.label || '')) return false;
    if (opts.length) { choose(opts[0]); return true; }
    setText(place.label || ''); setOpen(false);
    return false;
  };
  useImperativeHandle(ref, () => ({ resolve }));

  const listShown = open && options.length > 0;

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      if (open && options.length) { e.preventDefault(); choose(options[active >= 0 && active < options.length ? active : 0]); }
      else if (text.trim() !== (place.label || '')) { e.preventDefault(); resolve(); }
    }
    else if (e.key === 'Escape') { if (listShown) { e.preventDefault(); e.stopPropagation(); } setOpen(false); setActive(-1); }
  };


  return (
    <div className="feed-place">
      <input
        type="text" role="combobox" aria-expanded={listShown} aria-controls={listShown ? 'feed-place-list' : undefined}
        aria-activedescendant={listShown && options[active] ? `feed-place-opt-${active}` : undefined}
        aria-autocomplete="list" aria-label="Location" placeholder="City, state or country"
        value={text} autoComplete="off"
        onChange={(e) => { setText(e.target.value); setOpen(true); if (!e.target.value) onChange(EMPTY_PLACE); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKeyDown}
      />
      {listShown && (
        <ul id="feed-place-list" role="listbox" className="feed-place-list">
          {options.map((o, i) => (
            <li key={`${o.type}-${o.label}`} id={`feed-place-opt-${i}`} role="option" aria-selected={i === active}
              className={i === active ? 'is-active' : ''} onMouseDown={() => choose(o)}>
              <span>{o.label}</span><span className="feed-place-count">{o.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export default PlaceTypeahead;
