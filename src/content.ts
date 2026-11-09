import type { Comment } from './notion-api.ts';
import type { ScheduledComment } from './schedule.ts';

// A content script cannot import a module statically, so the script loads the picker module at its first use.
type Picker = typeof import('./picker.ts');

const READ_EVENT = 'enhanced-notion:read-target';
const BUTTON_CLASS = 'enhanced-notion-send-later';
const SVG = 'http://www.w3.org/2000/svg';
// Notion handles these events for its own shortcuts and editor, so they stay inside the dialog.
const DIALOG_EVENTS = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'copy', 'cut'];
const DIALOG_STYLE = `
  dialog { color-scheme: light dark; box-sizing: border-box; width: 320px; padding: 14px; border: 1px solid #8884; border-radius: 8px;
    font: 14px/1.4 ui-sans-serif, -apple-system, sans-serif; color: CanvasText; background: Canvas; }
  dialog::backdrop { background: #0003; }
  .title { margin: 0 0 8px; opacity: 0.65; }
  .error { margin: 8px 0 0; color: #d44c47; }
  .error:empty { display: none; }
  .actions { display: flex; flex-direction: row-reverse; gap: 8px; margin-top: 12px; }
  .actions button { font: inherit; padding: 4px 12px; border: 1px solid #8886; border-radius: 4px; color: inherit; background: none; cursor: pointer; }
  .actions button[value=schedule] { color: white; background: #2383e2; border-color: #2383e2; }
`;

type Target = Comment & { isPlainText: boolean };

function readTarget(box: HTMLElement): Target | null {
  box.dispatchEvent(new CustomEvent(READ_EVENT, { bubbles: true }));
  const answer = box.dataset.enhancedNotionTarget;
  delete box.dataset.enhancedNotionTarget;
  return answer ? JSON.parse(answer) : null;
}

let pickerModule: Promise<Picker> | undefined;
const loadPicker = () => (pickerModule ??= import(chrome.runtime.getURL('src/picker.js')));

// The dialog lives in a shadow root, so the styles of Notion and of the dialog stay apart.
function createDialog({ el, createPicker, PICKER_STYLE }: Picker) {
  let choose = (_sendAt: number) => {};
  const picker = createPicker((sendAt) => choose(sendAt));
  const error = el('p', { className: 'error' });
  const schedule = el('button', { value: 'schedule', textContent: 'Schedule' });
  const form = el(
    'form',
    { method: 'dialog' },
    el('p', { className: 'title', textContent: 'Send later' }),
    picker.element,
    error,
    el('div', { className: 'actions' }, schedule, el('button', { value: '', textContent: 'Cancel', formNoValidate: true })),
  );
  form.addEventListener('submit', (event) => {
    if (event.submitter === schedule) {
      event.preventDefault();
      choose(picker.chosen());
    }
  });
  const dialog = el('dialog', {}, form);
  const host = el('div');
  host.attachShadow({ mode: 'open' }).append(el('style', { textContent: DIALOG_STYLE + PICKER_STYLE }), dialog);
  for (const type of DIALOG_EVENTS) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }
  document.body.append(host);
  return { dialog, picker, error, schedule, onChoose: (handler: typeof choose) => (choose = handler) };
}

let dialogParts: ReturnType<typeof createDialog> | undefined;

// Resolves with the chosen time once submit accepts it, or with undefined when the user cancels.
async function askSendAt(problem: string | undefined, submit: (sendAt: number) => Promise<string | undefined>) {
  const parts = (dialogParts ??= createDialog(await loadPicker()));
  const { dialog, picker, error, schedule } = parts;
  picker.reset(Date.now());
  picker.element.hidden = schedule.hidden = Boolean(problem);
  error.textContent = problem ?? '';
  dialog.showModal();
  return new Promise<number | undefined>((resolve) => {
    let isSending = false;
    parts.onChoose(async (sendAt) => {
      if (isSending) {
        return;
      }
      isSending = true;
      const message = await submit(sendAt);
      isSending = false;
      error.textContent = message ?? '';
      if (!message) {
        resolve(sendAt);
        dialog.close();
      }
    });
    dialog.onclose = () => resolve(undefined);
  });
}

