import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';
import { ToastProvider } from './Toast';

// Helper: wrap MessageInput in ToastProvider so the useToast() hook resolves.
// Without this, render() throws because useToast requires a provider.
function renderInput(props: React.ComponentProps<typeof MessageInput>) {
  return render(<ToastProvider><MessageInput {...props} /></ToastProvider>);
}

// Mock uploadFile to avoid real XHR
vi.mock('../lib/api', () => ({
  uploadFile: vi.fn(),
  api: {
    getMembers: vi.fn(async () => []),
  },
}));

afterEach(() => cleanup());

/** The visible text input (not the hidden file input) */
function getInput() {
  return screen.getByPlaceholderText('Type a message...') as HTMLInputElement;
}

describe('MessageInput', () => {
  it('renders input and send button', () => {
    renderInput({ onSend: vi.fn() });
    expect(getInput()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('calls onSend with trimmed text on Enter', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    renderInput({ onSend });

    const input = getInput();
    await user.type(input, 'hello world{Enter}');

    expect(onSend).toHaveBeenCalledWith('hello world', undefined);
  });

  it('clears input after send', async () => {
    const user = userEvent.setup();
    renderInput({ onSend: vi.fn() });

    const input = getInput();
    await user.type(input, 'hello{Enter}');

    expect(input).toHaveValue('');
  });

  it('does not send empty message', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    renderInput({ onSend });

    const input = getInput();
    await user.type(input, '   {Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });

  it('calls onTyping when user types (throttled)', async () => {
    const onTyping = vi.fn();
    const user = userEvent.setup();
    renderInput({ onSend: vi.fn(), onTyping });

    const input = getInput();
    await user.type(input, 'abc');

    expect(onTyping).toHaveBeenCalledTimes(1);
  });

  it('send button is disabled when input is empty', () => {
    renderInput({ onSend: vi.fn() });
    const btn = screen.getByRole('button', { name: /send/i });
    expect(btn).toBeDisabled();
  });

  it('send button is enabled when input has text', async () => {
    const user = userEvent.setup();
    renderInput({ onSend: vi.fn() });

    await user.type(getInput(), 'hi');
    const btn = screen.getByRole('button', { name: /send/i });
    expect(btn).toBeEnabled();
  });

  it('calls onSend when clicking the Send button', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    renderInput({ onSend });

    await user.type(getInput(), 'click send');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('click send', undefined);
  });

  it('disables input when disabled prop is true', () => {
    renderInput({ onSend: vi.fn(), disabled: true });
    expect(getInput()).toBeDisabled();
  });

  it('has safe-area-bottom class on wrapper for iOS PWA support (T#69)', () => {
    const { container } = renderInput({ onSend: vi.fn() });
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains('safe-area-bottom')).toBe(true);
  });


  it('T#173: blocks send and shows toast when an attachment upload errored', async () => {
    const { uploadFile } = await import('../lib/api');
    (uploadFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('content type not allowed'));

    const onSend = vi.fn();
    const user = userEvent.setup();
    renderInput({ onSend });

    // Drop a rejected upload into the hidden file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['bad payload'], 'bad.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);

    // Wait for the reject to propagate through React state
    await screen.findByText(/content type not allowed/i);

    // Type text and try to send — should be blocked because the attachment errored
    await user.type(getInput(), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
    // Toast should surface the error. Toast renders its text content somewhere in the DOM.
    expect(await screen.findByText(/failed to upload/i)).toBeInTheDocument();
  });

  it('T#173: does not block send when text-only (no attachments)', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    renderInput({ onSend });

    await user.type(getInput(), 'hello{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello', undefined);
  });

  it('T#173: allows send after the errored attachment is removed', async () => {
    const { uploadFile } = await import('../lib/api');
    (uploadFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    const onSend = vi.fn();
    const user = userEvent.setup();
    renderInput({ onSend });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(['x'], 'x.pdf', { type: 'application/pdf' }));
    await screen.findByText(/boom/i);

    // Find the remove-attachment button by its a11y label.
    const removeBtn = screen.getByRole('button', { name: /Remove attachment/i });
    await user.click(removeBtn);

    await user.type(getInput(), 'hello{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello', undefined);
  });
});