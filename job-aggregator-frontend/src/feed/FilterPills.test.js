import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FilterPills from './FilterPills';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); });
const render = (props) => act(async () => { root.render(<FilterPills filters={{ remote: false, type: '', days: '' }} onChange={() => {}} {...props} />); });
const roleSelect = () => container.querySelector('select[aria-label="Role"]');
const ROLES = [{ slug: 'software-engineering', label: 'Software engineering' }, { slug: 'design', label: 'Design' }];

test('no roles (feature off, still loading, or failed): no Role control', async () => {
  await render({ roles: [], role: '', onRoleChange: () => {} });
  expect(roleSelect()).toBeNull();
  await render({});
  expect(roleSelect()).toBeNull();
});

test('with roles: an accessible Role select with All roles first, in the given order', async () => {
  await render({ roles: ROLES, role: '', onRoleChange: () => {} });
  const sel = roleSelect();
  expect(sel).not.toBeNull();
  expect([...sel.options].map(o => o.textContent)).toEqual(['All roles', 'Software engineering', 'Design']);
  expect(sel.value).toBe('');
  expect(sel.className).toContain('feed-pill');
});

test('choosing a role and All roles reports the slug / empty string', async () => {
  const onRoleChange = jest.fn();
  await render({ roles: ROLES, role: '', onRoleChange });
  const sel = roleSelect();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'design');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onRoleChange).toHaveBeenLastCalledWith('design');
  await render({ roles: ROLES, role: 'design', onRoleChange });
  expect(roleSelect().value).toBe('design');
  expect(roleSelect().className).toContain('on');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(roleSelect(), '');
    roleSelect().dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onRoleChange).toHaveBeenLastCalledWith('');
});

test('Clear all also clears the role', async () => {
  const onChange = jest.fn(); const onRoleChange = jest.fn();
  await render({ roles: ROLES, role: 'design', onChange, onRoleChange });
  const clear = [...container.querySelectorAll('button')].find(b => b.textContent === 'Clear all');
  await act(async () => { clear.click(); });
  expect(onChange).toHaveBeenCalledWith({ remote: false, type: '', days: '', salary: '' });
  expect(onRoleChange).toHaveBeenCalledWith('');
});

const salarySelect = () => container.querySelector('select[aria-label="Minimum salary"]');

test('Min salary: an accessible select, Min salary first, dollar floors in order', async () => {
  await render({});
  const sel = salarySelect();
  expect(sel).not.toBeNull();
  expect(sel.className).toContain('feed-pill');
  expect([...sel.options].map(o => o.textContent)).toEqual(['Min salary', '$50k+', '$80k+', '$100k+', '$120k+', '$150k+', '$200k+']);
  expect(sel.value).toBe('');
});

test('choosing a salary reports it with the other filters kept; the pill shows as on', async () => {
  const onChange = jest.fn();
  await render({ onChange, filters: { remote: true, type: '', days: '', salary: '' } });
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(salarySelect(), '100000');
    salarySelect().dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith({ remote: true, type: '', days: '', salary: '100000' });
  await render({ onChange, filters: { remote: false, type: '', days: '', salary: '100000' } });
  expect(salarySelect().value).toBe('100000');
  expect(salarySelect().className).toContain(' on');
});

test('a salary alone shows Clear all, and Clear all resets it', async () => {
  const onChange = jest.fn();
  await render({ onChange, filters: { remote: false, type: '', days: '', salary: '150000' } });
  const clear = [...container.querySelectorAll('button')].find(b => b.textContent === 'Clear all');
  expect(clear).toBeDefined();
  await act(async () => { clear.click(); });
  expect(onChange).toHaveBeenCalledWith({ remote: false, type: '', days: '', salary: '' });
});