async function scheduleEntry(entry: ScheduledComment): Promise<string | undefined> {
  try {
    const { error } = await chrome.runtime.sendMessage<unknown, { error?: string }>({ schedule: entry });
    return error;
  } catch {
    return 'Reload this page, because the extension was updated.';
  }
}

// Notion keeps the draft in its editor, so a delete in the textbox clears the draft the way the user's own delete does.
function clearDraft(box: HTMLElement) {
  const textbox = box.querySelector<HTMLElement>('[role=textbox]');
  if (!textbox?.isConnected) {
    return false;
  }
  textbox.focus();
  getSelection()?.selectAllChildren(textbox);
  document.execCommand('delete');
  return !textbox.textContent?.trim();
}

const pageTitle = () => document.title.replace(/^\(\d+\) /, '').replace(/ \| Notion$/, '');

const pagePath = (comment: Comment) =>
  location.pathname + ('discussionId' in comment ? `?d=${comment.discussionId.replaceAll('-', '')}` : '');

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function sendLater(box: HTMLElement, clock: HTMLButtonElement) {
  const target = readTarget(box);
  if (!target) {
    return;
  }
  const { isPlainText, ...comment } = target;
  const problem = !comment.text.trim()
    ? 'Write the comment first.'
    : isPlainText
      ? undefined
      : 'Send later takes plain text only, without mentions, links, or formatting.';
  const sendAt = await askSendAt(problem, (sendAt) =>
    scheduleEntry({
      ...comment,
      id: crypto.randomUUID(),
      sendAt,
      title: pageTitle(),
      path: pagePath(comment),
      status: 'pending',
    }),
  );
  if (sendAt && !clearDraft(box)) {
    clock.title = clock.ariaLabel = `Scheduled for ${timeFormat.format(sendAt)}`;
  }
}

function clockIcon() {
  const svg = document.createElementNS(SVG, 'svg');
  const attributes = { viewBox: '0 0 16 16', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' };
  Object.entries(attributes).forEach(([name, value]) => svg.setAttribute(name, value));
  const circle = document.createElementNS(SVG, 'circle');
  Object.entries({ cx: '8', cy: '8', r: '6.25' }).forEach(([name, value]) => circle.setAttribute(name, value));
  const hands = document.createElementNS(SVG, 'path');
  hands.setAttribute('d', 'M8 4.5V8l2.5 1.5');
  svg.append(circle, hands);
  return svg;
}

function clockButton(box: HTMLElement) {
  const clock = Object.assign(document.createElement('button'), { type: 'button', className: BUTTON_CLASS, title: 'Send later', ariaLabel: 'Send later' });
  clock.append(clockIcon());
  clock.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:4px;color:inherit;background:none;opacity:0.6;cursor:pointer';
  // The textbox keeps the focus, so Notion keeps the send buttons on screen.
  clock.addEventListener('mousedown', (event) => event.preventDefault());
  clock.addEventListener('click', (event) => {
    event.stopPropagation();
    sendLater(box, clock).catch(console.error);
  });
  return clock;
}

// The last button of a comment box is "Send comment". A box without a readable target gets no clock button.
function addClockButtons() {
  for (const box of document.querySelectorAll<HTMLElement>('.notion-discussion-input')) {
    const buttons = box.querySelectorAll('[role=button]');
    const send = buttons[buttons.length - 1];
    if (send && !box.querySelector(`.${BUTTON_CLASS}`) && readTarget(box)) {
      send.before(clockButton(box));
    }
  }
}

addClockButtons();
let scanQueued = false;
new MutationObserver(() => {
  if (!scanQueued) {
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      addClockButtons();
    });
  }
}).observe(document.body, { childList: true, subtree: true });
