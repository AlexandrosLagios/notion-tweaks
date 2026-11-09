import * as NotionTweaksSchedule from './schedule.ts';

// The send time picker of the panel and of the comment box button. The comment box script loads this module at run time.

const timeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export const PICKER_STYLE = `
  .presets { display: grid; gap: 2px; margin-bottom: 10px; }
  .preset { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 12px; width: 100%; padding: 6px 8px;
    border: 0; border-radius: 4px; font: inherit; text-align: left; color: inherit; background: none; cursor: pointer; }
  .preset:hover, .preset:focus-visible { background: #8883; }
  .preset span { opacity: 0.65; }
  .custom { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 8px; padding-top: 10px; border-top: 1px solid #8884; }
  .custom span { grid-column: 1 / -1; font-weight: 600; }
  .custom input { box-sizing: border-box; width: 100%; padding: 4px 6px; font: inherit; }
`;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

// The local date and time in the format of the date and the time fields: 2026-11-10T09:00.
function localInputValue(time: number) {
  const date = new Date(time);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

// A preset click calls choose. The host reads the date and time fields with chosen() when the user submits them.
export function createPicker(choose: (sendAt: number) => void) {
  const presets = el('div', { className: 'presets' });
  const date = el('input', { type: 'date', required: true, ariaLabel: 'Date' });
  const time = el('input', { type: 'time', required: true, ariaLabel: 'Time' });
  return {
    element: el('div', {}, presets, el('div', { className: 'custom' }, el('span', { textContent: 'Pick date and time' }), date, time)),
    reset(now: number) {
      presets.replaceChildren(
        ...NotionTweaksSchedule.presets(now).map(({ label, sendAt }) => {
          const button = el('button', { type: 'button', className: 'preset' }, label, el('span', { textContent: timeFormat.format(sendAt) }));
          button.addEventListener('click', () => choose(sendAt));
          return button;
        }),
      );
      const fallback = localInputValue(NotionTweaksSchedule.defaultSendAt(now));
      date.min = localInputValue(now).slice(0, 10);
      date.value = fallback.slice(0, 10);
      time.value = fallback.slice(11);
    },
    chosen: () => new Date(`${date.value}T${time.value}`).getTime(),
  };
}
